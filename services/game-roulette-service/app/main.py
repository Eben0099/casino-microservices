import asyncio
import json
import os
import hashlib
import hmac
import random
import secrets
import time
from datetime import datetime
import redis.asyncio as redis
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Header, HTTPException, Depends
from sqlalchemy import select

from .database import engine, SessionLocal
from .models import RouletteRound
from .rules import get_number_properties, calculate_stats
from .settings import load_settings, save_settings, DEFAULT_SETTINGS
from . import jackpot_client, kiosk_validator

# Number of synthetic results used to populate stats on the very first boot
# (only when Redis history is empty — never overwrites real production data).
INITIAL_HISTORY_SEED_COUNT = 200

app = FastAPI(
    title="AGDTech Roulette Engine",
    root_path=os.getenv("ROOT_PATH", "")
)

# Configuration des temps (en secondes) définis par le protocole
TIME_BETTING = 30.0
TIME_BETS_CLOSING = 5.0
TIME_SPINNING = 12.0
TIME_RESULT = 5.0

redis_client = None

# État global du jeu pour les nouveaux arrivants (welcome)
current_game_state = {
    "round_id": "",
    "phase": "Betting",
    "started_at": 0.0,
    "duration": TIME_BETTING,
    "result": None
}

# Dernier snapshot de stats (rejoué aux clients qui se connectent après welcome
# pour qu'ils n'aient pas un dashboard vide pendant ~47s en attendant le 1er round)
current_stats = None

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        # On groupe les connexions par kiosk_id pour pouvoir broadcaster les
        # jackpots bronze/silver/gold seulement aux clients concernés.
        # La clé None représente les clients qui n'ont pas envoyé de kiosk_id.
        self.by_kiosk: dict[str | None, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, kiosk_id: str | None = None):
        await websocket.accept()
        self.active_connections.append(websocket)
        self.by_kiosk.setdefault(kiosk_id, []).append(websocket)
        # On accroche le kiosk_id sur le scope du WS pour le retrouver facilement
        # côté disconnect et pour les futurs sends ciblés.
        try:
            websocket.scope["kiosk_id"] = kiosk_id
        except Exception:
            pass
        await self.send_welcome(websocket, kiosk_id)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        kiosk_id = None
        try:
            kiosk_id = websocket.scope.get("kiosk_id")
        except Exception:
            pass
        bucket = self.by_kiosk.get(kiosk_id)
        if bucket and websocket in bucket:
            bucket.remove(websocket)
            if not bucket:
                # Nettoie le bucket vide pour éviter une croissance illimitée
                self.by_kiosk.pop(kiosk_id, None)

    async def broadcast(self, message: dict):
        for connection in self.active_connections.copy():
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)

    async def broadcast_to_kiosk(self, kiosk_id: str | None, message: dict):
        for connection in list(self.by_kiosk.get(kiosk_id, [])):
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)

    async def broadcast_jackpots(self):
        """Envoie un `jackpot_updated` à chaque kiosk avec sa propre vue.

        Fetches fresh data from jackpot-service for each distinct kiosk bucket.
        On failure fetch_jackpots returns zeros so the broadcast is always safe.
        """
        # Iterate over a copy of keys: sends can trigger disconnect() which
        # mutates by_kiosk.
        for kiosk_id in list(self.by_kiosk.keys()):
            jackpots = await jackpot_client.fetch_jackpots(kiosk_id)
            message = {
                "type": "jackpot_updated",
                "serverTime": time.time(),
                "jackpots": jackpots,
            }
            await self.broadcast_to_kiosk(kiosk_id, message)

    async def send_welcome(self, websocket: WebSocket, kiosk_id: str | None = None):
        # Envoie l'état instantané du jeu + le snapshot jackpots pour que
        # les cartes header/footer soient déjà calées sur la vérité serveur.
        # kiosk_id=None is accepted by fetch_jackpots; locals will come back 0.
        jackpots = await jackpot_client.fetch_jackpots(kiosk_id)
        welcome_msg = {
            "type": "welcome",
            "serverTime": time.time(),
            "currentGameId": current_game_state["round_id"],
            "currentPhase": current_game_state["phase"],
            "phaseStartedAt": current_game_state["started_at"],
            "phaseDuration": current_game_state["duration"],
            "result": current_game_state["result"],
            "jackpots": jackpots,
        }
        await websocket.send_json(welcome_msg)

        # Rejoue le dernier stats_updated connu pour que le dashboard du client
        # soit peuplé immédiatement (sinon il reste vide jusqu'au prochain round).
        if current_stats is not None:
            await websocket.send_json({
                "type": "stats_updated",
                "serverTime": time.time(),
                "gameId": current_game_state["round_id"],
                "stats": current_stats
            })

