import asyncio
from app.core.logging import get_logger
from datetime import datetime, timedelta, timezone

from app.config import settings
from app.core.sse import sse_manager
from app.db.session import SyncDBContext
from app.modules.events.service import DeviceEventService
from app.modules.notifications.service import NotificationService
from app.modules.timbangan.service import TimbanganService

logger = get_logger(__name__)

_OFFLINE_CHECK_INTERVAL   = 30   # detik
_OFFLINE_FALLBACK_TIMEOUT = 120  # detik — 2× keepalive, mark offline di DB/UI
_OFFLINE_NOTIFY_THRESHOLD = 300  # detik — 5 menit, baru kirim notifikasi


def _is_offline_notified(device) -> bool:
    """Baca flag offline_notified dari device.config (persistent di DB)."""
    return bool(device.config and device.config.get("offline_notified", False))


def _set_offline_notified(db, device, value: bool):
    """Tulis flag offline_notified ke device.config di DB."""
    config = dict(device.config) if device.config else {}
    config["offline_notified"] = value
    device.config = config


class TimbanganScheduler:

    def __init__(self):
        self.running = False

    async def start(self):
        if self.running:
            return
        self.running = True
        logger.info("Timbangan scheduler started")
        await asyncio.gather(
            self._daily_backup_loop(),
            self._offline_detection_loop(),
        )

    def stop(self):
        self.running = False
        logger.info("Timbangan scheduler stopped")

    async def _offline_detection_loop(self):
        while self.running:
            await asyncio.sleep(_OFFLINE_CHECK_INTERVAL)
            try:
                self._check_offline_devices()
            except Exception as e:
                logger.error(f"Offline detection error: {e}", exc_info=True)

    def _check_offline_devices(self):
        from sqlalchemy import select
        from app.models import Device

        now = datetime.now(timezone.utc)

        with SyncDBContext() as db:
            # ── Step 1: tandai device online yang heartbeat-nya habis ──────────
            online_devices = db.execute(
                select(Device).where(Device.type == "timbangan", Device.online == True)
            ).scalars().all()

            for device in online_devices:
                if device.last_seen is None:
                    continue

                last_seen = device.last_seen
                if last_seen.tzinfo is None:
                    last_seen = last_seen.replace(tzinfo=timezone.utc)

                elapsed = (now - last_seen).total_seconds()
                if elapsed > _OFFLINE_FALLBACK_TIMEOUT:
                    device.online = False
                    logger.warning(
                        f"Device offline (fallback): {device.name} "
                        f"(last seen {int(elapsed)}s ago)"
                    )
                    # SSE status update langsung untuk real-time UI indicator
                    sse_manager.publish_sync("status", {
                        "name":      device.name,
                        "online":    False,
                        "status":    "offline",
                        "timestamp": now.isoformat(),
                    })
                    # Activity feed TIDAK dicatat di sini — akan dicatat di Step 2
                    # setelah 5 menit, bersamaan dengan push notification.

            db.commit()

            # ── Step 2: kirim notifikasi offline jika sudah ≥ 5 menit ──────────
            # Pakai last_seen dari DB sebagai patokan kapan device terakhir aktif.
            # Ini aman karena last_seen hanya diupdate saat device ONLINE.
            all_offline = db.execute(
                select(Device).where(Device.type == "timbangan", Device.online == False)
            ).scalars().all()

            for device in all_offline:
                if device.last_seen is None:
                    continue

                last_seen = device.last_seen
                if last_seen.tzinfo is None:
                    last_seen = last_seen.replace(tzinfo=timezone.utc)

                elapsed_offline = (now - last_seen).total_seconds()

                if elapsed_offline >= _OFFLINE_NOTIFY_THRESHOLD and not _is_offline_notified(device):
                    logger.info(
                        f"Notifikasi offline: {device.name} "
                        f"(offline ~{int(elapsed_offline)}s)"
                    )
                    # Catat ke activity feed dan kirim push notification bersamaan
                    DeviceEventService.record(
                        type_="offline",
                        title=f"{device.name} Offline",
                        message=f"Tidak ada heartbeat selama {int(elapsed_offline // 60)} menit.",
                        device_name=device.name,
                        db=db,
                    )
                    NotificationService.notify_status_async(
                        device_id=device.id,
                        device_name=device.name,
                        location_id=device.location_id,
                        is_online=False,
                    )
                    _set_offline_notified(db, device, True)

            db.commit()

    async def _daily_backup_loop(self):
        """Backup harian pada jam yang dikonfigurasi"""
        while self.running:
            now    = datetime.now()
            target = now.replace(
                hour=settings.timbangan_backup_time_hour,
                minute=settings.timbangan_backup_time_minute,
                second=0, microsecond=0
            )
            if now >= target:
                target += timedelta(days=1)

            wait = (target - now).total_seconds()
            logger.info(f"Next backup: {target.strftime('%Y-%m-%d %H:%M:%S')} (in {int(wait)}s)")
            await asyncio.sleep(wait)

            try:
                with SyncDBContext() as db:
                    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

                    files         = TimbanganService.create_daily_backup(db, yesterday)
                    deleted       = TimbanganService.delete_old_logs(
                        db, settings.timbangan_log_retention_days
                    )
                    cleaned       = TimbanganService.cleanup_old_backups(
                        settings.timbangan_backup_retention_days
                    )
                    events_pruned = DeviceEventService.delete_old_events(
                        db, settings.device_event_retention_days
                    )

                    logger.info(
                        f"Backup done: {len(files)} files, "
                        f"{deleted} logs deleted, {cleaned} old backups cleaned, "
                        f"{events_pruned} old events pruned"
                    )
            except Exception as e:
                logger.error(f"Daily backup error: {e}", exc_info=True)


timbangan_scheduler = TimbanganScheduler()
