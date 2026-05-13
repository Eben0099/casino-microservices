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
    replay_rounds: int = Field(
        default=1, ge=1, le=10,
        description="Re-jouer le ticket sur N rounds (1 = vente normale, max 10).",
    )

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
    plan_id: Optional[UUID4] = None    # rempli si le ticket fait partie d'une chaine de re-jeu

    class Config:
        from_attributes = True


class ReplayChainSibling(BaseModel):
    """Un ticket parmi tous ceux qui partagent le meme plan."""
    short_code: str
    round_id: str
    round_index: int             # 1 = original, 2 = 2eme round, etc.
    status: TicketStatus
    total_wager: int
    total_payout: int
    winning_number: Optional[str] = None
    is_current: bool = False     # True si c'est le ticket scanne par le caissier


class ReplayChainInfo(BaseModel):
    """Resume du plan + liste complete des tickets de la serie."""
    plan_id: UUID4
    rounds_total: int
    rounds_played: int
    rounds_remaining: int
    plan_status: str             # ACTIVE | COMPLETED | CANCELLED
    siblings: List[ReplayChainSibling]


class TicketDetailResponse(TicketResponse):
    """Reponse de GET /tickets/{short_code} — meme structure que TicketResponse
    plus la chaine de re-jeu si applicable."""
    replay_chain: Optional[ReplayChainInfo] = None