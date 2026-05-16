"""Service jackpots — lecture/écriture des compteurs.

Source de vérité : Postgres (table `jackpot_state`).
Cache rapide : Redis (`jackpot:{kiosk_id}:{name}`).

Convention : `kiosk_id = "__GLOBAL__"` pour les jackpots globaux
(`general`, `spin2win`). Les jackpots per-kiosk (`bronze`, `silver`,
`gold`) sont seedés à la volée lors du premier accès d'un nouveau
kiosk_id.
"""

import logging
import math
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .database import SessionLocal
from .models import JackpotState

logger = logging.getLogger("jackpot-service")

JACKPOT_NAMES: tuple[str, ...] = ("general", "spin2win", "bronze", "silver", "gold")
GLOBAL_KIOSK = "__GLOBAL__"
GLOBAL_JACKPOTS = frozenset({"general", "spin2win"})
KIOSK_JACKPOTS = frozenset({"bronze", "silver", "gold"})

SEED_VALUES: dict[str, int] = {
    "general": 1_500_000,
    "spin2win": 500_000_000,
    "bronze": 2_500_000,
    "silver": 25_000_000,
    "gold": 45_000_000,
}

SEED_CONTRIBUTION_PCT: dict[str, float] = {
    "general": 0.003,
    "spin2win": 0.002,
    "bronze": 0.005,
    "silver": 0.003,
    "gold": 0.001,
}


def _redis_key(kiosk_id: str, name: str) -> str:
    return f"jackpot:{kiosk_id}:{name}"


async def _cache_value(redis_client, kiosk_id: str, name: str, value: int) -> None:
    if not redis_client:
        return
    try:
        await redis_client.set(_redis_key(kiosk_id, name), str(int(value)))
    except Exception as e:  # pragma: no cover — cache best-effort
        logger.warning(f"redis cache set failed for {kiosk_id}/{name}: {e}")


async def ensure_seeded(redis_client) -> None:
    """Seed les 2 lignes globales au démarrage si elles n'existent pas."""
    async with SessionLocal() as db:
        for name in ("general", "spin2win"):
            stmt = (
                pg_insert(JackpotState)
                .values(
                    kiosk_id=GLOBAL_KIOSK,
                    name=name,
                    value=SEED_VALUES[name],
                    contribution_pct=SEED_CONTRIBUTION_PCT[name],
                )
                .on_conflict_do_nothing(index_elements=["kiosk_id", "name"])
            )
            await db.execute(stmt)
        await db.commit()

        # Réhydrate le cache Redis depuis la base
        result = await db.execute(
            select(JackpotState).where(JackpotState.kiosk_id == GLOBAL_KIOSK)
        )
        for row in result.scalars().all():
            await _cache_value(redis_client, row.kiosk_id, row.name, row.value)


async def _seed_kiosk_if_missing(db, kiosk_id: str) -> None:
    """Insère les 3 lignes bronze/silver/gold pour un kiosk inconnu."""
    for name in KIOSK_JACKPOTS:
        stmt = (
            pg_insert(JackpotState)
            .values(
                kiosk_id=kiosk_id,
                name=name,
                value=SEED_VALUES[name],
                contribution_pct=SEED_CONTRIBUTION_PCT[name],
            )
            .on_conflict_do_nothing(index_elements=["kiosk_id", "name"])
        )
        await db.execute(stmt)


async def get_jackpots_for_kiosk(
    kiosk_id: str | None, redis_client=None
) -> dict[str, int]:
    """Renvoie le dict complet (5 clés) pour ce kiosk.

    Lecture seule : aucun seed à la volée. Si la ligne n'existe pas en DB
    pour ce `kiosk_id`, la clé reste à 0. Les 3 lignes bronze/silver/gold
    sont seedées uniquement par `apply_round_settlement()` lorsqu'un
    settlement réel arrive pour ce kiosk (ou via `admin_set_jackpots`).
    """
    out: dict[str, int] = {name: 0 for name in JACKPOT_NAMES}

    async with SessionLocal() as db:
        # Lecture globale
        result = await db.execute(
            select(JackpotState).where(JackpotState.kiosk_id == GLOBAL_KIOSK)
        )
        for row in result.scalars().all():
            if row.name in GLOBAL_JACKPOTS:
                out[row.name] = int(row.value)

        # Lecture per-kiosk si on a un id (sans seed à la volée)
        if kiosk_id:
            result = await db.execute(
                select(JackpotState).where(JackpotState.kiosk_id == kiosk_id)
            )
            for row in result.scalars().all():
                if row.name in KIOSK_JACKPOTS:
                    out[row.name] = int(row.value)
                    await _cache_value(redis_client, row.kiosk_id, row.name, row.value)

    return out


