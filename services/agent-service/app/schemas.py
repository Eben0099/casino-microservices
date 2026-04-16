from pydantic import BaseModel, Field, UUID4
from typing import Optional
from .models import AgentRole
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
    role: AgentRole
    
    class Config:
        from_attributes = True

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
    amount: int = Field(..., gt=0, description="Montant en XAF (strictement positif)")
    description: Optional[str] = "Approvisionnement initial"

class LoginRequest(BaseModel):
    agent_id: str
    password: str