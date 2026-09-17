from app.core.logging import get_logger
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth import create_access_token
from app.db.session import get_async_db
from app.models.user import User

logger = get_logger(__name__)
router = APIRouter(prefix="/auth", tags=["Auth"])

# odoo_uid khusus untuk hardcoded admin (tidak akan bentrok dengan UID Odoo nyata)
HARDCODED_ADMIN_ODOO_UID = -1


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


async def _get_or_create_user(db: AsyncSession, odoo_uid: int, email: str, display_name: str, role: str) -> User:
    result = await db.execute(select(User).where(User.odoo_uid == odoo_uid))
    user = result.scalar_one_or_none()

    if not user:
        user = User(
            id=uuid.uuid4(),
            odoo_uid=odoo_uid,
            email=email,
            display_name=display_name,
            role=role,
            is_active=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        logger.info(f"Auto-created user: {email} (odoo_uid={odoo_uid}, role={role})")
    else:
        if not user.is_active:
            raise HTTPException(status_code=403, detail="Akun tidak aktif, hubungi admin")
        if user.display_name != display_name:
            user.display_name = display_name
            await db.commit()
            await db.refresh(user)

    return user


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_async_db)):

    # ── 1. Cek hardcoded admin ──────────────────────────────────────────────
    if (
        settings.admin_username
        and settings.admin_password
        and body.username == settings.admin_username
        and body.password == settings.admin_password
    ):
        user = await _get_or_create_user(
            db,
            odoo_uid=HARDCODED_ADMIN_ODOO_UID,
            email=settings.admin_username,
            display_name="Admin",
            role="admin",
        )
        token = create_access_token({"sub": str(user.id), "odoo_uid": HARDCODED_ADMIN_ODOO_UID, "role": "admin"})
        logger.info(f"Hardcoded admin login: {body.username}")
        return LoginResponse(
            access_token=token,
            user={"id": str(user.id), "odoo_uid": user.odoo_uid, "email": user.email,
                  "display_name": user.display_name, "role": user.role},
        )

    # ── 2. Login via Odoo ───────────────────────────────────────────────────
    try:
        async with httpx.AsyncClient(timeout=10.0, verify=False, follow_redirects=True) as client:
            resp = await client.post(
                settings.odoo_login_url,
                data={"login": body.username, "password": body.password},
            )
    except httpx.RequestError as e:
        logger.error(f"Odoo login error: {e}")
        raise HTTPException(status_code=503, detail="Tidak dapat terhubung ke server Odoo")

    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Username atau password salah")

    odoo = resp.json()
    logger.info(f"Odoo response body: {odoo}")

    # Odoo mengembalikan uid: false saat login gagal (tetap 200 OK)
    odoo_uid = odoo.get("uid")
    logger.info(f"Odoo uid value: {odoo_uid!r} (type: {type(odoo_uid).__name__})")

    if not odoo_uid or odoo_uid is False:
        logger.warning(f"Odoo uid falsy, rejecting login")
        raise HTTPException(status_code=401, detail="Username atau password salah")

    odoo_uid     = int(odoo_uid)
    display_name = odoo.get("display_name") or body.username
    email        = odoo.get("username") or body.username

    # Cek apakah UID ini termasuk admin dari env
    admin_uids = {
        int(x.strip()) for x in settings.admin_odoo_uids.split(",") if x.strip().isdigit()
    }
    role = "admin" if odoo_uid in admin_uids else "pic"

    user = await _get_or_create_user(db, odoo_uid, email, display_name, role)

    token = create_access_token({"sub": str(user.id), "odoo_uid": odoo_uid, "role": user.role})

    return LoginResponse(
        access_token=token,
        user={"id": str(user.id), "odoo_uid": user.odoo_uid, "email": user.email,
              "display_name": user.display_name, "role": user.role},
    )
