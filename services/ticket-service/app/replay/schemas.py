from typing import List, Optional
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, ConfigDict

from .models import TicketPlanStatus

MAX_REPLAY_ROUNDS = 10


class TicketPlanBetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    bet_type: str
    bet_target: Optional[str]
    amount: int


class TicketPlanResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    agent_id: UUID
    game_id: str
    total_wager_per_round: int
    rounds_total: int
    rounds_remaining: int
    rounds_played: int
    original_ticket_id: Optional[UUID]
    last_round_id: Optional[str]
    status: TicketPlanStatus
    created_at: Optional[datetime]
    bets: List[TicketPlanBetResponse]


class CancelPlanResponse(BaseModel):
    plan_id: UUID
    refunded_amount: int
    rounds_refunded: int
    message: str
