"""Add drawn_numbers column for Keno ticket settlement

Revision ID: c1d2e3f4a5b6
Revises: b9c2d3e4f5a7
Create Date: 2026-05-26 00:00:00.000000

Adds `tickets.drawn_numbers` (JSON, nullable) to record the 20 Keno numbers
drawn for a given ticket's round. This field doubles as the "settled" marker
for Keno tickets: NULL means unsettled, a populated JSON array means the
round result has been applied.

The roulette workflow uses `winning_number IS NULL` as its unsettled guard;
Keno uses `drawn_numbers IS NULL` on a separate column so the two games
never interfere with each other's settlement loops.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "c1d2e3f4a5b6"
down_revision: Union[str, None] = "b9c2d3e4f5a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tickets",
        sa.Column("drawn_numbers", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tickets", "drawn_numbers")
