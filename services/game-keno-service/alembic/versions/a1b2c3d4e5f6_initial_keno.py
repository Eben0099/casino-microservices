"""Initial keno tables: keno_draws + jackpot_state

Revision ID: a1b2c3d4e5f6
Revises:
Create Date: 2026-05-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # keno_draws — persists every draw for provably-fair audit
    op.create_table(
        "keno_draws",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("round_id", sa.Integer(), nullable=False),
        sa.Column("server_seed", sa.String(), nullable=False),
        sa.Column("server_seed_hash", sa.String(), nullable=False),
        sa.Column("drawn_numbers", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_keno_draws_id"), "keno_draws", ["id"], unique=False
    )
    op.create_index(
        op.f("ix_keno_draws_round_id"), "keno_draws", ["round_id"], unique=True
    )

    # jackpot_state — reused verbatim from roulette; scoped to casino_keno_db
    op.create_table(
        "jackpot_state",
        sa.Column("kiosk_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("value", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column(
            "contribution_pct",
            sa.Float(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("kiosk_id", "name"),
    )
    op.create_index(
        "ix_jackpot_state_kiosk_id",
        "jackpot_state",
        ["kiosk_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_jackpot_state_kiosk_id", table_name="jackpot_state")
    op.drop_table("jackpot_state")
    op.drop_index(op.f("ix_keno_draws_round_id"), table_name="keno_draws")
    op.drop_index(op.f("ix_keno_draws_id"), table_name="keno_draws")
    op.drop_table("keno_draws")
