"""Drop jackpot tables from casino_ticket_db

Jackpot logic has been extracted to the dedicated jackpot-service
(casino_jackpot_db). The tables jackpot_wins, jackpot_contributions, and
jackpot_pots are no longer owned by ticket-service.

Revision ID: a9f3c1e2d4b7
Revises: c1d2e3f4a5b6
Create Date: 2026-05-27 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a9f3c1e2d4b7"
down_revision: Union[str, None] = "c1d2e3f4a5b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # DROP TABLE ... CASCADE removes the table along with ALL its constraints,
    # indexes and FKs in one shot — robust regardless of which uniqueness
    # migration state the table was left in (ticket-service's jackpot_pots went
    # through the COALESCE partial-index migrations, so uq_jackpot_pot_identity
    # no longer exists; explicit drop_constraint would fail). Order respects FKs
    # but CASCADE makes it moot.
    op.execute("DROP TABLE IF EXISTS jackpot_wins CASCADE")
    op.execute("DROP TABLE IF EXISTS jackpot_contributions CASCADE")
    op.execute("DROP TABLE IF EXISTS jackpot_pots CASCADE")

    # Drop Postgres enum types created by the original migration.
    for enum_name in ("resetmode", "contributionmode", "winnermode", "jackpottier", "jackpotscope"):
        op.execute(f"DROP TYPE IF EXISTS {enum_name}")


def downgrade() -> None:
    # Best-effort recreation of the minimal table structure so that the
    # previous migration can re-run cleanly. Data is not restored (these
    # were test-seeded values only; jackpot-service holds the live state).
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
