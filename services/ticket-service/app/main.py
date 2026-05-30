import logging
import httpx
import asyncio
import random
import string
import json
import os
import time
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
from .schemas import TicketCreate, TicketResponse, TicketDetailResponse
from .rules import calculate_payout
from .keno_rules import calculate_keno_payout
from .security import get_current_agent_id, verify_admin_key
from .replay import services as replay_services
from sqlalchemy import func

app = FastAPI(
    title="AGDTech Ticket Service",
    root_path=os.getenv("ROOT_PATH", "")
)

# Module replay : plans de tickets recurrents
from .replay.routes import router as replay_router
app.include_router(replay_router)

@app.get("/status", tags=["Health"])
async def health_check():
    return {"status": "ok", "service": "ticket-service", "timestamp": str(datetime.now())}

redis_client = None
# Module-level httpx client with connection pooling + keep-alive.
# Initialised at startup, closed at shutdown. Avoids one TCP handshake +
# DNS lookup per ticket sale (which becomes a real bottleneck at >50/s).
http_client: httpx.AsyncClient | None = None

ADMIN_EVENTS_CHANNEL = "admin-events"

JACKPOT_SERVICE_URL = os.getenv("JACKPOT_SERVICE_URL", "http://jackpot-service:8000")
# `or default` (not getenv default): compose turns an undefined ${VAR} into an
# EMPTY env var, which getenv's default would NOT replace. Coalesce empty →
# default so we send the same key jackpot-service expects when .env is unset.
JACKPOT_INTERNAL_API_KEY = os.getenv("JACKPOT_INTERNAL_API_KEY") or "DevJackpotInternal2026"


async def publish_admin_event(event_type: str, payload: dict):
    """Diffuse un event temps reel vers les dashboards connectes via WS.
    Non bloquant : toute erreur est loggee mais n'interrompt jamais le flow.
    """
    if not redis_client:
        return
    try:
        msg = {"type": event_type, "ts": time.time(), **payload}
        await redis_client.publish(ADMIN_EVENTS_CHANNEL, json.dumps(msg, default=str))
    except Exception as e:
        logger.error(f"PUBLISH_ADMIN_EVENT_FAIL type={event_type} error={e}")


# Sentinel : cache miss explicite (agent connu mais sans kiosk_code) — on
# garde une chaine vide en Redis pour eviter de re-frapper agent-service.
_KIOSK_CACHE_TTL = 3600
_KIOSK_NULL_SENTINEL = ""


async def get_agent_kiosk_code(agent_id: str) -> str | None:
    """Resout (et cache) le kiosk_code court (4 char) d'un agent.

    Strategie : Redis-cached lookup. Hot path = HIT Redis -> 1 GET ~1ms.
    Cold path -> appel HTTP a agent-service (admin endpoint) puis cache 1h.
    En cas d'erreur reseau on renvoie None SANS cacher : un retry au prochain
    ticket pourra reussir.
    """
    if not agent_id:
        return None
    cache_key = f"agent:{agent_id}:kiosk_code"
    if redis_client:
        try:
            cached = await redis_client.get(cache_key)
            if cached is not None:
                return cached or None  # "" -> None
        except Exception as e:
            logger.warning(f"KIOSK_CACHE_GET_FAIL agent={agent_id} error={e}")

    if not http_client:
        return None
    agent_base = os.getenv("AGENT_SERVICE_URL", "http://agent-service:8000")
    admin_key = os.getenv("ADMIN_API_KEY", "CleSuperSecreteBackoffice2026")
    url = f"{agent_base}/admin/{agent_id}"
    try:
        resp = await http_client.get(url, headers={"X-API-Key": admin_key}, timeout=3.0)
        if resp.status_code == 404:
            # Agent inconnu cote agent-service : on cache None pour eviter le
            # spam. Si l'agent est cree plus tard, le TTL fera retry dans 1h.
            if redis_client:
                try:
                    await redis_client.setex(cache_key, _KIOSK_CACHE_TTL, _KIOSK_NULL_SENTINEL)
                except Exception:
                    pass
            return None
        resp.raise_for_status()
        data = resp.json()
        # Format : {"agent": {... "kiosk_code": "AB12" ...}, "caisse": {...}}
        # On accepte aussi un payload "plat" (agent directement) au cas ou.
        agent_blob = data.get("agent") if isinstance(data, dict) and "agent" in data else data
        kiosk_code = None
        if isinstance(agent_blob, dict):
            kc = agent_blob.get("kiosk_code")
            if isinstance(kc, str) and kc.strip():
                kiosk_code = kc.strip()
        if redis_client:
            try:
                await redis_client.setex(
                    cache_key,
                    _KIOSK_CACHE_TTL,
                    kiosk_code if kiosk_code else _KIOSK_NULL_SENTINEL,
                )
            except Exception as e:
                logger.warning(f"KIOSK_CACHE_SET_FAIL agent={agent_id} error={e}")
        return kiosk_code
    except Exception as e:
        # Pas de cache en cas d'erreur reseau/timeout : on retentera.
        logger.warning(f"KIOSK_LOOKUP_FAIL agent={agent_id} error={e}")
        return None


