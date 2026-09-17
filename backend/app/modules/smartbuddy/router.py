from app.core.logging import get_logger
import hashlib
import hmac
import json
import os
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse, FileResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.core.sse import sse_manager
from app.db.session import get_sync_db
from app.models import Device
from app.models.user import User
from app.modules.auth.dependencies import (
    get_current_user, get_current_user_sse, require_permission, require_admin,
    get_allowed_location_ids,
)
from app.modules.smartbuddy.mqtt_handler import SmartBuddyMQTTHandler
from app.modules.smartbuddy.service import SmartBuddyService
from app.schemas.smartbuddy import (
    SmartBuddyDeviceResponse,
    SmartBuddyFirmwareResponse,
    SmartBuddyUpdateRequest,
    ACCommandRequest,
    LampCommandRequest,
    ScheduleUpdateRequest,
    IRLearnRequest,
    SmartBuddyOTARequest,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/smartbuddy", tags=["SmartBuddy"])


def _ota_sign(firmware_id: int) -> str:
    key = settings.smartbuddy_ota_download_secret.encode()
    return hmac.new(key, str(firmware_id).encode(), hashlib.sha256).hexdigest()[:16]


def _get_sb_or_404(db: Session, sb_id: int):
    sb = SmartBuddyService.get_by_id(db, sb_id)
    if not sb:
        raise HTTPException(status_code=404, detail="SmartBuddy device tidak ditemukan")
    return sb


def _check_location_access(sb, allowed_ids, db: Session) -> None:
    """Raise 403 jika device berada di luar lokasi yang diizinkan untuk user ini."""
    if allowed_ids is None:
        return
    device = db.get(Device, sb.device_id)
    if device.location_id is None or device.location_id not in allowed_ids:
        raise HTTPException(status_code=403, detail="Akses ditolak: device bukan di lokasi Anda")


# ==================== SSE ====================

@router.get("/events")
async def sse_stream(current_user: User = Depends(get_current_user_sse)):
    """SSE realtime stream untuk semua event SmartBuddy."""
    async def generator():
        q = await sse_manager.subscribe()
        try:
            while True:
                import asyncio
                try:
                    data = await asyncio.wait_for(q.get(), timeout=30.0)
                    # Filter hanya event SmartBuddy
                    if str(data.get("type", "")).startswith("smartbuddy"):
                        yield f"data: {json.dumps(data)}\n\n"
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            await sse_manager.unsubscribe(q)

    return StreamingResponse(generator(), media_type="text/event-stream")


# ==================== LIST & DETAIL ====================

@router.get("/status", response_model=List[SmartBuddyDeviceResponse])
def list_devices(
    _:           User           = Depends(require_permission("smartbuddy.view")),
    allowed_ids: list | None   = Depends(get_allowed_location_ids),
    db:          Session        = Depends(get_sync_db),
):
    """List SmartBuddy device — PIC hanya melihat device di lokasi yang diizinkan."""
    devices = SmartBuddyService.get_all(db, location_ids=allowed_ids)
    return [SmartBuddyService.get_full(db, sb) for sb in devices]


@router.get("/{sb_id}", response_model=SmartBuddyDeviceResponse)
def get_device(
    sb_id:       int,
    _:           User           = Depends(require_permission("smartbuddy.view")),
    allowed_ids: list | None   = Depends(get_allowed_location_ids),
    db:          Session        = Depends(get_sync_db),
):
    sb = _get_sb_or_404(db, sb_id)
    _check_location_access(sb, allowed_ids, db)
    return SmartBuddyService.get_full(db, sb)


@router.put("/{sb_id}", response_model=dict)
def update_device(
    sb_id:       int,
    body:        SmartBuddyUpdateRequest,
    _:           User           = Depends(require_permission("smartbuddy.control")),
    allowed_ids: list | None   = Depends(get_allowed_location_ids),
    db:          Session        = Depends(get_sync_db),
):
    sb = _get_sb_or_404(db, sb_id)
    _check_location_access(sb, allowed_ids, db)
    ok, err = SmartBuddyService.update_device(db, sb_id, body.name, body.location)
    if not ok:
        raise HTTPException(status_code=400, detail=err)
    return {"success": True}


@router.delete("/{sb_id}", status_code=204)
def delete_device(
    sb_id: int,
    _:     User    = Depends(require_admin),
    db:    Session = Depends(get_sync_db),
):
    ok, err = SmartBuddyService.delete_device(db, sb_id)
    if not ok:
        raise HTTPException(status_code=404, detail=err)


# ==================== AC CONTROL ====================

@router.post("/{sb_id}/ac/command", response_model=dict)
def send_ac_command(
    sb_id:       int,
    body:        ACCommandRequest,
    _:           User           = Depends(require_permission("smartbuddy.control")),
    allowed_ids: list | None   = Depends(get_allowed_location_ids),
    db:          Session        = Depends(get_sync_db),
):
    """Kirim perintah AC ke device via MQTT. State disimpan ke DB optimistically."""
    sb = _get_sb_or_404(db, sb_id)
    _check_location_access(sb, allowed_ids, db)
    if not sb.has_ac:
        raise HTTPException(status_code=400, detail="Device tidak memiliki AC")

    full = SmartBuddyService.get_full(db, sb)
    device_name = full["name"]

    SmartBuddyService.save_ac_command(
        db, sb,
        power=body.power, mode=body.mode, temp=body.temp,
        fan=body.fan, swing_v=body.swing_v,
    )

    SmartBuddyMQTTHandler.send_ac_command(device_name, {
        "power":   body.power,
        "mode":    body.mode,
        "temp":    body.temp,
        "fan":     body.fan,
        "swing_v": body.swing_v,
    })

    logger.info(f"AC command sent: {device_name} power={body.power} {body.mode} {body.temp}°C")
    return {"success": True, "message": "AC command sent"}


# ==================== AC SYNC ====================

@router.post("/{sb_id}/ac/sync", response_model=dict)
def sync_ac_state(
    sb_id:       int,
    _:           User           = Depends(require_permission("smartbuddy.control")),
    allowed_ids: list | None   = Depends(get_allowed_location_ids),
    db:          Session        = Depends(get_sync_db),
):
    """Push state AC yang tersimpan di DB ke device (force re-apply)."""
    sb = _get_sb_or_404(db, sb_id)
    _check_location_access(sb, allowed_ids, db)
    if not sb.has_ac:
        raise HTTPException(status_code=400, detail="Device tidak memiliki AC")

    device_name = SmartBuddyService.get_full(db, sb)["name"]
    SmartBuddyMQTTHandler.send_ac_sync(device_name, sb)

    logger.info(f"AC sync sent: {device_name}")
    return {"success": True, "message": "AC sync sent"}


# ==================== LAMP CONTROL ====================

@router.post("/{sb_id}/lamp/command", response_model=dict)
def send_lamp_command(
    sb_id:       int,
    body:        LampCommandRequest,
    _:           User           = Depends(require_permission("smartbuddy.control")),
    allowed_ids: list | None   = Depends(get_allowed_location_ids),
    db:          Session        = Depends(get_sync_db),
):
    """Kirim perintah lampu ke device via MQTT."""
    sb = _get_sb_or_404(db, sb_id)
    _check_location_access(sb, allowed_ids, db)
    if not sb.has_lamp:
        raise HTTPException(status_code=400, detail="Device tidak memiliki lamp control")

    device_name = SmartBuddyService.get_full(db, sb)["name"]

    SmartBuddyService.save_lamp_command(
        db, sb,
        power=body.power, mode=body.mode, pir_timeout=body.pir_timeout,
    )

    cmd: dict = {"power": body.power, "mode": body.mode}
    if body.pir_timeout is not None:
        cmd["pir_timeout"] = body.pir_timeout

    SmartBuddyMQTTHandler.send_lamp_command(device_name, cmd)

    logger.info(f"Lamp command sent: {device_name} power={body.power} mode={body.mode}")
    return {"success": True, "message": "Lamp command sent"}


# ==================== SCHEDULE ====================

@router.put("/{sb_id}/schedule", response_model=dict)
def update_schedule(
    sb_id:       int,
    body:        ScheduleUpdateRequest,
    _:           User           = Depends(require_permission("smartbuddy.control")),
    allowed_ids: list | None   = Depends(get_allowed_location_ids),
    db:          Session        = Depends(get_sync_db),
):
    """Simpan jadwal ke DB dan push ke device via MQTT."""
    sb = _get_sb_or_404(db, sb_id)
    _check_location_access(sb, allowed_ids, db)
    device_name = SmartBuddyService.get_full(db, sb)["name"]

    schedules_data = [s.model_dump() for s in body.schedules]
    SmartBuddyService.save_schedules(db, sb, schedules_data)

    # Eksekusi jadwal dihandle oleh backend scheduler — tidak perlu push ke device
    logger.info(f"Schedule updated: {device_name} ({len(schedules_data)} entries)")
    return {"success": True, "message": f"{len(schedules_data)} schedule entries saved"}


# ==================== IR LEARNING ====================

@router.post("/{sb_id}/ir/learn", response_model=dict)
def trigger_ir_learn(
    sb_id:       int,
    body:        IRLearnRequest,
    _:           User           = Depends(require_permission("smartbuddy.control")),
    allowed_ids: list | None   = Depends(get_allowed_location_ids),
    db:          Session        = Depends(get_sync_db),
):
    """Trigger IR learning mode pada device. Hasil dikirim kembali via MQTT ir/result → SSE."""
    sb = _get_sb_or_404(db, sb_id)
    _check_location_access(sb, allowed_ids, db)
    if not sb.has_ac:
        raise HTTPException(status_code=400, detail="Device tidak memiliki AC")
    if not sb.device.online:
        raise HTTPException(status_code=400, detail="Device sedang offline")

    device_name = SmartBuddyService.get_full(db, sb)["name"]
    SmartBuddyMQTTHandler.send_ir_learn(device_name, body.slot)

    logger.info(f"IR learn triggered: {device_name} slot={body.slot}")
    return {
        "success": True,
        "message": f"IR learning mode started for slot '{body.slot}'. "
                   "Hasil akan muncul di SSE event 'smartbuddy_ir_result'."
    }


# ==================== OTA FIRMWARE MANAGEMENT ====================

@router.get("/ota/firmware", response_model=List[SmartBuddyFirmwareResponse])
def list_firmware(
    _: User = Depends(require_admin),
    db: Session = Depends(get_sync_db),
):
    return SmartBuddyService.list_firmware(db)


@router.get("/ota/firmware/active", response_model=Optional[SmartBuddyFirmwareResponse])
def get_active_firmware(
    _: User = Depends(require_admin),
    db: Session = Depends(get_sync_db),
):
    return SmartBuddyService.get_active_firmware(db)


@router.post("/ota/firmware", status_code=201)
async def upload_firmware(
    version:     str        = Form(...),
    description: str        = Form(None),
    file:        UploadFile = File(...),
    _: User = Depends(require_admin),
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

    fw, err = SmartBuddyService.upload_firmware(db, version, file.filename, file_bytes, description)
    if err:
        raise HTTPException(status_code=400, detail=err)

    logger.info(f"Firmware uploaded: SmartBuddy v{fw.version} ({fw.size} bytes)")
    return {"success": True, "firmware_id": fw.id, "version": fw.version,
            "size": fw.size, "checksum": fw.checksum}


@router.post("/ota/firmware/{firmware_id}/activate")
def activate_firmware(
    firmware_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_sync_db),
):
    ok, err = SmartBuddyService.set_active_firmware(db, firmware_id)
    if not ok:
        raise HTTPException(status_code=400, detail=err)
    fw = SmartBuddyService.get_firmware(db, firmware_id)
    return {"success": True, "active_version": fw.version}


@router.delete("/ota/firmware/{firmware_id}", status_code=204)
def delete_firmware(
    firmware_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_sync_db),
):
    ok, err = SmartBuddyService.delete_firmware(db, firmware_id)
    if not ok:
        raise HTTPException(status_code=400, detail=err)


