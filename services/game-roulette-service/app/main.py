import asyncio
import json
import os
import hashlib
import hmac
import secrets
from datetime import datetime
import redis.asyncio as redis
from fastapi import FastAPI

# --- NOUVEAUX IMPORTS ---
from .database import engine, Base, SessionLocal
from .models import RouletteRound

app = FastAPI(
    title="Roisbet Roulette Engine",
    root_path=os.getenv("ROOT_PATH", "")
)

# Configuration des temps (en secondes)
TIME_BETTING = 45
TIME_SPINNING = 15
TIME_RESULT = 10

redis_client = None

@app.on_event("startup")
async def startup_event():
    global redis_client
    # Connexion à Redis au démarrage du service
    redis_url = os.getenv("REDIS_URL", "redis://casino_redis:6379/0")
    redis_client = redis.from_url(redis_url, decode_responses=True)
    
    # Création automatique de la table d'audit si elle n'existe pas
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        
    # On lance la boucle de jeu en arrière-plan !
    asyncio.create_task(game_loop())

@app.on_event("shutdown")
async def shutdown_event():
    if redis_client:
        await redis_client.close()

# --- PROVABLY FAIR LOGIC ---

def generate_provably_fair_result(server_seed: str, nonce: str) -> str:
    """Calcule le résultat de la roulette de manière cryptographique et déterministe"""
    # On crée une empreinte HMAC combinant le secret et le numéro du round (nonce)
    hmac_obj = hmac.new(
        key=server_seed.encode('utf-8'),
        msg=nonce.encode('utf-8'),
        digestmod=hashlib.sha256
    )
    hash_hex = hmac_obj.hexdigest()
    
    # On prend les 8 premiers caractères du hash, on les convertit en nombre, et on fait modulo 37 (pour avoir 0-36)
    decimal_value = int(hash_hex[:8], 16)
    winning_number = decimal_value % 37
    return str(winning_number)

# --- LA MACHINE À ÉTATS ---

async def game_loop():
    print("🎰 Moteur de Roulette (Provably Fair) démarré !")
    
    while True:
        try:
            round_id = f"ROUND-{datetime.now().strftime('%Y%m%d%H%M%S')}"
            
            # --- GÉNÉRATION CRYPTOGRAPHIQUE ---
            # 1. On crée un secret absolu pour ce tour
            server_seed = secrets.token_hex(16) 
            # 2. On crée le "coffre-fort" (le hash public)
            server_seed_hash = hashlib.sha256(server_seed.encode('utf-8')).hexdigest()
            # 3. On calcule DEJA le résultat (mais on le garde pour nous)
            winning_number = generate_provably_fair_result(server_seed, round_id)
            
            # ==========================================
            # ÉTAT 1 : BETTING
            # ==========================================
            print(f"🟢 [BETTING] {round_id} - Hash Public: {server_seed_hash[:16]}...")
            
            await redis_client.set("roulette:current_state", json.dumps({
                "round_id": round_id,
                "status": "BETTING",
                "time_left": TIME_BETTING,
                "server_seed_hash": server_seed_hash # On publie le hash pour la TV !
            }))
            
            await redis_client.publish("roulette-events", json.dumps({
                "event": "STATE_CHANGE",
                "round_id": round_id,
                "status": "BETTING",
                "duration": TIME_BETTING,
                "server_seed_hash": server_seed_hash
            }))
            
            await asyncio.sleep(TIME_BETTING)

            # ==========================================
            # ÉTAT 2 : SPINNING
            # ==========================================
            print(f"🟡 [SPINNING] {round_id} - Rien ne va plus ! Cible: {winning_number}")
            
            await redis_client.set("roulette:current_state", json.dumps({
                "round_id": round_id,
                "status": "SPINNING",
                "time_left": TIME_SPINNING
            }))
            
            await redis_client.publish("roulette-events", json.dumps({
                "event": "STATE_CHANGE",
                "round_id": round_id,
                "status": "SPINNING",
                "duration": TIME_SPINNING,
                "target_number": winning_number 
            }))
            
            await asyncio.sleep(TIME_SPINNING)

            # ==========================================
            # ÉTAT 3 : RESULT
            # ==========================================
            print(f"🔴 [RESULT] {round_id} - Gagnant: {winning_number} | Secret révélé: {server_seed}")
            
            await redis_client.set("roulette:current_state", json.dumps({
                "round_id": round_id,
                "status": "RESULT",
                "winning_number": winning_number,
                "server_seed": server_seed, # On révèle le secret !
                "time_left": TIME_RESULT
            }))
            
            await redis_client.lpush("roulette:history", winning_number)
            await redis_client.ltrim("roulette:history", 0, 49)
            
            await redis_client.publish("roulette-events", json.dumps({
                "event": "ROUND_FINISHED",
                "round_id": round_id,
                "winning_number": winning_number,
                "server_seed": server_seed # La TV peut afficher le secret à l'écran pour les joueurs paranos
            }))
            
            # --- NOUVEAU : SAUVEGARDE EN BASE DE DONNÉES ---
            async with SessionLocal() as db:
                new_round = RouletteRound(
                    round_id=round_id,
                    winning_number=winning_number,
                    server_seed=server_seed,
                    server_seed_hash=server_seed_hash
                )
                db.add(new_round)
                await db.commit()
                print(f"💾 [AUDIT] Round {round_id} sauvegardé en base de données.")

            await asyncio.sleep(TIME_RESULT)
            
        except Exception as e:
            print(f"Erreur critique dans la boucle de jeu: {e}")
            await asyncio.sleep(5) # Pause avant de retenter pour éviter de spammer les logs en cas de crash

# Une petite route pour vérifier que le service tourne
@app.get("/status")
async def get_status():
    if not redis_client:
        return {"status": "starting"}
    current_state = await redis_client.get("roulette:current_state")
    return json.loads(current_state) if current_state else {"status": "unknown"}

# --- ROUTE ADMIN: HISTORIQUE ---
from fastapi import Header, HTTPException, Depends
from sqlalchemy import select

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
