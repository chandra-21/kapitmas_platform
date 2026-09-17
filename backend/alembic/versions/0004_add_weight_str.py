"""add weight_str column to timbangan_devices and timbangan_logs

Revision ID: 0004_add_weight_str
Revises: 0003_add_unit_column
Create Date: 2026-05-19
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0004_add_weight_str'
down_revision: Union[str, None] = '0003_add_unit_column'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('timbangan_devices',
        sa.Column('weight_str', sa.String(16), nullable=True)
    )
    op.add_column('timbangan_logs',
        sa.Column('weight_str', sa.String(16), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('timbangan_logs', 'weight_str')
    op.drop_column('timbangan_devices', 'weight_str')
