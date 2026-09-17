from sqlalchemy import Column, Integer, String, Boolean, DateTime, JSON, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.base import Base


class SmartBuddyDevice(Base):
    """
    State spesifik SmartBuddy (AC + Lamp controller).
    Terhubung ke tabel devices universal via device_id (1:1).
    """
    __tablename__ = "smartbuddy_devices"

    id        = Column(Integer, primary_key=True, index=True)
    device_id = Column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )

    # Capabilities (dari provisioning / capabilities topic)
    has_ac   = Column(Boolean,    default=True,    nullable=False)
    has_lamp = Column(Boolean,    default=True,    nullable=False)
    ac_brand = Column(String(16), default="daikin", nullable=False)
    room_id  = Column(String(64), nullable=True)    # label lokasi dari firmware

    # AC state (update dari MQTT ac/state)
    ac_power   = Column(Boolean,    default=False,  nullable=False)
    ac_mode    = Column(String(16), default="cool", nullable=False)
    ac_temp    = Column(Integer,    default=25,     nullable=False)
    ac_fan     = Column(String(16), default="auto", nullable=False)
    ac_swing_v = Column(Boolean,    default=False,  nullable=False)
    ac_last_cmd = Column(DateTime(timezone=True), nullable=True)

    # Lamp state (update dari MQTT lamp/state)
    lamp_power       = Column(Boolean,    default=False,    nullable=False)
    lamp_mode        = Column(String(16), default="manual", nullable=False)
    lamp_pir_timeout = Column(Integer,    default=300,      nullable=False)  # detik
    lamp_last_cmd    = Column(DateTime(timezone=True), nullable=True)

    # Schedule config (JSON array — di-push ke device saat update atau reconnect)
    schedules = Column(JSON, nullable=True)

    device = relationship("Device", foreign_keys=[device_id])

    def __repr__(self):
        return (
            f"<SmartBuddyDevice id={self.id} "
            f"ac={self.ac_power} lamp={self.lamp_power}>"
        )


class SmartBuddyFirmware(Base):
    """OTA firmware untuk SmartBuddy ESP32."""
    __tablename__ = "smartbuddy_firmware"

    id          = Column(Integer,      primary_key=True, index=True)
    version     = Column(String(50),   unique=True, nullable=False, index=True)
    filename    = Column(String(255),  nullable=False)
    filepath    = Column(String(500),  nullable=False)
    size        = Column(Integer,      nullable=False)
    checksum    = Column(String(64),   nullable=False)
    description = Column(Text,         nullable=True)
    is_active   = Column(Boolean,      default=False, nullable=False)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f"<SmartBuddyFirmware v{self.version} active={self.is_active}>"