@app.on_event("startup")
async def startup_event():
    global redis_client, http_client
    redis_url = os.getenv("REDIS_URL", "redis://casino_redis:6379/0")
    redis_client = redis.from_url(redis_url, decode_responses=True)

    # Pooled HTTP client (50 keep-alive conns, 100 max). Sized for ~500 t/s.
    limits = httpx.Limits(max_keepalive_connections=50, max_connections=100, keepalive_expiry=30.0)
    http_client = httpx.AsyncClient(timeout=10.0, limits=limits)

    # Roulette listener (pre-existing)
    asyncio.create_task(listen_to_roulette_results())
    # Keno listener — dedicated channel, fully isolated from roulette
    asyncio.create_task(listen_to_keno_results())

@app.on_event("shutdown")
async def shutdown_event():
    if http_client:
        await http_client.aclose()
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

            # 1) Fin de tour -> reglement des tickets PENDING
            if data.get("event") == "ROUND_FINISHED":
                round_id = data["round_id"]
                winning_number = data["winning_number"]

                logger.info(f"SETTLEMENT round={round_id} winning_number={winning_number}")
                await process_settlement(round_id, winning_number)

            # 2) Nouveau round en phase Betting -> generation des tickets fils des plans
            elif data.get("type") == "phase_changed" and data.get("phase") == "Betting":
                round_id = data.get("gameId")
                if round_id:
                    try:
                        created = await replay_services.generate_replay_tickets_for_round(round_id)
                        if created:
                            logger.info(f"REPLAY_TICKETS_GENERATED round={round_id} count={created}")
                    except Exception as e:
                        logger.error(f"REPLAY_GENERATION_FAIL round={round_id} error={e}")

SETTLEMENT_BATCH_SIZE = int(os.getenv("SETTLEMENT_BATCH_SIZE", "500"))


