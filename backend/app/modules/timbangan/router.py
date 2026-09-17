import hashlib
import hmac
import json
from app.core.logging import get_logger
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, UploadFile, File, Form
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.core.sse import sse_manager
from app.db.session import get_sync_db, SyncDBContext
from app.models.user import User
from app.modules.auth.dependencies import require_permission, get_current_user_sse
from app.modules.events.service import DeviceEventService
from app.modules.notifications.service import NotificationService
from app.modules.timbangan.service import TimbanganService
from uuid import UUID

from app.schemas.timbangan import (
    TimbanganDeviceSimple,
    TimbanganDeviceResponse,
    TimbanganDeviceCreate,
    TimbanganDeviceUpdate,
    TimbanganDeviceAvailable,
    TimbanganWeightResponse,
    TimbanganUnitLogsResponse,
    TimbanganBackupFileResponse,
    TimbanganAuthRequest,
    TimbanganAuthResponse,
    TimbanganStatusResponse,
    TimbanganAnalyticsOverviewResponse,
    TimbanganDeviceAnalyticsResponse,
    TimbanganFirmwareResponse,
    TimbanganOTARequest,
    TimbanganOTABroadcastRequest,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/timbangan", tags=["Timbangan"])


def _ota_sign(firmware_id: int) -> str:
    """Generate HMAC-SHA256 signature for OTA download URL (no auth required on ESP32 side)."""
    key = settings.timbangan_ota_download_secret.encode()
    msg = str(firmware_id).encode()
    return hmac.new(key, msg, hashlib.sha256).hexdigest()[:16]


# ==================== DEVICE MANAGEMENT ====================

def _resolve_location_name(db: Session, location_uuid) -> Optional[str]:
    """Resolve location UUID → location name string."""
    if not location_uuid:
        return None
    from app.models import Location
    loc = db.get(Location, location_uuid)
    return loc.name if loc else None


def _is_expired(t, now: datetime) -> bool:
    """Data dianggap expired jika belum consumed, ada berat, tapi timestamp > 1 menit yang lalu."""
    if t.consumed or t.weight is None or t.timestamp is None:
        return False
    ts = t.timestamp if t.timestamp.tzinfo else t.timestamp.replace(tzinfo=timezone.utc)
    return (now - ts) > timedelta(minutes=1)


@router.get("/devices", response_model=List[TimbanganDeviceResponse])
def list_devices(
    db: Session = Depends(get_sync_db),
):
    """Full device list with weight, online status, location name, firmware."""
    from app.models import Device
    timbangans = TimbanganService.get_all(db)
    result     = []
    now = datetime.now(timezone.utc)
    for t in timbangans:
        device = db.get(Device, t.device_id)
        if not device:
            continue
        result.append({
            "id":          t.id,
            "device_id":   str(device.id),
            "name":        device.name,
            "location_id": _resolve_location_name(db, device.location_id),
            "weight":      t.weight,
            "weight_str":  t.weight_str,
            "unit":        t.unit,
            "timestamp":   t.timestamp,
            "consumed":    t.consumed,
            "expired":     _is_expired(t, now),
            "online":      device.online,
            "last_seen":   device.last_seen,
            "firmware":    device.firmware,
            "rssi":        (device.config or {}).get("rssi"),
        })
    return result


@router.get("/devices/{device_id}", response_model=TimbanganDeviceResponse)
def get_device(
    device_id: int,
    _: User = Depends(require_permission("timbangan.view")),
    db: Session = Depends(get_sync_db),
):
    from app.models import Device
    t = TimbanganService.get_by_id(db, device_id)
    if not t:
        raise HTTPException(status_code=404, detail="Device not found")

    device = db.get(Device, t.device_id)
    return {
        "id":          t.id,
        "device_id":   str(device.id) if device else "",
        "name":        device.name if device else "Unknown",
        "location_id": _resolve_location_name(db, device.location_id if device else None),
        "weight":      t.weight,
        "weight_str":  t.weight_str,
        "unit":        t.unit,
        "timestamp":   t.timestamp,
        "consumed":    t.consumed,
        "expired":     _is_expired(t, datetime.now(timezone.utc)),
        "online":      device.online if device else False,
        "last_seen":   device.last_seen if device else None,
        "firmware":    device.firmware if device else None,
        "rssi":        ((device.config or {}).get("rssi")) if device else None,
    }


@router.get("/units/{unit_id}/export")
def export_unit_logs(
    unit_id: UUID,
    date: str = Query(..., description="YYYY-MM-DD"),
    _: User = Depends(require_permission("report.export")),
    db: Session = Depends(get_sync_db),
):
    """Download CSV logs for a specific physical unit on a given date."""
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")

    csv_bytes = TimbanganService.export_csv(db, unit_id, date)
    if not csv_bytes:
        raise HTTPException(status_code=404, detail="No data for this unit/date")

    return Response(
        content=csv_bytes,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=timbangan_{unit_id}_{date}.csv"}
    )


@router.post("/devices", response_model=dict, status_code=201)
def create_device(
    body: TimbanganDeviceCreate,
    _: User = Depends(require_permission("timbangan.add")),
    db: Session = Depends(get_sync_db),
):
    tid, err = TimbanganService.create(db, body.name, body.location or "")
    if err:
        raise HTTPException(status_code=400, detail=err)
    return {"success": True, "device_id": tid, "name": body.name}


@router.put("/devices/{device_id}", response_model=dict)
def update_device(
    device_id: int,
    body:      TimbanganDeviceUpdate,
    _:         User = Depends(require_permission("timbangan.edit")),
    db:        Session = Depends(get_sync_db),
):
    if body.name is not None:
        ok, err = TimbanganService.update_name(db, device_id, body.name)
        if not ok:
            raise HTTPException(status_code=400, detail=err)

    if body.location is not None:
        ok, err = TimbanganService.update_location(db, device_id, body.location)
        if not ok:
            raise HTTPException(status_code=400, detail=err)

    return {"success": True}


@router.delete("/devices/{device_id}", status_code=204)
def delete_device(
    device_id: int,
    _: User = Depends(require_permission("timbangan.delete")),
    db: Session = Depends(get_sync_db),
):
    ok, err = TimbanganService.delete(db, device_id)
    if not ok:
        raise HTTPException(status_code=404, detail=err)


# ==================== WEIGHT & REALTIME ====================

@router.get("/weight/latest", response_model=TimbanganWeightResponse)
def get_latest_weight(
    device_id: int = Query(...),
    used_by:   str = Query("unknown"),
    db: Session = Depends(get_sync_db),
):
    """
    Endpoint untuk Odoo — TIDAK BOLEH BERUBAH.
    Menggunakan SELECT FOR UPDATE untuk mencegah race condition.
    """
    data = TimbanganService.mark_consumed_atomic(db, device_id)
    if data is None:
        raise HTTPException(status_code=404, detail="No data available")

    TimbanganService.update_log_used_for(
        db, device_id, data["timestamp"], used_by
    )
    return data


@router.get("/realtime", response_model=List[TimbanganDeviceAvailable])
def get_realtime(
    _: User = Depends(require_permission("timbangan.view")),
    db: Session = Depends(get_sync_db),
):
    timbangans = TimbanganService.get_available(db)
    result     = []
    for t in timbangans:
        from app.models import Device
        device = db.get(Device, t.device_id)
        result.append({
            "id":        t.id,
            "name":      device.name if device else "Unknown",
            "location_id": device.location_id_id if device else None,
            "weight":    t.weight,
            "timestamp": t.timestamp
        })
    return result


@router.get("/status", response_model=TimbanganStatusResponse)
def get_status(
    _: User = Depends(require_permission("timbangan.view")),
    db: Session = Depends(get_sync_db),
):
    return {"status": TimbanganService.get_status(db)}


# ==================== SSE ====================

@router.get("/events")
async def sse_stream(current_user: User = Depends(get_current_user_sse)):
    """SSE realtime stream — tidak memory leak"""
    async def generator():
        q = await sse_manager.subscribe()
        try:
            while True:
                import asyncio
                try:
                    data = await asyncio.wait_for(q.get(), timeout=30.0)
                    yield f"data: {json.dumps(data)}\n\n"
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            await sse_manager.unsubscribe(q)

    return StreamingResponse(generator(), media_type="text/event-stream")


# ==================== LOGS ====================

@router.get("/logs", response_model=List[TimbanganUnitLogsResponse])
def get_logs(
    date: str = Query(..., description="YYYY-MM-DD"),
    _: User = Depends(require_permission("report.view")),
    db: Session = Depends(get_sync_db),
):
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    return TimbanganService.get_logs_by_date(db, date)


# ==================== BACKUPS ====================

@router.get("/backups", response_model=List[TimbanganBackupFileResponse])
def list_backups(_: User = Depends(require_permission("report.view"))):
    return TimbanganService.list_backups()


@router.post("/backups/run")
def run_backup_now(
    date: Optional[str] = Query(None, description="YYYY-MM-DD (default: yesterday UTC)"),
    _: User = Depends(require_permission("report.export")),
):
    """Jalankan backup manual untuk tanggal tertentu (default: kemarin)."""
    if date:
        try:
            datetime.strptime(date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format, use YYYY-MM-DD")
        target_date = date
    else:
        target_date = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")

    with SyncDBContext() as db:
        files = TimbanganService.create_daily_backup(db, target_date)

    return {"date": target_date, "count": len(files), "files": files}


@router.get("/backups/{filename}")
def download_backup(
    filename: str,
    _: User = Depends(require_permission("report.export")),
):
    filepath = os.path.join(settings.timbangan_backup_dir, filename)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Backup not found")
    return FileResponse(path=filepath, filename=filename, media_type="text/csv")


# ==================== AUTH ====================

@router.post("/auth/device", response_model=TimbanganAuthResponse)
def auth_device(body: TimbanganAuthRequest):
    if body.password == settings.timbangan_device_menu_password:
        return {"success": True}
    return {"success": False, "error": "Invalid password"}


# ==================== ANALYTICS ====================

@router.get("/analytics/overview", response_model=TimbanganAnalyticsOverviewResponse)
def analytics_overview(
    date_range: str = Query("7days", alias="range"),
    start_date: str = Query(None),
    end_date:   str = Query(None),
    _: User = Depends(require_permission("report.view")),
    db: Session = Depends(get_sync_db),
):
    end_dt = datetime.now()
    if date_range == "today":
        start_dt = end_dt.replace(hour=0, minute=0, second=0, microsecond=0)
    elif date_range == "7days":
        start_dt = end_dt - timedelta(days=7)
    elif date_range == "30days":
        start_dt = end_dt - timedelta(days=30)
    elif date_range == "custom":
        if not start_date or not end_date:
            raise HTTPException(status_code=400, detail="start_date and end_date required")
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt   = datetime.strptime(end_date,   "%Y-%m-%d").replace(hour=23, minute=59, second=59)
    else:
        start_dt = end_dt - timedelta(days=7)

    data         = TimbanganService.get_analytics_overview(
        db,
        start_dt.strftime("%Y-%m-%d %H:%M:%S"),
        end_dt.strftime("%Y-%m-%d %H:%M:%S")
    )
    unit_series = defaultdict(list)
    for row in data["time_series"]:
        tb, uid, uname, cnt, avg_w, min_w, max_w, tot_w = row
        unit_series[uname if uname else "Unassigned"].append({
            "time":         str(tb),
            "count":        cnt,
            "avg_weight":   round(avg_w,  2) if avg_w  else 0,
            "total_weight": round(tot_w, 2) if tot_w else 0
        })

    heatmap = [[0] * 24 for _ in range(7)]
    for day, hour, cnt in data["heatmap_data"]:
        heatmap[int(day)][int(hour)] = cnt

    return {
        "summary":           data["summary"],
        "time_series":       dict(unit_series),
        "device_comparison": [
            {"device_id": str(uid), "device_name": uname, "count": cnt}
            for uid, uname, cnt in data["device_counts"]
        ],
        "heatmap": heatmap,
        "range":   date_range
    }


@router.get("/analytics/unit/{unit_id}", response_model=TimbanganDeviceAnalyticsResponse)
def analytics_unit(
    unit_id:    UUID,
    date_range: str = Query("7days", alias="range"),
    start_date: str = Query(None),
    end_date:   str = Query(None),
    _: User = Depends(require_permission("report.view")),
    db: Session = Depends(get_sync_db),
):
    end_dt = datetime.now()
    if date_range == "today":
        start_dt = end_dt.replace(hour=0, minute=0, second=0, microsecond=0)
    elif date_range == "7days":
        start_dt = end_dt - timedelta(days=7)
    elif date_range == "30days":
        start_dt = end_dt - timedelta(days=30)
    elif date_range == "custom":
        if not start_date or not end_date:
            raise HTTPException(status_code=400, detail="start_date and end_date required")
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt   = datetime.strptime(end_date,   "%Y-%m-%d").replace(hour=23, minute=59, second=59)
    else:
        start_dt = end_dt - timedelta(days=7)

    data = TimbanganService.get_unit_analytics(
        db, unit_id,
        start_dt.strftime("%Y-%m-%d %H:%M:%S"),
        end_dt.strftime("%Y-%m-%d %H:%M:%S")
    )

    return {
        "time_series": [{"time": str(t), "weight": w} for t, w in data["time_series"]],
        "daily_data":  [{"date": str(d), "count": c, "avg_weight": round(a, 2)} for d, c, a in data["daily_data"]],
        "usage_data":  [{"system": s, "count": c} for s, c in data["usage_data"]]
    }


# ==================== OTA ====================

@router.get("/ota/firmware", response_model=List[TimbanganFirmwareResponse])
def list_firmware(
    _: User = Depends(require_permission("timbangan.ota")),
    db: Session = Depends(get_sync_db),
):
    return TimbanganService.list_firmware(db)


@router.get("/ota/firmware/active", response_model=Optional[TimbanganFirmwareResponse])
def get_active_firmware(
    _: User = Depends(require_permission("timbangan.ota")),
    db: Session = Depends(get_sync_db),
):
    return TimbanganService.get_active_firmware(db)


@router.post("/ota/firmware", status_code=201)
async def upload_firmware(
    version:     str        = Form(...),
    description: str        = Form(None),
    file:        UploadFile = File(...),
    _: User = Depends(require_permission("timbangan.ota")),
    db: Session = Depends(get_sync_db),
):
    if not file.filename.endswith(".bin"):
        raise HTTPException(status_code=400, detail="File harus .bin")

    version = version.strip()
    if not version:
        raise HTTPException(status_code=400, detail="Version tidak boleh kosong")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="File kosong")

    fw, err = TimbanganService.upload_firmware(
        db, version, file.filename, file_bytes, description
    )
    if err:
        raise HTTPException(status_code=400, detail=err)

    return {
        "success":     True,
        "firmware_id": fw.id,
        "version":     fw.version,
        "size":        fw.size,
        "checksum":    fw.checksum
    }


@router.post("/ota/firmware/{firmware_id}/activate")
def activate_firmware(
    firmware_id: int,
    _: User = Depends(require_permission("timbangan.ota")),
    db: Session = Depends(get_sync_db),
):
    ok, err = TimbanganService.set_active_firmware(db, firmware_id)
    if not ok:
        raise HTTPException(status_code=400, detail=err)
    fw = TimbanganService.get_firmware(db, firmware_id)
    return {"success": True, "active_version": fw.version}


@router.delete("/ota/firmware/{firmware_id}", status_code=204)
def delete_firmware(
    firmware_id: int,
    _: User = Depends(require_permission("timbangan.ota")),
    db: Session = Depends(get_sync_db),
):
    ok, err = TimbanganService.delete_firmware(db, firmware_id)
    if not ok:
        raise HTTPException(status_code=400, detail=err)


@router.get("/ota/dl/{firmware_id}/{sig}")
def download_firmware_public(
    firmware_id: int,
    sig: str,
    db: Session = Depends(get_sync_db),
):
    """Public endpoint for ESP32 OTA — no JWT needed, secured via HMAC signature."""
    if not hmac.compare_digest(_ota_sign(firmware_id), sig):
        raise HTTPException(status_code=403, detail="Invalid download token")

    fw = TimbanganService.get_firmware(db, firmware_id)
    if not fw:
        raise HTTPException(status_code=404, detail="Firmware not found")
    if not os.path.exists(fw.filepath):
        raise HTTPException(status_code=404, detail="Firmware file not found on disk")

    return FileResponse(
        path=fw.filepath,
        filename=fw.filename,
        media_type="application/octet-stream",
        headers={
            "X-Firmware-Version":  fw.version,
            "X-Firmware-Checksum": fw.checksum,
            "X-Firmware-Size":     str(fw.size)
        }
    )


@router.get("/ota/download/{firmware_id}")
def download_firmware(
    firmware_id: int,
    _: User = Depends(require_permission("timbangan.ota")),
    db: Session = Depends(get_sync_db),
):
    fw = TimbanganService.get_firmware(db, firmware_id)
    if not fw:
        raise HTTPException(status_code=404, detail="Firmware not found")
    if not os.path.exists(fw.filepath):
        raise HTTPException(status_code=404, detail="Firmware file not found on disk")

    return FileResponse(
        path=fw.filepath,
        filename=fw.filename,
        media_type="application/octet-stream",
        headers={
            "X-Firmware-Version":  fw.version,
            "X-Firmware-Checksum": fw.checksum,
            "X-Firmware-Size":     str(fw.size)
        }
    )


@router.post("/ota/trigger")
def trigger_ota(
    req: TimbanganOTARequest,
    _: User = Depends(require_permission("timbangan.ota")),
    db: Session = Depends(get_sync_db),
):
    from app.core.mqtt import mqtt_client

    t  = TimbanganService.get_by_id(db, req.device_id)
    fw = TimbanganService.get_firmware(db, req.firmware_id)

    if not t:
        raise HTTPException(status_code=404, detail="Device not found")
    if not fw:
        raise HTTPException(status_code=404, detail="Firmware not found")
    if not os.path.exists(fw.filepath):
        raise HTTPException(status_code=400, detail="Firmware file not found")
    if not mqtt_client.connected:
        raise HTTPException(status_code=503, detail="MQTT not connected")

    from app.models import Device
    device       = db.get(Device, t.device_id)
    safe_name    = TimbanganService.safe_topic(device.name)
    topic        = f"ota/{safe_name}"
    sig          = _ota_sign(fw.id)
    download_url = f"{settings.timbangan_ota_base_url}/api/timbangan/ota/dl/{fw.id}/{sig}"

    mqtt_client.publish(topic, json.dumps({
        "url":      download_url,
        "version":  fw.version,
        "checksum": fw.checksum,
        "size":     fw.size
    }), qos=1)

    DeviceEventService.record(
        type_="firmware",
        title=f"Update Firmware {device.name}",
        message=f"OTA {fw.version} dikirim ke {device.name}.",
        device_name=device.name,
    )
    NotificationService.notify_firmware_async(
        device_id=device.id,
        device_name=device.name,
        location_id=device.location_id,
        version=fw.version,
    )

    return {
        "success":          True,
        "device":           device.name,
        "firmware_version": fw.version,
        "mqtt_topic":       topic,
        "download_url":     download_url
    }


@router.post("/ota/broadcast")
def broadcast_ota(
    req: TimbanganOTABroadcastRequest,
    _: User = Depends(require_permission("timbangan.ota")),
    db: Session = Depends(get_sync_db),
):
    from app.core.mqtt import mqtt_client
    from app.models import Device

    fw = TimbanganService.get_firmware(db, req.firmware_id)
    if not fw:
        raise HTTPException(status_code=404, detail="Firmware not found")
    if not os.path.exists(fw.filepath):
        raise HTTPException(status_code=400, detail="Firmware file not found")
    if not mqtt_client.connected:
        raise HTTPException(status_code=503, detail="MQTT not connected")

    timbangans   = TimbanganService.get_all(db)
    sig          = _ota_sign(fw.id)
    download_url = f"{settings.timbangan_ota_base_url}/api/timbangan/ota/dl/{fw.id}/{sig}"
    payload      = json.dumps({
        "url":      download_url,
        "version":  fw.version,
        "checksum": fw.checksum,
        "size":     fw.size
    })
    triggered = []

    for t in timbangans:
        device = db.get(Device, t.device_id)
        if not device:
            continue
        topic = f"ota/{TimbanganService.safe_topic(device.name)}"
        mqtt_client.publish(topic, payload, qos=1)
        triggered.append(device.name)
        DeviceEventService.record(
            type_="firmware",
            title=f"Update Firmware {device.name}",
            message=f"OTA {fw.version} dikirim ke {device.name}.",
            device_name=device.name,
        )
        NotificationService.notify_firmware_async(
            device_id=device.id,
            device_name=device.name,
            location_id=device.location_id,
            version=fw.version,
        )

    return {
        "success":           True,
        "firmware_version":  fw.version,
        "devices_triggered": triggered,
        "count":             len(triggered)
    }