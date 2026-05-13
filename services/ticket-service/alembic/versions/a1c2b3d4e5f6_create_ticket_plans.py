"""Create ticket_plans and ticket_plan_bets

Revision ID: a1c2b3d4e5f6
Revises: f7a8b9c1d2e3
Create Date: 2026-05-13 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1c2b3d4e5f6"
down_revision: Union[str, None] = "f7a8b9c1d2e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    status_enum = sa.Enum("ACTIVE", "COMPLETED", "CANCELLED", name="ticketplanstatus")

    op.create_table(
        "ticket_plans",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("agent_id", sa.UUID(), nullable=False),
        sa.Column("game_id", sa.String(length=50), nullable=False),
        sa.Column("total_wager_per_round", sa.BigInteger(), nullable=False),
        sa.Column("rounds_total", sa.Integer(), nullable=False),
        sa.Column("rounds_remaining", sa.Integer(), nullable=False),
        sa.Column("rounds_played", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("original_ticket_id", sa.UUID(), nullable=True),
        sa.Column("last_round_id", sa.String(length=50), nullable=True),
        sa.Column("status", status_enum, nullable=False, server_default="ACTIVE"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_ticket_plans_agent_id", "ticket_plans", ["agent_id"])
    op.create_index("ix_ticket_plans_agent_status", "ticket_plans", ["agent_id", "status"])

    op.create_table(
        "ticket_plan_bets",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("plan_id", sa.UUID(), sa.ForeignKey("ticket_plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("bet_type", sa.String(length=50), nullable=False),
        sa.Column("bet_target", sa.String(length=100), nullable=True),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_ticket_plan_bets_plan_id", "ticket_plan_bets", ["plan_id"])


def downgrade() -> None:
    op.drop_index("ix_ticket_plan_bets_plan_id", table_name="ticket_plan_bets")
    op.drop_table("ticket_plan_bets")
    op.drop_index("ix_ticket_plans_agent_status", table_name="ticket_plans")
    op.drop_index("ix_ticket_plans_agent_id", table_name="ticket_plans")
    op.drop_table("ticket_plans")
    op.execute("DROP TYPE IF EXISTS ticketplanstatus")
