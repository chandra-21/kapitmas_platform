import asyncio
from app.core.logging import get_logger

from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.models.device import Device
from app.modules.notifications.service import NotificationService

logger = get_logger(__name__)


class NotificationScheduler:
    """
    Kirim push notification saat status device berubah.
    Source of truth untuk device.online ada di MQTT handler & timbangan scheduler —
    scheduler ini hanya reaktif, tidak menghitung ulang status dari last_seen.
    """

    def __init__(self):
        self.running    = False
        self._prev_online: dict[str, bool] = {}  # str(device_id) -> bool

    async def start(self):
        if self.running:
            return
        self.running = True
        logger.info("Notification scheduler started")
        await self._status_watch_loop()

    def stop(self):
        self.running = False
        logger.info("Notification scheduler stopped")

    async def _status_watch_loop(self):
        while self.running:
            try:
                await self._check_and_notify()
            except Exception as e:
                logger.error(f"Notification status check error: {e}", exc_info=True)
            await asyncio.sleep(30)

    async def _check_and_notify(self):
        async with AsyncSessionLocal() as db:
            result  = await db.execute(select(Device))
            devices = result.scalars().all()

            for device in devices:
                device_key = str(device.id)
                is_online  = device.online

                # Iterasi pertama: inisialisasi state tanpa notifikasi
                if device_key not in self._prev_online:
                    self._prev_online[device_key] = is_online
                    continue

                was_online = self._prev_online[device_key]
                if was_online == is_online:
                    continue

                self._prev_online[device_key] = is_online
                logger.info(
                    f"Device {device.name} is now {'online' if is_online else 'offline'}"
                )
                # Push notification ditangani event-driven di mqtt_handler
                # dan timbangan_scheduler — scheduler ini hanya tracking state.


notification_scheduler = NotificationScheduler()
