import os
from fastapi import Header, HTTPException

ADMIN_API_KEY = os.getenv("ADMIN_API_KEY", "")
JACKPOT_INTERNAL_API_KEY = os.getenv("JACKPOT_INTERNAL_API_KEY", "")


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
