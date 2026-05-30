"""Logique metier du moteur jackpot (jackpot-service).

Source de verite unique pour tous les pots :
  - GLOBAL   : 1 pot, alimente par tous les tickets de tous les jeux
  - GAME     : 1 pot par jeu (game_id), alimente par tous les tickets de ce jeu
  - LOCAL    : 3 tiers (BRONZE/SILVER/GOLD) par (game_id, kiosk_code)

ADAPTATION cle : les pots LOCAL sont keyes par kiosk_code (String, ex "99A4")
au lieu de kiosk_id (UUID) — le frontend parle toujours kiosk_code.

contribute() prend des scalaires (pas de Ticket ORM) car ce service est
independant de ticket-service.
"""
from __future__ import annotations

import logging
import secrets
from decimal import Decimal
from typing import List, Optional, Tuple
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select, update, delete, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .models import (
    JackpotPot, JackpotContribution, JackpotWin,
    JackpotScope, JackpotTier, WinnerMode, ContributionMode, ResetMode,
)
from .threshold import draw_threshold

logger = logging.getLogger("jackpot-service")


# ---------------------------------------------------------------------------
# Constantes : templates de pots LOCAL auto-crees a la premiere contribution
# ---------------------------------------------------------------------------

_LOCAL_DEFAULTS = {
    JackpotTier.BRONZE: dict(
        contribution_percent=Decimal("0.5000"),
        threshold_min=500_000,
        threshold_max=2_000_000,
    ),
    JackpotTier.SILVER: dict(
        contribution_percent=Decimal("0.3000"),
        threshold_min=2_000_000,
        threshold_max=8_000_000,
    ),
    JackpotTier.GOLD: dict(
        contribution_percent=Decimal("0.1000"),
        threshold_min=8_000_000,
        threshold_max=30_000_000,
    ),
}


# ---------------------------------------------------------------------------
# Validation identite pot
# ---------------------------------------------------------------------------

def _validate_pot_identity(scope: JackpotScope, game_id, kiosk_code, tier) -> None:
    if scope == JackpotScope.GLOBAL:
        if game_id or kiosk_code or tier:
            raise HTTPException(
                status_code=400,
                detail="Le pot GLOBAL ne doit avoir ni game_id, ni kiosk_code, ni tier",
            )
    elif scope == JackpotScope.GAME:
        if not game_id or kiosk_code:
            raise HTTPException(
                status_code=400,
                detail="Le pot GAME doit avoir game_id (tier optionnel), sans kiosk_code",
            )
    elif scope == JackpotScope.LOCAL:
        if not game_id or not kiosk_code or not tier:
            raise HTTPException(
                status_code=400,
                detail="Le pot LOCAL doit avoir game_id + kiosk_code + tier",
            )


# ---------------------------------------------------------------------------
# Administration des pots
# ---------------------------------------------------------------------------

