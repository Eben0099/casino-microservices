"""Create jackpot_state table

Revision ID: c1d2e3f4a5b6
Revises: b1c2d3e4f5a6
Create Date: 2026-05-13 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c1d2e3f4a5b6"
down_revision: Union[str, None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
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
