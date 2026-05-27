"""Logique metier des plans de tickets recurrents."""
from __future__ import annotations

import os
import logging
import random
import string
from datetime import datetime
from typing import List
from uuid import UUID

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models as ticket_models
from ..database import AsyncSessionLocal
from .models import TicketPlan, TicketPlanBet, TicketPlanStatus

logger = logging.getLogger("ticket-service.replay")


def _generate_ticket_code() -> str:
    date_str = datetime.now().strftime("%Y%m%d")
    random_str = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
    return f"TK-{date_str}-{random_str}"


async def create_plan(
    db: AsyncSession,
    *,
    agent_id: UUID,
    game_id: str,
    bets: list,
    original_ticket_id: UUID,
    replay_rounds: int,
) -> TicketPlan:
    """Cree un plan : rounds_remaining = replay_rounds - 1 (le round courant est deja
    couvert par `original_ticket_id`)."""
    total_wager_per_round = sum(b.amount for b in bets)
    plan = TicketPlan(
        agent_id=agent_id,
        game_id=game_id,
        total_wager_per_round=total_wager_per_round,
        rounds_total=replay_rounds,
        rounds_remaining=replay_rounds - 1,
        rounds_played=1,                     # le ticket courant compte deja
        original_ticket_id=original_ticket_id,
        status=TicketPlanStatus.ACTIVE,
    )
    for b in bets:
        plan.bets.append(TicketPlanBet(
            bet_type=b.bet_type, bet_target=b.bet_target, amount=b.amount,
        ))
    db.add(plan)
    await db.flush()
    logger.info(
        f"REPLAY_PLAN_CREATED id={plan.id} agent={agent_id} game={game_id} "
        f"rounds={replay_rounds} wager_per_round={total_wager_per_round}"
    )
    return plan


async def list_active_plans_for_agent(db: AsyncSession, agent_id: UUID) -> List[TicketPlan]:
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(TicketPlan)
        .options(selectinload(TicketPlan.bets))
        .where(
            TicketPlan.agent_id == agent_id,
            TicketPlan.status == TicketPlanStatus.ACTIVE,
        )
        .order_by(TicketPlan.created_at.desc())
    )
    return list(result.scalars().all())


async def cancel_plan(db: AsyncSession, plan_id: UUID, requesting_agent_id: UUID) -> tuple[TicketPlan, int]:
    """Annule un plan et calcule le montant a rembourser. Le caller fera l'appel
    HTTP a agent-service pour creer la transaction REVERSAL."""
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(TicketPlan)
        .options(selectinload(TicketPlan.bets))
        .where(TicketPlan.id == plan_id)
    )
    plan = result.scalars().first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan introuvable.")
    if str(plan.agent_id) != str(requesting_agent_id):
        raise HTTPException(status_code=403, detail="Vous n'etes pas proprietaire de ce plan.")
    if plan.status != TicketPlanStatus.ACTIVE:
        raise HTTPException(status_code=400, detail=f"Plan non-actif (statut: {plan.status.value}).")

    refunded_amount = plan.rounds_remaining * plan.total_wager_per_round
    rounds_refunded = plan.rounds_remaining

    plan.status = TicketPlanStatus.CANCELLED
    plan.rounds_remaining = 0

    logger.info(
        f"REPLAY_PLAN_CANCELLED id={plan.id} agent={plan.agent_id} "
        f"rounds_refunded={rounds_refunded} refund={refunded_amount}"
    )
    return plan, refunded_amount


async def build_replay_chain(db: AsyncSession, ticket) -> dict | None:
    """Si le ticket fait partie d'un plan, renvoie le resume + tous les tickets
    freres tries par date de creation. Sinon None.

    Le `round_index` est 1 pour le ticket original, 2 pour le 2eme round, etc.
    """
    if not ticket.plan_id:
        return None

    plan_q = await db.execute(select(TicketPlan).where(TicketPlan.id == ticket.plan_id))
    plan = plan_q.scalars().first()
    if not plan:
        return None

    siblings_q = await db.execute(
        select(ticket_models.Ticket)
        .where(ticket_models.Ticket.plan_id == plan.id)
        .order_by(ticket_models.Ticket.created_at.asc())
    )
    siblings = list(siblings_q.scalars().all())

    siblings_dicts = []
    for idx, s in enumerate(siblings, start=1):
        siblings_dicts.append({
            "short_code": s.short_code,
            "round_id": s.round_id,
            "round_index": idx,
            "status": s.status,
            "total_wager": s.total_wager,
            "total_payout": s.total_payout or 0,
            "winning_number": s.winning_number,
            "is_current": s.id == ticket.id,
        })

    return {
        "plan_id": plan.id,
        "rounds_total": plan.rounds_total,
        "rounds_played": plan.rounds_played,
        "rounds_remaining": plan.rounds_remaining,
        "plan_status": plan.status.value if hasattr(plan.status, "value") else str(plan.status),
        "siblings": siblings_dicts,
    }


