"""Logique metier du moteur jackpot.

Regroupe :
  - pots_service   : creation/lecture/configuration des pots
  - kiosks_service : resolution kiosk_code -> agent_id via agent-service
  - contribution_service : ajout de contributions pour un ticket vendu
  - hit_service    : traitement d'un HIT (designation gagnant, reset)
  - cancel_service : rollback des contributions d'un ticket annule
"""
from __future__ import annotations

import os
import logging
import secrets
from decimal import Decimal
from uuid import UUID
from typing import List, Optional
from datetime import datetime, timedelta

import httpx
from fastapi import HTTPException
from sqlalchemy import select, update, delete, func, and_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models as ticket_models
from .models import (
    JackpotPot, JackpotContribution, JackpotWin,
    JackpotScope, JackpotTier, WinnerMode, ContributionMode, ResetMode,
)
from .threshold import draw_threshold

logger = logging.getLogger("ticket-service.jackpot")


# ----------------------------------------------------------------------
# Resolution kiosk_code -> agent_id (via agent-service)
# ----------------------------------------------------------------------

class _KioskLookup:
    agent_id: UUID
    kiosk_code: str
    kiosk_name: Optional[str]


async def resolve_kiosk_code(code: str) -> _KioskLookup:
    base = os.getenv("AGENT_SERVICE_URL", "http://agent-service:8000")
    url = f"{base}/by-code/{code.upper()}"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url)
        if r.status_code == 404:
            raise HTTPException(status_code=404, detail="Aucun kiosque pour ce code")
        r.raise_for_status()
        data = r.json()
    except httpx.HTTPError as e:
        logger.error(f"KIOSK_LOOKUP_FAILED code={code} error={e}")
        raise HTTPException(status_code=502, detail="Service kiosque indisponible")

    lk = _KioskLookup()
    lk.agent_id = UUID(data["agent_id"])
    lk.kiosk_code = data["kiosk_code"]
    lk.kiosk_name = data.get("kiosk_name")
    return lk


# ----------------------------------------------------------------------
# Pots — creation / lecture / configuration
# ----------------------------------------------------------------------

def _validate_pot_identity(scope: JackpotScope, game_id, kiosk_id, tier) -> None:
    if scope == JackpotScope.GLOBAL:
        if game_id or kiosk_id or tier:
            raise HTTPException(status_code=400, detail="Le pot GLOBAL ne doit avoir ni game_id, ni kiosk_id, ni tier")
    elif scope == JackpotScope.GAME:
        # tier est optionnel : un pot GAME sans tier = "le" jackpot global du jeu,
        # complementaire des paliers Bronze/Argent/Or.
        if not game_id or kiosk_id:
            raise HTTPException(status_code=400, detail="Le pot GAME doit avoir game_id (tier optionnel), sans kiosk_id")
    elif scope == JackpotScope.LOCAL:
        if not game_id or not kiosk_id or not tier:
            raise HTTPException(status_code=400, detail="Le pot LOCAL doit avoir game_id + kiosk_id + tier")


async def create_pot(db: AsyncSession, payload) -> JackpotPot:
    _validate_pot_identity(payload.scope, payload.game_id, payload.kiosk_id, payload.tier)
    if payload.threshold_max < payload.threshold_min:
        raise HTTPException(status_code=400, detail="threshold_max < threshold_min")

    initial_threshold = draw_threshold(payload.threshold_min, payload.threshold_max)
    pot = JackpotPot(
        scope=payload.scope,
        game_id=payload.game_id,
        kiosk_id=payload.kiosk_id,
        tier=payload.tier,
        enabled=payload.enabled,
        contribution_mode=payload.contribution_mode,
        contribution_percent=payload.contribution_percent,
        contribution_fixed=payload.contribution_fixed,
        threshold_min=payload.threshold_min,
        threshold_max=payload.threshold_max,
        reset_mode=payload.reset_mode,
        seed_amount=payload.seed_amount,
        winner_mode=payload.winner_mode,
        recent_window_minutes=payload.recent_window_minutes,
        max_payout=payload.max_payout,
        current_amount=payload.seed_amount if payload.reset_mode == ResetMode.SEED else 0,
        current_threshold=initial_threshold,
        cycle_number=1,
    )
    db.add(pot)
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Un pot avec cette identite (scope/jeu/kiosque/niveau) existe deja.",
        ) from e
    await db.refresh(pot)
    logger.info(f"JACKPOT_POT_CREATED id={pot.id} scope={pot.scope.value} game={pot.game_id} tier={pot.tier} threshold_secret=set")
    return pot


