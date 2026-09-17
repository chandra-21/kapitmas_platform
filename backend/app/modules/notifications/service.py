from app.core.logging import get_logger
import threading
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.core.firebase import send_multicast_push
from app.models.notification import NotificationLog
from app.models.user import User, UserFCMToken, UserLocation

logger = get_logger(__name__)


class NotificationService:

    @staticmethod
    async def send_device_status_push(
        db: AsyncSession,
        device_id: UUID,
        device_name: str,
        location_id: UUID | None,
        is_online: bool,
    ) -> None:
        status_str = "online" if is_online else "offline"
        title = f"Device {status_str.capitalize()}"
        body = f"{device_name} sekarang {status_str}"

        users_query = (
            select(User)
            .where(User.is_active == True, User.notif_enabled == True)
        )

        if location_id is not None:
            users_query = (
                select(User)
                .join(UserLocation, UserLocation.user_id == User.id)
                .where(
                    UserLocation.location_id == location_id,
                    User.is_active == True,
                    User.notif_enabled == True,
                )
            )

        result = await db.execute(users_query)
        users = result.scalars().all()

        if not users:
            return

        user_ids = [u.id for u in users]
        tokens_result = await db.execute(
            select(UserFCMToken.token, UserFCMToken.user_id).where(
                UserFCMToken.user_id.in_(user_ids)
            )
        )
        token_rows = tokens_result.fetchall()

        if not token_rows:
            return

        tokens = [row[0] for row in token_rows]
        token_to_user = {row[0]: row[1] for row in token_rows}

        success_count, failure_count = send_multicast_push(
            tokens=tokens,
            title=title,
            body=body,
            data={"device_id": str(device_id), "status": status_str},
        )

        log_entries = [
            NotificationLog(
                user_id=token_to_user[token],
                device_id=device_id,
                type=f"device_{status_str}",
                message=body,
                success=(i < success_count),
            )
            for i, token in enumerate(tokens)
        ]
        db.add_all(log_entries)
        await db.commit()

        logger.info(
            f"Push sent for {device_name} ({status_str}): "
            f"{success_count} ok, {failure_count} failed"
        )

    # ── Sync version ─────────────────────────────────────────────────────────

    @staticmethod
    def _push_sync(
        device_id: UUID,
        device_name: str,
        location_id,
        notif_type: str,
        title: str,
        body: str,
        extra_data: dict | None = None,
    ) -> None:
        """
        Kirim push notification dari sync context (MQTT handler / scheduler).
        Dipanggil di background thread agar tidak memblok MQTT callback.
        """
        from app.db.session import SyncDBContext

        try:
            with SyncDBContext() as db:
                if location_id is not None:
                    users_query = (
                        select(User)
                        .join(UserLocation, UserLocation.user_id == User.id)
                        .where(
                            UserLocation.location_id == location_id,
                            User.is_active  == True,
                            User.notif_enabled == True,
                        )
                    )
                else:
                    users_query = select(User).where(
                        User.is_active     == True,
                        User.notif_enabled == True,
                    )

                users = db.execute(users_query).scalars().all()
                if not users:
                    logger.debug(f"No users to notify: {device_name} {notif_type}")
                    return

                user_ids   = [u.id for u in users]
                token_rows = db.execute(
                    select(UserFCMToken.token, UserFCMToken.user_id)
                    .where(UserFCMToken.user_id.in_(user_ids))
                ).fetchall()

                if not token_rows:
                    logger.debug(f"No FCM tokens: {device_name} {notif_type}")
                    return

                tokens       = [r[0] for r in token_rows]
                token_to_uid = {r[0]: r[1] for r in token_rows}

                data = {"device_id": str(device_id), "type": notif_type}
                if extra_data:
                    data.update(extra_data)

                success_count, failure_count = send_multicast_push(
                    tokens=tokens, title=title, body=body, data=data
                )

                db.add_all([
                    NotificationLog(
                        user_id=token_to_uid[t],
                        device_id=device_id,
                        type=notif_type,
                        message=body,
                        success=(i < success_count),
                    )
                    for i, t in enumerate(tokens)
                ])
                db.commit()

                logger.info(
                    f"Push [{notif_type}] {device_name}: "
                    f"{success_count} ok, {failure_count} failed"
                )
        except Exception:
            logger.exception(f"Push sync error — {device_name} {notif_type}")

    @staticmethod
    def notify_status_async(
        device_id: UUID,
        device_name: str,
        location_id,
        is_online: bool,
    ) -> None:
        """Event-driven: panggil dari mqtt_handler / scheduler tanpa blocking."""
        status_str = "online" if is_online else "offline"
        title = f"Device {'Online' if is_online else 'Offline'}"
        body  = f"{device_name} sekarang {status_str}"
        threading.Thread(
            target=NotificationService._push_sync,
            args=(device_id, device_name, location_id,
                  f"device_{status_str}", title, body),
            daemon=True,
        ).start()

    @staticmethod
    def notify_firmware_async(
        device_id: UUID,
        device_name: str,
        location_id,
        version: str,
    ) -> None:
        """Panggil saat OTA di-trigger ke device."""
        title = "Update Firmware"
        body  = f"{device_name} menerima update ke {version}"
        threading.Thread(
            target=NotificationService._push_sync,
            args=(device_id, device_name, location_id,
                  "device_firmware", title, body,
                  {"version": version}),
            daemon=True,
        ).start()

    @staticmethod
    async def get_my_notification_logs(
        db: AsyncSession, user_id: UUID, limit: int = 50
    ) -> list[NotificationLog]:
        result = await db.execute(
            select(NotificationLog)
            .where(NotificationLog.user_id == user_id)
            .order_by(NotificationLog.sent_at.desc())
            .limit(limit)
        )
        return result.scalars().all()
