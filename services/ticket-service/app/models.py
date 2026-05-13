import uuid
import enum
from sqlalchemy import Column, String, BigInteger, DateTime, ForeignKey, Enum, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base

class TicketStatus(str, enum.Enum):
    PENDING = "PENDING"
    WON = "WON"
    LOST = "LOST"
    PAID = "PAID"
    CANCELLED = "CANCELLED"

class Ticket(Base):
    __tablename__ = "tickets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    short_code = Column(String(50), unique=True, index=True, nullable=False)
    agent_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    game_id = Column(String(50), nullable=False)
    round_id = Column(String(50), nullable=False)
    
    total_wager = Column(BigInteger, nullable=False)
    total_payout = Column(BigInteger, default=0, nullable=False)
    winning_number = Column(String(10), nullable=True) # Enregistré lors de la résolution
    status = Column(Enum(TicketStatus), default=TicketStatus.PENDING, nullable=False)
    # Lien optionnel vers le plan de re-jeu (parent + tous les fils partagent le meme plan_id).
    plan_id = Column(UUID(as_uuid=True), ForeignKey("ticket_plans.id", ondelete="SET NULL"), nullable=True, index=True)
    # Denormalisation : on copie le kiosk_code de l'agent au moment de la vente.
    # Permet l'aggregation per-kiosk au settlement sans avoir a joindre la table
    # agents (qui vit dans la DB d'un autre service). NULL = agent sans kiosk
    # ou lookup en echec (le ticket n'alimentera alors que les pots globaux).
    kiosk_code = Column(String(4), nullable=True, index=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relations
    bets = relationship("TicketBet", back_populates="ticket", cascade="all, delete-orphan")

class TicketBet(Base):
    __tablename__ = "ticket_bets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ticket_id = Column(UUID(as_uuid=True), ForeignKey("tickets.id"), nullable=False)
    
    bet_type = Column(String(50), nullable=False)
    bet_target = Column(String(100), nullable=True)
    amount = Column(BigInteger, nullable=False)
    
    # Détails de résolution
    is_winning = Column(Boolean, default=False)
    payout = Column(BigInteger, default=0)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    ticket = relationship("Ticket", back_populates="bets")


# Enregistre les modeles jackpot sur la meme Base pour qu'Alembic les detecte.
from .jackpot import models as _jackpot_models  # noqa: F401, E402
# Idem pour le module replay (plans de ticket recurrents).
from .replay import models as _replay_models  # noqa: F401, E402
