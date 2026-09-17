import json
from app.core.logging import get_logger
from datetime import datetime, timezone

from app.core.mqtt import mqtt_client
from app.core.sse import sse_manager
from app.db.session import SyncDBContext
from app.modules.events.service import DeviceEventService
from app.modules.notifications.service import NotificationService
from app.modules.smartbuddy.service import SmartBuddyService

logger = get_logger(__name__)

# Enum mapping: firmware integer ↔ backend string
# Matches app_types.h: AC_MODE_AUTO=0, COOL=1, HEAT=2, DRY=3, FAN=4
_AC_MODE_TO_STR = {0: "auto", 1: "cool", 2: "heat", 3: "dry", 4: "fan"}
_AC_STR_TO_MODE = {v: k for k, v in _AC_MODE_TO_STR.items()}
# AC_FAN_AUTO=0, QUIET=1, LOW=2, MEDIUM=3, HIGH=4
_AC_FAN_TO_STR  = {0: "auto", 1: "quiet", 2: "low", 3: "medium", 4: "high"}
_AC_STR_TO_FAN  = {v: k for k, v in _AC_FAN_TO_STR.items()}
# LAMP_MODE_MANUAL=0, AUTO_PIR=1, SCHEDULE=2
_LAMP_MODE_TO_STR = {0: "manual", 1: "auto_pir", 2: "schedule"}
_LAMP_STR_TO_MODE = {v: k for k, v in _LAMP_MODE_TO_STR.items()}


