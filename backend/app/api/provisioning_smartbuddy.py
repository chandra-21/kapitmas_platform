import uuid
from app.core.logging import get_logger
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_sync_db
from app.models import Device, SmartBuddyDevice, AssetUnit, DeviceUnitHistory
from app.models.user import Location
from app.schemas.smartbuddy import (
    SmartBuddyProvisioningRequest,
    SmartBuddyProvisioningResponse,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/provisioning", tags=["Provisioning"])


@router.post("/smartbuddy", response_model=SmartBuddyProvisioningResponse)
def provisioning_smartbuddy(
    body: SmartBuddyProvisioningRequest,
    db:   Session = Depends(get_sync_db),
):
    """
    Dipanggil oleh SmartBuddy ESP32 setelah connect ke WiFi.
    Upsert Device + SmartBuddyDevice, simpan capabilities.
    """
    try:
        now = datetime.now(timezone.utc)

        # Upsert Device via MAC
        existing = db.execute(
            select(Device).where(Device.mac == body.mac)
        ).scalar_one_or_none()

        if existing:
            existing.name       = body.name
            existing.type       = "smartbuddy"
            existing.firmware   = body.firmware
            existing.chip       = body.chip
            existing.ip_address = body.ip
            existing.online     = True
            existing.last_seen  = now
            device = existing
            logger.info(f"SmartBuddy re-registered: {body.name} ({body.mac})")
        else:
            device = Device(
                id=uuid.uuid4(),
                mac=body.mac,
                name=body.name,
                type="smartbuddy",
                firmware=body.firmware,
                chip=body.chip,
                ip_address=body.ip,
                online=True,
                last_seen=now,
                registered_at=now,
            )
            db.add(device)
            db.flush()
            logger.info(f"New SmartBuddy registered: {body.name} ({body.mac})")

        # Upsert SmartBuddyDevice
        sb = db.execute(
            select(SmartBuddyDevice)
            .where(SmartBuddyDevice.device_id == device.id)
        ).scalar_one_or_none()

        if sb:
            sb.has_ac   = body.has_ac
            sb.has_lamp = body.has_lamp
            sb.ac_brand = body.ac_brand
            sb.room_id  = body.room_id or sb.room_id
        else:
            sb = SmartBuddyDevice(
                device_id=device.id,
                has_ac=body.has_ac,
                has_lamp=body.has_lamp,
                ac_brand=body.ac_brand,
                room_id=body.room_id,
            )
            db.add(sb)
            logger.info(f"Created SmartBuddyDevice for: {body.name}")

        # Auto-assign location berdasarkan room_id jika ada
        if body.room_id and not device.location_id:
            loc = db.execute(
                select(Location).where(Location.name.ilike(f"%{body.room_id.replace('_', ' ')}%"))
            ).scalars().first()
            if loc:
                device.location_id = loc.id
                logger.info(f"Location assigned: {body.name} → {loc.name}")

        db.commit()

        return SmartBuddyProvisioningResponse(
            success=True,
            device_id=str(device.id),
            message=f"SmartBuddy {body.name} registered successfully",
        )

    except Exception as e:
        db.rollback()
        logger.error(f"SmartBuddy provisioning error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
