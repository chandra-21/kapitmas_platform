"""add smartbuddy_devices table

Revision ID: 0006_smartbuddy
Revises: 0005_device_history_snapshot
Create Date: 2026-05-29
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0006_smartbuddy'
down_revision: Union[str, None] = '0005_device_history_snapshot'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent — aman jika create_all_tables() sudah buat tabel ini
    op.execute("""
        CREATE TABLE IF NOT EXISTS smartbuddy_devices (
            id          SERIAL PRIMARY KEY,
            device_id   UUID NOT NULL UNIQUE REFERENCES devices(id) ON DELETE CASCADE,

            has_ac      BOOLEAN NOT NULL DEFAULT TRUE,
            has_lamp    BOOLEAN NOT NULL DEFAULT TRUE,
            ac_brand    VARCHAR(16) NOT NULL DEFAULT 'daikin',
            room_id     VARCHAR(64),

            ac_power    BOOLEAN NOT NULL DEFAULT FALSE,
            ac_mode     VARCHAR(16) NOT NULL DEFAULT 'cool',
            ac_temp     INTEGER NOT NULL DEFAULT 25,
            ac_fan      VARCHAR(16) NOT NULL DEFAULT 'auto',
            ac_swing_v  BOOLEAN NOT NULL DEFAULT FALSE,
            ac_last_cmd TIMESTAMPTZ,

            lamp_power       BOOLEAN NOT NULL DEFAULT FALSE,
            lamp_mode        VARCHAR(16) NOT NULL DEFAULT 'manual',
            lamp_pir_timeout INTEGER NOT NULL DEFAULT 300,
            lamp_last_cmd    TIMESTAMPTZ,

            schedules JSONB
        )
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_smartbuddy_devices_device_id
        ON smartbuddy_devices (device_id)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS smartbuddy_devices CASCADE")
