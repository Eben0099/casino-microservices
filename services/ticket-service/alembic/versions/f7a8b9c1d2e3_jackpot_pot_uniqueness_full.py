"""Robust uniqueness for jackpot pots (handles NULL in kiosk_id/tier)

Revision ID: f7a8b9c1d2e3
Revises: e5f1c2d3a4b6
Create Date: 2026-05-12 16:45:00.000000

PostgreSQL's default UNIQUE on (scope, game_id, kiosk_id, tier) was bypassable
because NULL is treated as distinct. We now express uniqueness via partial
indexes covering each NULL pattern :
  - one GLOBAL pot only
  - one GAME pot per (game_id, tier) — covers no-tier case via COALESCE
  - one LOCAL pot per (game_id, kiosk_id, tier) — same

Existing duplicates (residue from manual testing) are pruned : we keep the
oldest in each identity bucket, delete the rest along with their contributions
and wins (cascade).
"""
from typing import Sequence, Union
from alembic import op


revision: str = "f7a8b9c1d2e3"
down_revision: Union[str, None] = "e5f1c2d3a4b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Identify and remove duplicates : keep the oldest row per identity bucket.
    op.execute("""
        WITH ranked AS (
            SELECT
                id,
                row_number() OVER (
                    PARTITION BY
                        scope,
                        COALESCE(game_id, ''),
                        COALESCE(kiosk_id, '00000000-0000-0000-0000-000000000000'::uuid),
                        COALESCE(tier::text, '')
                    ORDER BY created_at ASC, id ASC
                ) AS rn
            FROM jackpot_pots
        )
        DELETE FROM jackpot_wins WHERE pot_id IN (SELECT id FROM ranked WHERE rn > 1);
    """)
    op.execute("""
        WITH ranked AS (
            SELECT
                id,
                row_number() OVER (
                    PARTITION BY
                        scope,
                        COALESCE(game_id, ''),
                        COALESCE(kiosk_id, '00000000-0000-0000-0000-000000000000'::uuid),
                        COALESCE(tier::text, '')
                    ORDER BY created_at ASC, id ASC
                ) AS rn
            FROM jackpot_pots
        )
        DELETE FROM jackpot_pots WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
    """)

    # 2. Drop the bypassable UNIQUE constraint and the previous partial index.
    op.execute("ALTER TABLE jackpot_pots DROP CONSTRAINT IF EXISTS uq_jackpot_pot_identity")
    op.execute("DROP INDEX IF EXISTS uq_jackpot_pot_no_tier")

    # 3. New robust indexes (one per scope), all using COALESCE on nullable cols.
    # 3.a  GLOBAL : at most one row, all other identity cols are NULL.
    op.execute("""
        CREATE UNIQUE INDEX uq_jackpot_pot_global
        ON jackpot_pots ((true))
        WHERE scope = 'GLOBAL'
    """)
    # 3.b  GAME with tier : (game_id, tier) unique
    op.execute("""
        CREATE UNIQUE INDEX uq_jackpot_pot_game_tiered
        ON jackpot_pots (game_id, tier)
        WHERE scope = 'GAME' AND tier IS NOT NULL
    """)
    # 3.c  GAME no-tier ("le" jackpot principal du jeu) : un seul par game_id
    op.execute("""
        CREATE UNIQUE INDEX uq_jackpot_pot_game_main
        ON jackpot_pots (game_id)
        WHERE scope = 'GAME' AND tier IS NULL
    """)
    # 3.d  LOCAL : (game_id, kiosk_id, tier) — tous non-NULL par validation
    op.execute("""
        CREATE UNIQUE INDEX uq_jackpot_pot_local
        ON jackpot_pots (game_id, kiosk_id, tier)
        WHERE scope = 'LOCAL'
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_jackpot_pot_global")
    op.execute("DROP INDEX IF EXISTS uq_jackpot_pot_game_tiered")
    op.execute("DROP INDEX IF EXISTS uq_jackpot_pot_game_main")
    op.execute("DROP INDEX IF EXISTS uq_jackpot_pot_local")
    op.execute("""
        ALTER TABLE jackpot_pots
        ADD CONSTRAINT uq_jackpot_pot_identity UNIQUE (scope, game_id, kiosk_id, tier)
    """)
    op.execute("""
        CREATE UNIQUE INDEX uq_jackpot_pot_no_tier
        ON jackpot_pots (
            scope,
            game_id,
            COALESCE(kiosk_id, '00000000-0000-0000-0000-000000000000'::uuid)
        )
        WHERE tier IS NULL AND scope <> 'GLOBAL'
    """)
