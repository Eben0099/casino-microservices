"""Denormalise kiosk_code onto tickets

Revision ID: b9c2d3e4f5a7
Revises: b3d5e7c9f1a2
Create Date: 2026-05-13 12:00:00.000000

Adds `kiosk_code` (VARCHAR(4) NULL, indexed) on the `tickets` table.

Pourquoi denormaliser ? Au settlement on doit produire un dict
{kiosk_code -> sum(total_wager)} pour alimenter les jackpots par kiosque
(general + spin2win + bronze/silver/gold). La table `agents` vit dans la
DB d'un autre service, donc pas de JOIN possible. On copie donc le code
au moment de la vente : un seul GROUP BY suffit ensuite.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "b9c2d3e4f5a7"
down_revision: Union[str, None] = "b3d5e7c9f1a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tickets",
        sa.Column("kiosk_code", sa.String(length=4), nullable=True),
    )
    op.create_index("ix_tickets_kiosk_code", "tickets", ["kiosk_code"])


def downgrade() -> None:
    op.drop_index("ix_tickets_kiosk_code", table_name="tickets")
    op.drop_column("tickets", "kiosk_code")
