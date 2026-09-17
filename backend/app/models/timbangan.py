from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.base import Base


class TimbanganDevice(Base):
    """
    Data spesifik timbangan.
    Terhubung ke tabel devices universal via device_id.
    """
    __tablename__ = "timbangan_devices"

    id        = Column(Integer, primary_key=True, index=True)
    device_id = Column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True
    )

    # Current weight state
    weight      = Column(Float,                   nullable=True)
    weight_str  = Column(String(16),              nullable=True)   # "31.0" — presisi asli dari serial
    unit        = Column(String(8),               nullable=True)   # "kg", "lb", "g", "t"
    timestamp   = Column(DateTime(timezone=True), nullable=True)
    consumed    = Column(Boolean, default=False,  nullable=False)

    # Relationships
    device = relationship("Device", foreign_keys=[device_id])

    def __repr__(self):
        return f"<TimbanganDevice id={self.id} weight={self.weight}>"


class TimbanganLog(Base):
    """Historis semua penimbangan — FK ke AssetUnit (timbangan fisik), bukan IoT device."""
    __tablename__ = "timbangan_logs"

    id              = Column(Integer, primary_key=True, index=True)
    unit_id         = Column(
        UUID(as_uuid=True),
        ForeignKey("asset_units.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    unit_name       = Column(String(100), nullable=True)    # snapshot nama unit fisik
    iot_device_id   = Column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="SET NULL"),
        nullable=True
    )
    iot_device_name = Column(String(100), nullable=True)    # snapshot nama IoT device
    weight          = Column(Float,                   nullable=False)
    weight_str      = Column(String(16),              nullable=True)   # "31.0" — presisi asli dari serial
    unit            = Column(String(8),               nullable=True)   # "kg", "lb", "g", "t"
    timestamp       = Column(DateTime(timezone=True), nullable=False, index=True)
    used_for        = Column(String(100),             nullable=True)

    def __repr__(self):
        return f"<TimbanganLog unit={self.unit_id} weight={self.weight}>"


class TimbanganFirmware(Base):
    """OTA firmware khusus untuk timbangan"""
    __tablename__ = "timbangan_firmware"

    id          = Column(Integer, primary_key=True, index=True)
    version     = Column(String(50),  unique=True, nullable=False, index=True)
    filename    = Column(String(255), nullable=False)
    filepath    = Column(String(500), nullable=False)
    size        = Column(Integer,     nullable=False)
    checksum    = Column(String(64),  nullable=False)
    description = Column(Text,        nullable=True)
    is_active   = Column(Boolean, default=False, nullable=False)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f"<TimbanganFirmware v{self.version} active={self.is_active}>"