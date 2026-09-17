"""preserve device_unit_history on device delete + add device snapshots

Revision ID: 0005_device_history_snapshot
Revises: 0004_add_weight_str
Create Date: 2026-05-26
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0005_device_history_snapshot'
down_revision: Union[str, None] = '0004_add_weight_str'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ADD COLUMN IF NOT EXISTS — safe if create_all_tables() already ran with updated model
    op.execute("ALTER TABLE device_unit_history ADD COLUMN IF NOT EXISTS device_name VARCHAR(100)")
    op.execute("ALTER TABLE device_unit_history ADD COLUMN IF NOT EXISTS device_mac  VARCHAR(20)")

    op.execute("""
        UPDATE device_unit_history duh
        SET device_name = d.name, device_mac = d.mac
        FROM devices d
        WHERE duh.device_id = d.id
          AND (duh.device_name IS NULL OR duh.device_mac IS NULL)
    """)
    op.execute("""
        UPDATE device_unit_history
        SET device_name = COALESCE(device_name, 'unknown'),
            device_mac  = COALESCE(device_mac,  '00:00:00:00:00:00')
    """)

    op.alter_column('device_unit_history', 'device_name', nullable=False)
    op.alter_column('device_unit_history', 'device_mac',  nullable=False)

    op.alter_column('device_unit_history', 'device_id',
                    existing_type=sa.dialects.postgresql.UUID(as_uuid=True),
                    nullable=True)

    # Drop ANY FK on device_id regardless of auto-generated constraint name,
    # then recreate with the canonical name + SET NULL behaviour.
    op.execute("""
        DO $$
        DECLARE r RECORD;
        BEGIN
            FOR r IN (
                SELECT c.conname
                FROM pg_constraint c
                JOIN pg_attribute a
                  ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
                WHERE c.conrelid = 'device_unit_history'::regclass
                  AND c.contype  = 'f'
                  AND a.attname  = 'device_id'
            ) LOOP
                EXECUTE 'ALTER TABLE device_unit_history DROP CONSTRAINT '
                        || quote_ident(r.conname);
            END LOOP;
        END $$;
    """)
    op.create_foreign_key(
        'device_unit_history_device_id_fkey',
        'device_unit_history', 'devices',
        ['device_id'], ['id'],
        ondelete='SET NULL'
    )


def downgrade() -> None:
    op.drop_constraint('device_unit_history_device_id_fkey',
                       'device_unit_history', type_='foreignkey')
    op.create_foreign_key(
        'device_unit_history_device_id_fkey',
        'device_unit_history', 'devices',
        ['device_id'], ['id'],
        ondelete='CASCADE'
    )
    op.alter_column('device_unit_history', 'device_id',
                    existing_type=sa.dialects.postgresql.UUID(as_uuid=True),
                    nullable=False)
    op.drop_column('device_unit_history', 'device_mac')
    op.drop_column('device_unit_history', 'device_name')
