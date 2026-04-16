import httpx 
import asyncio
import random
import string
import json
import os
import redis.asyncio as redis
from datetime import datetime
from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from uuid import UUID

from .database import get_db, AsyncSessionLocal
from .models import Ticket, TicketBet, TicketStatus
from .schemas import TicketCreate, TicketResponse
from .rules import calculate_payout
from .security import get_current_agent_id, verify_admin_key
from sqlalchemy import func

app = FastAPI(
    title="Roisbet Ticket Service",
    root_path=os.getenv("ROOT_PATH", "")
)

redis_client = None

@app.on_event("startup")
async def startup_event():
    global redis_client
    redis_url = os.getenv("REDIS_URL", "redis://casino_redis:6379/0")
    redis_client = redis.from_url(redis_url, decode_responses=True)
    
    # ON LANCE NOTRE ECOUTEUR EN ARRIÈRE-PLAN
    asyncio.create_task(listen_to_roulette_results())

@app.on_event("shutdown")
async def shutdown_event():
    if redis_client:
        await redis_client.close()

async def listen_to_roulette_results():
    """Tâche de fond qui écoute les résultats et paye les tickets"""
    print("🎧 Ticket Service en écoute des résultats de la roulette...")
    pubsub = redis_client.pubsub()
    await pubsub.subscribe("roulette-events")

    async for message in pubsub.listen():
        if message["type"] == "message":
            data = json.loads(message["data"])
            
            # On ne réagit QU'À la fin du tour
            if data.get("event") == "ROUND_FINISHED":
                round_id = data["round_id"]
                winning_number = data["winning_number"]
                
                print(f"💰 [SETTLEMENT] Résolution des paris pour le {round_id} (Gagnant: {winning_number})")
                await process_settlement(round_id, winning_number)

async def process_settlement(round_id: str, winning_number: str):
    """Calcule les gains et met à jour la base de données"""
    # On utilise AsyncSessionLocal pour ouvrir une connexion hors requête HTTP
    async with AsyncSessionLocal() as db:
        # 1. On récupère tous les tickets PENDING de ce tour, avec leurs paris (bets)
        result = await db.execute(
            select(Ticket)
            .options(selectinload(Ticket.bets))
            .where(Ticket.round_id == round_id, Ticket.status == TicketStatus.PENDING)
        )
        tickets_to_process = result.scalars().all()

        if not tickets_to_process:
            print(f"   -> Aucun ticket en attente pour le {round_id}.")
            return

        for ticket in tickets_to_process:
            total_payout = 0
            
            # 2. On calcule le gain de chaque ligne de pari
            for bet in ticket.bets:
                payout = calculate_payout(bet.bet_type, bet.bet_target, bet.amount, winning_number)
                total_payout += payout

            # 3. On détermine le nouveau statut du ticket
            new_status = TicketStatus.WON if total_payout > 0 else TicketStatus.LOST
            
            # 4. On met à jour le ticket
            ticket.status = new_status
            ticket.total_payout = total_payout
            
            print(f"   -> Ticket {ticket.short_code} : {new_status.value} | Gain : {total_payout} XAF")

        # 5. On sauvegarde tout en une seule transaction
        await db.commit()
        print(f"✅ [SETTLEMENT] {len(tickets_to_process)} tickets traités avec succès.")

@app.get("/admin/stats", dependencies=[Depends(verify_admin_key)])
async def get_admin_stats(db: AsyncSession = Depends(get_db)):
    # Total des mises
    total_wager_result = await db.execute(select(func.sum(Ticket.total_wager)))
    total_wager = total_wager_result.scalar() or 0

    # Total de tickets
    count_tickets_result = await db.execute(select(func.count(Ticket.id)))
    count_tickets = count_tickets_result.scalar() or 0
    # Total des paiements
    total_payout_result = await db.execute(select(func.sum(Ticket.total_payout)))
    total_payout = total_payout_result.scalar() or 0
    
    return {
        "total_wager": total_wager,
        "total_payout": total_payout,
        "tickets_validated": count_tickets
    }

@app.get("/admin/agents-performance", dependencies=[Depends(verify_admin_key)])
async def get_agents_performance(db: AsyncSession = Depends(get_db)):
    # Group by agent_id, sum(total_wager), count(id), sum(total_payout)
    result = await db.execute(
        select(
            Ticket.agent_id,
            func.count(Ticket.id).label("tickets_sold"),
            func.sum(Ticket.total_wager).label("volume"),
            func.sum(Ticket.total_payout).label("payouts")
        )
        .group_by(Ticket.agent_id)
        .order_by(func.sum(Ticket.total_wager).desc())
        .limit(5)
    )
    rows = result.all()
    
    performance = []
    for row in rows:
        performance.append({
            "agent_id": str(row.agent_id),
            "tickets_sold": row.tickets_sold,
            "volume": row.volume or 0,
            "payouts": row.payouts or 0
        })
        
    return performance

