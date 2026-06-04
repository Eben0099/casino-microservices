"""Keno game engine — VOLKENO WebSocket protocol (BACKEND.md v1.1).

Phase cycle: idle → preLaunch → draw → results → (repeat)

All timestamps are epoch milliseconds (int(time.time() * 1000)).
drawId increments by 1 at the START of every idle phase.

WebSocket endpoints:
    /ws/keno     — primary
    /ws/volkeno  — alias (same handler)

Kiosk auth (BACKEND.md §"Kiosk authentication"):
    - kiosk_id ABSENT        → allow as global-only (admin / backoffice)
    - kiosk_id NON-EMPTY + VALID   → accept + welcome
    - kiosk_id NON-EMPTY + INVALID → HTTP 403 at handshake (close BEFORE accept)

Redis channels:
    Publish   → keno-events      (ROUND_FINISHED)
    Subscribe ← jackpot-updated  (jackpot-service authority broadcasts)
"""

import asyncio
import hashlib
import json
import os
import random
import secrets
import time
from datetime import datetime, timezone

import redis.asyncio as redis
from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from .database import SessionLocal
from .models import KenoDraw
from .rules import calculate_stats
from .settings import DEFAULT_SETTINGS, load_settings, save_settings
from .keno_rng import draw_numbers
from . import jackpot_client, kiosk_validator

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Keno Engine (VOLKENO)",
    root_path=os.getenv("ROOT_PATH", ""),
)

ADMIN_API_KEY = os.getenv("ADMIN_API_KEY", "CleSuperSecreteBackoffice2026")

# --- Debug tirage -----------------------------------------------------------
# Les 20 numéros sont désormais générés au début de l'IDLE (avant la première
# vente) : logués à la génération et servis par GET /admin/debug/draw (clé
# admin). Ils restent privés (jamais dans welcome/phase_changed/current-round)
# jusqu'à la phase draw — draw_locked reste le moment de révélation publique.
# ENGINE_DEBUG_LOG_DRAWS=0 coupe le log console (l'endpoint reste).
DEBUG_LOG_DRAWS = os.getenv("ENGINE_DEBUG_LOG_DRAWS", "1") == "1"

# Number of synthetic history entries to seed Redis on first boot
INITIAL_HISTORY_SEED_COUNT = 50

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------

redis_client = None

# Monotonic draw counter (int).  Bumped at the START of each idle phase.
# Initialised to 0 here; game_loop sets it properly on its first iteration.
current_draw_id: int = 0

# Live phase state — serialised to welcome messages and keno:current_state
current_phase_state: dict = {
    "draw_id": 0,
    "phase": "idle",
    "phase_started_at": 0,     # epoch ms
    "phase_duration_ms": 0,    # ms
    "drawn_numbers": None,     # list[int] or None
    # Client win-celebration overlay duration (ms); refreshed each loop from
    # keno:settings so admin changes apply live. Sent in welcome + jackpot_hit.
    "celebration_duration_ms": 10000,
}

# Jackpot hits that arrived OUTSIDE the idle phase are queued here and flushed
# at the next idle entry, so the celebration always plays while the VOLKENO
# stats dashboard is on screen (the win/payout already happened at sale time —
# only the on-screen celebration is timed).
pending_hits: list[dict] = []

# Latest StatsSnapshot (BACKEND.md §3) — served immediately in welcome so
# the dashboard is never blank on reconnect.
current_stats: dict | None = None

# Snapshot du tirage courant côté génération — servi UNIQUEMENT par
# /admin/debug/draw (clé admin). Jamais broadcasté avant la phase draw.
current_debug_draw: dict | None = None


# ---------------------------------------------------------------------------
# ms helper
# ---------------------------------------------------------------------------

def _now_ms() -> int:
    return int(time.time() * 1000)


# ---------------------------------------------------------------------------
# ConnectionManager
# ---------------------------------------------------------------------------

