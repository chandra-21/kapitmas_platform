from app.core.logging import get_logger
import uuid
from uuid import UUID
from typing import Optional

from fastapi import Depends, Header, HTTPException, Query, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth import verify_access_token
from app.db.session import get_async_db
from app.models.user import User, UserLocation

logger = get_logger(__name__)
security = HTTPBearer()


def _extract_user_id(token: str) -> str:
    payload = verify_access_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise ValueError("Token tidak mengandung user ID")
    return user_id


async def _get_user_from_token(token: str, db: AsyncSession) -> User:
    try:
        user_id = _extract_user_id(token)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token tidak valid atau sudah expired")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User tidak ditemukan atau tidak aktif")

    return user


def _make_api_key_user() -> User:
    u = User()
    u.id = uuid.uuid4()
    u.role = "admin"
    u.is_active = True
    u.display_name = "System"
    return u


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(HTTPBearer(auto_error=False)),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    db: AsyncSession = Depends(get_async_db),
) -> User:
    if x_api_key is not None:
        if not settings.odoo_api_key or x_api_key != settings.odoo_api_key:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API key tidak valid")
        return _make_api_key_user()
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return await _get_user_from_token(credentials.credentials, db)


async def get_current_user_sse(
    token: Optional[str] = Query(None),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(HTTPBearer(auto_error=False)),
    db: AsyncSession = Depends(get_async_db),
) -> User:
    """Auth dependency for SSE — accepts token from Authorization header OR ?token= query param."""
    raw = (credentials.credentials if credentials else None) or token
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token diperlukan")
    return await _get_user_from_token(raw, db)


async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Akses admin diperlukan")
    return current_user


async def require_admin_or_pic(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in ("admin", "pic"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Akses tidak diizinkan")
    return current_user


def require_permission(key: str):
    async def _check(
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_async_db),
    ) -> User:
        if current_user.role == "admin":
            return current_user
        from app.models.user import UserPermission
        from sqlalchemy import select as sa_select
        result = await db.execute(
            sa_select(UserPermission).where(
                UserPermission.user_id == current_user.id,
                UserPermission.permission_key == key,
            )
        )
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Akses ditolak: izin '{key}' diperlukan")
        return current_user
    return _check


async def get_allowed_location_ids(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> list[UUID] | None:
    if current_user.role == "admin":
        return None
    result = await db.execute(
        select(UserLocation.location_id).where(UserLocation.user_id == current_user.id)
    )
    return [row[0] for row in result.fetchall()]
