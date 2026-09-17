from app.core.logging import get_logger
from datetime import datetime, timezone
from uuid import UUID
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_db
from app.modules.auth.dependencies import require_admin
from app.modules.asset_units.schemas import (
    AssetUnitCreate, AssetUnitUpdate, AssetUnitResponse, AssetUnitAssignRequest,
)
from app.modules.asset_units.service import AssetUnitService, _close_all_open_history

router = APIRouter(prefix="/asset-units", tags=["Asset Units"])
logger = get_logger(__name__)


@router.get("/", response_model=list[AssetUnitResponse])
async def list_asset_units(
    location_id: Optional[UUID] = None,
    type:        Optional[str]  = Query(None),
    _:           object         = Depends(require_admin),
    db:          AsyncSession   = Depends(get_async_db),
):
    return await AssetUnitService.list_all(db, location_id, type)


@router.post("/", response_model=AssetUnitResponse, status_code=status.HTTP_201_CREATED)
async def create_asset_unit(
    data: AssetUnitCreate,
    _:    object       = Depends(require_admin),
    db:   AsyncSession = Depends(get_async_db),
):
    existing = await AssetUnitService.get_by_unit_id(db, data.unit_id)
    if existing:
        raise HTTPException(status_code=409, detail=f"Unit ID '{data.unit_id}' sudah ada")
    return await AssetUnitService.create(db, data)


@router.patch("/{unit_id}", response_model=AssetUnitResponse)
async def update_asset_unit(
    unit_id: UUID,
    data:    AssetUnitUpdate,
    _:       object       = Depends(require_admin),
    db:      AsyncSession = Depends(get_async_db),
):
    unit = await AssetUnitService.get_by_id(db, unit_id)
    if not unit:
        raise HTTPException(status_code=404, detail="Asset unit tidak ditemukan")
    return await AssetUnitService.update(db, unit, data)


@router.post("/{unit_id}/assign", response_model=AssetUnitResponse)
async def assign_device(
    unit_id: UUID,
    data:    AssetUnitAssignRequest,
    _:       object       = Depends(require_admin),
    db:      AsyncSession = Depends(get_async_db),
):
    unit = await AssetUnitService.get_by_id(db, unit_id)
    if not unit:
        raise HTTPException(status_code=404, detail="Asset unit tidak ditemukan")
    if data.device_id is None:
        if unit.device_id:
            await _close_all_open_history(db, device_id=unit.device_id, released_at=datetime.now(timezone.utc))
        unit.device_id = None
        await db.commit()
        return await AssetUnitService.get_full(db, unit_id)
    return await AssetUnitService.assign_device(db, unit, data.device_id)


@router.delete("/{unit_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_asset_unit(
    unit_id: UUID,
    _:       object       = Depends(require_admin),
    db:      AsyncSession = Depends(get_async_db),
):
    unit = await AssetUnitService.get_by_id(db, unit_id)
    if not unit:
        raise HTTPException(status_code=404, detail="Asset unit tidak ditemukan")
    if unit.device_id:
        raise HTTPException(
            status_code=409,
            detail="Unit masih ter-assign ke device. Unpair device terlebih dahulu."
        )
    await AssetUnitService.delete(db, unit)
