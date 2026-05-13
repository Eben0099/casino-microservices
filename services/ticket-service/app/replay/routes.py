import os
import logging
from typing import List
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..security import get_current_agent_id
from . import services
from .schemas import TicketPlanResponse, CancelPlanResponse

logger = logging.getLogger("ticket-service.replay.routes")

router = APIRouter(prefix="/plans", tags=["Ticket Plans"])


@router.get("/active", response_model=List[TicketPlanResponse])
async def list_active_plans(
    db: AsyncSession = Depends(get_db),
    agent_id: str = Depends(get_current_agent_id),
):
    """Liste les plans de re-jeu actifs du caissier connecte."""
    return await services.list_active_plans_for_agent(db, UUID(agent_id))


@router.post("/{plan_id}/cancel", response_model=CancelPlanResponse)
async def cancel_plan(
    plan_id: UUID,
    db: AsyncSession = Depends(get_db),
    agent_id: str = Depends(get_current_agent_id),
):
    """Annule un plan : rembourse les rounds restants dans la caisse.

    Les tickets deja generes pour les rounds passes restent comme tickets normaux.
    """
    plan, refund_amount = await services.cancel_plan(db, plan_id, UUID(agent_id))
    rounds_refunded = (plan.rounds_total - plan.rounds_played)

    # Remboursement caisse via agent-service (montant positif = credit retour)
    if refund_amount > 0:
        agent_base = os.getenv("AGENT_SERVICE_URL", "http://agent-service:8000")
        admin_key = os.getenv("ADMIN_API_KEY", "CleSuperSecreteBackoffice2026")
        async with httpx.AsyncClient(timeout=5.0) as client:
            try:
                r = await client.post(
                    f"{agent_base}/{plan.agent_id}/provision",
                    json={
                        # Negatif : on retire les rounds restants de la caisse (rendu client).
                        "amount": -refund_amount,
                        "tx_type": "REVERSAL",
                        "description": f"Annulation plan re-jeu {str(plan.id)[:8]} ({rounds_refunded} rounds)",
                        "reference": f"PLAN-{str(plan.id)[:8]}",
                    },
                    headers={"X-API-Key": admin_key},
                )
                r.raise_for_status()
            except httpx.HTTPError as e:
                await db.rollback()
                logger.error(f"REPLAY_REFUND_FAIL plan={plan.id} error={e}")
                raise HTTPException(status_code=503, detail="Erreur lors du remboursement de la caisse.")

    await db.commit()
    logger.info(f"REPLAY_PLAN_CANCEL_OK plan={plan.id} refund={refund_amount}")

    return CancelPlanResponse(
        plan_id=plan.id,
        refunded_amount=refund_amount,
        rounds_refunded=rounds_refunded,
        message=f"Plan annule, {refund_amount} XAF rembourses ({rounds_refunded} rounds).",
    )
