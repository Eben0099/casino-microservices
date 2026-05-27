"""Robust uniqueness for jackpot pots (handles NULL game_id/kiosk_code/tier)

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f0
Create Date: 2026-05-27 00:00:00.000000

PostgreSQL's UNIQUE(scope, game_id, kiosk_code, tier) is bypassable because
NULL is treated as distinct — so two GLOBAL pots (all-NULL identity cols) never
conflict and the startup seed re-creates "le Jackpot Général" on every restart.
We replace it with partial unique indexes, one per scope:
  - exactly ONE GLOBAL pot
  - one GAME main pot per game_id (tier NULL) + one GAME tiered pot per (game_id, tier)
  - one LOCAL pot per (game_id, kiosk_code, tier)

Existing duplicates (residue from restarts/testing) are pruned: keep the oldest
in each identity bucket, delete the rest (contributions/wins cascade).
"""
from typing import Sequence, Union
from alembic import op


revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "a1b2c3d4e5f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Prune duplicates: keep the oldest row per identity bucket.
    op.execute("""
        WITH ranked AS (
            SELECT id, row_number() OVER (
                PARTITION BY scope,
                             COALESCE(game_id, ''),
                             COALESCE(kiosk_code, ''),
                             COALESCE(tier::text, '')
                ORDER BY created_at ASC, id ASC
            ) AS rn
            FROM jackpot_pots
        )
        DELETE FROM jackpot_wins WHERE pot_id IN (SELECT id FROM ranked WHERE rn > 1);
    """)
    op.execute("""
        WITH ranked AS (
            SELECT id, row_number() OVER (
                PARTITION BY scope,
                             COALESCE(game_id, ''),
                             COALESCE(kiosk_code, ''),
                             COALESCE(tier::text, '')
                ORDER BY created_at ASC, id ASC
            ) AS rn
            FROM jackpot_pots
        )
        DELETE FROM jackpot_pots WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
    """)

    # 2. Drop the bypassable UNIQUE constraint.
    op.execute("ALTER TABLE jackpot_pots DROP CONSTRAINT IF EXISTS uq_jackpot_pot_identity")

    # 3. Partial unique indexes (one per scope), robust to NULLs.
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_jackpot_pot_global
        ON jackpot_pots ((true)) WHERE scope = 'GLOBAL'
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_jackpot_pot_game_main
        ON jackpot_pots (game_id) WHERE scope = 'GAME' AND tier IS NULL
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_jackpot_pot_game_tiered
        ON jackpot_pots (game_id, tier) WHERE scope = 'GAME' AND tier IS NOT NULL
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_jackpot_pot_local
        ON jackpot_pots (game_id, kiosk_code, tier) WHERE scope = 'LOCAL'
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_jackpot_pot_global")
    op.execute("DROP INDEX IF EXISTS uq_jackpot_pot_game_main")
    op.execute("DROP INDEX IF EXISTS uq_jackpot_pot_game_tiered")
    op.execute("DROP INDEX IF EXISTS uq_jackpot_pot_local")
    op.execute("""
        ALTER TABLE jackpot_pots
        ADD CONSTRAINT uq_jackpot_pot_identity UNIQUE (scope, game_id, kiosk_code, tier)
    """)
