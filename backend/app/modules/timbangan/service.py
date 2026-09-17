import csv
import hashlib
import io
from app.core.logging import get_logger
import os
from datetime import datetime, timezone, timedelta
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Device, TimbanganDevice, TimbanganLog, TimbanganFirmware

logger = get_logger(__name__)

_WITA = timezone(timedelta(hours=8))

def _fmt_wib(ts: datetime) -> str:
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(_WITA).strftime("%Y-%m-%d %H:%M:%S")


class TimbanganService:

    # ==================== DEVICE ====================

    @staticmethod
    def get_all(db: Session) -> list[TimbanganDevice]:
        return db.execute(
            select(TimbanganDevice)
            .join(Device, Device.id == TimbanganDevice.device_id)
            .order_by(TimbanganDevice.id)
        ).scalars().all()

    @staticmethod
    def get_by_id(db: Session, timbangan_id: int) -> Optional[TimbanganDevice]:
        return db.get(TimbanganDevice, timbangan_id)

    @staticmethod
    def get_by_device_id(db: Session, device_id) -> Optional[TimbanganDevice]:
        return db.execute(
            select(TimbanganDevice)
            .where(TimbanganDevice.device_id == device_id)
        ).scalar_one_or_none()

    @staticmethod
    def get_by_name(db: Session, name: str) -> Optional[TimbanganDevice]:
        """Cari timbangan via nama di tabel devices. Nama tidak unique — ambil yang paling baru."""
        device = db.execute(
            select(Device).where(
                Device.name == name,
                Device.type == "timbangan"
            ).order_by(Device.last_seen.desc())
        ).scalars().first()

        if not device:
            return None

        return TimbanganService.get_by_device_id(db, device.id)

    @staticmethod
    def get_device_by_mac_or_name(db: Session, mac: str | None, name: str | None) -> Optional[Device]:
        """Lookup device by MAC (authoritative) with fallback to name.
        No type filter — device may arrive as 'other' from Flutter and get fixed here."""
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
    def ensure_timbangan_type(db: Session, device: Device) -> None:
        """Auto-fix device type to 'timbangan' and create timbangan_device record if missing.
        Handles devices provisioned by Flutter app without the correct type."""
        changed = False
        if device.type != "timbangan":
            device.type = "timbangan"
            changed = True
        timbangan = db.execute(
            select(TimbanganDevice).where(TimbanganDevice.device_id == device.id)
        ).scalar_one_or_none()
        if not timbangan:
            db.add(TimbanganDevice(device_id=device.id, weight=None, timestamp=None, consumed=False))
            changed = True
        if changed:
            db.commit()
            db.refresh(device)

    @staticmethod
    def try_sync_name(db: Session, device: Device, new_name: str) -> bool:
        """
        Auto-sync nama device dari MQTT payload jika MAC cocok dan nama berbeda dari DB.
        Nama boleh sama dengan device lain — MAC adalah identifier utama.
        """
        if not new_name or new_name == device.name:
            return False
        try:
            old_name = device.name
            device.name = new_name
            db.commit()
            logger.info(f"Nama device auto-synced via MQTT: {device.mac} '{old_name}' → '{new_name}'")
            return True
        except Exception as e:
            db.rollback()
            logger.error(f"Error auto-sync nama: {e}")
            return False

    @staticmethod
    def create(
        db: Session, name: str, location_id=None
    ) -> tuple[Optional[int], Optional[str]]:
        """
        Buat device timbangan baru secara manual (tanpa BLE provisioning).
        Buat entry di devices + timbangan_devices.
        """
        import uuid

        # Cek duplikat nama
        existing = db.execute(
            select(Device).where(Device.name == name)
        ).scalar_one_or_none()

        if existing:
            return None, "Device name already exists"

        try:
            # Buat di tabel devices dulu
            device = Device(
                id=uuid.uuid4(),
                mac=f"manual-{uuid.uuid4().hex[:12]}",  # placeholder MAC
                name=name,
                type="timbangan",
                location_id=location_id,
                online=False
            )
            db.add(device)
            db.flush()  # Dapat device.id tanpa commit

            # Buat di timbangan_devices
            timbangan = TimbanganDevice(
                device_id=device.id,
                weight=None,
                timestamp=None,
                consumed=False
            )
            db.add(timbangan)
            db.commit()
            db.refresh(timbangan)

            logger.info(f"Created timbangan: {name} (id={timbangan.id})")
            return timbangan.id, None

        except Exception as e:
            db.rollback()
            logger.error(f"Error creating timbangan: {e}")
            return None, str(e)

    @staticmethod
    def update_name(
        db: Session, timbangan_id: int, new_name: str
    ) -> tuple[bool, Optional[str]]:
        timbangan = db.get(TimbanganDevice, timbangan_id)
        if not timbangan:
            return False, "Device not found"

        duplicate = db.execute(
            select(Device).where(Device.name == new_name)
        ).scalar_one_or_none()

        if duplicate:
            return False, "Device name already exists"

        try:
            device = db.get(Device, timbangan.device_id)
            device.name = new_name
            db.commit()
            return True, None
        except Exception as e:
            db.rollback()
            return False, str(e)

    @staticmethod
    def update_location(
        db: Session, timbangan_id: int, location_id
    ) -> tuple[bool, Optional[str]]:
        timbangan = db.get(TimbanganDevice, timbangan_id)
        if not timbangan:
            return False, "Device not found"

        try:
            device = db.get(Device, timbangan.device_id)
            device.location_id = location_id
            db.commit()
            return True, None
        except Exception as e:
            db.rollback()
            return False, str(e)

    @staticmethod
    def delete(
        db: Session, timbangan_id: int
    ) -> tuple[bool, Optional[str]]:
        timbangan = db.get(TimbanganDevice, timbangan_id)
        if not timbangan:
            return False, "Device not found"

        try:
            device = db.get(Device, timbangan.device_id)
            db.delete(device)  # cascade hapus timbangan_device juga
            db.commit()
            return True, None
        except Exception as e:
            db.rollback()
            return False, str(e)

    @staticmethod
    def update_weight(
        db: Session, timbangan_id: int, weight: float, timestamp: datetime,
        unit: Optional[str] = None,
        weight_str: Optional[str] = None,
        device_id=None,
    ):
        """Update current weight — dipanggil dari MQTT handler"""
        try:
            db.execute(
                update(TimbanganDevice)
                .where(TimbanganDevice.id == timbangan_id)
                .values(
                    weight=weight, weight_str=weight_str,
                    unit=unit, timestamp=timestamp, consumed=False,
                )
            )
            if device_id is not None:
                db.execute(
                    update(Device)
                    .where(Device.id == device_id)
                    .values(last_seen=datetime.now(timezone.utc))
                )
            db.commit()
        except Exception as e:
            db.rollback()
            logger.error(f"Error updating weight: {e}")

    @staticmethod
    def update_online_status(db: Session, device: Device, is_online: bool, rssi: int | None = None):
        """Persist status online/offline dari MQTT (termasuk LWT). Opsional update RSSI di config."""
        try:
            device.online = is_online
            if is_online:
                device.last_seen = datetime.now(timezone.utc)
            if rssi is not None:
                config = dict(device.config) if device.config else {}
                config["rssi"] = rssi
                device.config = config
            db.commit()
        except Exception as e:
            db.rollback()
            logger.error(f"Error updating online status for {device.name}: {e}")

    @staticmethod
    def update_last_seen(db: Session, device: Device):
        """
        Update last_seen di tabel devices.
        Dipanggil setiap ada MQTT message — menggantikan in-memory dict.
        """
        try:
            now = datetime.now(timezone.utc)
            db.execute(
                update(Device)
                .where(Device.id == device.id)
                .values(last_seen=now)
            )
            db.commit()
        except Exception as e:
            db.rollback()
            logger.error(f"Error updating last_seen for {device.name}: {e}")

    @staticmethod
    def mark_consumed_atomic(
        db: Session, timbangan_id: int
    ) -> Optional[dict]:
        """
        Atomic get + mark consumed dengan SELECT FOR UPDATE.
        Mencegah race condition kalau dua user Odoo klik bersamaan.
        Returns data dict jika berhasil, None jika sudah consumed/tidak ada data.
        """
        try:
            result = db.execute(
                select(TimbanganDevice)
                .where(TimbanganDevice.id == timbangan_id)
                .with_for_update()
            )
            timbangan = result.scalar_one_or_none()

            if not timbangan:
                return None

            if timbangan.consumed or timbangan.weight is None:
                return None

            # Tolak data yang sudah lewat 1 menit — jangan mark consumed
            if timbangan.timestamp is not None:
                ts = timbangan.timestamp
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) - ts > timedelta(minutes=1):
                    return None

            # Ambil nama device
            device = db.get(Device, timbangan.device_id)

            data = {
                "device_id": timbangan.id,
                "name":      device.name if device else "Unknown",
                "weight":    timbangan.weight,
                "timestamp": timbangan.timestamp
            }

            timbangan.consumed = True
            db.commit()

            return data

        except Exception as e:
            db.rollback()
            logger.error(f"Error in mark_consumed_atomic: {e}")
            return None

    @staticmethod
    def get_available(db: Session) -> list[TimbanganDevice]:
        """Devices dengan data yang belum consumed"""
        return db.execute(
            select(TimbanganDevice)
            .where(
                TimbanganDevice.consumed == False,
                TimbanganDevice.weight.isnot(None)
            )
            .order_by(TimbanganDevice.id)
        ).scalars().all()

    @staticmethod
    def get_status(db: Session) -> dict:
        """
        Get online/offline status dari database.
        Source of truth: device.online yang di-set oleh MQTT handler dan scheduler.
        location_id di-resolve ke nama string supaya frontend bisa langsung pakai.
        """
        from app.models import Location
        devices = db.execute(
            select(TimbanganDevice)
            .join(Device, Device.id == TimbanganDevice.device_id)
        ).scalars().all()

        result = {}
        for t in devices:
            device = db.get(Device, t.device_id)
            if not device:
                continue

            loc_name = None
            if device.location_id:
                loc = db.get(Location, device.location_id)
                loc_name = loc.name if loc else None

            result[device.name] = {
                "name":        device.name,
                "online":      device.online,
                "last_seen":   device.last_seen.isoformat() if device.last_seen else None,
                "location_id": loc_name,
            }

        return result

    # ==================== LOGS ====================

    @staticmethod
    def insert_log(
        db:              Session,
        unit_id:         Optional[object],
        unit_name:       Optional[str],
        iot_device_id:   Optional[object],
        iot_device_name: Optional[str],
        weight:          float,
        timestamp:       datetime,
        used_for:        Optional[str] = None,
        weight_unit:     Optional[str] = None,
        weight_str:      Optional[str] = None,
    ):
        try:
            log = TimbanganLog(
                unit_id=unit_id,
                unit_name=unit_name,
                iot_device_id=iot_device_id,
                iot_device_name=iot_device_name,
                weight=weight,
                weight_str=weight_str,
                unit=weight_unit,
                timestamp=timestamp,
                used_for=used_for,
            )
            db.add(log)
            db.commit()
        except Exception as e:
            db.rollback()
            logger.error(f"Error inserting log: {e}")

    @staticmethod
    def update_log_used_for(
        db: Session, timbangan_id: int, timestamp: datetime, used_for: str
    ):
        """
        Update used_for pada log berdasarkan timbangan_id (TimbanganDevice.id) dan timestamp.
        Lookup via iot_device_id: resolve timbangan → devices.id, lalu cari log.
        """
        timbangan = db.get(TimbanganDevice, timbangan_id)
        if not timbangan:
            return
        log = db.execute(
            select(TimbanganLog).where(
                TimbanganLog.iot_device_id == timbangan.device_id,
                TimbanganLog.timestamp == timestamp
            )
        ).scalar_one_or_none()

        if log:
            log.used_for = used_for
            db.commit()

    @staticmethod
    def get_logs_by_date(db: Session, date_str: str) -> list[dict]:
        start = datetime.strptime(f"{date_str} 00:00:00", "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        end   = datetime.strptime(f"{date_str} 23:59:59", "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)

        logs = db.execute(
            select(TimbanganLog)
            .where(
                TimbanganLog.timestamp >= start,
                TimbanganLog.timestamp <= end
            )
            .order_by(TimbanganLog.unit_id, TimbanganLog.timestamp.desc())
        ).scalars().all()

        result = {}
        for log in logs:
            key = str(log.unit_id) if log.unit_id else "unassigned"
            if key not in result:
                result[key] = {
                    "unit_id":   key,
                    "unit_name": log.unit_name or "Unknown",
                    "logs":      []
                }
            result[key]["logs"].append({
                "id":              log.id,
                "weight":          log.weight,
                "weight_str":      log.weight_str,
                "unit":            log.unit,
                "timestamp":       log.timestamp,
                "used_for":        log.used_for or "Not Used",
                "iot_device_name": log.iot_device_name,
            })

        return list(result.values())

    @staticmethod
    def delete_old_logs(db: Session, days: int = 14) -> int:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        logs   = db.execute(
            select(TimbanganLog).where(TimbanganLog.timestamp < cutoff)
        ).scalars().all()

        count = len(logs)
        for log in logs:
            db.delete(log)

        db.commit()
        logger.info(f"Deleted {count} old logs")
        return count

    # ==================== BACKUP ====================

    @staticmethod
    def ensure_dirs():
        os.makedirs(settings.timbangan_data_dir,    exist_ok=True)
        os.makedirs(settings.timbangan_backup_dir,  exist_ok=True)
        os.makedirs(settings.timbangan_firmware_dir, exist_ok=True)

    @staticmethod
    def export_csv(db: Session, unit_id, date_str: str) -> Optional[bytes]:
        start = datetime.strptime(f"{date_str} 00:00:00", "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        end   = datetime.strptime(f"{date_str} 23:59:59", "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)

        logs = db.execute(
            select(TimbanganLog).where(
                TimbanganLog.unit_id == unit_id,
                TimbanganLog.timestamp >= start,
                TimbanganLog.timestamp <= end
            ).order_by(TimbanganLog.timestamp)
        ).scalars().all()

        if not logs:
            return None

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["timestamp", "weight", "used_for", "iot_device"])
        for log in logs:
            writer.writerow([
                _fmt_wib(log.timestamp),
                log.weight,
                log.used_for or "NULL",
                log.iot_device_name or "Unknown",
            ])

        return output.getvalue().encode("utf-8")

    @staticmethod
    def create_daily_backup(db: Session, date_str: str) -> list[str]:
        TimbanganService.ensure_dirs()
        start = datetime.strptime(f"{date_str} 00:00:00", "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        end   = datetime.strptime(f"{date_str} 23:59:59", "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)

        backup_files = []

        # Backup per asset unit (log yang sudah di-assign ke unit)
        unit_rows = db.execute(
            select(TimbanganLog.unit_id, TimbanganLog.unit_name)
            .where(
                TimbanganLog.timestamp >= start,
                TimbanganLog.timestamp <= end,
                TimbanganLog.unit_id.isnot(None)
            )
            .distinct()
        ).all()

        for unit_id, unit_name in unit_rows:
            csv_data = TimbanganService.export_csv(db, unit_id, date_str)
            if not csv_data:
                continue
            safe_name = (unit_name or str(unit_id)).replace(" ", "_").replace("/", "_")
            filename  = f"backup_{safe_name}_{date_str.replace('-', '')}.csv"
            filepath  = os.path.join(settings.timbangan_backup_dir, filename)
            with open(filepath, "wb") as f:
                f.write(csv_data)
            backup_files.append(filename)

        # Backup log device yang belum di-assign ke asset unit, dikelompokkan per device
        unassigned_device_rows = db.execute(
            select(TimbanganLog.iot_device_id, TimbanganLog.iot_device_name)
            .where(
                TimbanganLog.timestamp >= start,
                TimbanganLog.timestamp <= end,
                TimbanganLog.unit_id.is_(None),
                TimbanganLog.iot_device_id.isnot(None)
            )
            .distinct()
        ).all()

        for device_id, device_name in unassigned_device_rows:
            logs = db.execute(
                select(TimbanganLog).where(
                    TimbanganLog.iot_device_id == device_id,
                    TimbanganLog.timestamp >= start,
                    TimbanganLog.timestamp <= end,
                    TimbanganLog.unit_id.is_(None)
                ).order_by(TimbanganLog.timestamp)
            ).scalars().all()

            if not logs:
                continue

            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(["timestamp", "weight", "used_for", "iot_device"])
            for log in logs:
                writer.writerow([
                    _fmt_wib(log.timestamp),
                    log.weight,
                    log.used_for or "NULL",
                    log.iot_device_name or "Unknown",
                ])

            safe_name = (device_name or str(device_id)).replace(" ", "_").replace("/", "_")
            filename  = f"backup_unassigned_{safe_name}_{date_str.replace('-', '')}.csv"
            filepath  = os.path.join(settings.timbangan_backup_dir, filename)
            with open(filepath, "wb") as f:
                f.write(output.getvalue().encode("utf-8"))
            backup_files.append(filename)

        return backup_files

    @staticmethod
    def list_backups() -> list[dict]:
        TimbanganService.ensure_dirs()
        files = []

        for fname in sorted(os.listdir(settings.timbangan_backup_dir), reverse=True):
            if not fname.endswith(".csv"):
                continue
            fpath = os.path.join(settings.timbangan_backup_dir, fname)
            files.append({
                "filename": fname,
                "size":     os.path.getsize(fpath),
                "mtime":    datetime.fromtimestamp(
                    os.path.getmtime(fpath)
                ).strftime("%Y-%m-%dT%H:%M:%S")
            })

        return files

    @staticmethod
    def cleanup_old_backups(days: int = 30) -> int:
        cutoff  = datetime.now() - timedelta(days=days)
        deleted = 0

        for fname in os.listdir(settings.timbangan_backup_dir):
            if not fname.endswith(".csv"):
                continue
            fpath = os.path.join(settings.timbangan_backup_dir, fname)
            if datetime.fromtimestamp(os.path.getmtime(fpath)) < cutoff:
                try:
                    os.remove(fpath)
                    deleted += 1
                except Exception as e:
                    logger.error(f"Error deleting backup {fname}: {e}")

        return deleted

    # ==================== ANALYTICS ====================

    @staticmethod
    def get_analytics_overview(
        db: Session, start_date: str, end_date: str
    ) -> dict:
        from sqlalchemy import func

        start = datetime.strptime(start_date, "%Y-%m-%d %H:%M:%S")
        end   = datetime.strptime(end_date,   "%Y-%m-%d %H:%M:%S")

        # PostgreSQL date_trunc — group by unit_id instead of device_id
        time_series = db.execute(
            select(
                func.date_trunc("hour", TimbanganLog.timestamp).label("time_bucket"),
                TimbanganLog.unit_id,
                TimbanganLog.unit_name,
                func.count(TimbanganLog.id).label("count"),
                func.avg(TimbanganLog.weight).label("avg_weight"),
                func.min(TimbanganLog.weight).label("min_weight"),
                func.max(TimbanganLog.weight).label("max_weight"),
                func.sum(TimbanganLog.weight).label("total_weight")
            )
            .where(TimbanganLog.timestamp >= start, TimbanganLog.timestamp <= end)
            .group_by("time_bucket", TimbanganLog.unit_id, TimbanganLog.unit_name)
            .order_by("time_bucket")
        ).all()

        summary = db.execute(
            select(
                func.count(TimbanganLog.id),
                func.avg(TimbanganLog.weight),
                func.min(TimbanganLog.weight),
                func.max(TimbanganLog.weight),
                func.sum(TimbanganLog.weight)
            )
            .where(TimbanganLog.timestamp >= start, TimbanganLog.timestamp <= end)
        ).first()

        # Counts by physical unit (no join to TimbanganDevice/Device needed)
        unit_counts = db.execute(
            select(
                TimbanganLog.unit_id,
                TimbanganLog.unit_name,
                func.count(TimbanganLog.id).label("count")
            )
            .where(
                TimbanganLog.timestamp >= start,
                TimbanganLog.timestamp <= end,
                TimbanganLog.unit_id.isnot(None)
            )
            .group_by(TimbanganLog.unit_id, TimbanganLog.unit_name)
            .order_by(func.count(TimbanganLog.id).desc())
        ).all()

        heatmap_data = db.execute(
            select(
                func.extract("dow",  TimbanganLog.timestamp).label("day"),
                func.extract("hour", TimbanganLog.timestamp).label("hour"),
                func.count(TimbanganLog.id).label("count")
            )
            .where(TimbanganLog.timestamp >= start, TimbanganLog.timestamp <= end)
            .group_by("day", "hour")
        ).all()

        return {
            "time_series":   time_series,
            "summary": {
                "total_measurements": summary[0] or 0,
                "avg_weight":   round(summary[1], 2) if summary[1] else 0,
                "min_weight":   round(summary[2], 2) if summary[2] else 0,
                "max_weight":   round(summary[3], 2) if summary[3] else 0,
                "total_weight": round(summary[4], 2) if summary[4] else 0
            },
            "device_counts": unit_counts,   # key kept for backward compat with router
            "heatmap_data":  heatmap_data
        }

    @staticmethod
    def get_unit_analytics(
        db: Session, unit_id, start_date: str, end_date: str
    ) -> dict:
        from sqlalchemy import func

        start = datetime.strptime(start_date, "%Y-%m-%d %H:%M:%S")
        end   = datetime.strptime(end_date,   "%Y-%m-%d %H:%M:%S")

        time_series = db.execute(
            select(TimbanganLog.timestamp, TimbanganLog.weight)
            .where(
                TimbanganLog.unit_id == unit_id,
                TimbanganLog.timestamp >= start,
                TimbanganLog.timestamp <= end
            )
            .order_by(TimbanganLog.timestamp)
        ).all()

        daily_data = db.execute(
            select(
                func.date_trunc("day", TimbanganLog.timestamp).label("date"),
                func.count(TimbanganLog.id).label("count"),
                func.avg(TimbanganLog.weight).label("avg_weight")
            )
            .where(
                TimbanganLog.unit_id == unit_id,
                TimbanganLog.timestamp >= start,
                TimbanganLog.timestamp <= end
            )
            .group_by("date")
            .order_by("date")
        ).all()

        usage_data = db.execute(
            select(
                func.coalesce(TimbanganLog.used_for, "Not Used").label("system"),
                func.count(TimbanganLog.id).label("count")
            )
            .where(
                TimbanganLog.unit_id == unit_id,
                TimbanganLog.timestamp >= start,
                TimbanganLog.timestamp <= end
            )
            .group_by("system")
        ).all()

        return {
            "time_series": time_series,
            "daily_data":  daily_data,
            "usage_data":  usage_data
        }

    # ==================== OTA ====================

    @staticmethod
    def safe_topic(name: str) -> str:
        return (
            name.replace(" ", "_")
                .replace("#", "")
                .replace("+", "")
                .replace("/", "_")
        )

    @staticmethod
    def upload_firmware(
        db:                Session,
        version:           str,
        original_filename: str,
        file_bytes:        bytes,
        description:       Optional[str] = None
    ) -> tuple[Optional[TimbanganFirmware], Optional[str]]:
        TimbanganService.ensure_dirs()

        existing = db.execute(
            select(TimbanganFirmware).where(TimbanganFirmware.version == version)
        ).scalar_one_or_none()

        if existing:
            return None, f"Version {version} already exists"

        checksum      = hashlib.md5(file_bytes).hexdigest()
        safe_filename = f"firmware_v{version}.bin"
        filepath      = os.path.join(settings.timbangan_firmware_dir, safe_filename)

        try:
            with open(filepath, "wb") as f:
                f.write(file_bytes)
        except Exception as e:
            return None, f"Failed to save file: {e}"

        try:
            fw = TimbanganFirmware(
                version=version,
                filename=safe_filename,
                filepath=filepath,
                size=len(file_bytes),
                checksum=checksum,
                description=description,
                is_active=False
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
    def list_firmware(db: Session) -> list[TimbanganFirmware]:
        return db.execute(
            select(TimbanganFirmware).order_by(TimbanganFirmware.created_at.desc())
        ).scalars().all()

    @staticmethod
    def get_firmware(db: Session, firmware_id: int) -> Optional[TimbanganFirmware]:
        return db.get(TimbanganFirmware, firmware_id)

    @staticmethod
    def get_active_firmware(db: Session) -> Optional[TimbanganFirmware]:
        return db.execute(
            select(TimbanganFirmware).where(TimbanganFirmware.is_active == True)
        ).scalar_one_or_none()

    @staticmethod
    def set_active_firmware(
        db: Session, firmware_id: int
    ) -> tuple[bool, Optional[str]]:
        fw = db.get(TimbanganFirmware, firmware_id)
        if not fw:
            return False, "Firmware not found"
        if not os.path.exists(fw.filepath):
            return False, "Firmware file not found on disk"

        try:
            db.execute(update(TimbanganFirmware).values(is_active=False))
            fw.is_active = True
            db.commit()
            return True, None
        except Exception as e:
            db.rollback()
            return False, str(e)

    @staticmethod
    def delete_firmware(
        db: Session, firmware_id: int
    ) -> tuple[bool, Optional[str]]:
        fw = db.get(TimbanganFirmware, firmware_id)
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