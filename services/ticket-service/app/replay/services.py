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


async def generate_replay_tickets_for_round(round_id: str) -> int:
    """Pour chaque plan ACTIVE, cree un ticket fils sur le round courant.
    Appele depuis le listener Redis quand un nouveau round entre en phase Betting.

    Retourne le nombre de tickets crees.
    """
    # Import ici pour eviter les cycles
    from ..jackpot import services as jackpot_services

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

            # Hook jackpot : meme logique que la vente manuelle.
            # Pas de debit caisse ici (deja debite au pre-paiement).
            try:
                await jackpot_services.contribute_for_ticket(db, child)
            except Exception as e:
                logger.error(f"REPLAY_JACKPOT_FAIL plan={plan.id} ticket={child.short_code} error={e}")
                # On laisse passer : le ticket est valide meme si la contribution jackpot echoue.

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
