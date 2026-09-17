import uuid
from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID

from app.db.base import Base


class DeviceUnitHistory(Base):
    __tablename__ = "device_unit_history"

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_id     = Column(UUID(as_uuid=True), ForeignKey("devices.id",     ondelete="SET NULL"),  nullable=True,  index=True)
    device_name   = Column(String(100), nullable=False)   # snapshot device.name
    device_mac    = Column(String(20),  nullable=False)   # snapshot device.mac
    unit_id       = Column(UUID(as_uuid=True), ForeignKey("asset_units.id", ondelete="SET NULL"),  nullable=True,  index=True)
    unit_code     = Column(String(100), nullable=False)   # snapshot unit.unit_id
    unit_name     = Column(String(100), nullable=False)   # snapshot unit.name
    unit_type     = Column(String(50),  nullable=False)   # snapshot unit.type
    location_id   = Column(UUID(as_uuid=True), ForeignKey("locations.id", ondelete="SET NULL"), nullable=True)
    location_name = Column(String(200), nullable=True)    # snapshot location.name
    assigned_at   = Column(DateTime(timezone=True), nullable=False, index=True)
    released_at   = Column(DateTime(timezone=True), nullable=True)  # NULL = masih aktif

    def __repr__(self):
        return f"<DeviceUnitHistory device={self.device_name} unit={self.unit_code} {self.assigned_at}→{self.released_at}>"