manager = ConnectionManager()

# ENGINE_MODE drives the runtime topology:
#   - "cyclic"     (default, legacy): the engine runs phases on a loop,
#     broadcasts welcome/phase_changed/result_revealed to Unity kiosks,
#     and is consumed via ticket-service settlement. Used in standalone mode.
#   - "on_demand"  (Phase 5+, integrated AGD): no game loop, no WebSocket
#     traffic, no ticket-service relays. The engine exposes only:
#       - POST /internal/spins   (called by agd-casino-service)
#       - GET  /verify/:round_id (public provably-fair audit)
#       - GET  /status, /admin/history (unchanged)
# Toggle via env. Same code, two deployments.
ENGINE_MODE = os.getenv("ENGINE_MODE", "cyclic").strip().lower()


@app.on_event("startup")
async def startup_event():
    global redis_client
    redis_url = os.getenv("REDIS_URL", "redis://casino_redis:6379/0")
    redis_client = redis.from_url(redis_url, decode_responses=True)

    if ENGINE_MODE == "on_demand":
        # On-demand mode: the engine is a pure REST RNG/persistor. No game
        # loop, no Unity WS, no jackpot relay. The DB is still used
        # (RouletteRound persists every spin so /verify/:round_id works).
        print("ENGINE_MODE=on_demand — skipping game_loop, WS, jackpot relays")
        return

    # Cyclic mode (legacy / standalone): full Unity-facing engine.
    asyncio.create_task(game_loop())
    asyncio.create_task(forward_admin_events())
    asyncio.create_task(consume_jackpot_updated())


async def forward_admin_events():
    """Relais Redis -> WebSocket pour les events publies par les autres services
    (ticket creations, payouts, settlements, etc). Permet au backoffice de
    rafraichir ses tableaux en temps reel sans polling.
    """
    if not redis_client:
        return
    pubsub = redis_client.pubsub()
    await pubsub.subscribe("admin-events")
    print("📡 admin-events relay attached to /ws/roulette broadcaster")
    async for message in pubsub.listen():
        if message["type"] != "message":
            continue
        try:
            payload = json.loads(message["data"])
        except Exception:
            continue
        await manager.broadcast(payload)


