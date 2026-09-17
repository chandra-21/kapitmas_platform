import uuid
from sqlalchemy import Column, String, Boolean, DateTime, Integer, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.db.base import Base


class AssetUnit(Base):
    __tablename__ = "asset_units"

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    unit_id     = Column(String(100), unique=True, nullable=False, index=True)
    name        = Column(String(100), nullable=False)
    type        = Column(String(50),  nullable=False, default='timbangan')  # 'timbangan' | 'doorlock' | ...
    location_id = Column(UUID(as_uuid=True), ForeignKey("locations.id",  ondelete="SET NULL"), nullable=True, index=True)
    device_id   = Column(UUID(as_uuid=True), ForeignKey("devices.id",    ondelete="SET NULL"), nullable=True, index=True)
    is_active   = Column(Boolean, default=True, nullable=False)
    odoo_id     = Column(Integer, nullable=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at  = Column(DateTime(timezone=True), onupdate=func.now(), nullable=True)

    def __repr__(self):
        return f"<AssetUnit {self.unit_id} type={self.type} device={self.device_id}>"