async def update_pot(db: AsyncSession, pot_id: UUID, payload) -> JackpotPot:
    result = await db.execute(select(JackpotPot).where(JackpotPot.id == pot_id))
    pot = result.scalars().first()
    if not pot:
        raise HTTPException(status_code=404, detail="Pot introuvable")

    data = payload.model_dump(exclude_unset=True)
    new_min = data.get("threshold_min", pot.threshold_min)
    new_max = data.get("threshold_max", pot.threshold_max)
    if new_max < new_min:
        raise HTTPException(status_code=400, detail="threshold_max < threshold_min")

    bounds_changed = (
        ("threshold_min" in data and data["threshold_min"] != pot.threshold_min)
        or ("threshold_max" in data and data["threshold_max"] != pot.threshold_max)
    )

    for k, v in data.items():
        setattr(pot, k, v)

    # Si l'admin modifie les bornes du seuil, on re-tire le current_threshold du cycle
    # courant pour qu'il appartienne au nouvel intervalle (sinon le pot peut HIT
    # immediatement ou jamais).
    if bounds_changed:
        pot.current_threshold = draw_threshold(pot.threshold_min, pot.threshold_max)
        logger.info(f"JACKPOT_POT_THRESHOLD_REDRAWN pot={pot.id} bounds=[{pot.threshold_min},{pot.threshold_max}]")

    await db.commit()
    await db.refresh(pot)
    return pot


async def list_pots(db: AsyncSession) -> List[JackpotPot]:
    result = await db.execute(
        select(JackpotPot).order_by(JackpotPot.scope, JackpotPot.game_id, JackpotPot.tier)
    )
    return list(result.scalars().all())


async def list_active_pots_for_kiosk(db: AsyncSession, kiosk_id: UUID) -> List[JackpotPot]:
    """Tous les pots qu'un ticket vendu sur ce kiosque alimente.

    = GLOBAL + GAME (* tier) + LOCAL pour ce kiosque (* tier)
    Filtrage par game_id se fait au moment de la contribution.
    """
    result = await db.execute(
        select(JackpotPot).where(
            JackpotPot.enabled.is_(True),
            (
                (JackpotPot.scope == JackpotScope.GLOBAL)
                | (JackpotPot.scope == JackpotScope.GAME)
                | ((JackpotPot.scope == JackpotScope.LOCAL) & (JackpotPot.kiosk_id == kiosk_id))
            ),
        ).order_by(JackpotPot.scope, JackpotPot.game_id, JackpotPot.tier)
    )
    return list(result.scalars().all())


async def list_wins(db: AsyncSession, pot_id: Optional[UUID] = None, limit: int = 100) -> List[JackpotWin]:
    q = select(JackpotWin).order_by(JackpotWin.paid_at.desc()).limit(limit)
    if pot_id:
        q = q.where(JackpotWin.pot_id == pot_id)
    result = await db.execute(q)
    return list(result.scalars().all())


# ----------------------------------------------------------------------
# Eligibilite + calcul de contribution
# ----------------------------------------------------------------------

def _pot_matches_ticket(pot: JackpotPot, game_id: str, kiosk_id: UUID) -> bool:
    if pot.scope == JackpotScope.GLOBAL:
        return True
    if pot.scope == JackpotScope.GAME:
        return pot.game_id == game_id
    if pot.scope == JackpotScope.LOCAL:
        return pot.game_id == game_id and pot.kiosk_id == kiosk_id
    return False


def _compute_contribution(pot: JackpotPot, total_wager: int) -> int:
    if pot.contribution_mode == ContributionMode.FIXED:
        return int(pot.contribution_fixed)
    pct = Decimal(pot.contribution_percent or 0)
    return int((Decimal(total_wager) * pct) / Decimal(100))


# ----------------------------------------------------------------------
# Contribution (appele apres creation d'un ticket)
# ----------------------------------------------------------------------

async def contribute_for_ticket(db: AsyncSession, ticket: ticket_models.Ticket) -> List["HitResult"]:
    """Alimente tous les pots eligibles. Retourne la liste des HITs declenches.

    Transaction atomique : si une etape echoue, l'appelant rollback.
    """
    hits: List[HitResult] = []

    # Lock les pots eligibles pour eviter les races
    result = await db.execute(
        select(JackpotPot)
        .where(
            JackpotPot.enabled.is_(True),
            (
                (JackpotPot.scope == JackpotScope.GLOBAL)
                | ((JackpotPot.scope == JackpotScope.GAME) & (JackpotPot.game_id == ticket.game_id))
                | (
                    (JackpotPot.scope == JackpotScope.LOCAL)
                    & (JackpotPot.game_id == ticket.game_id)
                    & (JackpotPot.kiosk_id == ticket.agent_id)
                )
            ),
        )
        .with_for_update()
    )
    pots = list(result.scalars().all())

    for pot in pots:
        contrib = _compute_contribution(pot, ticket.total_wager)
        if contrib <= 0:
            continue

        pot.current_amount += contrib
        db.add(JackpotContribution(
            pot_id=pot.id,
            ticket_id=ticket.id,
            cycle_number=pot.cycle_number,
            amount=contrib,
            pot_amount_after=pot.current_amount,
        ))

        if pot.current_amount >= pot.current_threshold:
            hit = await _process_hit(db, pot, ticket)
            hits.append(hit)

    return hits


# ----------------------------------------------------------------------
# Hit : un pot a franchi son seuil
# ----------------------------------------------------------------------

class HitResult:
    def __init__(self, pot: JackpotPot, winner_ticket_id: UUID, winner_agent_id: UUID, payout: int):
        self.pot = pot
        self.winner_ticket_id = winner_ticket_id
        self.winner_agent_id = winner_agent_id
        self.payout = payout