@app.get("/health-ticket")
async def health_check():
    return {"status": "ok", "service": "ticket-service"}

def generate_ticket_code() -> str:
    """Génère un code unique type TK-20260225-ABCDEF"""
    date_str = datetime.now().strftime("%Y%m%d")
    random_str = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
    return f"TK-{date_str}-{random_str}"


@app.post("/", response_model=TicketResponse)
async def create_ticket(
    ticket_in: TicketCreate, 
    db: AsyncSession = Depends(get_db),
    agent_id: str = Depends(get_current_agent_id)
):
    # Bonus de sécurité : On force l'agent_id du ticket à être celui du token JWT
    if str(ticket_in.agent_id) != agent_id:
        raise HTTPException(status_code=403, detail="Vous ne pouvez pas créer de ticket pour un autre agent.")

    # 0. VÉRIFICATION DU STATUT DE LA ROULETTE (Le Bouclier)
    if not redis_client:
        raise HTTPException(status_code=503, detail="Connexion au moteur de jeu impossible.")
        
    state_json = await redis_client.get("roulette:current_state")
    if not state_json:
        raise HTTPException(status_code=503, detail="Le jeu est actuellement hors ligne.")
        
    game_state = json.loads(state_json)
    
    # Règle A : La table doit être en phase BETTING
    if game_state.get("status") != "BETTING":
        raise HTTPException(
            status_code=400, 
            detail="Rien ne va plus ! La table est fermée pour ce tour."
        )
        
    # Règle B : Le pari doit correspondre au round actuel (Anti-décalage)
    if game_state.get("round_id") != ticket_in.round_id:
        raise HTTPException(
            status_code=400, 
            detail=f"Round invalide. Le round actuel est {game_state.get('round_id')}."
        )

    # 1. Calcul de la mise totale du ticket
    total_wager = sum(bet.amount for bet in ticket_in.bets)
    
    # 2. Génération du code unique (et vérification anti-collision)
    while True:
        short_code = generate_ticket_code()
        result = await db.execute(select(Ticket).where(Ticket.short_code == short_code))
        if not result.scalars().first():
            break

    # 3. Création de l'entité Ticket parent
    new_ticket = Ticket(
        short_code=short_code,
        agent_id=ticket_in.agent_id,
        game_id=ticket_in.game_id,
        round_id=ticket_in.round_id,
        total_wager=total_wager,
        status=TicketStatus.PENDING
    )
    db.add(new_ticket)
    await db.flush() # Récupère l'ID du ticket pour l'associer aux paris
    
    # 4. Création des lignes de pari enfants
    for bet_in in ticket_in.bets:
        new_bet = TicketBet(
            ticket_id=new_ticket.id,
            bet_type=bet_in.bet_type,
            bet_target=bet_in.bet_target,
            amount=bet_in.amount
        )
        db.add(new_bet)
        
    # 5. COMMUNICATION INTER-SERVICES : Mettre à jour la caisse de l'agent
    # On utilise le nom du conteneur "agent-service" défini dans docker-compose
    agent_url = f"http://agent-service:8000/{ticket_in.agent_id}/provision"
    
    async with httpx.AsyncClient() as client:
        try:
            # On utilise le même endpoint de provisioning pour "débiter" (montant positif car on ajoute à la caisse de l'agent)
            response = await client.post(
                agent_url,
                json={
                    "amount": total_wager, 
                    "description": f"Vente Ticket {short_code}"
                },
                timeout=5.0
            )
            response.raise_for_status()
        except httpx.HTTPError:
            # Si l'agent-service est injoignable ou erreur, rollback automatique.
            raise HTTPException(
                status_code=503, 
                detail="Le service de caisse est indisponible ou n'a pas pu traiter la mise."
            )

    # 6. Finalisation
    await db.commit()
    
    # Recharge avec relations (bets) pour la réponse JSON (INDISPENSABLE en async)
    result = await db.execute(
        select(Ticket)
        .options(selectinload(Ticket.bets))
        .where(Ticket.id == new_ticket.id)
    )
    return result.scalars().first()