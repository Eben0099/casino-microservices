"""Jackpot client — reads from the authoritative jackpot-service.

jackpot-service contract (frozen):
    GET {JACKPOT_SERVICE_URL}/jackpots?game_id=KENO-DRAW1&kiosk_code=<code>
    → { general: int, game: { game_id: str, amount: int }, locals: { bronze: int, silver: int, gold: int } }

Wire shapes returned by ``get_jackpots_for_kiosk`` match BACKEND.md exactly:

    jackpot = {
        "generalAmount": <int>,      # general pot — all games, all kiosks
        "volkenoAmount": <int>,      # game pot for KENO-DRAW1
        "currency": "XAF",
        "lastHitDrawId": null,
    }
    medals = {
        "bronze": <int>,             # LOCAL bronze amount for this kiosk
        "silver": <int>,
        "gold":   <int>,
    }

Amounts are whole-XAF integers.  On any HTTP/network failure the function
returns zeros so the frontend never receives a broken payload.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger("keno-jackpot-client")

JACKPOT_SERVICE_URL = os.getenv("JACKPOT_SERVICE_URL", "http://jackpot-service:8000")
GAME_ID = "KENO-DRAW1"
_HTTP_TIMEOUT = 3.0  # seconds — keep welcome cheap


def _zero_jackpot() -> dict[str, Any]:
    return {
        "generalAmount": 0,
        "volkenoAmount": 0,
        "currency": "XAF",
        "lastHitDrawId": None,
    }


def _zero_medals() -> dict[str, int]:
    return {"bronze": 0, "silver": 0, "gold": 0}


def _map_response(data: dict, kiosk_code: str | None) -> tuple[dict[str, Any], dict[str, int]]:
    """Map the jackpot-service JSON response to BACKEND.md wire shapes."""
    general = int(data.get("general") or 0)

    game = data.get("game") or {}
    volkeno_amount = int(game.get("amount") or 0)

    jackpot: dict[str, Any] = {
        "generalAmount": general,
        "volkenoAmount": volkeno_amount,
        "currency": "XAF",
        "lastHitDrawId": None,
    }

    # locals are scoped per kiosk; zero them out when no kiosk_code
    locals_raw = data.get("locals") or {}
    if kiosk_code:
        medals: dict[str, int] = {
            "bronze": int(locals_raw.get("bronze") or 0),
            "silver": int(locals_raw.get("silver") or 0),
            "gold":   int(locals_raw.get("gold")   or 0),
        }
    else:
        medals = _zero_medals()

    return jackpot, medals


async def get_jackpots_for_kiosk(
    kiosk_id: str | None,
    _redis_client=None,  # unused; accepted for call-site compatibility during migration
) -> tuple[dict[str, Any], dict[str, int]]:
    """Fetch jackpot + medals for *kiosk_id* from the authoritative service.

    Falls back to zeros on any error so the WS welcome is never blocked.
    The ``_redis_client`` parameter is accepted but unused — it exists only
    to keep call sites compatible during the migration.
    """
    params: dict[str, str] = {"game_id": GAME_ID}
    if kiosk_id:
        params["kiosk_code"] = kiosk_id

    url = f"{JACKPOT_SERVICE_URL}/jackpots"
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data: dict = resp.json()
        return _map_response(data, kiosk_id)
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "jackpot-service returned HTTP %s for kiosk=%s",
            exc.response.status_code,
            kiosk_id,
        )
    except Exception as exc:
        logger.warning("jackpot-service unavailable for kiosk=%s: %s", kiosk_id, exc)

    return _zero_jackpot(), _zero_medals()