class ConnectionManager:
    """Per-kiosk WebSocket connection registry.

    Provides:
    - broadcast()            → all connected clients
    - broadcast_to_kiosk()   → all clients for a specific kiosk_id
    - broadcast_jackpots()   → send BOTH jackpot_updated AND medals_updated
                               to every connected kiosk (each gets its own view)
    - broadcast_medals()     → send medals_updated to a single kiosk (kept for
                               legacy / targeted refresh paths)
    - send_welcome()         → BACKEND.md welcome message
    """

    def __init__(self) -> None:
        self.active_connections: list[WebSocket] = []
        self.by_kiosk: dict[str | None, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, kiosk_id: str | None = None) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)
        self.by_kiosk.setdefault(kiosk_id, []).append(websocket)
        try:
            websocket.scope["kiosk_id"] = kiosk_id
        except Exception:
            pass
        await self.send_welcome(websocket, kiosk_id)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        kiosk_id: str | None = None
        try:
            kiosk_id = websocket.scope.get("kiosk_id")
        except Exception:
            pass
        bucket = self.by_kiosk.get(kiosk_id)
        if bucket and websocket in bucket:
            bucket.remove(websocket)
            if not bucket:
                self.by_kiosk.pop(kiosk_id, None)

    async def broadcast(self, message: dict) -> None:
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)

    async def broadcast_to_kiosk(self, kiosk_id: str | None, message: dict) -> None:
        for connection in list(self.by_kiosk.get(kiosk_id, [])):
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)

    async def broadcast_jackpots(self) -> None:
        """Send BOTH ``jackpot_updated`` and ``medals_updated`` to every connected
        kiosk with its own view.

        We fetch the jackpot-service snapshot once per kiosk and emit the two
        events back-to-back — keeps medals fresh on every round end / every
        contribution, including for kiosks that didn't sell the ticket.
        """
        now = _now_ms()
        for kiosk_id in list(self.by_kiosk.keys()):
            jackpot, medals = await jackpot_client.get_jackpots_for_kiosk(kiosk_id)
            await self.broadcast_to_kiosk(kiosk_id, {
                "type": "jackpot_updated",
                "serverTime": now,
                "jackpot": jackpot,
            })
            await self.broadcast_to_kiosk(kiosk_id, {
                "type": "medals_updated",
                "serverTime": now,
                "medals": medals,
            })

    async def broadcast_medals(self, kiosk_id: str) -> None:
        """Send ``medals_updated`` only to sockets for ``kiosk_id``."""
        _jackpot, medals = await jackpot_client.get_jackpots_for_kiosk(kiosk_id)
        await self.broadcast_to_kiosk(kiosk_id, {
            "type": "medals_updated",
            "serverTime": _now_ms(),
            "medals": medals,
        })

    async def broadcast_hit(self, payload: dict) -> None:
        """Relay a jackpot HIT to the right displays as a one-shot ``jackpot_hit``.

        GLOBAL / GAME pots are shared, so every connected display celebrates.
        LOCAL pots are per-kiosk → only that kiosk's display fires. We stamp the
        engine's own current ``drawId`` so the client can correlate, and
        UPPERCASE the pot's ``kiosk_code`` to match the connection buckets (which
        key on the uppercased ``kiosk_id`` query param — a lowercase code would
        otherwise reach no one).
        """
        scope = (payload.get("scope") or "").upper()
        frame = {
            "type": "jackpot_hit",
            "serverTime": _now_ms(),
            "scope": scope,
            "tier": payload.get("tier"),
            "amount": payload.get("payout"),
            "cycleNumber": payload.get("cycle_number"),
            "hitId": payload.get("hit_id"),
            "drawId": current_phase_state["draw_id"],
            # Winning ticket code (so player + agent know who won); may be null.
            "winnerTicketCode": payload.get("winner_short_code"),
            # How long the client celebration overlay should stay up (admin-set).
            "celebrationDurationMs": current_phase_state.get("celebration_duration_ms", 10000),
        }
        if scope == "LOCAL":
            kiosk = payload.get("kiosk_code")
            if kiosk:
                await self.broadcast_to_kiosk(kiosk.upper(), frame)
        else:
            await self.broadcast(frame)

    async def send_welcome(
        self, websocket: WebSocket, kiosk_id: str | None = None
    ) -> None:
        """Send BACKEND.md ``welcome`` immediately on (re)connect."""
        jackpot, medals = await jackpot_client.get_jackpots_for_kiosk(kiosk_id)
        stats_snap = current_stats or {
            "recentDraws": [],
            "hot": [],
            "cold": [],
            "consecutive": [],
            "rowDistribution": [0] * 8,
            "colDistribution": [0] * 10,
        }
        msg = {
            "type": "welcome",
            "serverTime": _now_ms(),
            "currentDrawId": current_phase_state["draw_id"],
            "phase": current_phase_state["phase"],
            "phaseStartedAt": current_phase_state["phase_started_at"],
            "phaseDurationMs": current_phase_state["phase_duration_ms"],
            "drawnNumbers": current_phase_state["drawn_numbers"],
            "stats": stats_snap,
            "jackpot": jackpot,
            "medals": medals,
            "celebrationDurationMs": current_phase_state.get("celebration_duration_ms", 10000),
        }
        try:
            await websocket.send_json(msg)
        except Exception:
            pass


