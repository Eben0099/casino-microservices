"""Thin HTTP client for jackpot-service.

Fetches the canonical jackpot snapshot from the dedicated jackpot-service and
maps its response onto the 5-key shape expected by the WebSocket display and
the public GET /jackpots endpoint:

    {"general": <int>, "spin2win": <int>,
     "bronze": <int>, "silver": <int>, "gold": <int>}

On any failure (network error, bad status, parse error) the function returns
all-zero values so the display degrades gracefully rather than crashing.
"""

import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger("jackpot-client")

JACKPOT_SERVICE_URL = os.getenv("JACKPOT_SERVICE_URL", "http://jackpot-service:8000")
GAME_ID = "ROULETTE-TBL1"
# Short timeout: the engine must not block its game loop waiting for jackpots.
_TIMEOUT = 3.0

_ZERO_JACKPOTS: dict[str, int] = {
    "general": 0,
    "spin2win": 0,
    "bronze": 0,
    "silver": 0,
    "gold": 0,
}


async def fetch_jackpots(kiosk_code: Optional[str]) -> dict[str, int]:
    """Return the 5-key jackpot dict for `kiosk_code`.

    Calls:
        GET {JACKPOT_SERVICE_URL}/jackpots?game_id=ROULETTE-TBL1[&kiosk_code=<code>]

    jackpot-service response shape:
        {
            "general": <int>,
            "game": {"game_id": "ROULETTE-TBL1", "amount": <int>},
            "locals": {"bronze": <int>, "silver": <int>, "gold": <int>}
        }

    Mapping:
        general   -> response["general"]
        spin2win  -> response["game"]["amount"]
        bronze    -> response["locals"]["bronze"]
        silver    -> response["locals"]["silver"]
        gold      -> response["locals"]["gold"]

    When kiosk_code is None the locals come back as 0 from jackpot-service
    (it has no kiosk scope to resolve), which is the correct display behaviour.
    """
    params: dict[str, str] = {"game_id": GAME_ID}
    if kiosk_code:
        params["kiosk_code"] = kiosk_code

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(f"{JACKPOT_SERVICE_URL}/jackpots", params=params)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        logger.warning("jackpot-service unavailable (%s), returning zeros", exc)
        return dict(_ZERO_JACKPOTS)

    try:
        general: int = int(data.get("general") or 0)
        game_block = data.get("game") or {}
        spin2win: int = int(game_block.get("amount") or 0)
        locals_block = data.get("locals") or {}
        bronze: int = int(locals_block.get("bronze") or 0)
        silver: int = int(locals_block.get("silver") or 0)
        gold: int = int(locals_block.get("gold") or 0)
    except Exception as exc:
        logger.warning("jackpot-service response parse error (%s), returning zeros", exc)
        return dict(_ZERO_JACKPOTS)

    return {
        "general": general,
        "spin2win": spin2win,
        "bronze": bronze,
        "silver": silver,
        "gold": gold,
    }
