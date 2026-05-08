import logging
import httpx
import asyncio
import random
import string
import json
import os
import redis.asyncio as redis
from datetime import datetime
from fastapi import FastAPI, Depends, HTTPException

logger = logging.getLogger("ticket-service")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
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
    title="AGDTech Ticket Service",
    root_path=os.getenv("ROOT_PATH", "")
)

@app.get("/status", tags=["Health"])
async def health_check():
    return {"status": "ok", "service": "ticket-service", "timestamp": str(datetime.now())}

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
    logger.info("Ticket Service en ecoute des resultats de la roulette...")
    pubsub = redis_client.pubsub()
    await pubsub.subscribe("roulette-events")

    async for message in pubsub.listen():
        if message["type"] == "message":
            data = json.loads(message["data"])
            
            # On ne réagit QU'À la fin du tour
            if data.get("event") == "ROUND_FINISHED":
                round_id = data["round_id"]
                winning_number = data["winning_number"]
                
                logger.info(f"SETTLEMENT round={round_id} winning_number={winning_number}")
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
            logger.info(f"SETTLEMENT round={round_id} no_pending_tickets")
            return

        processed = 0
        for ticket in tickets_to_process:
            try:
                total_payout = 0
                ticket.winning_number = str(winning_number)

                # 2. On calcule le gain de chaque ligne de pari
                for bet in ticket.bets:
                    payout = calculate_payout(bet.bet_type, bet.bet_target, bet.amount, winning_number)
                    bet.payout = payout
                    bet.is_winning = (payout > 0)
                    total_payout += payout

                # 3. On détermine le nouveau statut du ticket
                new_status = TicketStatus.WON if total_payout > 0 else TicketStatus.LOST

                # 4. On met à jour le ticket
                ticket.status = new_status
                ticket.total_payout = total_payout
                processed += 1

                logger.info(f"SETTLEMENT ticket={ticket.short_code} status={new_status.value} payout={total_payout}")
            except Exception as e:
                logger.error(f"SETTLEMENT_ERROR ticket={ticket.short_code} error={e}")

        # 5. On sauvegarde tout en une seule transaction
        try:
            await db.commit()
            logger.info(f"SETTLEMENT_COMPLETE round={round_id} tickets_processed={processed}")
        except Exception as e:
            await db.rollback()
            logger.error(f"SETTLEMENT_COMMIT_FAILED round={round_id} error={e}")

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
    if game_state.get("phase") != "Betting":
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

    # Règle C : Validation min/max mise selon les paramètres dynamiques
    min_stake = 1
    max_stake = 10_000_000
    try:
        settings_raw = await redis_client.get("roulette:settings")
        if settings_raw:
            s = json.loads(settings_raw)
            min_stake = int(s.get("min_stake", min_stake))
            max_stake = int(s.get("max_stake", max_stake))
    except Exception:
        pass

    for bet in ticket_in.bets:
        if bet.amount < min_stake:
            raise HTTPException(status_code=400, detail=f"Mise trop faible. Minimum : {min_stake} XAF.")
        if bet.amount > max_stake:
            raise HTTPException(status_code=400, detail=f"Mise trop elevee. Maximum : {max_stake} XAF.")

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
    agent_url = f"http://agent-service:8000/{ticket_in.agent_id}/provision"
    admin_key = os.getenv("ADMIN_API_KEY", "CleSuperSecreteBackoffice2026")

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                agent_url,
                json={
                    "amount": total_wager,
                    "tx_type": "BET_RECEIVED",
                    "description": f"Vente Ticket {short_code}",
                    "reference": short_code
                },
                headers={"X-API-Key": admin_key},
                timeout=5.0
            )
            response.raise_for_status()
        except httpx.HTTPError:
            raise HTTPException(
                status_code=503,
                detail="Le service de caisse est indisponible ou n'a pas pu traiter la mise."
            )

    # 6. Finalisation
    await db.commit()

    logger.info(f"TICKET_CREATED code={short_code} agent={ticket_in.agent_id} wager={total_wager} round={ticket_in.round_id} bets={len(ticket_in.bets)}")

    # Recharge avec relations (bets) pour la réponse JSON (INDISPENSABLE en async)
    result = await db.execute(
        select(Ticket)
        .options(selectinload(Ticket.bets))
        .where(Ticket.id == new_ticket.id)
    )
    return result.scalars().first()

