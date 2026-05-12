"""Fix uq_jackpot_pot_no_tier : handle NULL kiosk_id via COALESCE

Revision ID: e5f1c2d3a4b6
Revises: d8e2f3a4b5c6
Create Date: 2026-05-12 16:30:00.000000

The previous partial index "uq_jackpot_pot_no_tier" indexed (scope, game_id, kiosk_id)
but PostgreSQL treats NULL kiosk_id as distinct from another NULL, so two GAME pots
without tier on the same game (both with kiosk_id=NULL) were both accepted.

We rebuild the index using COALESCE to map NULL kiosk_id to a sentinel UUID,
which makes the constraint behave like "NULLS NOT DISTINCT".
"""
from typing import Sequence, Union
from alembic import op


revision: str = "e5f1c2d3a4b6"
down_revision: Union[str, None] = "d8e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_jackpot_pot_no_tier")
    op.execute("""
        CREATE UNIQUE INDEX uq_jackpot_pot_no_tier
        ON jackpot_pots (
            scope,
            game_id,
            COALESCE(kiosk_id, '00000000-0000-0000-0000-000000000000'::uuid)
        )
        WHERE tier IS NULL AND scope <> 'GLOBAL'
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_jackpot_pot_no_tier")
    op.execute("""
        CREATE UNIQUE INDEX uq_jackpot_pot_no_tier
        ON jackpot_pots (scope, game_id, kiosk_id)
        WHERE tier IS NULL AND scope <> 'GLOBAL'
    """)
