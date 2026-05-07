"""Initial roulette_rounds table

Revision ID: b1c2d3e4f5a6
Revises:
Create Date: 2026-05-06 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('roulette_rounds',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('round_id', sa.String(), nullable=False),
        sa.Column('winning_number', sa.String(), nullable=False),
        sa.Column('server_seed', sa.String(), nullable=False),
        sa.Column('server_seed_hash', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_roulette_rounds_id'), 'roulette_rounds', ['id'], unique=False)
    op.create_index(op.f('ix_roulette_rounds_round_id'), 'roulette_rounds', ['round_id'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_roulette_rounds_round_id'), table_name='roulette_rounds')
    op.drop_index(op.f('ix_roulette_rounds_id'), table_name='roulette_rounds')
    op.drop_table('roulette_rounds')
