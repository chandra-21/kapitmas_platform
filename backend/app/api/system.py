import sys
import psutil
from pathlib import Path
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.core.mqtt import mqtt_client
from app.db.session import get_sync_db
from app.models import Device, DeviceEvent

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/health")
def system_health(db: Session = Depends(get_sync_db)):
    """Full system health — CPU, RAM, Disk, MQTT, device counts."""
    cpu_pct = psutil.cpu_percent(interval=0.5)
    ram     = psutil.virtual_memory()
    disk    = psutil.disk_usage(Path.cwd().anchor)

    # Device counts per type
    def _counts(device_type: str) -> dict:
        total  = db.execute(
            select(func.count(Device.id)).where(Device.type == device_type)
        ).scalar() or 0
        online = db.execute(
            select(func.count(Device.id))
            .where(Device.type == device_type, Device.online == True)
        ).scalar() or 0
        return {"total": total, "online": online, "offline": total - online}

    return {
        "cpu": {
            "percent": cpu_pct,
            "cores":   psutil.cpu_count(logical=True),
        },
        "ram": {
            "percent":  ram.percent,
            "used_gb":  round(ram.used  / 1024**3, 2),
            "total_gb": round(ram.total / 1024**3, 2),
        },
        "disk": {
            "percent":  round(disk.used / disk.total * 100, 1),
            "used_gb":  round(disk.used  / 1024**3, 1),
            "total_gb": round(disk.total / 1024**3, 1),
            "free_gb":  round(disk.free  / 1024**3, 1),
        },
        "mqtt": {
            "connected": mqtt_client.connected,
        },
        "devices": {
            "timbangan":  _counts("timbangan"),
            "smartbuddy": _counts("smartbuddy"),
            "lamp":       _counts("lamp"),
            "ac":         _counts("ac"),
        },
    }


@router.get("/activity")
def activity_feed(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_sync_db),
):
    """Recent device activity events for the dashboard feed."""
    rows = db.execute(
        select(DeviceEvent)
        .order_by(DeviceEvent.created_at.desc())
        .limit(limit)
    ).scalars().all()

    return [
        {
            "id":          r.id,
            "type":        r.type,
            "title":       r.title,
            "message":     r.message,
            "device_name": r.device_name,
            "created_at":  r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.get("/notifications")
def notifications_feed(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_sync_db),
):
    """
    Device event log used as the notifications center in the dashboard.
    Uses DeviceEvent (activity log) — no Firebase auth required.
    """
    rows = db.execute(
        select(DeviceEvent)
        .order_by(DeviceEvent.created_at.desc())
        .limit(limit)
    ).scalars().all()

    return [
        {
            "id":          r.id,
            "type":        r.type,
            "title":       r.title,
            "body":        r.message,
            "device_id":   r.device_name,
            "created_at":  r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]