manager = ConnectionManager()


# ---------------------------------------------------------------------------
# Startup / shutdown
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def startup_event() -> None:
    global redis_client
    redis_url = os.getenv("REDIS_URL", "redis://casino_redis:6379/0")
    redis_client = redis.from_url(redis_url, decode_responses=True)

    asyncio.create_task(game_loop())
    asyncio.create_task(consume_jackpot_updated())
    asyncio.create_task(consume_jackpot_hit())


@app.on_event("shutdown")
async def shutdown_event() -> None:
    if redis_client:
        await redis_client.close()


# ---------------------------------------------------------------------------
# Admin key dependency
# ---------------------------------------------------------------------------

def verify_admin_key(x_api_key: str = Header(None)) -> str:
    if x_api_key != ADMIN_API_KEY:
        raise HTTPException(status_code=403, detail="Acces refuse.")
    return x_api_key


# ---------------------------------------------------------------------------
# Phase transition helper
# ---------------------------------------------------------------------------

async def _set_phase(
    phase: str,
    draw_id: int,
    duration_ms: int,
    drawn_numbers: list[int] | None = None,
) -> None:
    """Update shared state and broadcast ``phase_changed``."""
    started_at = _now_ms()
    current_phase_state.update({
        "draw_id": draw_id,
        "phase": phase,
        "phase_started_at": started_at,
        "phase_duration_ms": duration_ms,
        "drawn_numbers": drawn_numbers,
    })

    msg = {
        "type": "phase_changed",
        "serverTime": _now_ms(),
        "drawId": draw_id,
        "phase": phase,
        "startedAt": started_at,
        "durationMs": duration_ms,
    }
    await manager.broadcast(msg)

    # Persist current state so ticket-service can gate bets (phase == "idle")
    if redis_client:
        await redis_client.set(
            "keno:current_state",
            json.dumps({
                "draw_id": draw_id,
                "phase": phase,
                "phase_started_at": started_at,
                "phase_duration_ms": duration_ms,
            }),
        )


# ---------------------------------------------------------------------------
# Game loop
# ---------------------------------------------------------------------------

