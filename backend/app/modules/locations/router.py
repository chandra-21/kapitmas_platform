from app.core.logging import get_logger
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_db
from app.modules.auth.dependencies import (
    get_current_user, require_admin, get_allowed_location_ids, require_permission,
)
from app.models.user import User
from app.modules.locations.schemas import (
    LocationCreate, LocationUpdate, LocationResponse,
    AssignUserRequest, UnassignUserRequest, LocationUserResponse,
)
from app.modules.locations.service import LocationService
from app.modules.users.service import UserService

router = APIRouter(prefix="/locations", tags=["Locations"])
logger = get_logger(__name__)


@router.get("/public", response_model=list[dict])
async def list_locations_public(db: AsyncSession = Depends(get_async_db)):
    """Endpoint publik tanpa auth — dipakai mobile provisioning app untuk mengambil daftar lokasi."""
    from sqlalchemy import select as sa_select
    from app.models.user import Location
    result = await db.execute(
        sa_select(Location.id, Location.name)
        .where(Location.is_active == True)
        .order_by(Location.name)
    )
    return [{"id": str(row.id), "name": row.name} for row in result.fetchall()]


@router.get("/", response_model=list[LocationResponse])
async def list_locations(
    _: User = Depends(require_permission("location.view")),
    allowed_ids: list[UUID] | None = Depends(get_allowed_location_ids),
    db: AsyncSession = Depends(get_async_db),
):
    return await LocationService.list_locations(db, allowed_ids)


@router.post("/", response_model=LocationResponse, status_code=status.HTTP_201_CREATED)
async def create_location(
    data: LocationCreate,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_async_db),
):
    return await LocationService.create_location(db, data)


@router.patch("/{location_id}", response_model=LocationResponse)
async def update_location(
    location_id: UUID,
    data: LocationUpdate,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_async_db),
):
    location = await LocationService.get_by_id(db, location_id)
    if not location:
        raise HTTPException(status_code=404, detail="Lokasi tidak ditemukan")
    return await LocationService.update_location(db, location, data)


@router.get("/{location_id}/users", response_model=list[LocationUserResponse])
async def get_location_users(
    location_id: UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_async_db),
):
    location = await LocationService.get_by_id(db, location_id)
    if not location:
        raise HTTPException(status_code=404, detail="Lokasi tidak ditemukan")
    return await LocationService.get_location_users(db, location_id)


@router.post("/{location_id}/users", status_code=status.HTTP_201_CREATED)
async def assign_user_to_location(
    location_id: UUID,
    data: AssignUserRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_async_db),
):
    location = await LocationService.get_by_id(db, location_id)
    if not location:
        raise HTTPException(status_code=404, detail="Lokasi tidak ditemukan")

    user = await UserService.get_by_id(db, data.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")

    assigned = await LocationService.assign_user(
        db, location_id, data.user_id, current_user.id
    )
    if not assigned:
        return {"message": "User sudah terdaftar di lokasi ini"}
    return {"message": f"User {user.display_name} berhasil ditambahkan ke {location.name}"}


@router.delete("/{location_id}/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unassign_user_from_location(
    location_id: UUID,
    user_id: UUID,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_async_db),
):
    removed = await LocationService.unassign_user(db, location_id, user_id)
    if not removed:
        raise HTTPException(status_code=404, detail="User tidak ditemukan di lokasi ini")