@router.get("/ota/dl/{firmware_id}/{sig}")
def download_firmware_public(
    firmware_id: int,
    sig: str,
    db: Session = Depends(get_sync_db),
):
    """Public endpoint untuk ESP32 OTA download — no JWT, diamankan via HMAC."""
    if not hmac.compare_digest(_ota_sign(firmware_id), sig):
        raise HTTPException(status_code=403, detail="Invalid download token")
    fw = SmartBuddyService.get_firmware(db, firmware_id)
    if not fw or not os.path.exists(fw.filepath):
        raise HTTPException(status_code=404, detail="Firmware not found")
    return FileResponse(
        path=fw.filepath, filename=fw.filename,
        media_type="application/octet-stream",
        headers={
            "X-Firmware-Version":  fw.version,
            "X-Firmware-Checksum": fw.checksum,
            "X-Firmware-Size":     str(fw.size),
        }
    )


@router.post("/ota/trigger")
def trigger_ota_managed(
    sb_id:       int = Form(...),
    firmware_id: int = Form(...),
    _: User = Depends(require_admin),
    db: Session = Depends(get_sync_db),
):
    """Kirim OTA ke device tertentu menggunakan firmware yang sudah diupload."""
    from app.modules.events.service import DeviceEventService

    sb = _get_sb_or_404(db, sb_id)
    fw = SmartBuddyService.get_firmware(db, firmware_id)
    if not fw:
        raise HTTPException(status_code=404, detail="Firmware not found")
    if not os.path.exists(fw.filepath):
        raise HTTPException(status_code=400, detail="Firmware file not found")

    full        = SmartBuddyService.get_full(db, sb)
    device_name = full["name"]
    sig         = _ota_sign(fw.id)
    url         = f"{settings.smartbuddy_ota_base_url}/api/smartbuddy/ota/dl/{fw.id}/{sig}"

    SmartBuddyMQTTHandler.send_ota(device_name, url)

    DeviceEventService.record(
        type_="firmware",
        title=f"Update Firmware {device_name}",
        message=f"SmartBuddy OTA v{fw.version} dikirim ke {device_name}.",
        device_name=device_name,
    )
    logger.info(f"OTA triggered: {device_name} v{fw.version}")
    return {"success": True, "device": device_name, "firmware_version": fw.version, "url": url}


@router.post("/ota/broadcast")
def broadcast_ota(
    firmware_id: int = Form(...),
    _: User = Depends(require_admin),
    db: Session = Depends(get_sync_db),
):
    """Kirim OTA ke semua SmartBuddy device yang online."""
    from app.models import Device

    fw = SmartBuddyService.get_firmware(db, firmware_id)
    if not fw or not os.path.exists(fw.filepath):
        raise HTTPException(status_code=400, detail="Firmware not found")

    sig  = _ota_sign(fw.id)
    url  = f"{settings.smartbuddy_ota_base_url}/api/smartbuddy/ota/dl/{fw.id}/{sig}"

    devices = SmartBuddyService.get_all(db)
    triggered = []
    for sb in devices:
        device: Device = sb.device or db.get(Device, sb.device_id)
        if not device.online:
            continue
        SmartBuddyMQTTHandler.send_ota(device.name, url)
        triggered.append(device.name)

    logger.info(f"OTA broadcast: v{fw.version} → {len(triggered)} devices")
    return {"success": True, "firmware_version": fw.version,
            "devices_triggered": triggered}