async def apply_round_settlement(
    redis_client,
    total_wager: int,
    per_kiosk_wager: dict[str, int],
) -> dict[str, dict[str, int]]:
    """Incrémente les jackpots après une settlement.

    - Globaux : += floor(total_wager * pct)
    - Per-kiosk : pour chaque kiosk dans per_kiosk_wager, += floor(wager * pct)

    Retourne `{kiosk_id_or_GLOBAL: {name: new_value, ...}, ...}` listant
    les lignes effectivement modifiées pour faciliter le broadcast.
    """
    total_wager = max(0, int(total_wager or 0))
    affected: dict[str, dict[str, int]] = {}

    async with SessionLocal() as db:
        # ---- Globaux ----
        if total_wager > 0:
            for name in GLOBAL_JACKPOTS:
                # Charge la ligne (existe forcément après ensure_seeded)
                row = await db.get(JackpotState, (GLOBAL_KIOSK, name))
                if row is None:
                    # Filet de sécurité — seed à la volée
                    row = JackpotState(
                        kiosk_id=GLOBAL_KIOSK,
                        name=name,
                        value=SEED_VALUES[name],
                        contribution_pct=SEED_CONTRIBUTION_PCT[name],
                    )
                    db.add(row)
                    await db.flush()
                inc = int(math.floor(total_wager * float(row.contribution_pct)))
                if inc > 0:
                    row.value = int(row.value) + inc
                    affected.setdefault(GLOBAL_KIOSK, {})[name] = int(row.value)

        # ---- Per-kiosk ----
        for kid, wager in (per_kiosk_wager or {}).items():
            if not kid:
                continue
            wager = max(0, int(wager or 0))
            if wager <= 0:
                continue

            # S'assure que les 3 lignes existent
            await _seed_kiosk_if_missing(db, kid)
            await db.flush()

            for name in KIOSK_JACKPOTS:
                row = await db.get(JackpotState, (kid, name))
                if row is None:
                    continue
                inc = int(math.floor(wager * float(row.contribution_pct)))
                if inc > 0:
                    row.value = int(row.value) + inc
                    affected.setdefault(kid, {})[name] = int(row.value)

        await db.commit()

    # Met à jour le cache Redis pour toutes les lignes modifiées
    for kid, names in affected.items():
        for name, value in names.items():
            await _cache_value(redis_client, kid, name, value)

    return affected


async def admin_set_jackpots(
    redis_client, payload: dict
) -> dict[str, dict[str, int]]:
    """Applique un override admin.

    Body attendu :
    ```
    {
        "<name>": {
            "value": <long>,           # optionnel
            "contribution_pct": <float>,  # optionnel
            "kiosk_id": "<id or null>" # null/absent → __GLOBAL__ pour les
                                       # jackpots globaux, requis pour
                                       # bronze/silver/gold
        },
        ...
    }
    ```

    Retourne `{kiosk_id: {name: value, ...}}` pour broadcast.
    """
    affected: dict[str, dict[str, int]] = {}

    async with SessionLocal() as db:
        for name, spec in (payload or {}).items():
            if name not in JACKPOT_NAMES:
                raise ValueError(f"unknown jackpot name: {name}")
            if not isinstance(spec, dict):
                raise ValueError(f"invalid spec for {name}: expected object")

            raw_kid = spec.get("kiosk_id")
            if name in GLOBAL_JACKPOTS:
                kid = GLOBAL_KIOSK
            else:
                if not raw_kid:
                    raise ValueError(
                        f"kiosk_id is required for per-kiosk jackpot '{name}'"
                    )
                kid = str(raw_kid)

            # Charge ou crée la ligne
            row = await db.get(JackpotState, (kid, name))
            if row is None:
                row = JackpotState(
                    kiosk_id=kid,
                    name=name,
                    value=SEED_VALUES.get(name, 0),
                    contribution_pct=SEED_CONTRIBUTION_PCT.get(name, 0.0),
                )
                db.add(row)
                await db.flush()

            if "value" in spec and spec["value"] is not None:
                row.value = int(spec["value"])
            if (
                "contribution_pct" in spec
                and spec["contribution_pct"] is not None
            ):
                row.contribution_pct = float(spec["contribution_pct"])

            affected.setdefault(kid, {})[name] = int(row.value)

        await db.commit()

    for kid, names in affected.items():
        for name, value in names.items():
            await _cache_value(redis_client, kid, name, value)

    return affected


def affected_kiosks_to_broadcast_scope(
    affected: dict[str, dict[str, int]],
) -> tuple[bool, set[str]]:
    """Helper : décompose `affected` en (broadcast_global, set_of_kiosks).

    - `broadcast_global=True` si au moins une clé globale a changé → push à tous
    - `set_of_kiosks` : les kiosk_ids dont une clé per-kiosk a changé
    """
    broadcast_global = False
    kiosks: set[str] = set()
    for kid, names in (affected or {}).items():
        if kid == GLOBAL_KIOSK:
            if any(n in GLOBAL_JACKPOTS for n in names):
                broadcast_global = True
        else:
            if any(n in KIOSK_JACKPOTS for n in names):
                kiosks.add(kid)
    return broadcast_global, kiosks
