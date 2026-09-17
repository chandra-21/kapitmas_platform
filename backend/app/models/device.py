import uuid
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func

from app.db.base import Base


class Device(Base):
    """
    Universal device registry.
    Setiap ESP32 yang di-provision terdaftar di sini.
    """
    __tablename__ = "devices"

    id  = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    mac = Column(String(17), unique=True, nullable=False, index=True)

    # Identity
    name        = Column(String(100), nullable=False, index=True)
    type        = Column(String(50), nullable=False, default="other")
    location_id = Column(UUID(as_uuid=True), ForeignKey("locations.id", ondelete="SET NULL"), nullable=True, index=True)

    # Hardware info
    firmware   = Column(String(50), nullable=True)
    chip       = Column(String(50), nullable=True)
    ip_address = Column(String(15), nullable=True)

    # Status
    online    = Column(Boolean, default=False, nullable=False)
    last_seen = Column(DateTime(timezone=True), nullable=True)

    # Timestamps
    registered_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at    = Column(DateTime(timezone=True), onupdate=func.now(), nullable=True)

    # Misc config per device type
    config = Column(JSONB, nullable=True, default=dict)

    def __repr__(self):
        return f"<Device {self.name} type={self.type} mac={self.mac}>"
