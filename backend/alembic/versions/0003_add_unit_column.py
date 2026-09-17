"""add unit column to timbangan_devices and timbangan_logs

Revision ID: 0003_add_unit_column
Revises: 0002_odoo_auth
Create Date: 2026-05-19
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0003_add_unit_column'
down_revision: Union[str, None] = '0002_odoo_auth'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('timbangan_devices',
        sa.Column('unit', sa.String(8), nullable=True)
    )
    op.add_column('timbangan_logs',
        sa.Column('unit', sa.String(8), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('timbangan_logs', 'unit')
    op.drop_column('timbangan_devices', 'unit')