async def game_loop() -> None:
    global current_draw_id, current_stats, current_debug_draw
    print("[keno] Game loop started — VOLKENO protocol active")

    # ---- Load / seed history from Redis ------------------------------------
    history_entries: list[dict] = []
    try:
        if redis_client:
            redis_hist = await redis_client.lrange("keno:history", 0, 199)
            if redis_hist:
                # lrange returns newest-first (LPUSH convention); reverse for
                # chronological order.
                for raw in reversed(redis_hist):
                    try:
                        entry = json.loads(raw)
                        history_entries.append({
                            "round_id": int(entry["round_id"]),
                            "numbers": list(entry["numbers"]),
                            "time": entry.get("time", "00:00"),
                        })
                    except Exception:
                        pass
    except Exception as e:
        print(f"[keno] history load from Redis failed: {e}")

    # First boot with empty history — seed synthetic draws
    if not history_entries and INITIAL_HISTORY_SEED_COUNT > 0:
        print(f"[keno] Seeding {INITIAL_HISTORY_SEED_COUNT} synthetic history entries")
        for i in range(INITIAL_HISTORY_SEED_COUNT):
            nums = random.sample(range(1, 81), 20)
            t = datetime.now(timezone.utc).strftime("%H:%M")
            entry = {"round_id": i + 1, "numbers": nums, "time": t}
            history_entries.append(entry)
            if redis_client:
                try:
                    await redis_client.lpush(
                        "keno:history",
                        json.dumps({"round_id": i + 1, "numbers": nums, "time": t}),
                    )
                except Exception:
                    pass
        if redis_client:
            try:
                await redis_client.ltrim("keno:history", 0, 199)
            except Exception:
                pass

    # Seed drawId from history so it continues monotonically after restart
    if history_entries:
        current_draw_id = max(e["round_id"] for e in history_entries)
    else:
        current_draw_id = 0

    # Pre-compute initial stats so welcome messages are useful immediately
    current_stats = calculate_stats(history_entries)

    # ---- Main cycle --------------------------------------------------------
    while True:
        try:
            settings = await load_settings(redis_client)

            # Maintenance mode
            if not settings.get("enabled", True):
                await _set_phase("idle", current_draw_id, 5_000)
                await asyncio.sleep(5.0)
                continue

            t_idle = float(settings["idle_duration"])
            t_prelaunch = float(settings["prelaunch_duration"])
            t_draw = float(settings["draw_duration"])
            t_results = float(settings["results_duration"])
            # Refresh the celebration duration so admin edits apply next cycle.
            current_phase_state["celebration_duration_ms"] = int(
                settings.get("celebration_duration_ms", 10000)
            )

            # =================================================================
            # IDLE — betting window; drawId increments HERE
            # =================================================================
            current_draw_id += 1
            draw_id = current_draw_id
            print(f"[keno] IDLE  draw_id={draw_id} ({t_idle}s)")

            # Génération ANTICIPÉE du tirage (avant l'ouverture des ventes).
            # draw_numbers(seed, draw_id) est déterministe, donc fixer le seed
            # ici fixe les 20 numéros pour tout le round. Ils restent privés
            # (variables locales + current_debug_draw) jusqu'à la phase draw —
            # rien ne part sur le WS/REST public avant draw_locked.
            server_seed = secrets.token_hex(16)
            server_seed_hash = hashlib.sha256(server_seed.encode("utf-8")).hexdigest()
            numbers = draw_numbers(server_seed, draw_id)   # reveal order
            current_debug_draw = {
                "draw_id": draw_id,
                "numbers": numbers,
                "server_seed_hash": server_seed_hash,
                "generated_at": _now_ms(),
            }
            if DEBUG_LOG_DRAWS:
                print(
                    f"🔍 [keno][GENERATED] draw_id={draw_id} numbers={numbers} "
                    f"(seed_hash={server_seed_hash[:16]}…)",
                    flush=True,
                )

            await _set_phase("idle", draw_id, int(t_idle * 1000))

            # Flush any jackpot hits that landed during the previous draw/results
            # so the celebration plays now, over the stats dashboard.
            if pending_hits:
                queued, pending_hits[:] = list(pending_hits), []
                for hit in queued:
                    try:
                        await manager.broadcast_hit(hit)
                    except Exception as e:
                        print(f"[keno] deferred jackpot-hit relay failed: {e}")

            # Re-broadcast the pots in ~5s slices for the whole idle window so the
            # amounts climb smoothly (step-by-step) rather than jumping only when
            # a contribution relay lands. Cheap: one snapshot fetch per kiosk.
            idle_deadline = _now_ms() + int(t_idle * 1000)
            while _now_ms() < idle_deadline:
                await asyncio.sleep(min(5.0, max(0.5, (idle_deadline - _now_ms()) / 1000)))
                try:
                    await manager.broadcast_jackpots()
                except Exception as e:
                    print(f"[keno] idle jackpot ticker failed: {e}")

            # =================================================================
            # PRE-LAUNCH
            # =================================================================
            print(f"[keno] PRE-LAUNCH draw_id={draw_id} ({t_prelaunch}s)")
            await _set_phase("preLaunch", draw_id, int(t_prelaunch * 1000))
            await asyncio.sleep(t_prelaunch)

            # =================================================================
            # DRAW — generate numbers, broadcast, persist, publish
            # =================================================================
            print(f"[keno] DRAW  draw_id={draw_id} ({t_draw}s)")

            # server_seed / numbers générés au début de l'idle (voir bloc
            # "Génération ANTICIPÉE") — ici on ne fait que les révéler.
            locked_at = _now_ms()

            # 1. phase_changed(draw) FIRST
            await _set_phase(
                "draw", draw_id, int(t_draw * 1000), drawn_numbers=numbers
            )

            # 2. draw_locked immediately after
            await manager.broadcast({
                "type": "draw_locked",
                "serverTime": _now_ms(),
                "drawId": draw_id,
                "numbers": numbers,
                "lockedAt": locked_at,
            })

            # 3. Persist to Postgres
            async with SessionLocal() as db:
                draw_row = KenoDraw(
                    round_id=draw_id,
                    server_seed=server_seed,
                    server_seed_hash=server_seed_hash,
                    drawn_numbers=numbers,
                )
                db.add(draw_row)
                try:
                    await db.commit()
                except Exception as e:
                    print(f"[keno] DB persist failed for draw {draw_id}: {e}")

            # 4. Publish ROUND_FINISHED to ticket-service
            if redis_client:
                await redis_client.publish(
                    "keno-events",
                    json.dumps({
                        "event": "ROUND_FINISHED",
                        "round_id": str(draw_id),
                        "drawn_numbers": numbers,
                    }),
                )

            await asyncio.sleep(t_draw)

            # =================================================================
            # Update history and compute stats
            # =================================================================
            draw_time = datetime.now(timezone.utc).strftime("%H:%M")
            history_entry = {
                "round_id": draw_id,
                "numbers": numbers,
                "time": draw_time,
            }
            history_entries.append(history_entry)
            if len(history_entries) > 200:
                history_entries.pop(0)

            if redis_client:
                await redis_client.lpush(
                    "keno:history",
                    json.dumps({
                        "round_id": draw_id,
                        "numbers": numbers,
                        "time": draw_time,
                    }),
                )
                await redis_client.ltrim("keno:history", 0, 199)

            snapshot = calculate_stats(history_entries)
            current_stats = snapshot

            # =================================================================
            # RESULTS — stats_updated BEFORE phase_changed(results)
            # =================================================================
            print(f"[keno] RESULTS draw_id={draw_id} ({t_results}s)")

            # 1. stats_updated first
            await manager.broadcast({
                "type": "stats_updated",
                "serverTime": _now_ms(),
                "snapshot": snapshot,
            })

            # 2. phase_changed(results)
            await _set_phase("results", draw_id, int(t_results * 1000), drawn_numbers=numbers)

            # 3. Broadcast current jackpot snapshot
            try:
                await manager.broadcast_jackpots()
            except Exception as e:
                print(f"[keno] broadcast_jackpots failed: {e}")

            await asyncio.sleep(t_results)

        except Exception as e:
            print(f"[keno] Critical error in game loop: {e}")
            await asyncio.sleep(5.0)


