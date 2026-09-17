"""add smartbuddy_firmware table

Revision ID: 0007_smartbuddy_firmware
Revises: 0006_smartbuddy
Create Date: 2026-06-02
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0007_smartbuddy_firmware'
down_revision: Union[str, None] = '0006_smartbuddy'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS smartbuddy_firmware (
            id          SERIAL PRIMARY KEY,
            version     VARCHAR(50)  NOT NULL UNIQUE,
            filename    VARCHAR(255) NOT NULL,
            filepath    VARCHAR(500) NOT NULL,
            size        INTEGER      NOT NULL,
            checksum    VARCHAR(64)  NOT NULL,
            description TEXT,
            is_active   BOOLEAN NOT NULL DEFAULT FALSE,
            created_at  TIMESTAMPTZ DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_smartbuddy_firmware_version ON smartbuddy_firmware (version)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS smartbuddy_firmware CASCADE")
