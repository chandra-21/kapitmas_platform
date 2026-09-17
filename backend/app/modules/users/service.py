from app.core.logging import get_logger
from uuid import UUID

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, UserFCMToken
from app.modules.users.schemas import UserUpdate, ProfileUpdate

logger = get_logger(__name__)


class UserService:

    @staticmethod
    async def list_users(db: AsyncSession) -> list[User]:
        result = await db.execute(select(User).order_by(User.created_at.desc()))
        return result.scalars().all()

    @staticmethod
    async def get_by_id(db: AsyncSession, user_id: UUID) -> User | None:
        result = await db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    @staticmethod
    async def get_by_odoo_uid(db: AsyncSession, odoo_uid: int) -> User | None:
        result = await db.execute(select(User).where(User.odoo_uid == odoo_uid))
        return result.scalar_one_or_none()

    @staticmethod
    async def update_user(db: AsyncSession, user: User, data: UserUpdate) -> User:
        for field, value in data.model_dump(exclude_none=True).items():
            setattr(user, field, value)
        await db.commit()
        await db.refresh(user)
        return user

    @staticmethod
    async def update_profile(db: AsyncSession, user: User, data: ProfileUpdate) -> User:
        for field, value in data.model_dump(exclude_none=True).items():
            setattr(user, field, value)
        await db.commit()
        await db.refresh(user)
        return user

    @staticmethod
    async def deactivate_user(db: AsyncSession, user: User) -> User:
        user.is_active = False
        await db.commit()
        await db.refresh(user)
        return user

    # ==================== FCM TOKENS ====================

    @staticmethod
    async def register_fcm_token(
        db: AsyncSession, user: User, token: str, platform: str
    ) -> UserFCMToken:
        result = await db.execute(select(UserFCMToken).where(UserFCMToken.token == token))
        existing = result.scalar_one_or_none()

        if existing:
            existing.user_id  = user.id
            existing.platform = platform
            await db.commit()
            await db.refresh(existing)
            return existing

        fcm_token = UserFCMToken(user_id=user.id, token=token, platform=platform)
        db.add(fcm_token)
        await db.commit()
        await db.refresh(fcm_token)
        return fcm_token

    @staticmethod
    async def delete_fcm_token(db: AsyncSession, user: User, token: str) -> bool:
        result = await db.execute(
            delete(UserFCMToken).where(
                UserFCMToken.token   == token,
                UserFCMToken.user_id == user.id,
            )
        )
        await db.commit()
        return result.rowcount > 0

    @staticmethod
    async def get_fcm_tokens_by_user_ids(
        db: AsyncSession, user_ids: list[UUID]
    ) -> list[str]:
        if not user_ids:
            return []
        result = await db.execute(
            select(UserFCMToken.token).where(UserFCMToken.user_id.in_(user_ids))
        )
        return [row[0] for row in result.fetchall()]