async def consume_jackpot_updated():
    """Subscribes to `jackpot-updated` published by jackpot-service.

    Message shape (from jackpot-service):
        {"game_id": "ROULETTE-TBL1" | null, "kiosk_code": "<code>" | null,
         "pots": [...]}

    Routing logic:
    - game_id is null or "GLOBAL": treat as a global change — re-broadcast
      fresh jackpots to ALL connected kiosks.
    - game_id == ROULETTE-TBL1 and kiosk_code is set: re-broadcast only to
      the matching kiosk bucket (and to the None/global bucket, since those
      clients display the general + spin2win pots too).
    - game_id == ROULETTE-TBL1 and kiosk_code is null: re-broadcast to all
      kiosks (a game-level pot changed — all need refreshed spin2win/general).
    - game_id for a different game (e.g. KENO-DRAW1): ignore.

    The `pots` payload from jackpot-service is intentionally ignored here;
    we always re-fetch via fetch_jackpots() so the mapping logic is in one
    place and kiosk-specific locals are always correct.
    """
    if not redis_client:
        return
    pubsub = redis_client.pubsub()
    await pubsub.subscribe("jackpot-updated")
    print("jackpot-updated subscriber attached (jackpot-service relay)")
    async for message in pubsub.listen():
        if message["type"] != "message":
            continue
        try:
            payload = json.loads(message["data"])
        except Exception:
            continue
        try:
            game_id = payload.get("game_id") or None
            kiosk_code = payload.get("kiosk_code") or None

            # Determine broadcast scope.
            if game_id is None or game_id == "GLOBAL":
                # Global pot change — push fresh snapshot to every kiosk.
                await manager.broadcast_jackpots()
            elif game_id == "ROULETTE-TBL1":
                if kiosk_code:
                    # Kiosk-scoped update: refresh just that bucket plus the
                    # None bucket (global-only clients whose general/spin2win
                    # may have changed too).
                    for kid in (kiosk_code, None):
                        jackpots = await jackpot_client.fetch_jackpots(kid)
                        await manager.broadcast_to_kiosk(kid, {
                            "type": "jackpot_updated",
                            "serverTime": time.time(),
                            "jackpots": jackpots,
                        })
                else:
                    # Game-level pot changed — all kiosks need a refresh.
                    await manager.broadcast_jackpots()
            # else: message is for a different game (e.g. KENO-DRAW1) — ignore.
        except Exception as exc:
            print(f"jackpot-updated handler error: {exc}")

@app.on_event("shutdown")
async def shutdown_event():
    if redis_client:
        await redis_client.close()

def generate_provably_fair_result(server_seed: str, nonce: str) -> str:
    hmac_obj = hmac.new(
        key=server_seed.encode('utf-8'),
        msg=nonce.encode('utf-8'),
        digestmod=hashlib.sha256
    )
    hash_hex = hmac_obj.hexdigest()
    decimal_value = int(hash_hex[:8], 16)
    return str(decimal_value % 37)

async def set_game_phase(phase: str, duration: float, round_id: str, result=None, server_seed_hash: str = None):
    current_game_state.update({
        "round_id": round_id,
        "phase": phase,
        "started_at": time.time(),
        "duration": duration,
        "result": result,
        "server_seed_hash": server_seed_hash,
    })

    # `serverSeedHash` is the provably-fair commitment: it is published BEFORE
    # the reveal so any consumer (the AGD integration, an external auditor) can
    # record it up-front and later check the revealed seed hashes to it. The
    # seed itself is only released in ROUND_FINISHED.
    await manager.broadcast({
        "type": "phase_changed",
        "serverTime": time.time(),
        "gameId": round_id,
        "phase": phase,
        "duration": duration,
        "serverSeedHash": server_seed_hash,
    })

    # Optional fallback for other microservices via Redis
    if redis_client:
        await redis_client.set("roulette:current_state", json.dumps(current_game_state))
        await redis_client.publish("roulette-events", json.dumps({
            "type": "phase_changed",
            "serverTime": time.time(),
            "gameId": round_id,
            "phase": phase,
            "duration": duration,
            "serverSeedHash": server_seed_hash,
        }))

