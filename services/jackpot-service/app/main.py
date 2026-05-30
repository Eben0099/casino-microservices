"""Jackpot Service — source de verite unique pour tous les jackpots casino.

Endpoints :
  POST /internal/contribute   (x-internal-key) -> {touched_pots, hits}
  GET  /jackpots               (public)         -> {general, game, locals}
  GET  /admin/pots             (x-api-key)      -> liste complete des pots
  GET  /admin/pots/wins        (x-api-key)      -> historique des HITs
  GET  /admin/pots/{id}        (x-api-key)      -> detail d'un pot
  POST /admin/pots             (x-api-key)      -> creer un pot
  PATCH /admin/pots/{id}       (x-api-key)      -> modifier les regles d'un pot
  GET  /admin/pots/{id}/wins   (x-api-key)      -> HITs d'un pot
  GET  /status                 (public)         -> health
"""
import json
import logging
import os
from typing import List, Optional
from uuid import UUID

import redis.asyncio as redis
from fastapi import Depends, FastAPI, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from .database import SessionLocal, get_db
from .models import (
    JackpotPot, JackpotScope, JackpotTier, ContributionMode, ResetMode, WinnerMode,
)
from .schemas import (
    ContributeRequest, ContributeResponse, HitInfo,
    JackpotPotCreate, JackpotPotUpdate, JackpotPotResponse,
    JackpotWinResponse, JackpotsDisplayResponse,
)
from .security import verify_admin_key, verify_internal_key
from . import services
from .threshold import draw_threshold

logger = logging.getLogger("jackpot-service")

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Jackpot Service",
    root_path=os.getenv("ROOT_PATH", ""),
)

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------

redis_client = None

# ---------------------------------------------------------------------------
# Startup seeds — pots fixes (GLOBAL + GAME)
# ---------------------------------------------------------------------------

_SEED_POTS = [
    # GLOBAL — general
    dict(
        scope=JackpotScope.GLOBAL,
        game_id=None,
        kiosk_code=None,
        tier=None,
        enabled=True,
        contribution_mode=ContributionMode.PERCENT,
        contribution_percent="1.0000",  # 1% de chaque mise
        contribution_fixed=0,
        threshold_min=10_000_000,
        threshold_max=50_000_000,
        reset_mode=ResetMode.ZERO,
        seed_amount=0,
        winner_mode=WinnerMode.TRIGGER_TICKET,
        recent_window_minutes=60,
        max_payout=None,
    ),
    # GAME — Roulette
    dict(
        scope=JackpotScope.GAME,
        game_id="ROULETTE-TBL1",
        kiosk_code=None,
        tier=None,
        enabled=True,
        contribution_mode=ContributionMode.PERCENT,
        contribution_percent="0.5000",
        contribution_fixed=0,
        threshold_min=5_000_000,
        threshold_max=20_000_000,
        reset_mode=ResetMode.ZERO,
        seed_amount=0,
        winner_mode=WinnerMode.TRIGGER_TICKET,
        recent_window_minutes=60,
        max_payout=None,
    ),
    # GAME — Keno
    dict(
        scope=JackpotScope.GAME,
        game_id="KENO-DRAW1",
        kiosk_code=None,
        tier=None,
        enabled=True,
        contribution_mode=ContributionMode.PERCENT,
        contribution_percent="0.5000",
        contribution_fixed=0,
        threshold_min=5_000_000,
        threshold_max=20_000_000,
        reset_mode=ResetMode.ZERO,
        seed_amount=0,
        winner_mode=WinnerMode.TRIGGER_TICKET,
        recent_window_minutes=60,
        max_payout=None,
    ),
]


async def _seed_fixed_pots() -> None:
    """Insere les pots fixes (GLOBAL + GAME) si inexistants — idempotent."""
    async with SessionLocal() as db:
        for spec in _SEED_POTS:
            # Calcule un seuil initial
            tmin = spec["threshold_min"]
            tmax = spec["threshold_max"]
            threshold = draw_threshold(tmin, tmax)

            stmt = (
                pg_insert(JackpotPot)
                .values(
                    scope=spec["scope"],
                    game_id=spec["game_id"],
                    kiosk_code=spec["kiosk_code"],
                    tier=spec["tier"],
                    enabled=spec["enabled"],
                    contribution_mode=spec["contribution_mode"],
                    contribution_percent=spec["contribution_percent"],
                    contribution_fixed=spec["contribution_fixed"],
                    threshold_min=tmin,
                    threshold_max=tmax,
                    reset_mode=spec["reset_mode"],
                    seed_amount=spec["seed_amount"],
                    winner_mode=spec["winner_mode"],
                    recent_window_minutes=spec["recent_window_minutes"],
                    max_payout=spec["max_payout"],
                    current_amount=0,
                    current_threshold=threshold,
                    cycle_number=1,
                )
                # Bare DO NOTHING catches ANY unique violation, including the
                # per-scope PARTIAL unique indexes (uq_jackpot_pot_global etc.)
                # that replaced the NULL-bypassable constraint. Guarantees a
                # single GLOBAL/GAME pot no matter how often startup re-runs.
                .on_conflict_do_nothing()
            )
            await db.execute(stmt)
        await db.commit()
        logger.info("JACKPOT_SEED_POTS done (idempotent)")


