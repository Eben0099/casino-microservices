import uuid
import enum
from sqlalchemy import Column, String, BigInteger, DateTime, ForeignKey, Enum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base

class TicketStatus(str, enum.Enum):
    PENDING = "PENDING"
    WON = "WON"
    LOST = "LOST"
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
    status = Column(Enum(TicketStatus), default=TicketStatus.PENDING, nullable=False)
    
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
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    ticket = relationship("Ticket", back_populates="bets")