async def generate_replay_tickets_for_round(round_id: str) -> int:
    """Pour chaque plan ACTIVE, cree un ticket fils sur le round courant.
    Appele depuis le listener Redis quand un nouveau round entre en phase Betting.

    Retourne le nombre de tickets crees.
    """
    jackpot_service_url = os.getenv("JACKPOT_SERVICE_URL", "http://jackpot-service:8000")
    jackpot_internal_key = os.getenv("JACKPOT_INTERNAL_API_KEY", "DevJackpotInternal2026")

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(TicketPlan).where(
                TicketPlan.status == TicketPlanStatus.ACTIVE,
                TicketPlan.rounds_remaining > 0,
            )
        )
        plans = list(result.scalars().all())

        if not plans:
            return 0

        created = 0
        for plan in plans:
            # Idempotence : si on a deja cree un ticket pour ce plan sur ce round, skip.
            if plan.last_round_id == round_id:
                logger.info(f"REPLAY_SKIP plan={plan.id} round={round_id} (already generated)")
                continue

            # Recharge les bets du plan
            await db.refresh(plan, ["bets"])

            # Genere le ticket fils
            while True:
                short_code = _generate_ticket_code()
                exists = await db.execute(
                    select(ticket_models.Ticket).where(ticket_models.Ticket.short_code == short_code)
                )
                if not exists.scalars().first():
                    break

            child = ticket_models.Ticket(
                short_code=short_code,
                agent_id=plan.agent_id,
                game_id=plan.game_id,
                round_id=round_id,
                total_wager=plan.total_wager_per_round,
                status=ticket_models.TicketStatus.PENDING,
                plan_id=plan.id,    # lien parent-fils via le plan
            )
            db.add(child)
            await db.flush()  # recupere l'id

            for b in plan.bets:
                db.add(ticket_models.TicketBet(
                    ticket_id=child.id,
                    bet_type=b.bet_type,
                    bet_target=b.bet_target,
                    amount=b.amount,
                ))

            # Jackpot contribution — delegated to jackpot-service (fail-open).
            # We must flush so child.id is available before the HTTP call.
            # Pas de debit caisse ici (deja debite au pre-paiement).
            try:
                async with httpx.AsyncClient(timeout=5.0) as _jp_client:
                    jp_resp = await _jp_client.post(
                        f"{jackpot_service_url}/internal/contribute",
                        json={
                            "ticket_id": str(child.id),
                            "game_id": child.game_id,
                            "kiosk_code": None,
                            "agent_id": str(plan.agent_id),
                            "wager": int(plan.total_wager_per_round),
                        },
                        headers={"x-internal-key": jackpot_internal_key},
                    )
                jp_resp.raise_for_status()
                jp_data = jp_resp.json()
                # Apply HIT awards if this replay ticket is the designated winner.
                for h in (jp_data.get("hits") or []):
                    if str(h.get("winner_ticket_id", "")) == str(child.id):
                        payout = int(h.get("payout", 0))
                        child.total_payout = (child.total_payout or 0) + payout
                        if child.status == ticket_models.TicketStatus.PENDING:
                            child.status = ticket_models.TicketStatus.WON
            except Exception as e:
                logger.warning(
                    f"REPLAY_JACKPOT_FAIL plan={plan.id} ticket={child.short_code} error={e} "
                    f"— ticket proceeds without jackpot contribution"
                )

            # Decrement
            plan.rounds_remaining -= 1
            plan.rounds_played += 1
            plan.last_round_id = round_id
            if plan.rounds_remaining <= 0:
                plan.status = TicketPlanStatus.COMPLETED

            created += 1
            logger.info(
                f"REPLAY_TICKET_CREATED plan={plan.id} ticket={short_code} "
                f"round={round_id} remaining={plan.rounds_remaining}"
            )

        await db.commit()
        return created