# ---------------------------------------------------------------------------
# Startup / shutdown
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def startup_event() -> None:
    global redis_client
    redis_url = os.getenv("REDIS_URL", "redis://casino_redis:6379/0")
    redis_client = redis.from_url(redis_url, decode_responses=True)

    try:
        await _seed_fixed_pots()
    except Exception as exc:
        logger.error("JACKPOT_SEED_FAILED error=%s", exc)

    logger.info("Jackpot service started")


@app.on_event("shutdown")
async def shutdown_event() -> None:
    if redis_client:
        await redis_client.aclose()


# ---------------------------------------------------------------------------
# Helper : publier jackpot-updated sur Redis
# ---------------------------------------------------------------------------

async def _publish_update(game_id: Optional[str], kiosk_code: Optional[str], pots: list) -> None:
    if redis_client is None:
        return
    try:
        await redis_client.publish(
            "jackpot-updated",
            json.dumps({
                "game_id": game_id,
                "kiosk_code": kiosk_code,
                "pots": pots,
            }),
        )
    except Exception as exc:
        logger.warning("JACKPOT_REDIS_PUBLISH_FAILED error=%s", exc)


async def _publish_hit(hit) -> None:
    """Annonce un HIT de jackpot sur Redis (canal `jackpot-hit`).

    Les game-engines relaient cet evenement a leurs clients WS pour declencher
    la cinematique de gain. Best-effort ; safe a appeler apres commit car la
    session est `expire_on_commit=False`.

    `hit_id` est deterministe (`pot_id:cycle_gagnant`) — un pot ne peut gagner
    qu'une fois par cycle — pour que chaque consommateur deduplique sans etat.
    """
    if redis_client is None:
        return
    pot = hit.pot
    scope = pot.scope.value if hasattr(pot.scope, "value") else str(pot.scope)
    tier = (
        pot.tier.value
        if pot.tier and hasattr(pot.tier, "value")
        else (str(pot.tier) if pot.tier else None)
    )
    won_cycle = pot.cycle_number - 1  # cycle_number a deja ete incremente au reset
    try:
        await redis_client.publish(
            "jackpot-hit",
            json.dumps({
                "hit_id": f"{pot.id}:{won_cycle}",
                "pot_id": str(pot.id),
                "scope": scope,
                "tier": tier,
                "game_id": pot.game_id,
                "kiosk_code": pot.kiosk_code,
                "payout": hit.payout,
                "winner_ticket_id": hit.winner_ticket_id,
                "winner_short_code": getattr(hit, "winner_short_code", None),
                "cycle_number": won_cycle,
            }),
        )
    except Exception as exc:
        logger.warning("JACKPOT_HIT_PUBLISH_FAILED error=%s", exc)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/status")
async def get_status() -> dict:
    return {"service": "jackpot-service", "status": "ok"}


# ---------------------------------------------------------------------------
# POST /internal/contribute  (internal — ticket-service)
# ---------------------------------------------------------------------------

@app.post("/internal/contribute", response_model=ContributeResponse)
async def internal_contribute(
    body: ContributeRequest,
    _key: str = Depends(verify_internal_key),
    db: AsyncSession = Depends(get_db),
) -> ContributeResponse:
    """Alimente les pots pour un ticket vendu.

    Fail-safe : ne renvoie jamais 500 au caller pour une erreur non-critique.
    Retourne toujours {touched_pots, hits} (hits peut etre vide si erreur).
    """
    try:
        touched, hits = await services.contribute(
            db,
            ticket_id=body.ticket_id,
            game_id=body.game_id,
            kiosk_code=body.kiosk_code,
            agent_id=body.agent_id,
            wager=body.wager,
            short_code=body.short_code,
        )
    except Exception as exc:
        # Fail-open : on logue mais on ne plante pas ticket-service
        logger.error(
            "JACKPOT_CONTRIBUTE_ERROR ticket_id=%s game_id=%s error=%s",
            body.ticket_id, body.game_id, exc,
        )
        return ContributeResponse(touched_pots=[], hits=[])

    # Publier jackpot-updated sur Redis (best-effort)
    await _publish_update(body.game_id, body.kiosk_code, touched)

    # Annoncer chaque HIT sur le canal dedie pour les cinematiques de gain.
    for h in hits:
        await _publish_hit(h)

    logger.info(
        "JACKPOT_CONTRIBUTE ticket_id=%s game_id=%s kiosk_code=%s wager=%s pots=%s hits=%s",
        body.ticket_id, body.game_id, body.kiosk_code, body.wager,
        len(touched), len(hits),
    )

    hits_out = [
        HitInfo(
            pot_id=str(h.pot.id),
            scope=h.pot.scope.value if hasattr(h.pot.scope, "value") else str(h.pot.scope),
            tier=(
                h.pot.tier.value
                if h.pot.tier and hasattr(h.pot.tier, "value")
                else (str(h.pot.tier) if h.pot.tier else None)
            ),
            game_id=h.pot.game_id,
            payout=h.payout,
            winner_ticket_id=h.winner_ticket_id,
            winner_agent_id=h.winner_agent_id,
            cycle_number=h.pot.cycle_number,
        )
        for h in hits
    ]

    return ContributeResponse(touched_pots=touched, hits=hits_out)