async def game_loop():
    global current_stats
    print("🎰 Moteur de Roulette (Provably Fair) + WebSockets Unity démarré !")


    # On charge l'historique existant en base si disponible.
    # Format Redis : chaque entree est un JSON `{"number": int, "round_id": str|None}`.
    # On accepte aussi l'ancien format (entier brut) pour compat ascendante : si
    # l'instance vient d'etre mise a jour mais que la liste Redis contient encore
    # des "23" simples, on les promeut en `{number:23, round_id:None}`.
    history_entries = []
    try:
        if redis_client:
            redis_hist = await redis_client.lrange("roulette:history", 0, 199)
            if redis_hist:
                for x in reversed(redis_hist):
                    try:
                        parsed = json.loads(x)
                        if isinstance(parsed, dict) and "number" in parsed:
                            history_entries.append({
                                "number": int(parsed["number"]),
                                "round_id": parsed.get("round_id"),
                            })
                        else:
                            history_entries.append({"number": int(parsed), "round_id": None})
                    except (ValueError, json.JSONDecodeError):
                        # ancien format : juste un int
                        history_entries.append({"number": int(x), "round_id": None})
    except Exception:
        pass

    # Premier boot avec Redis vide : on amorce l'historique avec des résultats
    # aléatoires pour que les stats (hot/cold/freq/percentages) aient une
    # distribution visuellement réaliste dès la 1re connexion. On ne touche
    # jamais à un historique déjà existant — la prod ne sera pas écrasée.
    if not history_entries and INITIAL_HISTORY_SEED_COUNT > 0:
        history_entries = [
            {"number": random.randint(0, 36), "round_id": None}
            for _ in range(INITIAL_HISTORY_SEED_COUNT)
        ]
        if redis_client:
            try:
                # LPUSH met le plus récent en tête → on push de l'ancien au plus récent
                for e in history_entries:
                    await redis_client.lpush("roulette:history", json.dumps(e))
                await redis_client.ltrim("roulette:history", 0, 199)
            except Exception as e:
                print(f"[seed] Redis lpush failed: {e}")
        print(f"[seed] Historique amorcé avec {len(history_entries)} résultats aléatoires")

    # Pré-calcule les stats initiales pour que les clients qui se connectent
    # AVANT la fin du 1er round aient déjà un dashboard peuplé via welcome.
    current_stats = calculate_stats(history_entries)

    while True:
        try:
            # Charge les paramètres dynamiques au début de chaque tour
            settings = await load_settings(redis_client)

            # Mode maintenance : si jeu désactivé, on attend
            if not settings.get("enabled", True):
                await set_game_phase("Maintenance", 5.0, "")
                await asyncio.sleep(5.0)
                continue

            t_betting = settings["betting_duration"]
            t_closing = settings["bets_closing_duration"]
            t_spinning = settings["spinning_duration"]
            t_result = settings["result_duration"]

            round_id = f"ROUND-{int(time.time())}"

            # --- GÉNÉRATION CRYPTOGRAPHIQUE ---
            server_seed = secrets.token_hex(16)
            server_seed_hash = hashlib.sha256(server_seed.encode('utf-8')).hexdigest()
            winning_number_str = generate_provably_fair_result(server_seed, round_id)
            winning_number = int(winning_number_str)
            result_payload = get_number_properties(winning_number)

            # ==========================================
            # ÉTAT 1 : BETTING
            # ==========================================
            print(f"🟢 [BETTING] {round_id} ({t_betting}s)")
            await set_game_phase("Betting", t_betting, round_id, server_seed_hash=server_seed_hash)
            await asyncio.sleep(t_betting)

            # ==========================================
            # ÉTAT 2 : BETS CLOSING
            # ==========================================
            print(f"🟠 [BETS CLOSING] {round_id}")
            await set_game_phase("BetsClosing", t_closing, round_id, server_seed_hash=server_seed_hash)
            await asyncio.sleep(t_closing)

            # ==========================================
            # ÉTAT 3 : SPINNING
            # ==========================================
            print(f"🟡 [SPINNING] {round_id} - Target: {winning_number}")
            await set_game_phase("Spinning", TIME_SPINNING, round_id, result_payload, server_seed_hash=server_seed_hash)

            # The Unity wheel needs the result at the START of Spinning so it can
            # spin for the full phase duration and land exactly when the phase ends.
            result_revealed_payload = {
                "type": "result_revealed",
                "serverTime": time.time(),
                "gameId": round_id,
                "result": result_payload
            }
            await manager.broadcast(result_revealed_payload)
            if redis_client:
                await redis_client.publish("roulette-events", json.dumps(result_revealed_payload))

            await asyncio.sleep(TIME_SPINNING)

            # Update history and calculate stats. On stocke `{number, round_id}`
            # pour que le front puisse afficher quel tour a produit chaque numero.
            entry = {"number": winning_number, "round_id": round_id}
            history_entries.append(entry)
            if len(history_entries) > 200:
                history_entries.pop(0)

            if redis_client:
                await redis_client.lpush("roulette:history", json.dumps(entry))
                await redis_client.ltrim("roulette:history", 0, 199)

            stats_payload = calculate_stats(history_entries)
            current_stats = stats_payload

            # --- STATS_UPDATED ---
            stats_updated_payload = {
                "type": "stats_updated",
                "serverTime": time.time(),
                "gameId": round_id,
                "stats": stats_payload
            }
            await manager.broadcast(stats_updated_payload)
            if redis_client:
                await redis_client.publish("roulette-events", json.dumps(stats_updated_payload))

            # --- JACKPOT_UPDATED ---
            # Per-round fallback broadcast: respects protocol ordering
            # stats_updated → jackpot_updated → phase_changed(Result).
            # Live updates from jackpot-service arrive independently via
            # consume_jackpot_updated() which subscribes to jackpot-updated.
            try:
                await manager.broadcast_jackpots()
            except Exception as e:
                print(f"broadcast_jackpots failed: {e}")

            # ==========================================
            # ÉTAT 4 : RESULT
            # ==========================================
            print(f"🔴 [RESULT] {round_id} - Gagnant: {winning_number}")
            await set_game_phase("Result", t_result, round_id, result_payload, server_seed_hash=server_seed_hash)
            
            # --- NOTIFY TICKET SERVICE ---
            # Reveal the server_seed here (after betting closed) so downstream
            # consumers can store the REAL provably-fair seed and expose a
            # verifiable /verify endpoint. winning_number = int(hmac_sha256(
            # server_seed, round_id).hexdigest()[:8], 16) mod 37.
            if redis_client:
                await redis_client.publish("roulette-events", json.dumps({
                    "event": "ROUND_FINISHED",
                    "round_id": round_id,
                    "winning_number": str(winning_number),
                    "server_seed": server_seed,
                    "server_seed_hash": server_seed_hash
                }))
            
            # Sauvegarde en base de données
            async with SessionLocal() as db:
                new_round = RouletteRound(
                    round_id=round_id,
                    winning_number=str(winning_number),
                    server_seed=server_seed,
                    server_seed_hash=server_seed_hash
                )
                db.add(new_round)
                await db.commit()

            await asyncio.sleep(t_result)

        except Exception as e:
            print(f"Erreur critique dans la boucle de jeu: {e}")
            await asyncio.sleep(5)

