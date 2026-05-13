from sqlalchemy import Column, String, Integer, BigInteger, Float, DateTime, Index
from sqlalchemy.sql import func
from .database import Base

class RouletteRound(Base):
    __tablename__ = "roulette_rounds"

    id = Column(Integer, primary_key=True, index=True)
    round_id = Column(String, unique=True, index=True, nullable=False)
    winning_number = Column(String, nullable=False)
    server_seed = Column(String, nullable=False)
    server_seed_hash = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class JackpotState(Base):
    """Etat persisté d'un jackpot par kiosk.

    Pour les jackpots globaux (general, spin2win) on utilise le kiosk_id
    sentinelle `__GLOBAL__`. Les jackpots per-kiosk (bronze, silver, gold)
    sont seedés au premier read d'un nouveau kiosk_id.
    """
    __tablename__ = "jackpot_state"

    kiosk_id = Column(String, primary_key=True, nullable=False)
    name = Column(String, primary_key=True, nullable=False)
    value = Column(BigInteger, nullable=False, default=0)
    contribution_pct = Column(Float, nullable=False, default=0.0)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        Index("ix_jackpot_state_kiosk_id", "kiosk_id"),
    )