# ---------------------------------------------------------------------------
# GET /jackpots  (public)
# ---------------------------------------------------------------------------

@app.get("/jackpots", response_model=JackpotsDisplayResponse)
async def public_jackpots(
    game_id: Optional[str] = Query(default=None),
    kiosk_code: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> JackpotsDisplayResponse:
    """Vue d'affichage : {general, game, locals:{bronze,silver,gold}}.

    Montants seulement. current_threshold jamais expose.
    """
    display = await services.get_display(db, game_id=game_id, kiosk_code=kiosk_code)
    return JackpotsDisplayResponse(**display)


# ---------------------------------------------------------------------------
# Admin — /admin/pots
# ---------------------------------------------------------------------------

@app.get("/admin/pots", response_model=List[JackpotPotResponse])
async def admin_list_pots(
    _key: str = Depends(verify_admin_key),
    db: AsyncSession = Depends(get_db),
) -> List[JackpotPotResponse]:
    """Liste tous les pots avec leur configuration complete (sans current_threshold)."""
    return await services.list_pots(db)


@app.post("/admin/pots", response_model=JackpotPotResponse, status_code=201)
async def admin_create_pot(
    payload: JackpotPotCreate,
    _key: str = Depends(verify_admin_key),
    db: AsyncSession = Depends(get_db),
) -> JackpotPotResponse:
    """Cree un pot avec l'ensemble des regles de distribution."""
    pot = await services.create_pot(db, payload)
    await _publish_update(pot.game_id, pot.kiosk_code, [])
    return pot


# IMPORTANT: /admin/pots/wins DOIT etre declare AVANT /admin/pots/{id}
# pour eviter le matching glouton de FastAPI.

@app.get("/admin/pots/wins", response_model=List[JackpotWinResponse])
async def admin_list_wins(
    limit: int = Query(100, ge=1, le=500),
    _key: str = Depends(verify_admin_key),
    db: AsyncSession = Depends(get_db),
) -> List[JackpotWinResponse]:
    """Historique global des HITs (tous pots)."""
    return await services.list_wins(db, pot_id=None, limit=limit)


@app.get("/admin/pots/{pot_id}", response_model=JackpotPotResponse)
async def admin_get_pot(
    pot_id: UUID,
    _key: str = Depends(verify_admin_key),
    db: AsyncSession = Depends(get_db),
) -> JackpotPotResponse:
    """Detail d'un pot (configuration complete, sans current_threshold)."""
    result = await db.execute(select(JackpotPot).where(JackpotPot.id == pot_id))
    pot = result.scalars().first()
    if not pot:
        raise HTTPException(status_code=404, detail="Pot introuvable")
    return pot


@app.patch("/admin/pots/{pot_id}", response_model=JackpotPotResponse)
async def admin_update_pot(
    pot_id: UUID,
    payload: JackpotPotUpdate,
    _key: str = Depends(verify_admin_key),
    db: AsyncSession = Depends(get_db),
) -> JackpotPotResponse:
    """Modifie les regles d'un pot.

    Champs editables :
      enabled, contribution_mode, contribution_percent, contribution_fixed,
      threshold_min, threshold_max, reset_mode, seed_amount,
      winner_mode, recent_window_minutes, max_payout.
    Si threshold_min/max change, current_threshold est re-tire automatiquement.
    """
    pot = await services.update_pot(db, pot_id, payload)
    await _publish_update(pot.game_id, pot.kiosk_code, [])
    return pot


@app.get("/admin/pots/{pot_id}/wins", response_model=List[JackpotWinResponse])
async def admin_get_pot_wins(
    pot_id: UUID,
    limit: int = Query(100, ge=1, le=500),
    _key: str = Depends(verify_admin_key),
    db: AsyncSession = Depends(get_db),
) -> List[JackpotWinResponse]:
    """Historique des HITs pour un pot specifique."""
    return await services.list_wins(db, pot_id=pot_id, limit=limit)
