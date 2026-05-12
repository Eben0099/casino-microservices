"""Allow GAME pots without tier + partial unique index to forbid duplicates

Revision ID: d8e2f3a4b5c6
Revises: c4d8f1a96bbf
Create Date: 2026-05-12 16:00:00.000000

PostgreSQL's standard UNIQUE constraint treats NULL as distinct from NULL,
so two rows (GAME, "roulette", NULL, NULL) would both be accepted.
We add a partial unique index that enforces uniqueness on (scope, game_id, kiosk_id)
when tier IS NULL.
"""
from typing import Sequence, Union
from alembic import op


revision: str = "d8e2f3a4b5c6"
down_revision: Union[str, None] = "c4d8f1a96bbf"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE UNIQUE INDEX uq_jackpot_pot_no_tier
        ON jackpot_pots (scope, game_id, kiosk_id)
        WHERE tier IS NULL AND scope <> 'GLOBAL'
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_jackpot_pot_no_tier")
