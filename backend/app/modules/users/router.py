from app.core.logging import get_logger
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_db
from app.modules.auth.dependencies import get_current_user, require_admin
from app.models.user import User
from app.modules.users.schemas import (
    UserUpdate, ProfileUpdate,
    UserResponse, FCMTokenRegister, FCMTokenDelete,
)
from app.modules.users.service import UserService

router = APIRouter(prefix="/users", tags=["Users"])
logger = get_logger(__name__)

ALL_PERMISSION_KEYS = [
    "timbangan.view",
    "timbangan.add",
    "timbangan.edit",
    "timbangan.delete",
    "timbangan.ota",
    "location.view",
    "location.manage",
    "report.view",
    "report.export",
]


class PermissionSet(BaseModel):
    permissions: list[str]


@router.get("/", response_model=list[UserResponse])
async def list_users(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_async_db),
):
    return await UserService.list_users(db)


# ==================== AUTH ENDPOINTS (must be before /{user_id} routes) ====================

@router.get("/me/profile", response_model=UserResponse)
async def get_my_profile(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me/profile", response_model=UserResponse)
async def update_my_profile(
    data: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    return await UserService.update_profile(db, current_user, data)


@router.get("/me/permissions", response_model=list[str])
async def get_my_permissions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Returns all permission keys for the current user. Admin gets all keys."""
    if current_user.role == "admin":
        return ALL_PERMISSION_KEYS
    from app.models.user import UserPermission
    result = await db.execute(
        select(UserPermission.permission_key).where(UserPermission.user_id == current_user.id)
    )
    return [row[0] for row in result.fetchall()]


@router.post("/me/fcm-token", status_code=status.HTTP_201_CREATED)
async def register_fcm_token(
    data: FCMTokenRegister,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    await UserService.register_fcm_token(db, current_user, data.token, data.platform)
    return {"message": "FCM token berhasil didaftarkan"}


@router.delete("/me/fcm-token", status_code=status.HTTP_204_NO_CONTENT)
async def delete_fcm_token(
    data: FCMTokenDelete,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    await UserService.delete_fcm_token(db, current_user, data.token)


# ==================== PERMISSION ENDPOINTS (before /{user_id} to avoid path conflicts) ====================

@router.get("/{user_id}/permissions", response_model=list[str])
async def get_user_permissions(
    user_id: UUID,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_async_db),
):
    from app.models.user import UserPermission
    result = await db.execute(
        select(UserPermission.permission_key).where(UserPermission.user_id == user_id)
    )
    return [row[0] for row in result.fetchall()]


@router.put("/{user_id}/permissions", response_model=list[str])
async def set_user_permissions(
    user_id: UUID,
    data: PermissionSet,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_async_db),
):
    from app.models.user import UserPermission
    await db.execute(delete(UserPermission).where(UserPermission.user_id == user_id))
    for key in data.permissions:
        db.add(UserPermission(user_id=user_id, permission_key=key, granted_by=current_user.id))
    await db.commit()
    return data.permissions


# ==================== USER CRUD (admin only) ====================

@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_async_db),
):
    user = await UserService.get_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    return user


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: UUID,
    data: UserUpdate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_async_db),
):
    user = await UserService.get_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    return await UserService.update_user(db, user, data)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_user(
    user_id: UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_async_db),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Tidak bisa menonaktifkan akun sendiri")
    user = await UserService.get_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    await UserService.deactivate_user(db, user)
