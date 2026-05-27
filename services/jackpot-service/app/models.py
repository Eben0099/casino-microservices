import uuid
import enum
from sqlalchemy import (
    Column, String, BigInteger, Integer, DateTime, Boolean,
    Enum as SAEnum, ForeignKey, Numeric, UniqueConstraint, Index,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from .database import Base


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
    """Une cagnotte vivante. Une ligne par pot configure (scope/jeu/kiosque/tier).

    ADAPTATION vs ticket-service : kiosk_id UUID -> kiosk_code String.
    La couche d'affichage (agent-web, frontends) parle kiosk_code (ex: '99A4').
    UniqueConstraint(scope, game_id, kiosk_code, tier).

    Regles d'identite :
      GLOBAL -> game_id=null, kiosk_code=null, tier=null
      GAME   -> game_id set, kiosk_code=null, tier=null
      LOCAL  -> game_id + kiosk_code + tier tous renseignes
    """
    __tablename__ = "jackpot_pots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Portee
    scope = Column(SAEnum(JackpotScope), nullable=False)
    game_id = Column(String(50), nullable=True)          # null si GLOBAL
    kiosk_code = Column(String(20), nullable=True)        # null si GLOBAL ou GAME  (ex: "99A4")
    tier = Column(SAEnum(JackpotTier), nullable=True)     # null si GLOBAL ou GAME

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

    # NOTE: l'unicité réelle est garantie par des INDEX UNIQUES PARTIELS par
    # scope (migration b2c3d4e5f6a7) : uq_jackpot_pot_global / _game_main /
    # _game_tiered / _local. On n'utilise PAS un UniqueConstraint classique car
    # PostgreSQL traite NULL comme distinct → il serait contournable pour les
    # pots GLOBAL/GAME (colonnes d'identité NULL) et laisserait recréer un
    # 2e "Jackpot Général".
    __table_args__ = (
        Index("ix_jackpot_pots_scope_game", "scope", "game_id"),
        Index("ix_jackpot_pots_kiosk_code", "kiosk_code"),
    )


class JackpotContribution(Base):
    """Trace d'audit : chaque ticket qui a contribue a un pot."""
    __tablename__ = "jackpot_contributions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pot_id = Column(UUID(as_uuid=True), ForeignKey("jackpot_pots.id", ondelete="CASCADE"), nullable=False, index=True)
    ticket_id = Column(String(36), nullable=False, index=True)   # UUID as string (cross-service)
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

    trigger_ticket_id = Column(String(36), nullable=False)   # UUID as string
    winner_ticket_id = Column(String(36), nullable=False)    # UUID as string
    winner_agent_id = Column(String(36), nullable=False)     # UUID as string

    threshold_hit = Column(BigInteger, nullable=False)       # seuil revele a posteriori
    pot_amount_at_hit = Column(BigInteger, nullable=False)
    payout_amount = Column(BigInteger, nullable=False)
    carryover = Column(BigInteger, default=0, nullable=False)

    paid_at = Column(DateTime(timezone=True), server_default=func.now())
