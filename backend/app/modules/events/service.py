from app.core.logging import get_logger
from datetime import datetime, timezone, timedelta
from typing import Optional

from sqlalchemy import select, delete
from sqlalchemy.orm import Session

from app.core.sse import sse_manager
from app.db.session import SyncDBContext
from app.models.device_event import DeviceEvent

logger = get_logger(__name__)


class DeviceEventService:
    """Catat & ambil event dashboard. Sync DB karena dipanggil dari MQTT/scheduler."""

    @staticmethod
    def record(
        type_: str,
        title: str,
        message: str,
        device_name: Optional[str] = None,
        db: Optional[Session] = None,
    ) -> None:
        """Insert event ke DB + broadcast SSE."""
        evt = DeviceEvent(
            device_name=device_name,
            type=type_,
            title=title,
            message=message,
        )

        try:
            if db is not None:
                db.add(evt)
                db.flush()
            else:
                with SyncDBContext() as ctx:
                    ctx.add(evt)
                    ctx.commit()
                    ctx.refresh(evt)
        except Exception as e:
            logger.error(f"Failed to record device event: {e}", exc_info=True)
            return

        sse_manager.publish_sync("activity", {
            "id":          evt.id,
            "type":        evt.type,
            "title":       evt.title,
            "message":     evt.message,
            "device_name": evt.device_name,
            "created_at":  evt.created_at.isoformat() if evt.created_at else None,
        })

    @staticmethod
    def list_recent(db: Session, limit: int = 20) -> list[DeviceEvent]:
        return db.execute(
            select(DeviceEvent)
            .order_by(DeviceEvent.created_at.desc())
            .limit(limit)
        ).scalars().all()

    @staticmethod
    def delete_old_events(db: Session, days: int = 30) -> int:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        result = db.execute(
            delete(DeviceEvent).where(DeviceEvent.created_at < cutoff)
        )
        db.commit()
        count = result.rowcount
        logger.info(f"Deleted {count} device events older than {days} days")
        return count