async def process_settlement(round_id: str, winning_number: str):
    """Calcule les gains et met à jour la base de données par batchs.

    Sous charge (>1k tickets), un commit unique tient la table tickets en lock
    pendant des secondes. On batchifie par chunks (defaut 500) : chaque chunk
    fait ses UPDATEs et commit, liberant les locks plus tot. Latence percue
    bien meilleure cote dashboard car les premiers tickets sont visibles WON
    avant que tout le round soit traite.
    """
    total_processed = 0
    total_won = 0
    total_lost = 0
    total_payout_round = 0
    offset = 0

    while True:
        async with AsyncSessionLocal() as db:
            # Critical: filter on winning_number IS NULL to identify unsettled
            # tickets. Without it, the batch loop would re-process tickets we
            # already marked WON (their status stays WON across iterations)
            # and double-count their payouts. Once settled, winning_number is
            # populated so they drop out of subsequent chunks.
            result = await db.execute(
                select(Ticket)
                .options(selectinload(Ticket.bets))
                .where(
                    Ticket.round_id == round_id,
                    Ticket.status.in_([TicketStatus.PENDING, TicketStatus.WON]),
                    Ticket.winning_number.is_(None),
                )
                .order_by(Ticket.created_at)
                .limit(SETTLEMENT_BATCH_SIZE)
            )
            chunk = list(result.scalars().all())
            if not chunk:
                break

            for ticket in chunk:
                try:
                    roulette_payout = 0
                    ticket.winning_number = str(winning_number)

                    for bet in ticket.bets:
                        payout = calculate_payout(bet.bet_type, bet.bet_target, bet.amount, winning_number)
                        bet.payout = payout
                        bet.is_winning = (payout > 0)
                        roulette_payout += payout

                    ticket.total_payout = (ticket.total_payout or 0) + roulette_payout
                    ticket.status = TicketStatus.WON if ticket.total_payout > 0 else TicketStatus.LOST
                    total_processed += 1
                    if ticket.status == TicketStatus.WON:
                        total_won += 1
                    else:
                        total_lost += 1
                    total_payout_round += int(ticket.total_payout or 0)
                except Exception as e:
                    logger.error(f"SETTLEMENT_ERROR ticket={ticket.short_code} error={e}")

            try:
                await db.commit()
            except Exception as e:
                await db.rollback()
                logger.error(f"SETTLEMENT_BATCH_COMMIT_FAIL round={round_id} offset={offset} error={e}")
                # On stoppe pour pas tourner en boucle infinie sur les memes tickets
                break

        if len(chunk) < SETTLEMENT_BATCH_SIZE:
            break
        offset += SETTLEMENT_BATCH_SIZE

    logger.info(f"SETTLEMENT_COMPLETE round={round_id} tickets_processed={total_processed}")
    if total_processed == 0:
        logger.info(f"SETTLEMENT round={round_id} no_pending_tickets")
        return
    await publish_admin_event("round_settled", {
        "round_id": round_id,
        "winning_number": str(winning_number),
        "processed": total_processed,
        "won": total_won,
        "lost": total_lost,
        "total_payout": total_payout_round,
    })


# ---------------------------------------------------------------------------
# Keno settlement — dedicated channel, no roulette paths touched below.
# ---------------------------------------------------------------------------

KENO_SETTINGS_URL = os.getenv("KENO_SETTINGS_URL", "http://game-keno-service:8000")


async def listen_to_keno_results():
    """Background task: subscribe to `keno-events` and settle Keno tickets.

    Mirrors listen_to_roulette_results() but on a fully isolated Redis channel.
    Roulette channels (roulette-events / jackpot-events) are never touched here.
    """
    logger.info("Ticket Service listening for Keno results (keno-events)...")
    pubsub = redis_client.pubsub()
    await pubsub.subscribe("keno-events")

    async for message in pubsub.listen():
        if message["type"] != "message":
            continue
        try:
            data = json.loads(message["data"])
        except Exception as e:
            logger.error(f"KENO_LISTENER_JSON_FAIL error={e}")
            continue

        # Primary: settle finished round
        if data.get("event") == "ROUND_FINISHED":
            round_id = data.get("round_id")
            drawn_numbers = data.get("drawn_numbers")
            if not round_id or not isinstance(drawn_numbers, list):
                logger.warning(f"KENO_ROUND_FINISHED_INVALID payload={data}")
                continue
            logger.info(f"KENO_SETTLEMENT round={round_id} drawn={drawn_numbers}")
            await process_keno_settlement(str(round_id), drawn_numbers)

        # Optional: new idle phase -> generate replay tickets for Keno plans.
        # Mirrors the roulette `phase_changed -> Betting` branch (plan §4.1).
        elif data.get("type") == "phase_changed" and data.get("phase") == "idle":
            draw_id = data.get("drawId")
            if draw_id is not None:
                round_id = str(draw_id)
                try:
                    created = await replay_services.generate_replay_tickets_for_round(round_id)
                    if created:
                        logger.info(f"KENO_REPLAY_TICKETS_GENERATED round={round_id} count={created}")
                except Exception as e:
                    logger.error(f"KENO_REPLAY_GENERATION_FAIL round={round_id} error={e}")


