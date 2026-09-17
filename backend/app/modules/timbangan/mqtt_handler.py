import json
from app.core.logging import get_logger
from datetime import datetime, timezone

from sqlalchemy import update

from app.core.sse import sse_manager
from app.db.session import SyncDBContext
from app.modules.events.service import DeviceEventService
from app.modules.notifications.service import NotificationService
from app.modules.timbangan.service import TimbanganService

logger = get_logger(__name__)


class TimbanganMQTTHandler:
    """
    Handle MQTT messages dari device timbangan.
    Support dual topic: legacy (weight/#) dan baru (kapitmas/timbangan/#)
    """

    @staticmethod
    def handle(client, userdata, msg):
        try:
            topic   = msg.topic
            payload = msg.payload.decode("utf-8")

            logger.info(f"MQTT Timbangan [{topic}]")
            logger.debug(f"Payload: {payload[:200]}")

            try:
                data = json.loads(payload)
            except json.JSONDecodeError:
                logger.warning(f"Invalid JSON from topic {topic}")
                return

            device_mac  = data.get("mac")
            device_name = data.get("name")

            if not device_mac and not device_name:
                logger.warning("Message tanpa field 'mac' maupun 'name', skip")
                return

            with SyncDBContext() as db:
                # Resolve device sekali — MAC adalah identifier utama, name adalah fallback
                device = TimbanganService.get_device_by_mac_or_name(db, device_mac, device_name)
                if not device:
                    logger.warning(f"Device tidak ditemukan: mac={device_mac} name={device_name}")
                    return

                # Auto-fix jika device bertipe 'other' (provisioned by Flutter tanpa type field)
                TimbanganService.ensure_timbangan_type(db, device)

                # Auto-sync nama jika MAC tersedia dan nama di payload berbeda dari DB
                # (hanya jika MAC yang dipakai untuk lookup, bukan fallback name)
                if device_mac and device_name and device_name != device.name:
                    TimbanganService.try_sync_name(db, device, device_name)

                if _is_weight_topic(topic):
                    TimbanganMQTTHandler._handle_weight(device, data, db)
                elif _is_status_topic(topic):
                    TimbanganMQTTHandler._handle_status(device, data, db)
                else:
                    logger.debug(f"No handler for topic: {topic}")

        except Exception as e:
            logger.error(f"Error processing MQTT message: {e}", exc_info=True)

    @staticmethod
    def _handle_weight(device, data: dict, db):
        try:
            from sqlalchemy import select as sa_select
            from app.models.asset_unit import AssetUnit

            weight       = float(data.get("weight", 0))
            weight_str   = str(data.get("weight_str") or data.get("weight") or "0").strip()
            weight_unit  = (data.get("unit") or "kg").strip().lower() or "kg"
            timestamp    = datetime.now(timezone.utc)

            timbangan = TimbanganService.get_by_device_id(db, device.id)
            if not timbangan:
                logger.warning(f"Timbangan record tidak ditemukan untuk device '{device.name}'")
                return

            # Lookup unit fisik yang sedang memakai device ini
            asset_unit = db.execute(
                sa_select(AssetUnit).where(AssetUnit.device_id == device.id)
            ).scalar_one_or_none()

            TimbanganService.update_weight(
                db, timbangan.id, weight, timestamp,
                unit=weight_unit, weight_str=weight_str,
                device_id=device.id,
            )
            TimbanganService.insert_log(
                db,
                unit_id=asset_unit.id if asset_unit else None,
                unit_name=asset_unit.name if asset_unit else None,
                iot_device_id=device.id,
                iot_device_name=device.name,
                weight=weight,
                timestamp=timestamp,
                weight_unit=weight_unit,
                weight_str=weight_str,
            )

            logger.info(f"Weight: {device.name} = {weight_str} {weight_unit}")

            sse_manager.publish_sync("weight", {
                "device_id":   timbangan.id,
                "device_name": device.name,
                "weight":      weight,
                "weight_str":  weight_str,
                "unit":        weight_unit,
                "timestamp":   timestamp.isoformat()
            })

        except ValueError:
            logger.error(f"Invalid weight value from {device.name}")
        except Exception as e:
            logger.error(f"Error handling weight: {e}", exc_info=True)

    @staticmethod
    def _handle_status(device, data: dict, db):
        try:
            from sqlalchemy import select
            from app.models import Device

            status   = data.get("status", "alive")
            firmware = data.get("firmware", "")
            heap     = data.get("heap", 0)
            rssi     = data.get("rssi")
            if rssi is not None:
                try:
                    rssi = int(rssi)
                except (ValueError, TypeError):
                    rssi = None

            is_online = status in ("online", "alive")
            logger.info(f"Status: {device.name} = {status} rssi={rssi}")

            was_online = device.online
            was_offline_notified = bool(
                device.config
                and device.config.get("offline_notified", False)
            )
            is_first_connect = device.last_seen is None

            if is_online:
                # Online langsung persist — termasuk update last_seen
                TimbanganService.update_online_status(db, device, True, rssi=rssi)
            else:
                # Offline TIDAK langsung di-persist — scheduler akan handle via
                # last_seen timeout (_OFFLINE_FALLBACK_TIMEOUT) untuk menghindari
                # flicker saat device reconnect cepat (< 2 menit).
                # Hanya update RSSI jika ada.
                if rssi is not None:
                    config = dict(device.config) if device.config else {}
                    config["rssi"] = rssi
                    device.config = config
                    try:
                        db.commit()
                    except Exception:
                        db.rollback()

            sse_manager.publish_sync("status", {
                "name":      device.name,
                "online":    is_online,
                "status":    status,
                "firmware":  firmware,
                "heap":      heap,
                "rssi":      rssi,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })

            if was_online == is_online:
                return

            if is_online:
                # Kirim notifikasi online HANYA jika:
                #   1. Sebelumnya offline ≥ 5 menit (offline_notified=True di DB), ATAU
                #   2. Pertama kali connect (last_seen masih None)
                should_notify = was_offline_notified or is_first_connect

                if was_offline_notified:
                    # Reset flag di DB
                    db.execute(
                        update(Device)
                        .where(Device.id == device.id)
                        .values(config={
                            **(device.config or {}),
                            "offline_notified": False
                        })
                    )
                    db.commit()

                if should_notify:
                    logger.info(f"Notifikasi online: {device.name}")
                    DeviceEventService.record(
                        type_="online",
                        title=f"{device.name} Online",
                        message="Device reconnected and is now active.",
                        device_name=device.name,
                    )
                    NotificationService.notify_status_async(
                        device_id=device.id,
                        device_name=device.name,
                        location_id=device.location_id,
                        is_online=True,
                    )
                else:
                    logger.info(f"Brief disconnect — skip notifikasi online: {device.name}")
            else:
                # Device offline — jangan catat activity feed dan jangan kirim notifikasi sekarang.
                # Scheduler akan kirim setelah 5 menit via last_seen DB.
                logger.info(f"Device offline, ditunda 5 menit oleh scheduler: {device.name}")

        except Exception as e:
            logger.error(f"Error handling status: {e}", exc_info=True)


def _is_weight_topic(topic: str) -> bool:
    return (
        topic.startswith("weight/") or
        (topic.startswith("kapitmas/timbangan/") and topic.endswith("/weight"))
    )


def _is_status_topic(topic: str) -> bool:
    return (
        topic.startswith("status/") or
        (topic.startswith("kapitmas/timbangan/") and topic.endswith("/status"))
    )
