import uuid
import enum
from sqlalchemy import Column, String, Boolean, Float, BigInteger, DateTime, ForeignKey, Enum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base

# --- ENUMS ---
class AgentRole(str, enum.Enum):
    AGENT = "AGENT"
    SUPER_AGENT = "SUPER_AGENT"
    ADMIN = "ADMIN"

class CashTxType(str, enum.Enum):
    PROVISION = "PROVISION"
    BET_RECEIVED = "BET_RECEIVED"
    PAYOUT = "PAYOUT"
    REVERSAL = "REVERSAL"
    ADJUSTMENT = "ADJUSTMENT"
    COMMISSION = "COMMISSION"

# --- MODELES ---

class Agent(Base):
    __tablename__ = "agents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    phone = Column(String(20), unique=True, index=True, nullable=False)
    display_name = Column(String(100), nullable=False)
    password_hash = Column(String(128), nullable=False)
    
    # Infos Kiosque
    kiosk_name = Column(String(100), nullable=True)
    kiosk_location = Column(String(200), nullable=True)
    
    # Hierarchie & Business
    role = Column(Enum(AgentRole), default=AgentRole.AGENT, nullable=False)
    parent_agent_id = Column(UUID(as_uuid=True), ForeignKey("agents.id"), nullable=True)
    commission_rate = Column(Float, default=5.0, nullable=False)
    
    # Statuts
    is_active = Column(Boolean, default=True)
    is_suspended = Column(Boolean, default=False)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relations SQLAlchemy
    cash_register = relationship("CashRegister", back_populates="agent", uselist=False)


class CashRegister(Base):
    __tablename__ = "cash_registers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agent_id = Column(UUID(as_uuid=True), ForeignKey("agents.id"), unique=True, nullable=False)
    
    # Solde THEORIQUE de la caisse en centimes/XAF. 
    # Augmente quand on encaisse un pari, diminue quand on paie un gain.
    balance = Column(BigInteger, default=0, nullable=False)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    agent = relationship("Agent", back_populates="cash_register")
    transactions = relationship("CashRegisterTransaction", back_populates="register")


class CashRegisterTransaction(Base):
    __tablename__ = "cash_register_transactions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cash_register_id = Column(UUID(as_uuid=True), ForeignKey("cash_registers.id"), nullable=False)
    agent_id = Column(UUID(as_uuid=True), ForeignKey("agents.id"), nullable=False) # Dénormalisé pour accès rapide
    
    tx_type = Column(Enum(CashTxType), nullable=False)
    amount = Column(BigInteger, nullable=False) # Positif ou Negatif
    
    # Pour l'audit parfait de la caisse
    balance_before = Column(BigInteger, nullable=False)
    balance_after = Column(BigInteger, nullable=False)
    
    # reference contiendra souvent le ticket_code (ex: TK-20260225-ABCDEF)
    reference = Column(String(100), nullable=True) 
    description = Column(String(200), nullable=True)
    
    # ID de l'admin ou du super-agent qui a fait l'action (si applicable)
    performed_by = Column(UUID(as_uuid=True), nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    register = relationship("CashRegister", back_populates="transactions")