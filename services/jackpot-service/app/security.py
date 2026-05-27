import os
from fastapi import Header, HTTPException

ADMIN_API_KEY = os.getenv("ADMIN_API_KEY", "")
# `or default` (not getenv default): compose turns an undefined ${VAR} into an
# EMPTY string env var, which getenv's default would NOT replace. Coalesce empty
# → default so the internal key works out-of-the-box and matches ticket-service.
# Override in prod via JACKPOT_INTERNAL_API_KEY in /opt/casino/.env.
JACKPOT_INTERNAL_API_KEY = os.getenv("JACKPOT_INTERNAL_API_KEY") or "DevJackpotInternal2026"


def verify_admin_key(x_api_key: str = Header(None)) -> str:
    """Verifie que la requete vient bien du Backoffice autorise."""
    if not ADMIN_API_KEY:
        raise HTTPException(status_code=500, detail="ADMIN_API_KEY non configure.")
    if x_api_key != ADMIN_API_KEY:
        raise HTTPException(status_code=403, detail="Acces refuse : Cle Admin invalide.")
    return x_api_key


def verify_internal_key(x_internal_key: str = Header(None)) -> str:
    """Verifie que la requete vient d'un service interne autorise (ticket-service)."""
    if not JACKPOT_INTERNAL_API_KEY:
        raise HTTPException(status_code=500, detail="JACKPOT_INTERNAL_API_KEY non configure.")
    if x_internal_key != JACKPOT_INTERNAL_API_KEY:
        raise HTTPException(status_code=403, detail="Acces refuse : Cle interne invalide.")
    return x_internal_key
