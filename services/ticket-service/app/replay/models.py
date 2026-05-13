import uuid
import enum
from sqlalchemy import (
    Column, String, BigInteger, Integer, DateTime, ForeignKey, Enum as SAEnum, Index,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from ..database import Base


class TicketPlanStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class TicketPlan(Base):
    """Plan de re-jeu automatique d'un ticket sur N rounds.

    Cree lors d'une vente avec `replay_rounds > 1`. La caisse est debitee
    integralement (N x total_wager_per_round) au moment de la creation.
    """
    __tablename__ = "ticket_plans"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agent_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    game_id = Column(String(50), nullable=False)

    total_wager_per_round = Column(BigInteger, nullable=False)
    rounds_total = Column(Integer, nullable=False)         # N demande a la vente
    rounds_remaining = Column(Integer, nullable=False)     # decrement a chaque ticket fils cree
    rounds_played = Column(Integer, nullable=False, default=0)

    original_ticket_id = Column(UUID(as_uuid=True), nullable=True)  # ticket du round courant
    last_round_id = Column(String(50), nullable=True)               # idempotence anti-doublon

    status = Column(
        SAEnum(TicketPlanStatus),
        nullable=False,
        default=TicketPlanStatus.ACTIVE,
    )

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    bets = relationship(
        "TicketPlanBet",
        back_populates="plan",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_ticket_plans_agent_status", "agent_id", "status"),
    )


class TicketPlanBet(Base):
    """Composition figee d'un plan : meme structure que TicketBet, mais sans
    payout/is_winning (le plan ne joue pas, ce sont ses tickets fils qui jouent)."""
    __tablename__ = "ticket_plan_bets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("ticket_plans.id", ondelete="CASCADE"), nullable=False, index=True)

    bet_type = Column(String(50), nullable=False)
    bet_target = Column(String(100), nullable=True)
    amount = Column(BigInteger, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    plan = relationship("TicketPlan", back_populates="bets")