@app.websocket("/ws/roulette")
async def websocket_endpoint(websocket: WebSocket):
    # kiosk_id arrive en query string (`?kiosk_id=AB12`). Spec 1.1.1.
    # On normalise les chaînes vides en None pour que les clients sans
    # kiosk_id (ex. backoffice) tombent dans le bucket "global only".
    raw_kid = websocket.query_params.get("kiosk_id")
    kiosk_id = raw_kid.strip().upper() if isinstance(raw_kid, str) and raw_kid.strip() else None

    # Si un kiosk_id est fourni, on le valide contre agent-service.
    # IMPORTANT : il faut accept() AVANT d'envoyer un close code applicatif
    # (4404). Sinon Starlette transforme le close pré-accept en HTTP 403
    # à l'upgrade, ce qui masque le vrai motif côté client.
    # Un kiosk_id absent reste autorisé (le client ne verra que les
    # jackpots globaux).
    if kiosk_id:
        valid = await kiosk_validator.is_valid_kiosk_code(kiosk_id, redis_client)
        if not valid:
            await websocket.accept()
            try:
                await websocket.send_json({
                    "type": "error",
                    "code": 4404,
                    "reason": "Invalid kiosk_id",
                })
            except Exception:
                pass
            await websocket.close(code=4404, reason="Invalid kiosk_id")
            return

    await manager.connect(websocket, kiosk_id)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                payload = json.loads(data)
                if payload.get("type") == "ping":
                    await websocket.send_json({
                        "type": "pong",
                        "clientTime": payload.get("clientTime"),
                        "serverTime": time.time()
                    })
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# --- ROUTES CLASSIQUES ---

@app.get("/status")
async def get_status():
    return current_game_state