async def _pick_winner(db: AsyncSession, pot: JackpotPot, trigger_ticket: ticket_models.Ticket) -> ticket_models.Ticket:
    if pot.winner_mode == WinnerMode.TRIGGER_TICKET:
        return trigger_ticket

    # RANDOM_RECENT : tirage uniforme parmi les tickets contributeurs du cycle courant
    # dans la fenetre `recent_window_minutes`.
    window_start = datetime.utcnow() - timedelta(minutes=pot.recent_window_minutes)
    result = await db.execute(
        select(ticket_models.Ticket)
        .join(JackpotContribution, JackpotContribution.ticket_id == ticket_models.Ticket.id)
        .where(
            JackpotContribution.pot_id == pot.id,
            JackpotContribution.cycle_number == pot.cycle_number,
            JackpotContribution.created_at >= window_start,
            ticket_models.Ticket.status != ticket_models.TicketStatus.CANCELLED,
        )
    )
    candidates = list(result.scalars().all())
    if not candidates:
        return trigger_ticket
    return secrets.choice(candidates)


async def _process_hit(db: AsyncSession, pot: JackpotPot, trigger_ticket: ticket_models.Ticket) -> HitResult:
    winner = await _pick_winner(db, pot, trigger_ticket)
    pot_amount = pot.current_amount

    if pot.max_payout is not None and pot.max_payout > 0:
        payout = min(pot_amount, pot.max_payout)
    else:
        payout = pot_amount
    carryover = pot_amount - payout

    # 1) Historise le win
    db.add(JackpotWin(
        pot_id=pot.id,
        cycle_number=pot.cycle_number,
        trigger_ticket_id=trigger_ticket.id,
        winner_ticket_id=winner.id,
        winner_agent_id=winner.agent_id,
        threshold_hit=pot.current_threshold,
        pot_amount_at_hit=pot_amount,
        payout_amount=payout,
        carryover=carryover,
    ))

    # 2) Attache la prime au ticket gagnant
    winner.total_payout = (winner.total_payout or 0) + payout
    # Si le ticket est encore PENDING, on le passe en WON ; sinon (WON deja resolu)
    # on ne change pas le statut pour ne pas re-payer un ticket deja regle.
    if winner.status == ticket_models.TicketStatus.PENDING:
        winner.status = ticket_models.TicketStatus.WON

    # 3) Reset cycle
    seed_carry = carryover
    base = pot.seed_amount if pot.reset_mode == ResetMode.SEED else 0
    pot.current_amount = base + seed_carry
    pot.current_threshold = draw_threshold(pot.threshold_min, pot.threshold_max)
    pot.cycle_number += 1
    pot.started_at = func.now()

    logger.info(
        f"JACKPOT_HIT pot={pot.id} cycle={pot.cycle_number - 1} payout={payout} "
        f"winner_ticket={winner.id} winner_agent={winner.agent_id} carryover={carryover}"
    )

    return HitResult(pot=pot, winner_ticket_id=winner.id, winner_agent_id=winner.agent_id, payout=payout)


# ----------------------------------------------------------------------
# Cancel : rollback des contributions d'un ticket annule
# ----------------------------------------------------------------------

async def rollback_for_ticket(db: AsyncSession, ticket_id: UUID) -> int:
    """Retire toutes les contributions d'un ticket. Refus si HIT deja paye.

    Retourne le nombre de pots impactes.
    """
    # Refus si une jackpot_win a ce ticket comme winner (gain deja attache)
    won = await db.execute(
        select(func.count(JackpotWin.id)).where(JackpotWin.winner_ticket_id == ticket_id)
    )
    if (won.scalar() or 0) > 0:
        raise HTTPException(
            status_code=409,
            detail="Annulation impossible : ce ticket a deja gagne un jackpot.",
        )

    # Recupere les contributions
    rows = await db.execute(
        select(JackpotContribution).where(JackpotContribution.ticket_id == ticket_id)
    )
    contributions = list(rows.scalars().all())
    if not contributions:
        return 0

    pot_ids = list({c.pot_id for c in contributions})
    pots_rs = await db.execute(
        select(JackpotPot).where(JackpotPot.id.in_(pot_ids)).with_for_update()
    )
    pots = {p.id: p for p in pots_rs.scalars().all()}

    for c in contributions:
        pot = pots.get(c.pot_id)
        if not pot:
            continue
        # On ne decremente que si la contribution etait sur le cycle courant.
        # Sinon (cycle deja remplace), elle est "absorbee" dans le pot precedent : on l'ignore.
        if c.cycle_number == pot.cycle_number:
            pot.current_amount = max(0, pot.current_amount - c.amount)

    # Supprime les traces
    await db.execute(
        delete(JackpotContribution).where(JackpotContribution.ticket_id == ticket_id)
    )

    logger.info(f"JACKPOT_ROLLBACK ticket={ticket_id} pots={len(pot_ids)} contribs={len(contributions)}")
    return len(pot_ids)
