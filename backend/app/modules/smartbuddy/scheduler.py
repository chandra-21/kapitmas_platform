import asyncio
from app.core.logging import get_logger
from datetime import datetime, timezone

from app.config import settings
from app.core.sse import sse_manager
from app.db.session import SyncDBContext
from app.modules.events.service import DeviceEventService
from app.modules.notifications.service import NotificationService

logger = get_logger(__name__)

_OFFLINE_CHECK_INTERVAL   = 30   # detik
_OFFLINE_FALLBACK_TIMEOUT = 120  # detik — device dianggap offline jika tak ada heartbeat
_OFFLINE_NOTIFY_THRESHOLD = 300  # detik — 5 menit, baru kirim notifikasi


def _is_offline_notified(device) -> bool:
    return bool(device.config and device.config.get("sb_offline_notified", False))


def _set_offline_notified(db, device, value: bool):
    config = dict(device.config) if device.config else {}
    config["sb_offline_notified"] = value
    device.config = config


class SmartBuddyScheduler:

    def __init__(self):
        self.running = False
        # Track jadwal yang sudah dieksekusi: (sb_id, idx) → "wday:hour:min"
        self._executed: dict[tuple, str] = {}

    async def start(self):
        if self.running:
            return
        self.running = True
        logger.info("SmartBuddy scheduler started")
        await asyncio.gather(
            self._offline_detection_loop(),
            self._schedule_execution_loop(),
        )

    def stop(self):
        self.running = False
        logger.info("SmartBuddy scheduler stopped")

    # ==================== SCHEDULE EXECUTION (backend-side) ====================

    async def _schedule_execution_loop(self):
        """Cek dan eksekusi jadwal setiap awal menit."""
        while self.running:
            # Tunggu sampai detik ke-0 menit berikutnya + 1 detik buffer
            now = datetime.now()
            sleep_secs = 60 - now.second + 1
            await asyncio.sleep(sleep_secs)
            try:
                self._check_and_execute_schedules()
            except Exception as e:
                logger.error(f"SmartBuddy schedule execution error: {e}", exc_info=True)

    def _check_and_execute_schedules(self):
        from sqlalchemy import select
        from app.models import Device, SmartBuddyDevice
        from app.modules.smartbuddy.mqtt_handler import SmartBuddyMQTTHandler

        # Pakai waktu lokal — backend container TZ dikonfigurasi via env TZ=Asia/Makassar
        now      = datetime.now()
        cur_hour = now.hour
        cur_min  = now.minute
        # Python weekday(): Mon=0..Sun=6 → konversi ke Sun=0..Sat=6 (sama dengan firmware/frontend)
        cur_wday = (now.weekday() + 1) % 7
        cur_key  = f"{cur_wday}:{cur_hour}:{cur_min}"

        with SyncDBContext() as db:
            rows = db.execute(
                select(SmartBuddyDevice)
                .join(Device, Device.id == SmartBuddyDevice.device_id)
                .where(
                    SmartBuddyDevice.schedules.isnot(None),
                    Device.online == True,
                )
            ).scalars().all()

            for sb in rows:
                if not sb.schedules:
                    continue
                device: Device = sb.device or db.get(Device, sb.device_id)

                for i, entry in enumerate(sb.schedules):
                    if not entry.get("enabled", True):
                        continue

                    if entry.get("hour") != cur_hour or entry.get("minute") != cur_min:
                        continue

                    days = entry.get("days", [True] * 7)
                    if len(days) <= cur_wday or not days[cur_wday]:
                        continue

                    # Cegah double-exec dalam menit yang sama
                    exec_key = (sb.id, i)
                    if self._executed.get(exec_key) == cur_key:
                        continue
                    self._executed[exec_key] = cur_key

                    target = entry.get("target", "ac")
                    power  = bool(entry.get("power", True))

                    if target == "ac" and sb.has_ac:
                        cmd = {
                            "power":   power,
                            "mode":    entry.get("ac_mode", 1),  # integer (firmware enum)
                            "temp":    entry.get("ac_temp", 25),
                            "fan":     entry.get("ac_fan", 0),   # integer (firmware enum)
                            "swing_v": False,
                        }
                        SmartBuddyMQTTHandler.send_ac_command(device.name, cmd)
                        logger.info(
                            f"[Schedule] {device.name} AC power={power} "
                            f"mode={cmd['mode']} temp={cmd['temp']}°C"
                        )

                    elif target == "lamp" and sb.has_lamp:
                        SmartBuddyMQTTHandler.send_lamp_command(device.name, {
                            "power": power,
                            "mode":  "manual",
                        })
                        logger.info(f"[Schedule] {device.name} Lamp power={power}")

    # ==================== OFFLINE DETECTION ====================

    async def _offline_detection_loop(self):
        while self.running:
            await asyncio.sleep(_OFFLINE_CHECK_INTERVAL)
            try:
                self._check_offline_devices()
            except Exception as e:
                logger.error(f"SmartBuddy offline detection error: {e}", exc_info=True)

    def _check_offline_devices(self):
        from sqlalchemy import select
        from app.models import Device

        now = datetime.now(timezone.utc)

        with SyncDBContext() as db:
            online_devices = db.execute(
                select(Device).where(
                    Device.type == "smartbuddy",
                    Device.online == True
                )
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
                        f"SmartBuddy offline (fallback): {device.name} "
                        f"(last seen {int(elapsed)}s ago)"
                    )
                    sse_manager.publish_sync("smartbuddy_status", {
                        "device_id":   str(device.id),
                        "device_name": device.name,
                        "online":      False,
                        "status":      "offline",
                        "timestamp":   now.isoformat(),
                    })

            db.commit()

            all_offline = db.execute(
                select(Device).where(
                    Device.type == "smartbuddy",
                    Device.online == False
                )
            ).scalars().all()

            for device in all_offline:
                if device.last_seen is None:
                    continue

                last_seen = device.last_seen
                if last_seen.tzinfo is None:
                    last_seen = last_seen.replace(tzinfo=timezone.utc)

                elapsed_offline = (now - last_seen).total_seconds()

                if elapsed_offline >= _OFFLINE_NOTIFY_THRESHOLD and \
                   not _is_offline_notified(device):
                    logger.info(
                        f"SmartBuddy notifikasi offline: {device.name} "
                        f"(offline ~{int(elapsed_offline)}s)"
                    )
                    DeviceEventService.record(
                        type_="offline",
                        title=f"{device.name} Offline",
                        message=(
                            f"SmartBuddy tidak ada heartbeat selama "
                            f"{int(elapsed_offline // 60)} menit."
                        ),
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


smartbuddy_scheduler = SmartBuddyScheduler()