async def process_keno_settlement(round_id: str, drawn_numbers: list[int]):
    """Batch-settle all unsettled Keno tickets for a completed round.

    Settlement guard: `drawn_numbers IS NULL` (Keno-specific column added in
    migration c1d2e3f4a5b6). This mirrors the roulette guard `winning_number
    IS NULL` without interfering with it. Once a Keno ticket is settled, its
    `drawn_numbers` column is populated and it drops out of subsequent chunks.

    After settling all batches the function aggregates total_wager /
    per_kiosk_wager / per_kiosk_medals and publishes ONE `ROUND_SETTLED`
    message to `keno-jackpot-events` (never to `jackpot-events`).

    Credit path: identical to roulette — payout is stored on the ticket and
    only paid out when the cashier calls POST /{short_code}/payout. No
    automatic credit push at settlement time.
    """
    total_processed = 0
    total_won = 0
    total_lost = 0
    total_payout_round = 0
    total_wager_round = 0
    offset = 0

    while True:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Ticket)
                .options(selectinload(Ticket.bets))
                .where(
                    Ticket.round_id == round_id,
                    Ticket.game_id.like("KENO%"),
                    Ticket.status.in_([TicketStatus.PENDING, TicketStatus.WON]),
                    Ticket.drawn_numbers.is_(None),
                )
                .order_by(Ticket.created_at)
                .limit(SETTLEMENT_BATCH_SIZE)
            )
            chunk = list(result.scalars().all())
            if not chunk:
                break

            for ticket in chunk:
                try:
                    keno_payout = 0
                    # Mark as settled — this is the idempotency guard.
                    ticket.drawn_numbers = drawn_numbers

                    for bet in ticket.bets:
                        if bet.bet_type != "KENO":
                            # Non-KENO bets on a KENO ticket are left as-is.
                            continue
                        payout = calculate_keno_payout(
                            bet.bet_target or "",
                            drawn_numbers,
                            int(bet.amount),
                        )
                        bet.payout = payout
                        bet.is_winning = (payout > 0)
                        keno_payout += payout

                    ticket.total_payout = (ticket.total_payout or 0) + keno_payout
                    ticket.status = TicketStatus.WON if ticket.total_payout > 0 else TicketStatus.LOST
                    total_processed += 1
                    if ticket.status == TicketStatus.WON:
                        total_won += 1
                    else:
                        total_lost += 1
                    total_payout_round += int(ticket.total_payout or 0)
                    total_wager_round += int(ticket.total_wager or 0)
                except Exception as e:
                    logger.error(f"KENO_SETTLEMENT_ERROR ticket={ticket.short_code} error={e}")

            try:
                await db.commit()
            except Exception as e:
                await db.rollback()
                logger.error(
                    f"KENO_SETTLEMENT_BATCH_COMMIT_FAIL round={round_id} offset={offset} error={e}"
                )
                break

        if len(chunk) < SETTLEMENT_BATCH_SIZE:
            break
        offset += SETTLEMENT_BATCH_SIZE

    logger.info(
        f"KENO_SETTLEMENT_COMPLETE round={round_id} "
        f"processed={total_processed} won={total_won} lost={total_lost}"
    )

    if total_processed == 0:
        logger.info(f"KENO_SETTLEMENT round={round_id} no_pending_tickets")

    await publish_admin_event("keno_round_settled", {
        "round_id": round_id,
        "processed": total_processed,
        "won": total_won,
        "lost": total_lost,
        "total_wager": total_wager_round,
        "total_payout": total_payout_round,
    })


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


