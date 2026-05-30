"""Generation de codes courts identifiant un kiosque.

Format : 4 caracteres dans un alphabet sans caracteres ambigus
(pas de 0/O ni de 1/I/L), pour une lecture sans erreur cote
caissier et cote frontend Unity.
"""
import secrets
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Agent

ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"  # 31 chars, sans 0/O/1/I/L
CODE_LENGTH = 4
MAX_TRIES = 25


def random_code() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))


async def generate_unique_kiosk_code(db: AsyncSession) -> str:
    """Retourne un code 4 caracteres garanti unique dans la table agents."""
    for _ in range(MAX_TRIES):
        candidate = random_code()
        existing = await db.execute(
            select(Agent.id).where(Agent.kiosk_code == candidate).limit(1)
        )
        if existing.scalar() is None:
            return candidate
    raise RuntimeError(
        f"Impossible de generer un code kiosque unique apres {MAX_TRIES} tentatives."
    )


def normalize_kiosk_code(code: str) -> str | None:
    """Normalise un code CHOISI ; retourne le code en majuscules s'il est valide
    (exactement CODE_LENGTH caracteres de ALPHABET), sinon None."""
    c = (code or "").strip().upper()
    if len(c) != CODE_LENGTH or any(ch not in ALPHABET for ch in c):
        return None
    return c


async def is_kiosk_code_taken(db: AsyncSession, code: str) -> bool:
    existing = await db.execute(
        select(Agent.id).where(Agent.kiosk_code == code).limit(1)
    )
    return existing.scalar() is not None
