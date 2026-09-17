from sqlalchemy import Column, String, Boolean, DateTime, Integer, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.db.base import Base


class NotificationLog(Base):
    __tablename__ = "notification_logs"

    id        = Column(Integer, primary_key=True, autoincrement=True, index=True)
    user_id   = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="SET NULL"), nullable=True, index=True)
    type      = Column(String(50), nullable=False)   # 'device_online' | 'device_offline'
    message   = Column(String(500), nullable=False)
    sent_at   = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    success   = Column(Boolean, default=False, nullable=False)

    def __repr__(self):
        return f"<NotificationLog type={self.type} user={self.user_id} success={self.success}>"
