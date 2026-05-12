"""Create jackpot tables (pots, contributions, wins)

Revision ID: c4d8f1a96bbf
Revises: a1b2c3d4e5f6
Create Date: 2026-05-12 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c4d8f1a96bbf"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    scope_enum = sa.Enum("GLOBAL", "GAME", "LOCAL", name="jackpotscope")
    tier_enum = sa.Enum("BRONZE", "SILVER", "GOLD", name="jackpottier")
    winner_enum = sa.Enum("TRIGGER_TICKET", "RANDOM_RECENT", name="winnermode")
    contrib_enum = sa.Enum("PERCENT", "FIXED", name="contributionmode")
    reset_enum = sa.Enum("ZERO", "SEED", name="resetmode")

    op.create_table(
        "jackpot_pots",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("scope", scope_enum, nullable=False),
        sa.Column("game_id", sa.String(length=50), nullable=True),
        sa.Column("kiosk_id", sa.UUID(), nullable=True),
        sa.Column("tier", tier_enum, nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("contribution_mode", contrib_enum, nullable=False, server_default="PERCENT"),
        sa.Column("contribution_percent", sa.Numeric(6, 4), nullable=False, server_default="0"),
        sa.Column("contribution_fixed", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("threshold_min", sa.BigInteger(), nullable=False),
        sa.Column("threshold_max", sa.BigInteger(), nullable=False),
        sa.Column("reset_mode", reset_enum, nullable=False, server_default="ZERO"),
        sa.Column("seed_amount", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("winner_mode", winner_enum, nullable=False, server_default="TRIGGER_TICKET"),
        sa.Column("recent_window_minutes", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("max_payout", sa.BigInteger(), nullable=True),
        sa.Column("current_amount", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("current_threshold", sa.BigInteger(), nullable=False),
        sa.Column("cycle_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_unique_constraint(
        "uq_jackpot_pot_identity",
        "jackpot_pots",
        ["scope", "game_id", "kiosk_id", "tier"],
    )
    op.create_index("ix_jackpot_pots_scope_game", "jackpot_pots", ["scope", "game_id"])
    op.create_index("ix_jackpot_pots_kiosk", "jackpot_pots", ["kiosk_id"])

    op.create_table(
        "jackpot_contributions",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("pot_id", sa.UUID(), sa.ForeignKey("jackpot_pots.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ticket_id", sa.UUID(), nullable=False),
        sa.Column("cycle_number", sa.Integer(), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("pot_amount_after", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_jackpot_contributions_pot_id", "jackpot_contributions", ["pot_id"])
    op.create_index("ix_jackpot_contributions_ticket_id", "jackpot_contributions", ["ticket_id"])
    op.create_unique_constraint(
        "uq_pot_ticket_contribution",
        "jackpot_contributions",
        ["pot_id", "ticket_id"],
    )

    op.create_table(
        "jackpot_wins",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("pot_id", sa.UUID(), sa.ForeignKey("jackpot_pots.id"), nullable=False),
        sa.Column("cycle_number", sa.Integer(), nullable=False),
        sa.Column("trigger_ticket_id", sa.UUID(), nullable=False),
        sa.Column("winner_ticket_id", sa.UUID(), nullable=False),
        sa.Column("winner_agent_id", sa.UUID(), nullable=False),
        sa.Column("threshold_hit", sa.BigInteger(), nullable=False),
        sa.Column("pot_amount_at_hit", sa.BigInteger(), nullable=False),
        sa.Column("payout_amount", sa.BigInteger(), nullable=False),
        sa.Column("carryover", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("paid_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_jackpot_wins_pot_id", "jackpot_wins", ["pot_id"])


def downgrade() -> None:
    op.drop_index("ix_jackpot_wins_pot_id", table_name="jackpot_wins")
    op.drop_table("jackpot_wins")

    op.drop_constraint("uq_pot_ticket_contribution", "jackpot_contributions", type_="unique")
    op.drop_index("ix_jackpot_contributions_ticket_id", table_name="jackpot_contributions")
    op.drop_index("ix_jackpot_contributions_pot_id", table_name="jackpot_contributions")
    op.drop_table("jackpot_contributions")

    op.drop_index("ix_jackpot_pots_kiosk", table_name="jackpot_pots")
    op.drop_index("ix_jackpot_pots_scope_game", table_name="jackpot_pots")
    op.drop_constraint("uq_jackpot_pot_identity", "jackpot_pots", type_="unique")
    op.drop_table("jackpot_pots")

    for enum_name in ("resetmode", "contributionmode", "winnermode", "jackpottier", "jackpotscope"):
        op.execute(f"DROP TYPE IF EXISTS {enum_name}")
