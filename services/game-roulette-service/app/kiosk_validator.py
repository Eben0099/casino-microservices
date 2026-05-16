"""Validation d'un `kiosk_code` contre agent-service.

Utilisé par `/ws/roulette` pour rejeter les connexions avec un code bidon.
Cache Redis 1h pour éviter de marteler agent-service à chaque reconnexion.
"""

import logging
import os

import httpx

logger = logging.getLogger("kiosk-validator")

AGENT_SERVICE_URL = os.getenv("AGENT_SERVICE_URL", "http://agent-service:8000")
CACHE_TTL_SECONDS = 3600


def _cache_key(code: str) -> str:
    return f"kiosk_valid:{code}"


async def is_valid_kiosk_code(code: str, redis_client) -> bool:
    """True si `code` correspond à un kiosk existant chez agent-service.

    Cache négatif/positif 1h. En cas d'indisponibilité d'agent-service, on
    refuse (fail-closed) — le client peut retenter, mais on ne laisse pas
    passer un code non vérifié.
    """
    code = (code or "").strip().upper()
    if not code:
        return False

    if redis_client is not None:
        try:
            cached = await redis_client.get(_cache_key(code))
            if cached == "1":
                return True
            if cached == "0":
                return False
        except Exception as e:
            logger.warning(f"redis get failed for {code}: {e}")

    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{AGENT_SERVICE_URL}/by-code/{code}")
        valid = resp.status_code == 200
    except Exception as e:
        logger.warning(f"agent-service lookup failed for {code}: {e}")
        return False

    if redis_client is not None:
        try:
            await redis_client.setex(_cache_key(code), CACHE_TTL_SECONDS, "1" if valid else "0")
        except Exception as e:
            logger.warning(f"redis setex failed for {code}: {e}")

    return valid