ADMIN_API_KEY = os.getenv("ADMIN_API_KEY", "CleSuperSecreteBackoffice2026")

def verify_admin_key(x_api_key: str = Header(None)):
    if x_api_key != ADMIN_API_KEY:
        raise HTTPException(status_code=403, detail="Accès refusé.")
    return x_api_key


# --- ON-DEMAND ENGINE (Phase 5: AGD-integrated mode) ---

ROULETTE_ENGINE_INTERNAL_API_KEY = os.getenv(
    "ROULETTE_ENGINE_INTERNAL_API_KEY", "DevRouletteInternal2026"
)


def verify_internal_key(x_internal_key: str = Header(None)):
    """
    Internal-network auth for /internal/spins.
    Stricter than the admin key — only the AGD casino service should hold this.
    """
    if x_internal_key != ROULETTE_ENGINE_INTERNAL_API_KEY:
        raise HTTPException(status_code=401, detail="invalid internal key")
    return x_internal_key


@app.post("/internal/spins", dependencies=[Depends(verify_internal_key)])
async def internal_resolve_spin(payload: dict):
    """
    Resolves a single spin synchronously.

    Designed to be called by `agd-casino-service` (NestJS) which provides
    its own UUID v4 `spin_id` (used as wallet referenceId). The Python
    engine produces a stable `external_round_id` derived from spin_id and
    timestamp, persists everything in `roulette_rounds`, and returns the
    payload the casino orchestrator needs.

    Request body:
      {
        "spin_id":     "<UUID v4>",   # required
        "game_code":   "ROULETTE_EU",  # optional, informational
        "client_seed": "<hex|str>",    # optional
        "bets":        [ {bet_type, bet_target, amount}, ... ]  # optional, opaque
      }

    Response 200:
      {
        "external_round_id": "ROUND-<unix-ms>-<spin8>",
        "winning_number":    "0".."36",
        "seed_hash":         "<64 hex>",
        "server_seed":       "<32 hex>",
        "client_seed":       "<echo>" | null,
        "metadata":          { "color": "Red", "isEven": false, "isHigh": false }
      }
    """
    spin_id = (payload or {}).get("spin_id")
    if not isinstance(spin_id, str) or len(spin_id) < 8:
        raise HTTPException(status_code=400, detail="spin_id is required")
    client_seed = (payload or {}).get("client_seed") or None
    game_code = (payload or {}).get("game_code") or "ROULETTE_EU"

    # 1. Build a stable round_id (engine-native) embedding spin_id for traceability.
    external_round_id = f"ROUND-{int(time.time() * 1000)}-{spin_id[:8]}"

    # 2. Provably-fair: generate server_seed + hash, derive winning_number.
    #    Mirror of the cyclic path so the same verify algorithm works.
    server_seed = secrets.token_hex(16)
    server_seed_hash = hashlib.sha256(server_seed.encode("utf-8")).hexdigest()

    # If a client_seed is provided, mix it into the HMAC message so both sides
    # influence the outcome (cf. CASINO_INTEGRATION_PLAN §10).
    hmac_msg = (
        f"{external_round_id}:{client_seed}"
        if client_seed
        else external_round_id
    )
    winning_number = generate_provably_fair_result(server_seed, hmac_msg)

    # 3. Enrich with UI-friendly metadata (color, parity, half).
    props = get_number_properties(int(winning_number))

    # 4. Persist for audit and /verify/:round_id lookups.
    try:
        async with SessionLocal() as db:
            db.add(
                RouletteRound(
                    round_id=external_round_id,
                    winning_number=str(winning_number),
                    server_seed=server_seed,
                    server_seed_hash=server_seed_hash,
                )
            )
            await db.commit()
    except Exception as e:
        # Persistence failure is non-fatal for the spin itself — the casino
        # service receives the result and we'll alert ops. The /verify
        # endpoint would simply 404 for this round_id.
        print(f"⚠️  on_demand round persist failed: {e}")

    return {
        "external_round_id": external_round_id,
        "winning_number": str(winning_number),
        "seed_hash": server_seed_hash,
        "server_seed": server_seed,
        "client_seed": client_seed,
        "metadata": {
            "color": props.get("color"),
            "isEven": props.get("isEven"),
            "isHigh": props.get("isHigh"),
            "game_code": game_code,
            "engine_mode": ENGINE_MODE,
        },
    }


