from sqlalchemy import Column, String, Integer, DateTime
from sqlalchemy.sql import func

from app.db.base import Base


class DeviceEvent(Base):
    """
    Device-level activity log untuk Activity Feed di dashboard.
    Independen dari NotificationLog (yg mencatat push per-user).
    """
    __tablename__ = "device_events"

    id          = Column(Integer, primary_key=True, autoincrement=True, index=True)
    device_name = Column(String(100), nullable=True, index=True)
    type        = Column(String(50), nullable=False, index=True)   # online | offline | firmware | calibration | sync
    title       = Column(String(120), nullable=False)
    message     = Column(String(500), nullable=False)
    created_at  = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    def __repr__(self):
        return f"<DeviceEvent {self.type} device={self.device_name}>"
