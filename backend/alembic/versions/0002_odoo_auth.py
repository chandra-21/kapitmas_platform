"""replace firebase_uid with odoo_uid

Revision ID: 0002_odoo_auth
Revises: 0001_initial_clean
Create Date: 2026-05-19
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0002_odoo_auth'
down_revision: Union[str, None] = '0001_initial_clean'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index('ix_users_firebase_uid', table_name='users')
    op.drop_column('users', 'firebase_uid')

    op.add_column('users', sa.Column('odoo_uid', sa.Integer(), nullable=False, server_default='0'))
    op.alter_column('users', 'odoo_uid', server_default=None)
    op.create_index('ix_users_odoo_uid', 'users', ['odoo_uid'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_users_odoo_uid', table_name='users')
    op.drop_column('users', 'odoo_uid')

    op.add_column('users', sa.Column('firebase_uid', sa.String(length=128), nullable=False, server_default=''))
    op.alter_column('users', 'firebase_uid', server_default=None)
    op.create_index('ix_users_firebase_uid', 'users', ['firebase_uid'], unique=True)
