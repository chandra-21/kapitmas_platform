from app.core.logging import get_logger
from datetime import datetime, timezone
from typing import Optional
import hashlib
import os

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Device, SmartBuddyDevice, SmartBuddyFirmware
from app.models.user import Location

logger = get_logger(__name__)


class SmartBuddyService:

    # ==================== LOOKUP ====================

    @staticmethod
    def get_all(db: Session, location_ids: list | None = None) -> list[SmartBuddyDevice]:
        q = (
            select(SmartBuddyDevice)
            .join(Device, Device.id == SmartBuddyDevice.device_id)
            .order_by(SmartBuddyDevice.id)
        )
        if location_ids is not None:
            q = q.where(Device.location_id.in_(location_ids))
        return db.execute(q).scalars().all()

    @staticmethod
    def get_by_id(db: Session, sb_id: int) -> Optional[SmartBuddyDevice]:
        return db.get(SmartBuddyDevice, sb_id)

    @staticmethod
    def get_by_device_id(db: Session, device_id) -> Optional[SmartBuddyDevice]:
        return db.execute(
            select(SmartBuddyDevice)
            .where(SmartBuddyDevice.device_id == device_id)
        ).scalar_one_or_none()

    @staticmethod
    def get_device_by_mac_or_name(
        db: Session, mac: str | None, name: str | None
    ) -> Optional[Device]:
        if mac:
            device = db.execute(
                select(Device).where(Device.mac == mac)
            ).scalar_one_or_none()
            if device:
                return device
        if name:
            return db.execute(
                select(Device).where(Device.name == name)
                .order_by(Device.last_seen.desc())
            ).scalars().first()
        return None

    @staticmethod
    def ensure_smartbuddy_type(db: Session, device: Device) -> None:
        """Auto-fix type ke 'smartbuddy' dan buat smartbuddy_device jika belum ada."""
        changed = False
        if device.type != "smartbuddy":
            device.type = "smartbuddy"
            changed = True
        sb = db.execute(
            select(SmartBuddyDevice)
            .where(SmartBuddyDevice.device_id == device.id)
        ).scalar_one_or_none()
        if not sb:
            db.add(SmartBuddyDevice(device_id=device.id))
            changed = True
        if changed:
            db.commit()
            db.refresh(device)

    # ==================== GET FULL (untuk response) ====================

    @staticmethod
    def get_full(db: Session, sb: SmartBuddyDevice) -> dict:
        """Return dict yang memenuhi SmartBuddyDeviceResponse."""
        device: Device = sb.device or db.get(Device, sb.device_id)

        location_id   = None
        location_name = None
        if device.location_id:
            loc = db.get(Location, device.location_id)
            if loc:
                location_id   = str(loc.id)
                location_name = loc.name

        return {
            "id":            sb.id,
            "device_id":     str(device.id),
            "name":          device.name,
            "mac":           device.mac,
            "room_id":       sb.room_id,
            "location_id":   location_id,
            "location_name": location_name,
            "online":        device.online,
            "last_seen":     device.last_seen,
            "firmware":      device.firmware,
            "ip_address":    device.ip_address,
            "has_ac":        sb.has_ac,
            "has_lamp":      sb.has_lamp,
            "ac_brand":      sb.ac_brand,
            "ac_state": {
                "power":    sb.ac_power,
                "mode":     sb.ac_mode,
                "temp":     sb.ac_temp,
                "fan":      sb.ac_fan,
                "swing_v":  sb.ac_swing_v,
                "last_cmd": sb.ac_last_cmd,
            },
            "lamp_state": {
                "power":       sb.lamp_power,
                "mode":        sb.lamp_mode,
                "pir_timeout": sb.lamp_pir_timeout,
                "last_cmd":    sb.lamp_last_cmd,
            },
            "schedules": sb.schedules,
        }

    # ==================== STATE UPDATE (dari MQTT) ====================

    @staticmethod
    def update_ac_state(
        db: Session, sb: SmartBuddyDevice,
        power: bool, mode: str, temp: int, fan: str, swing_v: bool
    ) -> None:
        sb.ac_power   = power
        sb.ac_mode    = mode
        sb.ac_temp    = temp
        sb.ac_fan     = fan
        sb.ac_swing_v = swing_v
        db.commit()

    @staticmethod
    def update_lamp_state(
        db: Session, sb: SmartBuddyDevice,
        power: bool, mode: str, pir_timeout: int
    ) -> None:
        sb.lamp_power       = power
        sb.lamp_mode        = mode
        sb.lamp_pir_timeout = pir_timeout
        db.commit()

    @staticmethod
    def update_capabilities(
        db: Session, sb: SmartBuddyDevice,
        has_ac: bool, has_lamp: bool, ac_brand: str
    ) -> None:
        sb.has_ac   = has_ac
        sb.has_lamp = has_lamp
        sb.ac_brand = ac_brand
        db.commit()

    @staticmethod
    def update_online_status(
        db: Session, device: Device, online: bool, rssi: int | None = None
    ) -> None:
        device.online    = online
        device.last_seen = datetime.now(timezone.utc)
        if rssi is not None:
            config = dict(device.config) if device.config else {}
            config["rssi"] = rssi
            device.config  = config
        try:
            db.commit()
        except Exception:
            db.rollback()
            raise

    # ==================== COMMAND (dari REST — simpan ke DB) ====================

    @staticmethod
    def save_ac_command(
        db: Session, sb: SmartBuddyDevice,
        power: bool, mode: str, temp: int, fan: str, swing_v: bool
    ) -> None:
        """Simpan state AC yang diperintahkan (sebelum MQTT konfirmasi kembali)."""
        sb.ac_power   = power
        sb.ac_mode    = mode
        sb.ac_temp    = temp
        sb.ac_fan     = fan
        sb.ac_swing_v = swing_v
        sb.ac_last_cmd = datetime.now(timezone.utc)
        db.commit()

    @staticmethod
    def save_lamp_command(
        db: Session, sb: SmartBuddyDevice,
        power: bool, mode: str, pir_timeout: int | None
    ) -> None:
        sb.lamp_power = power
        sb.lamp_mode  = mode
        if pir_timeout is not None:
            sb.lamp_pir_timeout = pir_timeout
        sb.lamp_last_cmd = datetime.now(timezone.utc)
        db.commit()

    @staticmethod
    def save_schedules(db: Session, sb: SmartBuddyDevice, schedules: list) -> None:
        sb.schedules = schedules
        db.commit()

    # ==================== OTA ====================

    @staticmethod
    def ensure_firmware_dir() -> None:
        os.makedirs(settings.smartbuddy_firmware_dir, exist_ok=True)

    @staticmethod
    def upload_firmware(
        db: Session,
        version: str,
        original_filename: str,
        file_bytes: bytes,
        description: Optional[str] = None,
    ) -> tuple[Optional[SmartBuddyFirmware], Optional[str]]:
        SmartBuddyService.ensure_firmware_dir()

        existing = db.execute(
            select(SmartBuddyFirmware).where(SmartBuddyFirmware.version == version)
        ).scalar_one_or_none()
        if existing:
            return None, f"Version {version} already exists"

        checksum      = hashlib.md5(file_bytes).hexdigest()
        safe_filename = f"smartbuddy_v{version}.bin"
        filepath      = os.path.join(settings.smartbuddy_firmware_dir, safe_filename)

        try:
            with open(filepath, "wb") as f:
                f.write(file_bytes)
        except Exception as e:
            return None, f"Failed to save file: {e}"

        try:
            fw = SmartBuddyFirmware(
                version=version,
                filename=safe_filename,
                filepath=filepath,
                size=len(file_bytes),
                checksum=checksum,
                description=description,
                is_active=False,
            )
            db.add(fw)
            db.commit()
            db.refresh(fw)
            return fw, None
        except Exception as e:
            db.rollback()
            if os.path.exists(filepath):
                os.remove(filepath)
            return None, str(e)

    @staticmethod
    def list_firmware(db: Session) -> list[SmartBuddyFirmware]:
        return db.execute(
            select(SmartBuddyFirmware).order_by(SmartBuddyFirmware.created_at.desc())
        ).scalars().all()

    @staticmethod
    def get_firmware(db: Session, firmware_id: int) -> Optional[SmartBuddyFirmware]:
        return db.get(SmartBuddyFirmware, firmware_id)

    @staticmethod
    def get_active_firmware(db: Session) -> Optional[SmartBuddyFirmware]:
        return db.execute(
            select(SmartBuddyFirmware).where(SmartBuddyFirmware.is_active == True)
        ).scalar_one_or_none()

    @staticmethod
    def set_active_firmware(
        db: Session, firmware_id: int
    ) -> tuple[bool, Optional[str]]:
        fw = db.get(SmartBuddyFirmware, firmware_id)
        if not fw:
            return False, "Firmware not found"
        if not os.path.exists(fw.filepath):
            return False, "Firmware file not found on disk"
        try:
            db.execute(update(SmartBuddyFirmware).values(is_active=False))
            fw.is_active = True
            db.commit()
            return True, None
        except Exception as e:
            db.rollback()
            return False, str(e)

    @staticmethod
    def update_device(
        db: Session, sb_id: int, name: Optional[str], location_id
    ) -> tuple[bool, Optional[str]]:
        sb = db.get(SmartBuddyDevice, sb_id)
        if not sb:
            return False, "Device not found"
        try:
            device = db.get(Device, sb.device_id)
            if name is not None:
                duplicate = db.execute(
                    select(Device).where(Device.name == name, Device.id != device.id)
                ).scalar_one_or_none()
                if duplicate:
                    return False, "Device name already exists"
                device.name = name
            if location_id is not None:
                device.location_id = location_id if location_id != "" else None
            db.commit()
            return True, None
        except Exception as e:
            db.rollback()
            return False, str(e)

    @staticmethod
    def delete_device(
        db: Session, sb_id: int
    ) -> tuple[bool, Optional[str]]:
        sb = db.get(SmartBuddyDevice, sb_id)
        if not sb:
            return False, "Device not found"
        try:
            device = db.get(Device, sb.device_id)
            db.delete(device)
            db.commit()
            return True, None
        except Exception as e:
            db.rollback()
            return False, str(e)

    @staticmethod
    def delete_firmware(
        db: Session, firmware_id: int
    ) -> tuple[bool, Optional[str]]:
        fw = db.get(SmartBuddyFirmware, firmware_id)
        if not fw:
            return False, "Firmware not found"
        if fw.is_active:
            return False, "Cannot delete active firmware"
        try:
            if os.path.exists(fw.filepath):
                os.remove(fw.filepath)
            db.delete(fw)
            db.commit()
            return True, None
        except Exception as e:
            db.rollback()
            return False, str(e)