async def create_pot(db: AsyncSession, payload) -> JackpotPot:
    _validate_pot_identity(payload.scope, payload.game_id, payload.kiosk_code, payload.tier)
    if payload.threshold_max < payload.threshold_min:
        raise HTTPException(status_code=400, detail="threshold_max < threshold_min")

    initial_threshold = draw_threshold(payload.threshold_min, payload.threshold_max)
    pot = JackpotPot(
        scope=payload.scope,
        game_id=payload.game_id,
        kiosk_code=payload.kiosk_code,
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
    logger.info(
        "JACKPOT_POT_CREATED id=%s scope=%s game=%s kiosk_code=%s tier=%s threshold_secret=set",
        pot.id, pot.scope.value, pot.game_id, pot.kiosk_code, pot.tier,
    )
    return pot


async def update_pot(db: AsyncSession, pot_id, payload) -> JackpotPot:
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
    # courant pour qu'il appartienne au nouvel intervalle.
    if bounds_changed:
        pot.current_threshold = draw_threshold(pot.threshold_min, pot.threshold_max)
        logger.info(
            "JACKPOT_POT_THRESHOLD_REDRAWN pot=%s bounds=[%s,%s]",
            pot.id, pot.threshold_min, pot.threshold_max,
        )

    await db.commit()
    await db.refresh(pot)
    return pot


async def list_pots(db: AsyncSession) -> List[JackpotPot]:
    result = await db.execute(
        select(JackpotPot).order_by(JackpotPot.scope, JackpotPot.game_id, JackpotPot.tier)
    )
    return list(result.scalars().all())


async def list_wins(
    db: AsyncSession, pot_id=None, limit: int = 100
) -> List[JackpotWin]:
    q = select(JackpotWin).order_by(JackpotWin.paid_at.desc()).limit(limit)
    if pot_id:
        q = q.where(JackpotWin.pot_id == pot_id)
    result = await db.execute(q)
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# Auto-creation des pots LOCAL pour (game_id, kiosk_code) si inexistants
# ---------------------------------------------------------------------------

async def _ensure_local_pots(
    db: AsyncSession, game_id: str, kiosk_code: str
) -> None:
    """Cree les 3 pots LOCAL (BRONZE/SILVER/GOLD) pour ce (game_id, kiosk_code)
    si ils n'existent pas encore. On_conflict_do_nothing : idempotent."""
    for tier, defaults in _LOCAL_DEFAULTS.items():
        # Test d'existence avant insertion pour eviter le rollback sous charge
        exists_r = await db.execute(
            select(JackpotPot.id).where(
                JackpotPot.scope == JackpotScope.LOCAL,
                JackpotPot.game_id == game_id,
                JackpotPot.kiosk_code == kiosk_code,
                JackpotPot.tier == tier,
            )
        )
        if exists_r.scalar_one_or_none() is not None:
            continue

        tmin = defaults["threshold_min"]
        tmax = defaults["threshold_max"]
        pot = JackpotPot(
            scope=JackpotScope.LOCAL,
            game_id=game_id,
            kiosk_code=kiosk_code,
            tier=tier,
            enabled=True,
            contribution_mode=ContributionMode.PERCENT,
            contribution_percent=defaults["contribution_percent"],
            contribution_fixed=0,
            threshold_min=tmin,
            threshold_max=tmax,
            reset_mode=ResetMode.ZERO,
            seed_amount=0,
            winner_mode=WinnerMode.TRIGGER_TICKET,
            recent_window_minutes=60,
            max_payout=None,
            current_amount=0,
            current_threshold=draw_threshold(tmin, tmax),
            cycle_number=1,
        )
        db.add(pot)
        try:
            await db.flush()
            logger.info(
                "JACKPOT_LOCAL_AUTO_CREATED game=%s kiosk_code=%s tier=%s",
                game_id, kiosk_code, tier.value,
            )
        except IntegrityError:
            # Concurrent create — fine, on rollback juste ce flush
            await db.rollback()


# ---------------------------------------------------------------------------
# Contribution (appele depuis POST /internal/contribute)
# ---------------------------------------------------------------------------

class HitResult:
    def __init__(
        self,
        pot: JackpotPot,
        winner_ticket_id: str,
        winner_agent_id: str,
        payout: int,
        winner_short_code: Optional[str] = None,
    ):
        self.pot = pot
        self.winner_ticket_id = winner_ticket_id
        self.winner_agent_id = winner_agent_id
        self.payout = payout
        # Human-readable code of the winning ticket (shown in the celebration so
        # the player + agent know who won). Known when the winner is the trigger
        # ticket (TRIGGER_TICKET mode); None for a RANDOM_RECENT winner.
        self.winner_short_code = winner_short_code


def _compute_contribution(pot: JackpotPot, total_wager: int) -> int:
    if pot.contribution_mode == ContributionMode.FIXED:
        return int(pot.contribution_fixed)
    pct = Decimal(pot.contribution_percent or 0)
    return int((Decimal(total_wager) * pct) / Decimal(100))


async def contribute(
    db: AsyncSession,
    *,
    ticket_id: str,
    game_id: str,
    kiosk_code: Optional[str],
    agent_id: str,
    wager: int,
    short_code: Optional[str] = None,
) -> Tuple[List[dict], List[HitResult]]:
    """Alimente tous les pots eligibles pour un ticket vendu.

    Signature scalaire (pas de Ticket ORM) — independant de ticket-service.

    Retourne (touched_pots, hits).

    Strateggie d'increment :
      - Path commun : UPDATE atomique avec RETURNING (serialisation row-level).
      - Path lent (HIT, rare) : SELECT FOR UPDATE sur LE pot qui a franchi son seuil.
    """
    hits: List[HitResult] = []
    touched: List[dict] = []

    # Auto-creer les pots LOCAL si kiosk_code fourni et pots absents
    if kiosk_code:
        await _ensure_local_pots(db, game_id, kiosk_code)

    # 1) Liste des pots eligibles (lecture seule, pas de verrou)
    eligible_filter = (
        (JackpotPot.scope == JackpotScope.GLOBAL)
        | ((JackpotPot.scope == JackpotScope.GAME) & (JackpotPot.game_id == game_id))
    )
    if kiosk_code:
        eligible_filter = eligible_filter | (
            (JackpotPot.scope == JackpotScope.LOCAL)
            & (JackpotPot.game_id == game_id)
            & (JackpotPot.kiosk_code == kiosk_code)
        )

    result = await db.execute(
        select(JackpotPot).where(
            JackpotPot.enabled.is_(True),
            eligible_filter,
        )
    )
    pots = list(result.scalars().all())

    for pot in pots:
        contrib = _compute_contribution(pot, wager)
        if contrib <= 0:
            continue

        # 2) Increment atomique avec RETURNING
        upd = await db.execute(
            update(JackpotPot)
            .where(JackpotPot.id == pot.id)
            .values(current_amount=JackpotPot.current_amount + contrib)
            .returning(
                JackpotPot.current_amount,
                JackpotPot.current_threshold,
                JackpotPot.cycle_number,
            )
        )
        row = upd.first()
        if row is None:
            # Le pot a ete supprime entre temps (cas marginal)
            continue
        new_amount, threshold, cycle = int(row[0]), int(row[1]), int(row[2])

        db.add(JackpotContribution(
            pot_id=pot.id,
            ticket_id=ticket_id,
            cycle_number=cycle,
            amount=contrib,
            pot_amount_after=new_amount,
        ))

        touched.append({
            "pot_id": str(pot.id),
            "scope": pot.scope.value if hasattr(pot.scope, "value") else str(pot.scope),
            "tier": (
                pot.tier.value
                if pot.tier and hasattr(pot.tier, "value")
                else (pot.tier if pot.tier else None)
            ),
            "game_id": pot.game_id,
            "kiosk_code": pot.kiosk_code,
            "current_amount": new_amount,
            "cycle_number": cycle,
        })

        # 3) HIT detection — slow path
        if new_amount >= threshold:
            hit = await _try_claim_hit(
                db, pot.id, cycle, ticket_id=ticket_id, agent_id=agent_id,
                short_code=short_code,
            )
            if hit:
                hits.append(hit)

    try:
        await db.commit()
    except IntegrityError:
        # Duplicate contribution (ticket_id deja vu) — idempotent, on ignore
        await db.rollback()
        logger.warning(
            "JACKPOT_CONTRIB_DUPLICATE ticket_id=%s game_id=%s — contribution ignoree",
            ticket_id, game_id,
        )
        return [], []

    return touched, hits


async def _try_claim_hit(
    db: AsyncSession,
    pot_id,
    seen_cycle: int,
    *,
    ticket_id: str,
    agent_id: str,
    short_code: Optional[str] = None,
) -> Optional[HitResult]:
    """Tente de revendiquer un HIT sur ce pot pour le cycle observe.

    Retourne None si un autre ticket concurrent a deja revendique ce HIT.
    """
    result = await db.execute(
        select(JackpotPot)
        .where(
            JackpotPot.id == pot_id,
            JackpotPot.cycle_number == seen_cycle,
        )
        .with_for_update()
    )
    pot = result.scalar_one_or_none()
    if pot is None:
        return None
    if pot.current_amount < pot.current_threshold:
        return None
    return await _process_hit(
        db, pot, ticket_id=ticket_id, agent_id=agent_id, short_code=short_code
    )


async def _pick_winner_ticket(
    db: AsyncSession,
    pot: JackpotPot,
    trigger_ticket_id: str,
    trigger_agent_id: str,
) -> Tuple[str, str]:
    """Retourne (winner_ticket_id, winner_agent_id).

    TRIGGER_TICKET : le ticket declencheur gagne.
    RANDOM_RECENT  : tirage parmi les contributeurs recents du cycle courant.
                     Les agent_ids ne sont pas disponibles ici (cross-service),
                     donc on retourne winner_agent_id = trigger_agent_id si
                     le gagnant est le ticket declencheur, sinon on ne peut
                     pas resoudre l'agent_id sans appel externe — on retourne
                     trigger_agent_id par defaut (conservatif).
    """
    if pot.winner_mode == WinnerMode.TRIGGER_TICKET:
        return trigger_ticket_id, trigger_agent_id

    # RANDOM_RECENT : tirage parmi les contributions du cycle courant dans la fenetre
    window_start = datetime.utcnow() - timedelta(minutes=pot.recent_window_minutes)
    result = await db.execute(
        select(JackpotContribution.ticket_id)
        .where(
            JackpotContribution.pot_id == pot.id,
            JackpotContribution.cycle_number == pot.cycle_number,
            JackpotContribution.created_at >= window_start,
        )
    )
    candidates = [row[0] for row in result.all()]
    if not candidates:
        return trigger_ticket_id, trigger_agent_id

    winner_tid = secrets.choice(candidates)
    # agent_id non disponible pour les autres tickets (cross-service boundary)
    # On retourne trigger_agent_id comme approximation conservatrice si ce n'est
    # pas le ticket declencheur. ticket-service peut surcharger si besoin.
    winner_aid = trigger_agent_id if winner_tid == trigger_ticket_id else trigger_agent_id
    return winner_tid, winner_aid


async def _process_hit(
    db: AsyncSession,
    pot: JackpotPot,
    *,
    ticket_id: str,
    agent_id: str,
    short_code: Optional[str] = None,
) -> HitResult:
    winner_ticket_id, winner_agent_id = await _pick_winner_ticket(
        db, pot, ticket_id, agent_id
    )
    # The triggering ticket's short_code is known (passed by ticket-service).
    # It IS the winner's code in TRIGGER_TICKET mode; for a RANDOM_RECENT winner
    # other than the trigger we don't have the code here, so leave it None.
    winner_short_code = short_code if winner_ticket_id == ticket_id else None
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
        trigger_ticket_id=ticket_id,
        winner_ticket_id=winner_ticket_id,
        winner_agent_id=winner_agent_id,
        threshold_hit=pot.current_threshold,
        pot_amount_at_hit=pot_amount,
        payout_amount=payout,
        carryover=carryover,
    ))

    # 2) Reset cycle
    seed_carry = carryover
    base = pot.seed_amount if pot.reset_mode == ResetMode.SEED else 0
    pot.current_amount = base + seed_carry
    pot.current_threshold = draw_threshold(pot.threshold_min, pot.threshold_max)
    pot.cycle_number += 1
    pot.started_at = func.now()

    logger.info(
        "JACKPOT_HIT pot=%s cycle=%s payout=%s winner_ticket=%s winner_agent=%s carryover=%s",
        pot.id, pot.cycle_number - 1, payout, winner_ticket_id, winner_agent_id, carryover,
    )

    return HitResult(
        pot=pot,
        winner_ticket_id=winner_ticket_id,
        winner_agent_id=winner_agent_id,
        payout=payout,
        winner_short_code=winner_short_code,
    )


