"""initial clean schema

Revision ID: 0001_initial_clean
Revises:
Create Date: 2026-05-19 00:00:00.000000

Squashed migration — creates all tables from scratch with the new
timbangan_logs structure (unit_id / iot_device_id instead of device_id).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0001_initial_clean'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── locations ──────────────────────────────────────────────────────────
    op.create_table(
        'locations',
        sa.Column('id',         postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name',       sa.String(length=100), nullable=False),
        sa.Column('address',    sa.String(length=255), nullable=True),
        sa.Column('is_active',  sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id', name='pk_locations'),
    )
    op.create_index('ix_locations_id',   'locations', ['id'],   unique=False)
    op.create_index('ix_locations_name', 'locations', ['name'], unique=False)

    # ── devices ────────────────────────────────────────────────────────────
    op.create_table(
        'devices',
        sa.Column('id',            postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('mac',           sa.String(length=17),  nullable=False),
        sa.Column('name',          sa.String(length=100), nullable=False),
        sa.Column('type',          sa.String(length=50),  nullable=False, server_default='other'),
        sa.Column('location_id',   postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('firmware',      sa.String(length=50),  nullable=True),
        sa.Column('chip',          sa.String(length=50),  nullable=True),
        sa.Column('ip_address',    sa.String(length=15),  nullable=True),
        sa.Column('online',        sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('last_seen',     sa.DateTime(timezone=True), nullable=True),
        sa.Column('registered_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at',    sa.DateTime(timezone=True), nullable=True),
        sa.Column('config',        postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(['location_id'], ['locations.id'], name='fk_devices_location_id_locations', ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name='pk_devices'),
    )
    op.create_index('ix_devices_id',   'devices', ['id'],   unique=False)
    op.create_index('ix_devices_mac',  'devices', ['mac'],  unique=True)
    op.create_index('ix_devices_name', 'devices', ['name'], unique=False)

    # ── asset_units ────────────────────────────────────────────────────────
    op.create_table(
        'asset_units',
        sa.Column('id',          postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('unit_id',     sa.String(length=100), nullable=False),
        sa.Column('name',        sa.String(length=100), nullable=False),
        sa.Column('type',        sa.String(length=50),  nullable=False, server_default='timbangan'),
        sa.Column('location_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('device_id',   postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('is_active',   sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('odoo_id',     sa.Integer(), nullable=True),
        sa.Column('created_at',  sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at',  sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['location_id'], ['locations.id'], name='fk_asset_units_location_id_locations', ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['device_id'],   ['devices.id'],   name='fk_asset_units_device_id_devices',    ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name='pk_asset_units'),
        sa.UniqueConstraint('unit_id', name='uq_asset_units_unit_id'),
    )
    op.create_index('ix_asset_units_id',        'asset_units', ['id'],        unique=False)
    op.create_index('ix_asset_units_unit_id',   'asset_units', ['unit_id'],   unique=True)
    op.create_index('ix_asset_units_location_id','asset_units', ['location_id'], unique=False)
    op.create_index('ix_asset_units_device_id', 'asset_units', ['device_id'], unique=False)

    # ── device_unit_history ────────────────────────────────────────────────
    op.create_table(
        'device_unit_history',
        sa.Column('id',            postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('device_id',     postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('unit_id',       postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('unit_code',     sa.String(length=100), nullable=False),
        sa.Column('unit_name',     sa.String(length=100), nullable=False),
        sa.Column('unit_type',     sa.String(length=50),  nullable=False),
        sa.Column('location_id',   postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('location_name', sa.String(length=200), nullable=True),
        sa.Column('assigned_at',   sa.DateTime(timezone=True), nullable=False),
        sa.Column('released_at',   sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['device_id'], ['devices.id'],     name='fk_device_unit_history_device_id_devices',         ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['unit_id'],   ['asset_units.id'], name='fk_device_unit_history_unit_id_asset_units',        ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['location_id'], ['locations.id'], name='fk_device_unit_history_location_id_locations',      ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name='pk_device_unit_history'),
    )
    op.create_index('ix_device_unit_history_device_id',   'device_unit_history', ['device_id'],   unique=False)
    op.create_index('ix_device_unit_history_unit_id',     'device_unit_history', ['unit_id'],     unique=False)
    op.create_index('ix_device_unit_history_assigned_at', 'device_unit_history', ['assigned_at'], unique=False)

    # ── timbangan_firmware ─────────────────────────────────────────────────
    op.create_table(
        'timbangan_firmware',
        sa.Column('id',          sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('version',     sa.String(length=50),  nullable=False),
        sa.Column('filename',    sa.String(length=255), nullable=False),
        sa.Column('filepath',    sa.String(length=500), nullable=False),
        sa.Column('size',        sa.Integer(), nullable=False),
        sa.Column('checksum',    sa.String(length=64),  nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('is_active',   sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at',  sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.PrimaryKeyConstraint('id', name='pk_timbangan_firmware'),
    )
    op.create_index('ix_timbangan_firmware_id',      'timbangan_firmware', ['id'],      unique=False)
    op.create_index('ix_timbangan_firmware_version', 'timbangan_firmware', ['version'], unique=True)

    # ── timbangan_devices ──────────────────────────────────────────────────
    op.create_table(
        'timbangan_devices',
        sa.Column('id',        sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('device_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('weight',    sa.Float(), nullable=True),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=True),
        sa.Column('consumed',  sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.ForeignKeyConstraint(['device_id'], ['devices.id'], name='fk_timbangan_devices_device_id_devices', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name='pk_timbangan_devices'),
    )
    op.create_index('ix_timbangan_devices_id',        'timbangan_devices', ['id'],        unique=False)
    op.create_index('ix_timbangan_devices_device_id', 'timbangan_devices', ['device_id'], unique=True)

    # ── timbangan_logs (new schema) ────────────────────────────────────────
    op.create_table(
        'timbangan_logs',
        sa.Column('id',              sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('unit_id',         postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('unit_name',       sa.String(length=100), nullable=True),
        sa.Column('iot_device_id',   postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('iot_device_name', sa.String(length=100), nullable=True),
        sa.Column('weight',          sa.Float(), nullable=False),
        sa.Column('timestamp',       sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_for',        sa.String(length=100), nullable=True),
        sa.ForeignKeyConstraint(['unit_id'],       ['asset_units.id'], name='fk_timbangan_logs_unit_id_asset_units',     ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['iot_device_id'], ['devices.id'],     name='fk_timbangan_logs_iot_device_id_devices',  ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name='pk_timbangan_logs'),
    )
    op.create_index('ix_timbangan_logs_id',        'timbangan_logs', ['id'],        unique=False)
    op.create_index('ix_timbangan_logs_unit_id',   'timbangan_logs', ['unit_id'],   unique=False)
    op.create_index('ix_timbangan_logs_timestamp', 'timbangan_logs', ['timestamp'], unique=False)

    # ── users ──────────────────────────────────────────────────────────────
    op.create_table(
        'users',
        sa.Column('id',            postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('firebase_uid',  sa.String(length=128), nullable=False),
        sa.Column('email',         sa.String(length=255), nullable=False),
        sa.Column('display_name',  sa.String(length=100), nullable=False),
        sa.Column('role',          sa.String(length=20),  nullable=False, server_default='pic'),
        sa.Column('is_active',     sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('notif_enabled', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_by',    postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at',    sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at',    sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], name='fk_users_created_by_users'),
        sa.PrimaryKeyConstraint('id', name='pk_users'),
    )
    op.create_index('ix_users_id',           'users', ['id'],           unique=False)
    op.create_index('ix_users_firebase_uid', 'users', ['firebase_uid'], unique=True)
    op.create_index('ix_users_email',        'users', ['email'],        unique=True)

    # ── user_fcm_tokens ────────────────────────────────────────────────────
    op.create_table(
        'user_fcm_tokens',
        sa.Column('id',         sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('user_id',    postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('token',      sa.String(length=500), nullable=False),
        sa.Column('platform',   sa.String(length=10),  nullable=False, server_default='web'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_user_fcm_tokens_user_id_users', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name='pk_user_fcm_tokens'),
        sa.UniqueConstraint('token', name='uq_user_fcm_tokens_token'),
    )
    op.create_index('ix_user_fcm_tokens_id',      'user_fcm_tokens', ['id'],      unique=False)
    op.create_index('ix_user_fcm_tokens_user_id', 'user_fcm_tokens', ['user_id'], unique=False)

    # ── user_locations ─────────────────────────────────────────────────────
    op.create_table(
        'user_locations',
        sa.Column('id',          sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('user_id',     postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('location_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('assigned_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('assigned_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'],     ['users.id'],     name='fk_user_locations_user_id_users',         ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['location_id'], ['locations.id'], name='fk_user_locations_location_id_locations', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['assigned_by'], ['users.id'],     name='fk_user_locations_assigned_by_users'),
        sa.PrimaryKeyConstraint('id', name='pk_user_locations'),
    )
    op.create_index('ix_user_locations_id',          'user_locations', ['id'],          unique=False)
    op.create_index('ix_user_locations_user_id',     'user_locations', ['user_id'],     unique=False)
    op.create_index('ix_user_locations_location_id', 'user_locations', ['location_id'], unique=False)

    # ── user_permissions ───────────────────────────────────────────────────
    op.create_table(
        'user_permissions',
        sa.Column('id',             postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id',        postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('permission_key', sa.String(length=100), nullable=False),
        sa.Column('granted_by',     postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('granted_at',     sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'],    ['users.id'], name='fk_user_permissions_user_id_users',    ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['granted_by'], ['users.id'], name='fk_user_permissions_granted_by_users', ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name='pk_user_permissions'),
        sa.UniqueConstraint('user_id', 'permission_key', name='uq_user_permission'),
    )
    op.create_index('ix_user_permissions_id',      'user_permissions', ['id'],      unique=False)
    op.create_index('ix_user_permissions_user_id', 'user_permissions', ['user_id'], unique=False)

    # ── notification_logs ──────────────────────────────────────────────────
    op.create_table(
        'notification_logs',
        sa.Column('id',        sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('user_id',   postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('device_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('type',      sa.String(length=50),  nullable=False),
        sa.Column('message',   sa.String(length=500), nullable=False),
        sa.Column('sent_at',   sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('success',   sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.ForeignKeyConstraint(['user_id'],   ['users.id'],   name='fk_notification_logs_user_id_users',     ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['device_id'], ['devices.id'], name='fk_notification_logs_device_id_devices', ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name='pk_notification_logs'),
    )
    op.create_index('ix_notification_logs_id',        'notification_logs', ['id'],        unique=False)
    op.create_index('ix_notification_logs_user_id',   'notification_logs', ['user_id'],   unique=False)
    op.create_index('ix_notification_logs_device_id', 'notification_logs', ['device_id'], unique=False)
    op.create_index('ix_notification_logs_sent_at',   'notification_logs', ['sent_at'],   unique=False)

    # ── device_events ──────────────────────────────────────────────────────
    op.create_table(
        'device_events',
        sa.Column('id',          sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('device_name', sa.String(length=100), nullable=True),
        sa.Column('type',        sa.String(length=50),  nullable=False),
        sa.Column('title',       sa.String(length=120), nullable=False),
        sa.Column('message',     sa.String(length=500), nullable=False),
        sa.Column('created_at',  sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id', name='pk_device_events'),
    )
    op.create_index('ix_device_events_id',          'device_events', ['id'],          unique=False)
    op.create_index('ix_device_events_device_name', 'device_events', ['device_name'], unique=False)
    op.create_index('ix_device_events_type',        'device_events', ['type'],        unique=False)
    op.create_index('ix_device_events_created_at',  'device_events', ['created_at'],  unique=False)


def downgrade() -> None:
    op.drop_table('device_events')
    op.drop_table('notification_logs')
    op.drop_table('user_permissions')
    op.drop_table('user_locations')
    op.drop_table('user_fcm_tokens')
    op.drop_table('users')
    op.drop_table('timbangan_logs')
    op.drop_table('timbangan_devices')
    op.drop_table('timbangan_firmware')
    op.drop_table('device_unit_history')
    op.drop_table('asset_units')
    op.drop_table('devices')
    op.drop_table('locations')
