import asyncio
import json
import os
import hashlib
import hmac
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

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        await self.send_welcome(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections.copy():
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)

    async def send_welcome(self, websocket: WebSocket):
        # Envoie l'état instantané du jeu
        welcome_msg = {
            "type": "welcome",
            "serverTime": time.time(),
            "currentGameId": current_game_state["round_id"],
            "currentPhase": current_game_state["phase"],
            "phaseStartedAt": current_game_state["started_at"],
            "phaseDuration": current_game_state["duration"],
            "result": current_game_state["result"]
        }
        await websocket.send_json(welcome_msg)

        # Envoie immédiatement les stats actuelles pour que les nouveaux clients
        # n'aient pas à attendre le prochain spin (~50s) pour voir les charts
        try:
            if redis_client:
                redis_hist = await redis_client.lrange("roulette:history", 0, 199)
                if redis_hist:
                    history_numbers = [int(x) for x in reversed(redis_hist)]
                    stats_payload = calculate_stats(history_numbers)
                    await websocket.send_json({
                        "type": "stats_updated",
                        "serverTime": time.time(),
                        "gameId": current_game_state["round_id"],
                        "stats": stats_payload
                    })
        except Exception:
            pass

manager = ConnectionManager()

@app.on_event("startup")
async def startup_event():
    global redis_client
    redis_url = os.getenv("REDIS_URL", "redis://casino_redis:6379/0")
    redis_client = redis.from_url(redis_url, decode_responses=True)
    
    asyncio.create_task(game_loop())

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

async def set_game_phase(phase: str, duration: float, round_id: str, result=None):
    current_game_state.update({
        "round_id": round_id,
        "phase": phase,
        "started_at": time.time(),
        "duration": duration,
        "result": result
    })
    
    await manager.broadcast({
        "type": "phase_changed",
        "serverTime": time.time(),
        "gameId": round_id,
        "phase": phase,
        "duration": duration
    })
    
    # Optional fallback for other microservices via Redis
    if redis_client:
        await redis_client.set("roulette:current_state", json.dumps(current_game_state))
        await redis_client.publish("roulette-events", json.dumps({
            "type": "phase_changed",
            "serverTime": time.time(),
            "gameId": round_id,
            "phase": phase,
            "duration": duration
        }))

async def game_loop():
    print("🎰 Moteur de Roulette (Provably Fair) + WebSockets Unity démarré !")

    # On charge l'historique existant en base si disponible
    history_numbers = []
    try:
        if redis_client:
            redis_hist = await redis_client.lrange("roulette:history", 0, 199)
            if redis_hist:
                history_numbers = [int(x) for x in reversed(redis_hist)]
    except Exception:
        pass

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
            await set_game_phase("Betting", t_betting, round_id)
            await asyncio.sleep(t_betting)

            # ==========================================
            # ÉTAT 2 : BETS CLOSING
            # ==========================================
            print(f"🟠 [BETS CLOSING] {round_id}")
            await set_game_phase("BetsClosing", t_closing, round_id)
            await asyncio.sleep(t_closing)

            # ==========================================
            # ÉTAT 3 : SPINNING
            # ==========================================
            print(f"🟡 [SPINNING] {round_id} - Target: {winning_number}")
            await set_game_phase("Spinning", t_spinning, round_id, result_payload)

            # On envoie result_revealed AVANT la fin du spin (e.g. 11s)
            delay_before_reveal = max(0.0, t_spinning - 1.0)
            await asyncio.sleep(delay_before_reveal)
            
            # --- RESULT_REVEALED ---
            result_revealed_payload = {
                "type": "result_revealed",
                "serverTime": time.time(),
                "gameId": round_id,
                "result": result_payload
            }
            await manager.broadcast(result_revealed_payload)
            if redis_client:
                await redis_client.publish("roulette-events", json.dumps(result_revealed_payload))
            
            await asyncio.sleep(1.0) # Fin de la phase Spinning
            
            # Update history and calculate stats
            history_numbers.append(winning_number)
            if len(history_numbers) > 200:
                history_numbers.pop(0)
            
            if redis_client:
                await redis_client.lpush("roulette:history", str(winning_number))
                await redis_client.ltrim("roulette:history", 0, 199)
                
            stats_payload = calculate_stats(history_numbers)
            
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

            # ==========================================
            # ÉTAT 4 : RESULT
            # ==========================================
            print(f"🔴 [RESULT] {round_id} - Gagnant: {winning_number}")
            await set_game_phase("Result", t_result, round_id, result_payload)
            
            # --- NOTIFY TICKET SERVICE ---
            if redis_client:
                await redis_client.publish("roulette-events", json.dumps({
                    "event": "ROUND_FINISHED",
                    "round_id": round_id,
                    "winning_number": str(winning_number)
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
@app.websocket("/api/display/ws/roulette")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
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
