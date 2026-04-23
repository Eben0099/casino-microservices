from pydantic import BaseModel, Field, UUID4
from typing import List, Optional
from datetime import datetime
from .models import TicketStatus

class TicketBetCreate(BaseModel):
    bet_type: str = Field(..., description="Type de pari (ex: STRAIGHT, RED, SPLIT)")
    bet_target: Optional[str] = Field(None, description="La cible (ex: '17', '17,20')")
    amount: int = Field(..., gt=0, description="Montant du pari en XAF")

class TicketCreate(BaseModel):
    agent_id: UUID4 = Field(..., description="L'ID de l'agent qui encaisse")
    game_id: str = Field(..., description="Ex: ROULETTE-TBL1")
    round_id: str = Field(..., description="Ex: ROUND-4502")
    bets: List[TicketBetCreate] = Field(..., min_length=1, description="Au moins un pari requis")

class TicketBetResponse(BaseModel):
    bet_type: str
    bet_target: Optional[str]
    amount: int
    is_winning: bool = False
    payout: int = 0
    
    class Config:
        from_attributes = True

class TicketResponse(BaseModel):
    id: UUID4
    short_code: str
    agent_id: UUID4
    game_id: str
    round_id: str
    status: TicketStatus
    total_wager: int
    total_payout: int
    winning_number: Optional[str] = None
    created_at: datetime
    bets: List[TicketBetResponse]
    
    class Config:
        from_attributes = True