from app.core.logging import get_logger
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_sync_db, get_async_db
from app.models import Device, TimbanganDevice, AssetUnit, DeviceUnitHistory
from app.models.user import Location
from app.modules.asset_units.schemas import AssetUnitProvisioningResponse
from app.modules.asset_units.service import AssetUnitService
from app.modules.locations.schemas import LocationResponse
from app.schemas.device import ProvisioningRequest, ProvisioningResponse

logger = get_logger(__name__)

router = APIRouter(prefix="/provisioning", tags=["Provisioning"])


def _sync_close_all_open_history(db: Session, device_id, released_at) -> None:
    """Tutup semua open history untuk device, apa pun unit-nya."""
    from sqlalchemy import update as sa_update, and_
    db.execute(
        sa_update(DeviceUnitHistory)
        .where(and_(
            DeviceUnitHistory.device_id == device_id,
            DeviceUnitHistory.released_at == None,
        ))
        .values(released_at=released_at)
    )


# ==================== DISCOVERY (untuk Flutter app) ====================

@router.get("/locations", response_model=list[LocationResponse])
async def get_provisioning_locations(db: AsyncSession = Depends(get_async_db)):
    """List lokasi aktif untuk dropdown Flutter provisioning app."""
    result = await db.execute(
        select(Location).where(Location.is_active == True).order_by(Location.name)
    )
    return result.scalars().all()


@router.get("/asset-units", response_model=list[AssetUnitProvisioningResponse])
async def get_available_asset_units(
    location_id: Optional[uuid.UUID] = None,
    type:        Optional[str]       = None,
    db:          AsyncSession        = Depends(get_async_db),
):
    """
    List asset units untuk provisioning:
    - Unit kosong (belum ada device)
    - Unit dengan device offline (bisa diganti)
    Field current_device_name/online terisi jika unit sudah ada device offline.
    """
    return await AssetUnitService.list_for_provisioning(db, location_id, type)


# ==================== COMPLETE (dipanggil ESP32) ====================

@router.post("/complete", response_model=ProvisioningResponse)
def provisioning_complete(
    body: ProvisioningRequest,
    db:   Session = Depends(get_sync_db)
):
    """
    Dipanggil oleh ESP32 setelah berhasil connect ke WiFi.
    Upsert device ke tabel devices.
    Kalau ada asset_unit_id, assign device ke unit tersebut.
    """
    try:
        existing = db.execute(
            select(Device).where(Device.mac == body.mac)
        ).scalar_one_or_none()

        now = datetime.now(timezone.utc)

        if existing:
            existing.name       = body.name
            existing.type       = body.type
            existing.firmware   = body.firmware
            existing.chip       = body.chip
            existing.ip_address = body.ip
            existing.online     = True
            existing.last_seen  = now
            device = existing
            logger.info(f"Device re-registered: {body.name} ({body.mac})")
        else:
            device = Device(
                id=uuid.uuid4(),
                mac=body.mac,
                name=body.name,
                type=body.type,
                firmware=body.firmware,
                chip=body.chip,
                ip_address=body.ip,
                online=True,
                last_seen=now,
                registered_at=now
            )
            db.add(device)
            db.flush()
            logger.info(f"New device registered: {body.name} ({body.mac})")

        # Auto-create timbangan_devices jika type=timbangan
        if body.type == "timbangan":
            timbangan_existing = db.execute(
                select(TimbanganDevice).where(TimbanganDevice.device_id == device.id)
            ).scalar_one_or_none()

            if not timbangan_existing:
                timbangan = TimbanganDevice(
                    device_id=device.id,
                    weight=None,
                    timestamp=None,
                    consumed=False
                )
                db.add(timbangan)
                logger.info(f"Created timbangan_device for: {body.name}")

        # Assign ke asset unit jika dikirim dari Flutter
        if body.asset_unit_id:
            asset_unit = db.execute(
                select(AssetUnit).where(AssetUnit.id == body.asset_unit_id)
            ).scalar_one_or_none()

            if asset_unit:
                # Tutup SEMUA open history device ini (apa pun unit-nya),
                # mencegah duplikat open record saat re-provision.
                _sync_close_all_open_history(db, device_id=device.id, released_at=now)

                # Tutup open history device LAMA yang menempati unit ini
                if asset_unit.device_id and asset_unit.device_id != device.id:
                    _sync_close_all_open_history(db, device_id=asset_unit.device_id, released_at=now)

                # Lepas device dari unit lain (jika ada) supaya unit lama jadi available
                old_unit = db.execute(
                    select(AssetUnit).where(
                        AssetUnit.device_id == device.id,
                        AssetUnit.id != asset_unit.id,
                    )
                ).scalar_one_or_none()
                if old_unit:
                    old_unit.device_id = None
                    logger.info(f"Released old unit: {old_unit.unit_id}")

                asset_unit.device_id = device.id

                # Sync location dari asset unit ke device
                if asset_unit.location_id:
                    device.location_id = asset_unit.location_id

                # Buka history baru
                loc_name: str | None = None
                if asset_unit.location_id:
                    loc = db.execute(
                        select(Location).where(Location.id == asset_unit.location_id)
                    ).scalar_one_or_none()
                    if loc:
                        loc_name = loc.name

                db.add(DeviceUnitHistory(
                    id=uuid.uuid4(),
                    device_id=device.id,
                    device_name=device.name,
                    device_mac=device.mac,
                    unit_id=asset_unit.id,
                    unit_code=asset_unit.unit_id,
                    unit_name=asset_unit.name,
                    unit_type=asset_unit.type,
                    location_id=asset_unit.location_id,
                    location_name=loc_name,
                    assigned_at=now,
                    released_at=None,
                ))

                logger.info(f"Device {body.name} assigned to unit {asset_unit.unit_id}")
            else:
                logger.warning(f"asset_unit_id {body.asset_unit_id} not found, skipped")

        db.commit()

        return ProvisioningResponse(
            success=True,
            device_id=str(device.id),
            message=f"Device {body.name} registered successfully"
        )

    except Exception as e:
        db.rollback()
        logger.error(f"Provisioning error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