class SmartBuddyMQTTHandler:
    """
    Handle MQTT messages dari device SmartBuddy.
    Topic: kapitmas/smartbuddy/{device_name}/{subtopic}
    """

    @staticmethod
    def handle(client, userdata, msg):
        try:
            topic   = msg.topic
            payload = msg.payload.decode("utf-8")

            logger.debug(f"MQTT SmartBuddy [{topic}]")

            try:
                data = json.loads(payload)
            except json.JSONDecodeError:
                logger.warning(f"Invalid JSON from {topic}")
                return

            # Extract device name dari topic: kapitmas/smartbuddy/{name}/{subtopic}
            parts = topic.split("/")
            if len(parts) < 4:
                logger.warning(f"Topic format invalid: {topic}")
                return

            device_name = parts[2]
            subtopic    = "/".join(parts[3:])  # e.g. "ac/state", "lamp/pir"

            device_mac  = data.get("mac")

            with SyncDBContext() as db:
                device = SmartBuddyService.get_device_by_mac_or_name(
                    db, device_mac, device_name
                )
                if not device:
                    logger.warning(f"SmartBuddy device tidak ditemukan: {device_name}")
                    return

                SmartBuddyService.ensure_smartbuddy_type(db, device)

                sb = SmartBuddyService.get_by_device_id(db, device.id)
                if not sb:
                    logger.warning(f"SmartBuddyDevice record tidak ada: {device_name}")
                    return

                handler = {
                    "status":       SmartBuddyMQTTHandler._handle_status,
                    "heartbeat":    SmartBuddyMQTTHandler._handle_heartbeat,
                    "capabilities": SmartBuddyMQTTHandler._handle_capabilities,
                    "ac/state":     SmartBuddyMQTTHandler._handle_ac_state,
                    "lamp/state":   SmartBuddyMQTTHandler._handle_lamp_state,
                    "lamp/pir":     SmartBuddyMQTTHandler._handle_pir,
                    "ir/result":    SmartBuddyMQTTHandler._handle_ir_result,
                }.get(subtopic)

                if handler:
                    handler(device, sb, data, db)
                else:
                    logger.debug(f"No handler for subtopic: {subtopic}")

        except Exception as e:
            logger.error(f"SmartBuddy MQTT error: {e}", exc_info=True)

    # ==================== HANDLERS ====================

    @staticmethod
    def _handle_status(device, sb, data: dict, db):
        status   = data.get("status", "alive")
        firmware = data.get("firmware", "")
        rssi     = data.get("rssi")
        is_online = status in ("online", "alive")

        was_online = device.online

        if firmware:
            device.firmware = firmware

        SmartBuddyService.update_online_status(db, device, is_online, rssi=rssi)

        sse_manager.publish_sync("smartbuddy_status", {
            "device_id":   str(device.id),
            "device_name": device.name,
            "online":      is_online,
            "status":      status,
            "firmware":    firmware,
            "rssi":        rssi,
            "timestamp":   datetime.now(timezone.utc).isoformat(),
        })

        logger.info(f"Status: {device.name} = {status}")

        # Saat device online: clear retained schedule + sync AC state
        if is_online and not was_online:
            # Hapus retained schedule dari broker — eksekusi jadwal sekarang di backend
            mqtt_client.publish(
                f"kapitmas/smartbuddy/{device.name}/schedule",
                b"",   # empty payload = hapus retained message
                retain=True,
            )
            logger.info(f"Cleared retained schedule for {device.name}")
            if sb.has_ac:
                SmartBuddyMQTTHandler.send_ac_sync(device.name, sb)
                logger.info(f"AC sync pushed to {device.name} on reconnect")

        if not was_online and is_online:
            DeviceEventService.record(
                type_="online",
                title=f"{device.name} Online",
                message="SmartBuddy reconnected.",
                device_name=device.name,
            )
            NotificationService.notify_status_async(
                device_id=device.id,
                device_name=device.name,
                location_id=device.location_id,
                is_online=True,
            )

    @staticmethod
    def _handle_heartbeat(device, sb, data: dict, db):
        SmartBuddyService.update_online_status(db, device, True,
                                                rssi=data.get("rssi"))

    @staticmethod
    def _handle_capabilities(device, sb, data: dict, db):
        has_ac   = bool(data.get("has_ac",   sb.has_ac))
        has_lamp = bool(data.get("has_lamp", sb.has_lamp))
        ac_brand = data.get("ac_brand",      sb.ac_brand) or "daikin"

        SmartBuddyService.update_capabilities(db, sb, has_ac, has_lamp, ac_brand)
        logger.info(
            f"Capabilities: {device.name} "
            f"ac={has_ac}({ac_brand}) lamp={has_lamp}"
        )

    @staticmethod
    def _handle_ac_state(device, sb, data: dict, db):
        power   = bool(data.get("power",   False))
        swing_v = bool(data.get("swing_v", False))
        temp_raw = data.get("temp", sb.ac_temp)
        try:
            temp = int(temp_raw)
            temp = max(16, min(30, temp))
        except (ValueError, TypeError):
            temp = sb.ac_temp

        # Firmware sends mode/fan as integers (enum values) — convert to string
        raw_mode = data.get("mode")
        if isinstance(raw_mode, int):
            mode = _AC_MODE_TO_STR.get(raw_mode, sb.ac_mode)
        else:
            mode = str(raw_mode) if raw_mode else sb.ac_mode

        raw_fan = data.get("fan")
        if isinstance(raw_fan, int):
            fan = _AC_FAN_TO_STR.get(raw_fan, sb.ac_fan)
        else:
            fan = str(raw_fan) if raw_fan else sb.ac_fan

        SmartBuddyService.update_ac_state(db, sb, power, mode, temp, fan, swing_v)

        sse_manager.publish_sync("smartbuddy_ac", {
            "device_id":   str(device.id),
            "device_name": device.name,
            "power":   power,
            "mode":    mode,
            "temp":    temp,
            "fan":     fan,
            "swing_v": swing_v,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        logger.debug(f"AC state: {device.name} power={power} {mode} {temp}°C")

    @staticmethod
    def _handle_lamp_state(device, sb, data: dict, db):
        power       = bool(data.get("power", False))
        pir_timeout = int(data.get("pir_timeout", sb.lamp_pir_timeout))

        # Firmware sends mode as integer — convert to string
        raw_mode = data.get("mode")
        if isinstance(raw_mode, int):
            mode = _LAMP_MODE_TO_STR.get(raw_mode, sb.lamp_mode)
        else:
            mode = str(raw_mode) if raw_mode else sb.lamp_mode

        SmartBuddyService.update_lamp_state(db, sb, power, mode, pir_timeout)

        sse_manager.publish_sync("smartbuddy_lamp", {
            "device_id":   str(device.id),
            "device_name": device.name,
            "power":       power,
            "mode":        mode,
            "pir_timeout": pir_timeout,
            "timestamp":   datetime.now(timezone.utc).isoformat(),
        })
        logger.debug(f"Lamp state: {device.name} power={power} mode={mode}")

    @staticmethod
    def _handle_pir(device, sb, data: dict, db):
        motion = bool(data.get("motion", False))

        sse_manager.publish_sync("smartbuddy_pir", {
            "device_id":   str(device.id),
            "device_name": device.name,
            "motion":      motion,
            "timestamp":   datetime.now(timezone.utc).isoformat(),
        })
        logger.debug(f"PIR: {device.name} motion={motion}")

    @staticmethod
    def _handle_ir_result(device, sb, data: dict, db):
        slot    = data.get("slot", "")
        success = bool(data.get("success", False))

        sse_manager.publish_sync("smartbuddy_ir_result", {
            "device_id":   str(device.id),
            "device_name": device.name,
            "slot":        slot,
            "success":     success,
            "timestamp":   datetime.now(timezone.utc).isoformat(),
        })
        logger.info(f"IR learn result: {device.name} slot={slot} success={success}")

    # ==================== PUBLISH HELPERS ====================

    @staticmethod
    def _push_schedule(device_name: str, schedules: list) -> None:
        topic   = f"kapitmas/smartbuddy/{device_name}/schedule"
        payload = json.dumps({"schedules": schedules})
        mqtt_client.publish(topic, payload, retain=True)

    @staticmethod
    def send_ac_command(device_name: str, cmd: dict) -> None:
        # Convert string mode/fan to integers for firmware
        payload = dict(cmd)
        if isinstance(payload.get("mode"), str):
            payload["mode"] = _AC_STR_TO_MODE.get(payload["mode"], 1)
        if isinstance(payload.get("fan"), str):
            payload["fan"] = _AC_STR_TO_FAN.get(payload["fan"], 0)
        topic = f"kapitmas/smartbuddy/{device_name}/ac/control"
        mqtt_client.publish(topic, json.dumps(payload))

    @staticmethod
    def send_ac_sync(device_name: str, sb) -> None:
        """Push current stored AC state to device via ac/sync topic."""
        payload = {
            "power":   sb.ac_power,
            "mode":    _AC_STR_TO_MODE.get(sb.ac_mode, 1),
            "temp":    sb.ac_temp,
            "fan":     _AC_STR_TO_FAN.get(sb.ac_fan, 0),
            "swing_v": sb.ac_swing_v,
        }
        topic = f"kapitmas/smartbuddy/{device_name}/ac/sync"
        mqtt_client.publish(topic, json.dumps(payload))

    @staticmethod
    def send_lamp_command(device_name: str, cmd: dict) -> None:
        # Convert string mode to integer for firmware
        payload = dict(cmd)
        if isinstance(payload.get("mode"), str):
            payload["mode"] = _LAMP_STR_TO_MODE.get(payload["mode"], 0)
        topic = f"kapitmas/smartbuddy/{device_name}/lamp/control"
        mqtt_client.publish(topic, json.dumps(payload))

    @staticmethod
    def send_ir_learn(device_name: str, slot: str) -> None:
        topic   = f"kapitmas/smartbuddy/{device_name}/ir/learn"
        mqtt_client.publish(topic, json.dumps({"slot": slot}))

    @staticmethod
    def send_ota(device_name: str, url: str) -> None:
        topic   = f"kapitmas/smartbuddy/{device_name}/ota"
        mqtt_client.publish(topic, json.dumps({"url": url}))

    @staticmethod
    def send_schedule(device_name: str, schedules: list) -> None:
        SmartBuddyMQTTHandler._push_schedule(device_name, schedules)


def is_smartbuddy_topic(topic: str, prefix: str) -> bool:
    return topic.startswith(f"{prefix}/smartbuddy/")
