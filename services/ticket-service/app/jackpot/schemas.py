from decimal import Decimal
from typing import Optional, List
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict, field_validator

from .models import JackpotScope, JackpotTier, WinnerMode, ContributionMode, ResetMode


# ----- Admin payloads -----

class JackpotPotCreate(BaseModel):
    scope: JackpotScope
    game_id: Optional[str] = None
    kiosk_id: Optional[UUID] = None
    tier: Optional[JackpotTier] = None

    enabled: bool = True
    contribution_mode: ContributionMode = ContributionMode.PERCENT
    contribution_percent: Decimal = Field(default=Decimal("0"), ge=0, le=100)
    contribution_fixed: int = Field(default=0, ge=0)

    threshold_min: int = Field(ge=0)
    threshold_max: int = Field(ge=0)

    reset_mode: ResetMode = ResetMode.ZERO
    seed_amount: int = Field(default=0, ge=0)

    winner_mode: WinnerMode = WinnerMode.TRIGGER_TICKET
    recent_window_minutes: int = Field(default=60, ge=1, le=24 * 60)

    max_payout: Optional[int] = Field(default=None, ge=0)

    @field_validator("threshold_max")
    @classmethod
    def _validate_max(cls, v, info):
        tmin = info.data.get("threshold_min")
        if tmin is not None and v < tmin:
            raise ValueError("threshold_max doit etre >= threshold_min")
        return v


class JackpotPotUpdate(BaseModel):
    enabled: Optional[bool] = None
    contribution_mode: Optional[ContributionMode] = None
    contribution_percent: Optional[Decimal] = Field(default=None, ge=0, le=100)
    contribution_fixed: Optional[int] = Field(default=None, ge=0)
    threshold_min: Optional[int] = Field(default=None, ge=0)
    threshold_max: Optional[int] = Field(default=None, ge=0)
    reset_mode: Optional[ResetMode] = None
    seed_amount: Optional[int] = Field(default=None, ge=0)
    winner_mode: Optional[WinnerMode] = None
    recent_window_minutes: Optional[int] = Field(default=None, ge=1, le=24 * 60)
    max_payout: Optional[int] = Field(default=None, ge=0)


# ----- Outbound -----

class JackpotPotResponse(BaseModel):
    """Vue admin complete (n'expose JAMAIS `current_threshold`)."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    scope: JackpotScope
    game_id: Optional[str]
    kiosk_id: Optional[UUID]
    tier: Optional[JackpotTier]

    enabled: bool
    contribution_mode: ContributionMode
    contribution_percent: Decimal
    contribution_fixed: int

    threshold_min: int
    threshold_max: int

    reset_mode: ResetMode
    seed_amount: int

    winner_mode: WinnerMode
    recent_window_minutes: int

    max_payout: Optional[int]

    current_amount: int
    cycle_number: int
    started_at: Optional[datetime]
    created_at: Optional[datetime]


class JackpotPotPublic(BaseModel):
    """Vue publique (Unity / caissier). Pas de seuil, pas d'info de cycle."""
    id: UUID
    scope: JackpotScope
    game_id: Optional[str]
    tier: Optional[JackpotTier]
    current_amount: int


class KioskJackpotsResponse(BaseModel):
    kiosk_code: str
    kiosk_name: Optional[str]
    kiosk_id: UUID
    pots: List[JackpotPotPublic]


class JackpotWinResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    pot_id: UUID
    cycle_number: int
    trigger_ticket_id: UUID
    winner_ticket_id: UUID
    winner_agent_id: UUID
    threshold_hit: int
    pot_amount_at_hit: int
    payout_amount: int
    carryover: int
    paid_at: Optional[datetime]