# ---------------------------------------------------------------------------
# jackpot-updated consumer
# ---------------------------------------------------------------------------

async def consume_jackpot_updated() -> None:
    """Subscribe to ``jackpot-updated`` (published by jackpot-service authority).

    Message shape:
        { "game_id": "KENO-DRAW1"|"ROULETTE-TBL1"|null, "kiosk_code": "<id>"|null, "pots": [...] }

    Logic:
    - game_id == GAME_ID ("KENO-DRAW1") OR game_id is null/absent (GLOBAL pot changed)
      → re-broadcast BOTH ``jackpot_updated`` and ``medals_updated`` to ALL
        connected kiosks (each fetches its own fresh snapshot from jackpot-service
        so generalAmount, volkenoAmount and per-kiosk medals are all accurate).
        broadcast_jackpots() now emits both events back-to-back per kiosk.
    """
    if not redis_client:
        return
    pubsub = redis_client.pubsub()
    await pubsub.subscribe("jackpot-updated")
    print("[keno] jackpot-updated consumer attached")

    async for message in pubsub.listen():
        if message["type"] != "message":
            continue
        try:
            payload = json.loads(message["data"])
        except Exception:
            continue

        game_id = payload.get("game_id")

        # Only act on messages that are relevant to this engine
        relevant = (game_id is None) or (game_id == jackpot_client.GAME_ID)
        if not relevant:
            continue

        try:
            # broadcast_jackpots() now emits BOTH jackpot_updated and
            # medals_updated to every connected kiosk, so a single call
            # keeps every kiosk in sync regardless of who triggered the event.
            await manager.broadcast_jackpots()
        except Exception as e:
            print(f"[keno] jackpot-updated relay failed: {e}")


