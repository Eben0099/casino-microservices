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
