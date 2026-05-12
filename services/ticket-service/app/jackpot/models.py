import uuid
import enum
from sqlalchemy import (
    Column, String, BigInteger, Integer, DateTime, Boolean,
    Enum as SAEnum, ForeignKey, Numeric, UniqueConstraint, Index,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from ..database import Base


# --- ENUMS ---

class JackpotScope(str, enum.Enum):
    GLOBAL = "GLOBAL"
    GAME = "GAME"
    LOCAL = "LOCAL"


class JackpotTier(str, enum.Enum):
    BRONZE = "BRONZE"
    SILVER = "SILVER"
    GOLD = "GOLD"


class WinnerMode(str, enum.Enum):
    TRIGGER_TICKET = "TRIGGER_TICKET"
    RANDOM_RECENT = "RANDOM_RECENT"


class ContributionMode(str, enum.Enum):
    PERCENT = "PERCENT"
    FIXED = "FIXED"


class ResetMode(str, enum.Enum):
    ZERO = "ZERO"
    SEED = "SEED"


# --- TABLES ---

class JackpotPot(Base):
    """Une cagnotte vivante. Une ligne par pot configure (scope/jeu/kiosque/tier)."""
    __tablename__ = "jackpot_pots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Portee
    scope = Column(SAEnum(JackpotScope), nullable=False)
    game_id = Column(String(50), nullable=True)              # null si GLOBAL
    kiosk_id = Column(UUID(as_uuid=True), nullable=True)      # null si GLOBAL ou GAME
    tier = Column(SAEnum(JackpotTier), nullable=True)         # null si GLOBAL

    # Activation
    enabled = Column(Boolean, default=True, nullable=False)

    # Contribution
    contribution_mode = Column(SAEnum(ContributionMode), default=ContributionMode.PERCENT, nullable=False)
    contribution_percent = Column(Numeric(6, 4), default=0, nullable=False)  # ex 0.5000 = 0.5%
    contribution_fixed = Column(BigInteger, default=0, nullable=False)        # ex 100 (XAF/ticket)

    # Seuil
    threshold_min = Column(BigInteger, nullable=False)
    threshold_max = Column(BigInteger, nullable=False)

    # Reset
    reset_mode = Column(SAEnum(ResetMode), default=ResetMode.ZERO, nullable=False)
    seed_amount = Column(BigInteger, default=0, nullable=False)

    # Gagnant
    winner_mode = Column(SAEnum(WinnerMode), default=WinnerMode.TRIGGER_TICKET, nullable=False)
    recent_window_minutes = Column(Integer, default=60, nullable=False)

    # Cap optionnel
    max_payout = Column(BigInteger, nullable=True)

    # Etat du cycle courant
    current_amount = Column(BigInteger, default=0, nullable=False)
    current_threshold = Column(BigInteger, nullable=False)   # SECRET (jamais expose)
    cycle_number = Column(Integer, default=1, nullable=False)
    started_at = Column(DateTime(timezone=True), server_default=func.now())

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        # Un seul pot par (scope, jeu, kiosque, tier). PostgreSQL traite NULL
        # distinctement => parfait pour distinguer GLOBAL / GAME / LOCAL.
        UniqueConstraint("scope", "game_id", "kiosk_id", "tier", name="uq_jackpot_pot_identity"),
        Index("ix_jackpot_pots_scope_game", "scope", "game_id"),
        Index("ix_jackpot_pots_kiosk", "kiosk_id"),
    )


class JackpotContribution(Base):
    """Trace d'audit : chaque ticket qui a contribue a un pot."""
    __tablename__ = "jackpot_contributions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pot_id = Column(UUID(as_uuid=True), ForeignKey("jackpot_pots.id", ondelete="CASCADE"), nullable=False, index=True)
    ticket_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    cycle_number = Column(Integer, nullable=False)  # cycle du pot au moment de la contribution

    amount = Column(BigInteger, nullable=False)
    pot_amount_after = Column(BigInteger, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("pot_id", "ticket_id", name="uq_pot_ticket_contribution"),
    )


class JackpotWin(Base):
    """Historique : un cycle qui s'est conclu par un HIT."""
    __tablename__ = "jackpot_wins"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pot_id = Column(UUID(as_uuid=True), ForeignKey("jackpot_pots.id"), nullable=False, index=True)
    cycle_number = Column(Integer, nullable=False)

    trigger_ticket_id = Column(UUID(as_uuid=True), nullable=False)
    winner_ticket_id = Column(UUID(as_uuid=True), nullable=False)
    winner_agent_id = Column(UUID(as_uuid=True), nullable=False)

    threshold_hit = Column(BigInteger, nullable=False)       # seuil revele a posteriori
    pot_amount_at_hit = Column(BigInteger, nullable=False)
    payout_amount = Column(BigInteger, nullable=False)
    carryover = Column(BigInteger, default=0, nullable=False)

    paid_at = Column(DateTime(timezone=True), server_default=func.now())
