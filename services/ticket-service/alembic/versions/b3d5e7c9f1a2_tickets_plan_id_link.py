"""Link tickets to their replay plan (nullable FK)

Revision ID: b3d5e7c9f1a2
Revises: a1c2b3d4e5f6
Create Date: 2026-05-13 11:00:00.000000

Adds `plan_id` on the `tickets` table so the parent and each generated
child ticket of a recurring sale share the same plan reference.
The cashier can then scan ANY ticket in the chain and the verifier
returns the full chain (siblings + plan progress) — no separate
"plan code" field needed.

Backfill of existing parent tickets is performed (parents are listed
in `ticket_plans.original_ticket_id`). Children of existing plans are
left untouched (we have no reliable mapping to reconstruct).
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "b3d5e7c9f1a2"
down_revision: Union[str, None] = "a1c2b3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tickets",
        sa.Column("plan_id", sa.UUID(), nullable=True),
    )
    op.create_index("ix_tickets_plan_id", "tickets", ["plan_id"])
    op.create_foreign_key(
        "fk_tickets_plan_id",
        "tickets", "ticket_plans",
        ["plan_id"], ["id"],
        ondelete="SET NULL",
    )

    # Backfill : link existing parent tickets to their plan
    op.execute("""
        UPDATE tickets t
        SET plan_id = p.id
        FROM ticket_plans p
        WHERE p.original_ticket_id = t.id
    """)


def downgrade() -> None:
    op.drop_constraint("fk_tickets_plan_id", "tickets", type_="foreignkey")
    op.drop_index("ix_tickets_plan_id", table_name="tickets")
    op.drop_column("tickets", "plan_id")
