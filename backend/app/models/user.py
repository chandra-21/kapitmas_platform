import uuid
from sqlalchemy import Column, String, Boolean, DateTime, Integer, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.db.base import Base


class Location(Base):
    __tablename__ = "locations"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    name       = Column(String(100), nullable=False, index=True)
    address    = Column(String(255), nullable=True)
    is_active  = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    def __repr__(self):
        return f"<Location {self.name}>"


class User(Base):
    __tablename__ = "users"

    id       = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    odoo_uid = Column(Integer, unique=True, nullable=False, index=True)
    email    = Column(String(255), unique=True, nullable=False, index=True)
    display_name = Column(String(100), nullable=False)
    role         = Column(String(20), nullable=False, default="pic")  # 'admin' | 'pic'
    is_active    = Column(Boolean, default=True, nullable=False)
    notif_enabled = Column(Boolean, default=True, nullable=False)
    created_by   = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at   = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at   = Column(DateTime(timezone=True), onupdate=func.now(), nullable=True)

    def __repr__(self):
        return f"<User {self.email} role={self.role}>"


class UserFCMToken(Base):
    __tablename__ = "user_fcm_tokens"

    id         = Column(Integer, primary_key=True, autoincrement=True, index=True)
    user_id    = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token      = Column(String(500), unique=True, nullable=False)
    platform   = Column(String(10), nullable=False, default="web")  # 'android' | 'ios' | 'web'
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), nullable=True)

    def __repr__(self):
        return f"<UserFCMToken user={self.user_id} platform={self.platform}>"


class UserLocation(Base):
    __tablename__ = "user_locations"

    id          = Column(Integer, primary_key=True, autoincrement=True, index=True)
    user_id     = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    location_id = Column(UUID(as_uuid=True), ForeignKey("locations.id", ondelete="CASCADE"), nullable=False, index=True)
    assigned_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    assigned_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    def __repr__(self):
        return f"<UserLocation user={self.user_id} location={self.location_id}>"


class UserPermission(Base):
    __tablename__ = "user_permissions"

    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id        = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    permission_key = Column(String(100), nullable=False)
    granted_by     = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    granted_at     = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    __table_args__ = (UniqueConstraint("user_id", "permission_key", name="uq_user_permission"),)

    def __repr__(self):
        return f"<UserPermission user={self.user_id} key={self.permission_key}>"
