from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..security import verify_admin_key
from . import services
from .models import JackpotPot
from .schemas import (
    JackpotPotCreate, JackpotPotUpdate, JackpotPotResponse,
    JackpotPotPublic, JackpotWinResponse, KioskJackpotsResponse,
)


# ============================================================
# ADMIN
# ============================================================

admin_router = APIRouter(prefix="/admin/jackpots", tags=["Jackpot Admin"])


@admin_router.get("", response_model=List[JackpotPotResponse], dependencies=[Depends(verify_admin_key)])
async def list_pots(db: AsyncSession = Depends(get_db)):
    pots = await services.list_pots(db)
    return pots


@admin_router.post("", response_model=JackpotPotResponse, dependencies=[Depends(verify_admin_key)])
async def create_pot(payload: JackpotPotCreate, db: AsyncSession = Depends(get_db)):
    return await services.create_pot(db, payload)


@admin_router.patch("/{pot_id}", response_model=JackpotPotResponse, dependencies=[Depends(verify_admin_key)])
async def update_pot(pot_id: UUID, payload: JackpotPotUpdate, db: AsyncSession = Depends(get_db)):
    return await services.update_pot(db, pot_id, payload)


# /wins (tous pots) DOIT etre declaree AVANT /{pot_id}/... pour eviter le matching glouton.
@admin_router.get("/wins", response_model=List[JackpotWinResponse], dependencies=[Depends(verify_admin_key)])
async def get_all_wins(limit: int = Query(100, ge=1, le=500), db: AsyncSession = Depends(get_db)):
    return await services.list_wins(db, pot_id=None, limit=limit)


@admin_router.get("/{pot_id}", response_model=JackpotPotResponse, dependencies=[Depends(verify_admin_key)])
async def get_pot(pot_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(JackpotPot).where(JackpotPot.id == pot_id))
    pot = result.scalars().first()
    if not pot:
        raise HTTPException(status_code=404, detail="Pot introuvable")
    return pot


@admin_router.get("/{pot_id}/wins", response_model=List[JackpotWinResponse], dependencies=[Depends(verify_admin_key)])
async def get_pot_wins(pot_id: UUID, limit: int = Query(100, ge=1, le=500), db: AsyncSession = Depends(get_db)):
    return await services.list_wins(db, pot_id=pot_id, limit=limit)


# ============================================================
# PUBLIC (consomme par le frontend Unity)
# ============================================================

public_router = APIRouter(prefix="/jackpots", tags=["Jackpot Public"])


@public_router.get("/by-kiosk/{code}", response_model=KioskJackpotsResponse)
async def jackpots_by_kiosk(code: str, db: AsyncSession = Depends(get_db)):
    """Liste tous les pots actifs alimentes par les tickets d'un kiosque.

    Resout d'abord `code` via agent-service. Ne renvoie jamais le seuil.
    """
    kiosk = await services.resolve_kiosk_code(code)
    pots = await services.list_active_pots_for_kiosk(db, kiosk.agent_id)

    return KioskJackpotsResponse(
        kiosk_code=kiosk.kiosk_code,
        kiosk_name=kiosk.kiosk_name,
        kiosk_id=kiosk.agent_id,
        pots=[
            JackpotPotPublic(
                id=p.id, scope=p.scope, game_id=p.game_id, tier=p.tier,
                current_amount=p.current_amount,
            )
            for p in pots
        ],
    )