async def consume_jackpot_hit() -> None:
    """Subscribe to ``jackpot-hit`` (published by jackpot-service on a win) and
    relay it to WS clients as a one-shot ``jackpot_hit`` event for the win
    cinematic.

    Message shape:
        { "hit_id", "pot_id", "scope", "tier", "game_id", "kiosk_code",
          "payout", "winner_ticket_id", "cycle_number" }

    Filter: relay only GLOBAL pots (``game_id`` null) or this engine's game
    (``KENO-DRAW1``). Roulette's own GAME/LOCAL hits are dropped here.
    """
    if not redis_client:
        return
    pubsub = redis_client.pubsub()
    await pubsub.subscribe("jackpot-hit")
    print("[keno] jackpot-hit consumer attached")

    async for message in pubsub.listen():
        if message["type"] != "message":
            continue
        try:
            payload = json.loads(message["data"])
        except Exception:
            continue

        game_id = payload.get("game_id")
        relevant = (game_id is None) or (game_id == jackpot_client.GAME_ID)
        if not relevant:
            continue

        # The hit can fire at any phase (it's triggered at ticket sale). Only
        # broadcast the celebration while idle (stats dashboard up); otherwise
        # queue it and the game_loop flushes it at the next idle entry.
        if current_phase_state.get("phase") == "idle":
            try:
                await manager.broadcast_hit(payload)
            except Exception as e:
                print(f"[keno] jackpot-hit relay failed: {e}")
        else:
            pending_hits.append(payload)


# ---------------------------------------------------------------------------
# WebSocket handlers
# ---------------------------------------------------------------------------

async def _ws_handler(websocket: WebSocket) -> None:
    """Shared handler for /ws/keno and /ws/volkeno."""
    raw_kid = websocket.query_params.get("kiosk_id")
    kiosk_id: str | None = (
        raw_kid.strip().upper()
        if isinstance(raw_kid, str) and raw_kid.strip()
        else None
    )

    # BACKEND.md §"Kiosk authentication":
    # A NON-EMPTY kiosk_id that is INVALID → HTTP 403 at handshake.
    # close() before accept() causes Starlette to return a 403 upgrade
    # rejection — no WebSocket frame is ever sent.
    if kiosk_id is not None:
        valid = await kiosk_validator.is_valid_kiosk_code(kiosk_id, redis_client)
        if not valid:
            await websocket.close(code=1008)
            return

    # kiosk_id absent → global-only connection (backoffice / admin)
    await manager.connect(websocket, kiosk_id)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("type") == "ping":
                    await websocket.send_json({
                        "type": "pong",
                        "clientTime": msg.get("clientTime"),
                        "serverTime": _now_ms(),
                    })
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)


@app.websocket("/ws/keno")
async def websocket_keno(websocket: WebSocket) -> None:
    await _ws_handler(websocket)