@app.get("/verify/{round_id}")
async def verify_round(round_id: str):
    """
    Public provably-fair audit endpoint. Returns the stored server_seed
    (revealed post-round) so any external auditor can recompute:

        sha256(server_seed)                            == seed_hash
        int(hmac_sha256(server_seed, msg)[:8], 16) % 37 == winning_number

    where `msg` is `round_id` (no client_seed) or `round_id:client_seed`.

    404 if the round id is unknown.
    """
    async with SessionLocal() as db:
        result = await db.execute(
            select(RouletteRound).where(RouletteRound.round_id == round_id)
        )
        round_row = result.scalar_one_or_none()
    if not round_row:
        raise HTTPException(status_code=404, detail="round not found")

    return {
        "round_id": round_row.round_id,
        "winning_number": round_row.winning_number,
        "server_seed": round_row.server_seed,
        "server_seed_hash": round_row.server_seed_hash,
        "algorithm": "winning_number = int(hmac_sha256(server_seed, round_id [, ':', client_seed])[:8], 16) mod 37",
        "created_at": round_row.created_at.isoformat() if round_row.created_at else None,
    }

@app.get("/admin/history", dependencies=[Depends(verify_admin_key)])
async def get_roulette_history():
    async with SessionLocal() as db:
        result = await db.execute(select(RouletteRound).order_by(RouletteRound.created_at.desc()).limit(10))
        rounds = result.scalars().all()
        return rounds


@app.get("/admin/settings", dependencies=[Depends(verify_admin_key)])
async def get_settings():
    """Renvoie les paramètres dynamiques actuels du moteur."""
    return await load_settings(redis_client)


@app.patch("/admin/settings", dependencies=[Depends(verify_admin_key)])
async def patch_settings(payload: dict):
    """Met à jour les paramètres dynamiques. Effet immédiat au prochain cycle."""
    return await save_settings(redis_client, payload)


@app.get("/settings/public")
async def public_settings():
    """Endpoint public pour le ticket-service : min_stake, max_stake, enabled."""
    s = await load_settings(redis_client)
    return {
        "min_stake": s["min_stake"],
        "max_stake": s["max_stake"],
        "enabled": s["enabled"],
    }


# --- ROUTES JACKPOTS ---

@app.get("/jackpots")
async def get_jackpots(kiosk_id: str | None = None):
    """Public proxy: returns the 5-key jackpot dict sourced from jackpot-service.

    Keeps the same response shape as before so the existing Unity/cashier
    frontend requires no changes.  If kiosk_id is absent the locals
    (bronze/silver/gold) come back as 0.
    """
    kid = kiosk_id.strip() if isinstance(kiosk_id, str) and kiosk_id.strip() else None
    jackpots = await jackpot_client.fetch_jackpots(kid)
    return {"jackpots": jackpots, "kiosk_id": kid}


@app.get("/admin/jackpots/all", dependencies=[Depends(verify_admin_key)])
async def admin_list_all_jackpots():
    """Jackpot rule management has moved to jackpot-service.

    Use GET /api/jackpots/admin/pots instead.
    """
    raise HTTPException(
        status_code=410,
        detail=(
            "Jackpot administration has moved to jackpot-service. "
            "Use GET /api/jackpots/admin/pots."
        ),
    )


@app.patch("/admin/jackpots", dependencies=[Depends(verify_admin_key)])
async def patch_jackpots():
    """Jackpot rule management has moved to jackpot-service.

    Use PATCH /api/jackpots/admin/pots instead.
    """
    raise HTTPException(
        status_code=410,
        detail=(
            "Jackpot administration has moved to jackpot-service. "
            "Use PATCH /api/jackpots/admin/pots."
        ),
    )
