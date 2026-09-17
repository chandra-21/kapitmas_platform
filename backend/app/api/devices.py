from app.core.logging import get_logger
from typing import List, Optional
from uuid import UUID
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_sync_db, get_async_db
from app.models import Device, DeviceUnitHistory
from app.schemas.device import DeviceResponse, DeviceStatusResponse, DeviceUpdate
from app.modules.auth.dependencies import require_admin

logger = get_logger(__name__)

router = APIRouter(prefix="/devices", tags=["Devices"])


class DeviceUnitHistoryResponse(BaseModel):
    id:            str
    device_id:     Optional[str]
    device_name:   str
    device_mac:    str
    unit_id:       Optional[str]
    unit_code:     str
    unit_name:     str
    unit_type:     str
    location_id:   Optional[str]
    location_name: Optional[str]
    assigned_at:   datetime
    released_at:   Optional[datetime]


@router.get("", response_model=List[DeviceResponse])
def list_all_devices(db: Session = Depends(get_sync_db)):
    """List semua device dari semua tipe dengan resolved location name."""
    from app.models import Location
    devices = db.execute(
        select(Device).order_by(Device.registered_at.desc())
    ).scalars().all()

    loc_ids = [d.location_id for d in devices if d.location_id]
    loc_map: dict = {}
    if loc_ids:
        locs = db.execute(
            select(Location).where(Location.id.in_(loc_ids))
        ).scalars().all()
        loc_map = {str(loc.id): loc.name for loc in locs}

    return [
        {
            "id":            str(d.id),
            "mac":           d.mac,
            "name":          d.name,
            "type":          d.type,
            "location_id":   str(d.location_id) if d.location_id else None,
            "location_name": loc_map.get(str(d.location_id)) if d.location_id else None,
            "firmware":      d.firmware,
            "ip_address":    d.ip_address,
            "chip":          d.chip,
            "online":        d.online,
            "last_seen":     d.last_seen,
            "registered_at": d.registered_at,
            "config":        d.config,
        }
        for d in devices
    ]


@router.get("/{device_id}", response_model=DeviceResponse)
def get_device(device_id: UUID, db: Session = Depends(get_sync_db)):
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


@router.put("/{device_id}", response_model=dict)
def update_device(
    device_id: UUID,
    body:      DeviceUpdate,
    db:        Session = Depends(get_sync_db)
):
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    if body.name is not None:
        duplicate = db.execute(
            select(Device).where(Device.name == body.name)
        ).scalar_one_or_none()
        if duplicate and duplicate.id != device_id:
            raise HTTPException(status_code=400, detail="Name already exists")
        device.name = body.name

    if body.location_id is not None:
        device.location_id = body.location_id

    db.commit()
    return {"success": True}


@router.delete("/{device_id}", status_code=204)
def delete_device(device_id: UUID, db: Session = Depends(get_sync_db)):
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    try:
        db.delete(device)
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{device_id}/unit-history", response_model=List[DeviceUnitHistoryResponse])
async def get_device_unit_history(
    device_id: UUID,
    _: object = Depends(require_admin),
    db: AsyncSession = Depends(get_async_db),
):
    """Riwayat assignment device ke asset unit, urut terbaru ke terlama."""
    result = await db.execute(
        select(DeviceUnitHistory)
        .where(DeviceUnitHistory.device_id == device_id)
        .order_by(DeviceUnitHistory.assigned_at.desc())
    )
    rows = result.scalars().all()
    return [
        {
            "id":            str(r.id),
            "device_id":     str(r.device_id) if r.device_id else None,
            "device_name":   r.device_name,
            "device_mac":    r.device_mac,
            "unit_id":       str(r.unit_id) if r.unit_id else None,
            "unit_code":     r.unit_code,
            "unit_name":     r.unit_name,
            "unit_type":     r.unit_type,
            "location_id":   str(r.location_id) if r.location_id else None,
            "location_name": r.location_name,
            "assigned_at":   r.assigned_at,
            "released_at":   r.released_at,
        }
        for r in rows
    ]


@router.get("/{mac}/status", response_model=DeviceStatusResponse)
def get_device_status_by_mac(mac: str, db: Session = Depends(get_sync_db)):
    """
    Get status device by MAC address.
    Dipakai PWA untuk polling saat provisioning.
    """
    device = db.execute(
        select(Device).where(Device.mac == mac)
    ).scalar_one_or_none()

    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    return device