@app.get("/admin/keno/margin", dependencies=[Depends(verify_admin_key)])
async def get_keno_margin(rounds: int = 50, db: AsyncSession = Depends(get_db)):
    """Realized KENO house margin over the last `rounds` settled rounds.

    gross margin = 1 − payout/wager (the base-game take from the paytable).
    NET margin subtracts the jackpot slice — deferred player return, 1.5%
    guaranteed (GLOBAL+GAME) up to 2.4% with LOCAL pots — so the company's true
    keep sits between `net_margin_min` (@2.4%) and `net_margin_max` (@1.5%).
    Target NET = 30%. Per-round margin swings widely by design (Law of Large
    Numbers); only the trailing aggregate should sit near 30%.
    """
    rounds = max(1, min(500, rounds))
    rows_result = await db.execute(
        select(
            Ticket.round_id,
            func.sum(Ticket.total_wager).label("wager"),
            func.sum(Ticket.total_payout).label("payout"),
            func.count(Ticket.id).label("tickets"),
        )
        .where(
            Ticket.game_id.like("KENO%"),
            Ticket.drawn_numbers.isnot(None),  # settled rounds only
        )
        .group_by(Ticket.round_id)
        .order_by(func.max(Ticket.created_at).desc())
        .limit(rounds)
    )
    per_round = []
    agg_wager = 0
    agg_payout = 0
    for r in rows_result.all():
        w = int(r.wager or 0)
        p = int(r.payout or 0)
        agg_wager += w
        agg_payout += p
        per_round.append({
            "round_id": r.round_id,
            "wager": w,
            "payout": p,
            "tickets": int(r.tickets or 0),
            "gross_margin": (1 - p / w) if w else None,
        })

    gross = (1 - agg_payout / agg_wager) if agg_wager else None
    return {
        "rounds": len(per_round),
        "total_wager": agg_wager,
        "total_payout": agg_payout,
        "gross_margin": gross,
        "net_margin_max": (gross - 0.015) if gross is not None else None,  # @1.5%
        "net_margin_min": (gross - 0.024) if gross is not None else None,  # @2.4%
        "target_net_margin": 0.30,
        "on_target": (gross is not None and abs((gross - 0.015) - 0.30) <= 0.05),
        "per_round": per_round,
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

    # 0. VÉRIFICATION DU STATUT DU JEU (Le Bouclier)
    if not redis_client:
        raise HTTPException(status_code=503, detail="Connexion au moteur de jeu impossible.")

    if ticket_in.game_id.startswith("KENO"):
        # --- Keno betting-window gate ---
        # The engine publishes `keno:current_state` (JSON) on every phase change.
        # We require phase == 'idle' (the only phase where bets are accepted per
        # plan §2.1) and a matching drawId / round_id.
        keno_state_json = await redis_client.get("keno:current_state")
        if not keno_state_json:
            raise HTTPException(status_code=503, detail="Le jeu Keno est actuellement hors ligne.")

        keno_state = json.loads(keno_state_json)

        # Règle A : la fenêtre de mise Keno est la phase 'idle'
        if keno_state.get("phase") != "idle":
            raise HTTPException(
                status_code=400,
                detail="Rien ne va plus ! Les mises Keno sont fermées pour ce tirage.",
            )

        # Règle B : le round_id doit correspondre au drawId courant (anti-décalage).
        # Le moteur sérialise la clé en snake_case (`draw_id`) dans keno:current_state.
        current_draw_id = str(keno_state.get("draw_id", ""))
        if current_draw_id != ticket_in.round_id:
            raise HTTPException(
                status_code=400,
                detail=f"Tirage invalide. Le tirage actuel est {current_draw_id}.",
            )

        # Règle C : min/max stake via Keno settings endpoint
        keno_min_stake = 1
        keno_max_stake = 10_000_000
        try:
            keno_settings_url = f"{KENO_SETTINGS_URL}/settings/public"
            resp = await http_client.get(keno_settings_url, timeout=3.0)
            if resp.status_code == 200:
                ks = resp.json()
                keno_min_stake = int(ks.get("min_stake", keno_min_stake))
                keno_max_stake = int(ks.get("max_stake", keno_max_stake))
        except Exception:
            # Settings service unavailable: fall back to defaults, do not block the sale.
            pass

        for bet in ticket_in.bets:
            if bet.amount < keno_min_stake:
                raise HTTPException(
                    status_code=400,
                    detail=f"Mise Keno trop faible. Minimum : {keno_min_stake} XAF.",
                )
            if bet.amount > keno_max_stake:
                raise HTTPException(
                    status_code=400,
                    detail=f"Mise Keno trop élevée. Maximum : {keno_max_stake} XAF.",
                )

    else:
        # --- Roulette (and any other non-Keno game) betting-window gate ---
        # This block is byte-identical in behaviour to the original code.
        state_json = await redis_client.get("roulette:current_state")
        if not state_json:
            raise HTTPException(status_code=503, detail="Le jeu est actuellement hors ligne.")

        game_state = json.loads(state_json)

        # Règle A : La table doit être en phase BETTING
        if game_state.get("phase") != "Betting":
            raise HTTPException(
                status_code=400,
                detail="Rien ne va plus ! La table est fermée pour ce tour.",
            )

        # Règle B : Le pari doit correspondre au round actuel (Anti-décalage)
        if game_state.get("round_id") != ticket_in.round_id:
            raise HTTPException(
                status_code=400,
                detail=f"Round invalide. Le round actuel est {game_state.get('round_id')}.",
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
    # On denormalise le kiosk_code de l'agent (cached 1h cote Redis). Si le
    # lookup echoue, on garde None : le ticket contribuera quand meme aux
    # pots globaux mais pas aux pots du kiosque (cf jackpot-events ROUND_SETTLED).
    kiosk_code = await get_agent_kiosk_code(str(ticket_in.agent_id))
    new_ticket = Ticket(
        short_code=short_code,
        agent_id=ticket_in.agent_id,
        game_id=ticket_in.game_id,
        round_id=ticket_in.round_id,
        total_wager=total_wager,
        status=TicketStatus.PENDING,
        kiosk_code=kiosk_code,
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
        
    # 5. COMMUNICATION INTER-SERVICES : Mettre à jour la caisse de l'agent.
    #    Si replay_rounds > 1, on debite l'integralite (N x total_wager) d'un coup.
    replay_rounds = max(1, min(10, ticket_in.replay_rounds))
    debit_amount = total_wager * replay_rounds
    agent_base = os.getenv("AGENT_SERVICE_URL", "http://agent-service:8000")
    agent_url = f"{agent_base}/{ticket_in.agent_id}/provision"
    admin_key = os.getenv("ADMIN_API_KEY", "CleSuperSecreteBackoffice2026")

    debit_description = (
        f"Vente Ticket {short_code}"
        if replay_rounds == 1
        else f"Vente Ticket {short_code} (+ replay {replay_rounds - 1} rounds)"
    )

    try:
        response = await http_client.post(
            agent_url,
            json={
                "amount": debit_amount,
                "tx_type": "BET_RECEIVED",
                "description": debit_description,
                "reference": short_code,
            },
            headers={"X-API-Key": admin_key},
            timeout=5.0,
        )
        response.raise_for_status()
    except httpx.HTTPError:
        raise HTTPException(
            status_code=503,
            detail="Le service de caisse est indisponible ou n'a pas pu traiter la mise.",
        )

    # Si replay demande, on cree le plan associe (rounds_remaining = replay_rounds - 1)
    if replay_rounds > 1:
        try:
            plan = await replay_services.create_plan(
                db,
                agent_id=ticket_in.agent_id,
                game_id=ticket_in.game_id,
                bets=ticket_in.bets,
                original_ticket_id=new_ticket.id,
                replay_rounds=replay_rounds,
            )
            # Lie le ticket parent au plan pour que la chaine soit reconstruite
            # quand le caissier scanne n'importe quel ticket de la serie.
            new_ticket.plan_id = plan.id
        except Exception as e:
            await db.rollback()
            logger.error(f"REPLAY_PLAN_CREATE_FAIL code={short_code} error={e}")
            raise HTTPException(status_code=500, detail="Erreur creation plan re-jeu.")

    # 6. Jackpot contribution — delegated to jackpot-service (fail-open).
    #    POST /internal/contribute returns {touched_pots, hits}. If the service
    #    is unreachable or errors, we log a warning and let the sale proceed
    #    with no hit (the ticket is still committed as PENDING/valid).
    hits: list[dict] = []
    touched_pots: list[dict] = []
    try:
        jp_resp = await http_client.post(
            f"{JACKPOT_SERVICE_URL}/internal/contribute",
            json={
                "ticket_id": str(new_ticket.id),
                "game_id": new_ticket.game_id,
                "kiosk_code": kiosk_code,
                "agent_id": str(ticket_in.agent_id),
                "wager": int(total_wager),
                "short_code": short_code,
            },
            headers={"x-internal-key": JACKPOT_INTERNAL_API_KEY},
            timeout=5.0,
        )
        jp_resp.raise_for_status()
        jp_data = jp_resp.json()
        hits = jp_data.get("hits") or []
        touched_pots = jp_data.get("touched_pots") or []
    except Exception as e:
        logger.warning(
            f"JACKPOT_CONTRIBUTE_FAIL code={short_code} agent={ticket_in.agent_id} "
            f"error={e} — sale proceeds without jackpot contribution"
        )

    # Award jackpot HIT(s): add each payout to this ticket's total and mark WON.
    # The response shape from jackpot-service: each hit has {pot_id, scope, tier,
    # game_id, payout, winner_ticket_id, winner_agent_id, cycle_number}.
    # We only act on hits where winner_ticket_id == new_ticket.id (i.e. this
    # ticket is the winner). The payout is added to total_payout and status set
    # to WON — matching exactly what the old _process_hit() did locally.
    for h in hits:
        if str(h.get("winner_ticket_id", "")) == str(new_ticket.id):
            payout = int(h.get("payout", 0))
            new_ticket.total_payout = (new_ticket.total_payout or 0) + payout
            if new_ticket.status == TicketStatus.PENDING:
                new_ticket.status = TicketStatus.WON

    # 7. Finalisation
    await db.commit()

    logger.info(
        f"TICKET_CREATED code={short_code} agent={ticket_in.agent_id} wager={total_wager} "
        f"round={ticket_in.round_id} bets={len(ticket_in.bets)} jackpot_hits={len(hits)}"
    )
    await publish_admin_event("ticket_created", {
        "short_code": short_code,
        "agent_id": str(ticket_in.agent_id),
        "round_id": ticket_in.round_id,
        "total_wager": int(total_wager),
        "bets_count": len(ticket_in.bets),
        "replay_rounds": replay_rounds,
    })
    if touched_pots:
        await publish_admin_event("jackpot_progress", {"pots": touched_pots})
    for h in hits:
        await publish_admin_event("jackpot_hit", {
            "pot_id": str(h.get("pot_id", "")),
            "scope": h.get("scope"),
            "tier": h.get("tier"),
            "trigger_ticket": short_code,
            "winner_ticket_id": str(h.get("winner_ticket_id", "")),
            "winner_agent_id": str(h.get("winner_agent_id", "")),
            "payout": int(h.get("payout", 0)),
        })
    for h in hits:
        logger.info(
            f"JACKPOT_HIT_ON_CREATE pot={h.get('pot_id')} ticket_winner={h.get('winner_ticket_id')} "
            f"payout={h.get('payout')} trigger_ticket={new_ticket.short_code}"
        )

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


async def _ticket_with_chain(db: AsyncSession, ticket: Ticket) -> dict:
    """Construit le payload TicketDetailResponse a partir d'un Ticket charge.

    Si le ticket porte un plan_id, on annexe `replay_chain` (resume du plan +
    tous les tickets de la serie). Le caissier scanne UN seul code et voit
    toute la chaine, parents et enfants confondus.
    """
    chain = await replay_services.build_replay_chain(db, ticket)
    payload = TicketDetailResponse.model_validate(ticket).model_dump()
    payload["replay_chain"] = chain
    return payload


@app.get("/admin/{short_code}", response_model=TicketDetailResponse, dependencies=[Depends(verify_admin_key)])
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
    return await _ticket_with_chain(db, ticket)


@app.get("/{short_code}", response_model=TicketDetailResponse)
async def get_ticket_by_code(
    short_code: str,
    db: AsyncSession = Depends(get_db),
    agent_id: str = Depends(get_current_agent_id)
):
    """Récupère les détails d'un ticket par son code court (ex: TK-2026...).

    Si le ticket fait partie d'une chaine de re-jeu, la reponse inclut
    `replay_chain` avec tous les tickets freres et le resume du plan.
    """
    result = await db.execute(
        select(Ticket)
        .options(selectinload(Ticket.bets))
        .where(Ticket.short_code == short_code)
    )
    ticket = result.scalars().first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket introuvable.")
    return await _ticket_with_chain(db, ticket)

@app.post("/{short_code}/cancel")
async def cancel_ticket(
    short_code: str,
    db: AsyncSession = Depends(get_db),
    agent_id: str = Depends(get_current_agent_id),
):
    """Annule un ticket PENDING et rembourse la caisse.

    Refuse si:
      - ticket inexistant
      - ticket deja PAID/CANCELLED/LOST/WON
    Note: jackpot contributions are now owned by jackpot-service; no local
    rollback is performed here.
    """
    result = await db.execute(select(Ticket).where(Ticket.short_code == short_code))
    ticket = result.scalars().first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket introuvable.")
    if str(ticket.agent_id) != agent_id:
        raise HTTPException(status_code=403, detail="Vous n'etes pas proprietaire de ce ticket.")
    if ticket.status != TicketStatus.PENDING:
        raise HTTPException(
            status_code=400,
            detail=f"Annulation impossible (statut: {ticket.status.value}).",
        )

    # 1. Remboursement de la caisse caissier
    agent_base = os.getenv("AGENT_SERVICE_URL", "http://agent-service:8000")
    agent_url = f"{agent_base}/{ticket.agent_id}/provision"
    admin_key = os.getenv("ADMIN_API_KEY", "CleSuperSecreteBackoffice2026")

    try:
        response = await http_client.post(
            agent_url,
            json={
                "amount": -ticket.total_wager,
                "tx_type": "REVERSAL",
                "description": f"Annulation Ticket {short_code}",
                "reference": short_code,
            },
            headers={"X-API-Key": admin_key},
            timeout=5.0,
        )
        response.raise_for_status()
    except httpx.HTTPError as e:
        await db.rollback()
        logger.error(f"TICKET_CANCEL_REVERSAL_FAIL code={short_code} error={e}")
        raise HTTPException(status_code=503, detail="Erreur lors du remboursement de la caisse.")

    # 2. Statut final
    ticket.status = TicketStatus.CANCELLED
    await db.commit()

    logger.info(
        f"TICKET_CANCELLED code={short_code} agent={ticket.agent_id} wager={ticket.total_wager}"
    )

    return {
        "status": "success",
        "message": f"Ticket {short_code} annule, {ticket.total_wager} XAF retournes a la caisse.",
    }


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
    agent_base = os.getenv("AGENT_SERVICE_URL", "http://agent-service:8000")
    agent_url = f"{agent_base}/{ticket.agent_id}/provision"
    admin_key = os.getenv("ADMIN_API_KEY", "CleSuperSecreteBackoffice2026")

    try:
        response = await http_client.post(
            agent_url,
            json={
                "amount": -ticket.total_payout,
                "tx_type": "PAYOUT",
                "description": f"Paiement Gain Ticket {short_code}",
                "reference": short_code,
            },
            headers={"X-API-Key": admin_key},
            timeout=5.0,
        )
        response.raise_for_status()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail="Erreur de communication avec le service de caisse.")

    # 4. Mettre à jour le statut
    ticket.status = TicketStatus.PAID
    await db.commit()

    logger.info(f"TICKET_PAID code={short_code} agent={ticket.agent_id} payout={ticket.total_payout}")
    await publish_admin_event("ticket_paid", {
        "short_code": short_code,
        "agent_id": str(ticket.agent_id),
        "payout": int(ticket.total_payout or 0),
    })

    return {"status": "success", "message": f"Ticket {short_code} payé : {ticket.total_payout} XAF"}