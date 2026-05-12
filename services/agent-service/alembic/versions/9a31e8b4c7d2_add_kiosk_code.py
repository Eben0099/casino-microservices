"""Add kiosk_code (short 4-char public alias) on agents

Revision ID: 9a31e8b4c7d2
Revises: 46c3717f415d
Create Date: 2026-05-12 13:00:00.000000

"""
from typing import Sequence, Union
import secrets

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "9a31e8b4c7d2"
down_revision: Union[str, None] = "46c3717f415d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
_CODE_LENGTH = 4


def _random_code() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(_CODE_LENGTH))


def upgrade() -> None:
    op.add_column("agents", sa.Column("kiosk_code", sa.String(length=4), nullable=True))

    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id FROM agents WHERE kiosk_code IS NULL")).fetchall()
    used = {
        r[0]
        for r in conn.execute(
            sa.text("SELECT kiosk_code FROM agents WHERE kiosk_code IS NOT NULL")
        ).fetchall()
    }
    for (agent_id,) in rows:
        for _ in range(50):
            code = _random_code()
            if code not in used:
                used.add(code)
                conn.execute(
                    sa.text("UPDATE agents SET kiosk_code = :c WHERE id = :id"),
                    {"c": code, "id": agent_id},
                )
                break
        else:
            raise RuntimeError(f"Impossible de generer un kiosk_code unique pour {agent_id}")

    op.create_index(
        op.f("ix_agents_kiosk_code"),
        "agents",
        ["kiosk_code"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_agents_kiosk_code"), table_name="agents")
    op.drop_column("agents", "kiosk_code")
