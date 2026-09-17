from app.core.logging import get_logger
from uuid import UUID

from sqlalchemy import select, delete, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Location, User, UserLocation
from app.modules.locations.schemas import LocationCreate, LocationUpdate

logger = get_logger(__name__)


class LocationService:

    @staticmethod
    async def list_locations(
        db: AsyncSession,
        allowed_ids: list[UUID] | None = None,
    ) -> list[Location]:
        query = select(Location).where(Location.is_active == True)
        if allowed_ids is not None:
            query = query.where(Location.id.in_(allowed_ids))
        result = await db.execute(query.order_by(Location.name))
        return result.scalars().all()

    @staticmethod
    async def get_by_id(db: AsyncSession, location_id: UUID) -> Location | None:
        result = await db.execute(select(Location).where(Location.id == location_id))
        return result.scalar_one_or_none()

    @staticmethod
    async def create_location(db: AsyncSession, data: LocationCreate) -> Location:
        location = Location(name=data.name, address=data.address)
        db.add(location)
        await db.commit()
        await db.refresh(location)
        return location

    @staticmethod
    async def update_location(
        db: AsyncSession, location: Location, data: LocationUpdate
    ) -> Location:
        for field, value in data.model_dump(exclude_none=True).items():
            setattr(location, field, value)
        await db.commit()
        await db.refresh(location)
        return location

    # ==================== USER ASSIGNMENT ====================

    @staticmethod
    async def get_location_users(db: AsyncSession, location_id: UUID) -> list[dict]:
        result = await db.execute(
            select(User, UserLocation.assigned_at)
            .join(UserLocation, UserLocation.user_id == User.id)
            .where(
                UserLocation.location_id == location_id,
                User.is_active == True,
            )
            .order_by(UserLocation.assigned_at.desc())
        )
        return [
            {
                "user_id": user.id,
                "display_name": user.display_name,
                "email": user.email,
                "role": user.role,
                "assigned_at": assigned_at,
            }
            for user, assigned_at in result.fetchall()
        ]

    @staticmethod
    async def assign_user(
        db: AsyncSession,
        location_id: UUID,
        user_id: UUID,
        assigned_by: UUID,
    ) -> bool:
        existing = await db.execute(
            select(UserLocation).where(
                and_(
                    UserLocation.location_id == location_id,
                    UserLocation.user_id == user_id,
                )
            )
        )
        if existing.scalar_one_or_none():
            return False  # sudah assigned

        entry = UserLocation(
            location_id=location_id,
            user_id=user_id,
            assigned_by=assigned_by,
        )
        db.add(entry)
        await db.commit()
        return True

    @staticmethod
    async def unassign_user(
        db: AsyncSession, location_id: UUID, user_id: UUID
    ) -> bool:
        result = await db.execute(
            delete(UserLocation).where(
                and_(
                    UserLocation.location_id == location_id,
                    UserLocation.user_id == user_id,
                )
            )
        )
        await db.commit()
        return result.rowcount > 0

    @staticmethod
    async def get_user_location_ids(db: AsyncSession, user_id: UUID) -> list[UUID]:
        result = await db.execute(
            select(UserLocation.location_id).where(UserLocation.user_id == user_id)
        )
        return [row[0] for row in result.fetchall()]
