from pydantic import BaseModel, Field, UUID4
from typing import Optional
from .models import AgentRole, CashTxType
from uuid import UUID

class AgentCreate(BaseModel):
    phone: str = Field(..., description="Numéro de téléphone unique de l'agent")
    display_name: str
    password: str = Field(..., max_length=72)
    kiosk_name: Optional[str] = None
    kiosk_location: Optional[str] = None
    role: AgentRole = AgentRole.AGENT

class AgentResponse(BaseModel):
    id: UUID4
    phone: str
    display_name: str
    kiosk_name: Optional[str]
    kiosk_location: Optional[str]
    kiosk_code: Optional[str] = None
    role: AgentRole
    is_active: bool = True
    is_suspended: bool = False

    class Config:
        from_attributes = True


class KiosqueLookupResponse(BaseModel):
    """Reponse publique pour le frontend Unity (`GET /by-code/{code}`).

    Aucune donnee sensible : ni hash, ni telephone, ni solde.
    """
    agent_id: UUID4
    kiosk_code: str
    kiosk_name: Optional[str]
    kiosk_location: Optional[str]
    is_active: bool
    is_suspended: bool

class AgentUpdate(BaseModel):
    display_name: Optional[str] = None
    kiosk_name: Optional[str] = None
    kiosk_location: Optional[str] = None
    is_active: Optional[bool] = None
    is_suspended: Optional[bool] = None

class AgentListResponse(BaseModel):
    items: list[AgentResponse]
    total: int

class ProvisionRequest(BaseModel):
    amount: int = Field(..., description="Montant en XAF (peut être négatif pour un retrait/paiement)")
    description: Optional[str] = "Transaction de caisse"
    tx_type: Optional[CashTxType] = None

class LoginRequest(BaseModel):
    phone: str
    password: str