# ---------------------------------------------------------------------------
# Lecture publique : display shape pour GET /jackpots
# ---------------------------------------------------------------------------

async def get_display(
    db: AsyncSession,
    game_id: Optional[str],
    kiosk_code: Optional[str],
) -> dict:
    """Retourne {general, game, locals} — jamais current_threshold."""
    result = await db.execute(
        select(
            JackpotPot.scope,
            JackpotPot.game_id,
            JackpotPot.kiosk_code,
            JackpotPot.tier,
            JackpotPot.current_amount,
        ).where(
            JackpotPot.enabled.is_(True),
            (
                (JackpotPot.scope == JackpotScope.GLOBAL)
                | (
                    (JackpotPot.scope == JackpotScope.GAME)
                    & (JackpotPot.game_id == game_id)
                )
                | (
                    (JackpotPot.scope == JackpotScope.LOCAL)
                    & (JackpotPot.game_id == game_id)
                    & (JackpotPot.kiosk_code == kiosk_code)
                )
            ),
        )
    )
    rows = result.all()

    general = 0
    game_amount: Optional[int] = None
    locals_map: dict = {}

    for scope, g_id, k_code, tier, amount in rows:
        if scope == JackpotScope.GLOBAL:
            general = int(amount)
        elif scope == JackpotScope.GAME:
            game_amount = int(amount)
        elif scope == JackpotScope.LOCAL and tier:
            tier_key = tier.value.lower() if hasattr(tier, "value") else str(tier).lower()
            locals_map[tier_key] = int(amount)

    return {
        "general": general,
        "game": {"game_id": game_id, "amount": game_amount or 0} if game_id else None,
        "locals": {
            "bronze": locals_map.get("bronze", 0),
            "silver": locals_map.get("silver", 0),
            "gold": locals_map.get("gold", 0),
        },
    }