@app.get("/me/recent", response_model=list[TicketResponse])
async def get_my_recent_tickets(
    limit: int = 50,
    minutes: int | None = None,
    db: AsyncSession = Depends(get_db),
    agent_id: str = Depends(get_current_agent_id),
):
    """Renvoie les tickets recents pour l'agent connecte (auth via JWT)."""
    from datetime import datetime, timedelta
    stmt = (
        select(Ticket)
        .options(selectinload(Ticket.bets))
        .where(Ticket.agent_id == agent_id)
        .order_by(Ticket.created_at.desc())
        .limit(min(limit, 200))
    )
    if minutes is not None and minutes > 0:
        since = datetime.utcnow() - timedelta(minutes=minutes)
        stmt = stmt.where(Ticket.created_at >= since)
    result = await db.execute(stmt)
    return result.scalars().all()


@app.get("/me/shift", dependencies=[])
async def get_my_shift_summary(
    minutes: int = 720,  # default 12h
    db: AsyncSession = Depends(get_db),
    agent_id: str = Depends(get_current_agent_id),
):
    """Resume de service: nb tickets, encaissement, paiements, ouverts vs reglés."""
    from datetime import datetime, timedelta
    since = datetime.utcnow() - timedelta(minutes=minutes)

    base = select(Ticket).where(Ticket.agent_id == agent_id, Ticket.created_at >= since)
    rows = (await db.execute(base)).scalars().all()
    total = len(rows)
    encaisse = sum((t.total_wager or 0) for t in rows)
    paye = sum((t.total_payout or 0) for t in rows if t.status == "PAID")

    by_status = {}
    for t in rows:
        by_status[t.status] = by_status.get(t.status, 0) + 1

    return {
        "tickets": total,
        "total_wager": encaisse,
        "total_payout": paye,
        "by_status": by_status,
        "since_minutes": minutes,
    }


@app.get("/admin/{short_code}", response_model=TicketResponse, dependencies=[Depends(verify_admin_key)])
async def admin_get_ticket_by_code(
    short_code: str,
    db: AsyncSession = Depends(get_db),
):
    """Endpoint Backoffice (x-api-key) pour consulter un ticket depuis le tableau Betslip."""
    result = await db.execute(
        select(Ticket)
        .options(selectinload(Ticket.bets))
        .where(Ticket.short_code == short_code)
    )
    ticket = result.scalars().first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket introuvable.")
    return ticket


@app.get("/{short_code}", response_model=TicketResponse)
async def get_ticket_by_code(
    short_code: str,
    db: AsyncSession = Depends(get_db),
    agent_id: str = Depends(get_current_agent_id)
):
    """Récupère les détails d'un ticket par son code court (ex: TK-2026...)"""
    result = await db.execute(
        select(Ticket)
        .options(selectinload(Ticket.bets))
        .where(Ticket.short_code == short_code)
    )
    ticket = result.scalars().first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket introuvable.")
    return ticket

@app.post("/{short_code}/payout")
async def payout_ticket(
    short_code: str, 
    db: AsyncSession = Depends(get_db),
    agent_id: str = Depends(get_current_agent_id)
):
    """Marque un ticket comme payé et débite la caisse de l'agent"""
    # 1. Récupérer le ticket
    result = await db.execute(
        select(Ticket)
        .where(Ticket.short_code == short_code)
    )
    ticket = result.scalars().first()
    
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket introuvable.")
        
    # 2. Vérifications de sécurité
    if ticket.status != TicketStatus.WON:
        if ticket.status == TicketStatus.PAID:
            raise HTTPException(status_code=400, detail="Ce ticket a déjà été payé.")
        raise HTTPException(status_code=400, detail=f"Ce ticket ne peut pas être payé (Statut: {ticket.status})")
    
    if ticket.total_payout <= 0:
        raise HTTPException(status_code=400, detail="Ce ticket n'a aucun gain à payer.")

    # 3. Appeler agent-service pour enregistrer le décaissement
    agent_url = f"http://agent-service:8000/{ticket.agent_id}/provision"
    admin_key = os.getenv("ADMIN_API_KEY", "CleSuperSecreteBackoffice2026")

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                agent_url,
                json={
                    "amount": -ticket.total_payout,
                    "tx_type": "PAYOUT",
                    "description": f"Paiement Gain Ticket {short_code}",
                    "reference": short_code
                },
                headers={"X-API-Key": admin_key},
                timeout=5.0
            )
            response.raise_for_status()
        except httpx.HTTPError as e:
            raise HTTPException(status_code=503, detail="Erreur de communication avec le service de caisse.")

    # 4. Mettre à jour le statut
    ticket.status = TicketStatus.PAID
    await db.commit()

    logger.info(f"TICKET_PAID code={short_code} agent={ticket.agent_id} payout={ticket.total_payout}")

    return {"status": "success", "message": f"Ticket {short_code} payé : {ticket.total_payout} XAF"}