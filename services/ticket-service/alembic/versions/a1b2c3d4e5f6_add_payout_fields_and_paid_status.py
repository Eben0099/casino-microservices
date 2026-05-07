"""Add payout fields and PAID status

Revision ID: a1b2c3d4e5f6
Revises: fdabfafdf74b
Create Date: 2026-05-06 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'fdabfafdf74b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Ajouter les colonnes manquantes sur tickets
    op.add_column('tickets', sa.Column('total_payout', sa.BigInteger(), nullable=False, server_default='0'))
    op.add_column('tickets', sa.Column('winning_number', sa.String(length=10), nullable=True))

    # 2. Ajouter les colonnes manquantes sur ticket_bets
    op.add_column('ticket_bets', sa.Column('is_winning', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('ticket_bets', sa.Column('payout', sa.BigInteger(), nullable=False, server_default='0'))

    # 3. Ajouter le statut PAID a l'enum ticketstatus
    # PostgreSQL necessite un ALTER TYPE pour etendre un enum
    op.execute("ALTER TYPE ticketstatus ADD VALUE IF NOT EXISTS 'PAID'")


def downgrade() -> None:
    op.drop_column('ticket_bets', 'payout')
    op.drop_column('ticket_bets', 'is_winning')
    op.drop_column('tickets', 'winning_number')
    op.drop_column('tickets', 'total_payout')
    # Note: PostgreSQL ne supporte pas le retrait d'une valeur d'enum.
    # Le downgrade du PAID status necesserait de recreer l'enum, ce qui est complexe.
