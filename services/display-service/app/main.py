import asyncio
import json
import os
from typing import List
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import redis.asyncio as redis

app = FastAPI(
    title="Roisbet Display Service",
    root_path=os.getenv("ROOT_PATH", "")
)

redis_client = None

# --- GESTIONNAIRE DE WEBSOCKETS ---
class ConnectionManager:
    def __init__(self):
        # Liste de tous les écrans TV (clients) actuellement connectés
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"📺 Nouvel écran connecté. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            print(f"📺 Écran déconnecté. Total: {len(self.active_connections)}")

    async def broadcast(self, message: str):
        """Envoie un message à TOUS les écrans connectés simultanément"""
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception:
                pass # Si une TV a coupé son wifi sans prévenir, on ignore

manager = ConnectionManager()

# --- TÂCHE DE FOND : ÉCOUTE DE REDIS ---
async def listen_to_redis_and_broadcast():
    """Écoute le moteur de jeu et diffuse aux TV"""
    print("📡 Démarrage du relais Redis -> WebSocket")
    pubsub = redis_client.pubsub()
    await pubsub.subscribe("roulette-events")

    async for message in pubsub.listen():
        if message["type"] == "message":
            # On reçoit le JSON de la roulette, et on le balance direct aux WebSockets !
            data = message["data"]
            await manager.broadcast(data)

# --- CYCLE DE VIE DU SERVICE ---
@app.on_event("startup")
async def startup_event():
    global redis_client
    redis_url = os.getenv("REDIS_URL", "redis://casino_redis:6379/0")
    redis_client = redis.from_url(redis_url, decode_responses=True)
    
    # On lance l'écouteur Redis en tâche de fond
    asyncio.create_task(listen_to_redis_and_broadcast())

@app.on_event("shutdown")
async def shutdown_event():
    if redis_client:
        await redis_client.close()

# --- ROUTES DE L'API ---

@app.websocket("/ws/roulette")
async def websocket_endpoint(websocket: WebSocket):
    """C'est ici que le frontend Unity ou Web va se connecter"""
    await manager.connect(websocket)
    
    # Au moment exact de la connexion, on envoie l'état actuel pour que la TV ne soit pas perdue
    current_state = await redis_client.get("roulette:current_state")
    if current_state:
        await websocket.send_text(current_state)

    try:
        # Boucle infinie pour garder la connexion WebSocket ouverte
        while True:
            # On ne s'attend pas à ce que la TV parle, mais on doit "écouter" pour détecter si elle se déconnecte
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

@app.get("/history")
async def get_history():
    """Permet à la TV de récupérer les derniers tirages (ex: pour dessiner les stats chaud/froid)"""
    if not redis_client:
        return {"history": []}
    
    # Récupère toute la liste (index 0 à -1)
    history = await redis_client.lrange("roulette:history", 0, -1)
    return {"history": history}