@app.websocket("/ws/volkeno")
async def websocket_volkeno(websocket: WebSocket) -> None:
    await _ws_handler(websocket)


# ---------------------------------------------------------------------------
# Public REST endpoints
# ---------------------------------------------------------------------------

@app.get("/status")
async def get_status() -> dict:
    return {
        "draw_id": current_phase_state["draw_id"],
        "phase": current_phase_state["phase"],
        "phase_started_at": current_phase_state["phase_started_at"],
        "phase_duration_ms": current_phase_state["phase_duration_ms"],
    }


@app.get("/jackpots")
async def get_jackpots(kiosk_id: str | None = None) -> dict:
    """Public jackpot read — thin proxy to jackpot-service.

    ``medals`` reflects LOCAL pots for the given kiosk; zeroed if absent.
    """
    kid = kiosk_id.strip().upper() if isinstance(kiosk_id, str) and kiosk_id.strip() else None
    jackpot, medals = await jackpot_client.get_jackpots_for_kiosk(kid)
    return {"jackpot": jackpot, "medals": medals, "kiosk_id": kid}


@app.get("/settings/public")
async def public_settings() -> dict:
    """Public settings for ticket-service: min_stake, max_stake, enabled, default_spots."""
    s = await load_settings(redis_client)
    return {
        "min_stake": s["min_stake"],
        "max_stake": s["max_stake"],
        "enabled": s["enabled"],
        "default_spots": s["default_spots"],
    }


@app.get("/verify/{round_id}")
async def verify_round(round_id: int) -> dict:
    """Provably-fair audit: replay the draw from the stored server_seed.

    Verifiers can check:
        SHA256(server_seed) == server_seed_hash
        draw_numbers(server_seed, round_id) == drawn_numbers
    """
    async with SessionLocal() as db:
        result = await db.execute(
            select(KenoDraw).where(KenoDraw.round_id == round_id)
        )
        row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="round not found")

    # Replay from seed to let auditors verify
    replayed = draw_numbers(row.server_seed, row.round_id)

    return {
        "round_id": row.round_id,
        "drawn_numbers": row.drawn_numbers,
        "replayed_numbers": replayed,
        "server_seed": row.server_seed,
        "server_seed_hash": row.server_seed_hash,
        "algorithm": (
            "drawn via iterative HMAC-SHA256(server_seed, '{draw_id}:{nonce}')[:8] "
            "% 80 + 1 until 20 unique numbers in [1,80] collected"
        ),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


# ---------------------------------------------------------------------------
# Admin REST endpoints
# ---------------------------------------------------------------------------

@app.get("/admin/debug/draw", dependencies=[Depends(verify_admin_key)])
async def admin_debug_draw() -> dict:
    """Tirage du round COURANT tel que généré (debug / vérification de match).

    Révèle les 20 numéros dès le début de l'idle, avant la première vente —
    protégé par la clé admin, à n'utiliser que pour le débogage. Compare avec
    draw_locked / GET /verify/:round_id.
    """
    if current_debug_draw is None:
        raise HTTPException(status_code=404, detail="Aucun tirage généré (moteur en démarrage ?)")
    return {**current_debug_draw, "phase": current_phase_state["phase"]}


@app.get("/admin/settings", dependencies=[Depends(verify_admin_key)])
async def admin_get_settings() -> dict:
    return await load_settings(redis_client)


@app.patch("/admin/settings", dependencies=[Depends(verify_admin_key)])
async def admin_patch_settings(payload: dict) -> dict:
    return await save_settings(redis_client, payload)


@app.get("/admin/history", dependencies=[Depends(verify_admin_key)])
async def admin_get_history() -> dict:
    async with SessionLocal() as db:
        result = await db.execute(
            select(KenoDraw).order_by(KenoDraw.created_at.desc()).limit(20)
        )
        rows = result.scalars().all()
    return {
        "draws": [
            {
                "round_id": r.round_id,
                "drawn_numbers": r.drawn_numbers,
                "server_seed_hash": r.server_seed_hash,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
    }
