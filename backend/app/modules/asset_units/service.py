from app.core.logging import get_logger
import uuid as _uuid
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select, and_, or_, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset_unit import AssetUnit
from app.models.device_unit_history import DeviceUnitHistory
from app.models.user import Location
from app.models.device import Device
from app.modules.asset_units.schemas import AssetUnitCreate, AssetUnitUpdate

logger = get_logger(__name__)


class AssetUnitService:

    @staticmethod
    async def list_all(db: AsyncSession, location_id: UUID | None = None, type: str | None = None) -> list[dict]:
        query = (
            select(AssetUnit, Location.name, Device.name)
            .outerjoin(Location, Location.id == AssetUnit.location_id)
            .outerjoin(Device,   Device.id   == AssetUnit.device_id)
        )
        if location_id:
            query = query.where(AssetUnit.location_id == location_id)
        if type:
            query = query.where(AssetUnit.type == type)

        result = await db.execute(query.order_by(AssetUnit.unit_id))
        return [
            _build_response(unit, loc_name, dev_name)
            for unit, loc_name, dev_name in result.fetchall()
        ]

    @staticmethod
    async def list_available(
        db: AsyncSession,
        location_id: UUID | None = None,
        type: str | None = None,
    ) -> list[AssetUnit]:
        query = select(AssetUnit).where(
            and_(AssetUnit.is_active == True, AssetUnit.device_id == None)
        )
        if location_id:
            query = query.where(AssetUnit.location_id == location_id)
        if type:
            query = query.where(AssetUnit.type == type)

        result = await db.execute(query.order_by(AssetUnit.unit_id))
        return result.scalars().all()

    @staticmethod
    async def list_for_provisioning(
        db: AsyncSession,
        location_id: UUID | None = None,
        type: str | None = None,
    ) -> list[dict]:
        """Return unit kosong + unit yang device-nya offline (dapat diganti saat provisioning)."""
        query = (
            select(AssetUnit, Device.name, Device.online)
            .outerjoin(Device, Device.id == AssetUnit.device_id)
            .where(AssetUnit.is_active == True)
            .where(
                or_(
                    AssetUnit.device_id == None,
                    Device.online == False,
                )
            )
        )
        if location_id:
            query = query.where(AssetUnit.location_id == location_id)
        if type:
            query = query.where(AssetUnit.type == type)

        result = await db.execute(query.order_by(AssetUnit.unit_id))
        return [
            {
                "id":                    unit.id,
                "unit_id":               unit.unit_id,
                "name":                  unit.name,
                "type":                  unit.type,
                "current_device_name":   dev_name,
                "current_device_online": dev_online,
            }
            for unit, dev_name, dev_online in result.fetchall()
        ]

    @staticmethod
    async def get_by_id(db: AsyncSession, unit_id: UUID) -> AssetUnit | None:
        result = await db.execute(select(AssetUnit).where(AssetUnit.id == unit_id))
        return result.scalar_one_or_none()

    @staticmethod
    async def get_full(db: AsyncSession, unit_id: UUID) -> dict | None:
        result = await db.execute(
            select(AssetUnit, Location.name, Device.name)
            .outerjoin(Location, Location.id == AssetUnit.location_id)
            .outerjoin(Device,   Device.id   == AssetUnit.device_id)
            .where(AssetUnit.id == unit_id)
        )
        row = result.first()
        if not row:
            return None
        unit, loc_name, dev_name = row
        return _build_response(unit, loc_name, dev_name)

    @staticmethod
    async def get_by_unit_id(db: AsyncSession, unit_id: str) -> AssetUnit | None:
        result = await db.execute(select(AssetUnit).where(AssetUnit.unit_id == unit_id))
        return result.scalar_one_or_none()

    @staticmethod
    async def get_by_device_id(db: AsyncSession, device_id: UUID) -> AssetUnit | None:
        result = await db.execute(select(AssetUnit).where(AssetUnit.device_id == device_id))
        return result.scalar_one_or_none()

    @staticmethod
    async def create(db: AsyncSession, data: AssetUnitCreate) -> dict:
        unit = AssetUnit(
            unit_id=data.unit_id,
            name=data.name,
            type=data.type,
            location_id=data.location_id,
        )
        db.add(unit)
        await db.commit()
        await db.refresh(unit)
        logger.info(f"AssetUnit created: {unit.unit_id} (type={unit.type})")
        return await AssetUnitService.get_full(db, unit.id)

    @staticmethod
    async def update(db: AsyncSession, unit: AssetUnit, data: AssetUnitUpdate) -> dict:
        for field, value in data.model_dump(exclude_none=True).items():
            setattr(unit, field, value)
        await db.commit()
        await db.refresh(unit)
        return await AssetUnitService.get_full(db, unit.id)

    @staticmethod
    async def delete(db: AsyncSession, unit: AssetUnit) -> None:
        await db.delete(unit)
        await db.commit()

    @staticmethod
    async def assign_device(db: AsyncSession, unit: AssetUnit, device_id: UUID) -> dict:
        now = datetime.now(timezone.utc)

        # 1. Tutup SEMUA open history device ini (apa pun unit-nya) → mencegah
        # duplikat open record saat re-assign ke unit yang sama atau berbeda.
        await _close_all_open_history(db, device_id=device_id, released_at=now)

        # 2. Tutup open history device LAMA yang sedang menempati unit ini
        if unit.device_id and unit.device_id != device_id:
            await _close_all_open_history(db, device_id=unit.device_id, released_at=now)

        # 3. Lepaskan device dari unit lain (jika ada) supaya unit lama jadi available
        old_result = await db.execute(
            select(AssetUnit).where(
                and_(AssetUnit.device_id == device_id, AssetUnit.id != unit.id)
            )
        )
        old = old_result.scalar_one_or_none()
        if old:
            old.device_id = None
            logger.info(f"Released old AssetUnit assignment: {old.unit_id}")

        # 4. Assign dan buka history baru
        unit.device_id = device_id
        await _open_history(db, device_id=device_id, unit=unit, assigned_at=now)

        await db.commit()
        logger.info(f"Device {device_id} assigned to AssetUnit {unit.unit_id}")
        return await AssetUnitService.get_full(db, unit.id)

    @staticmethod
    async def release_device(db: AsyncSession, device_id: UUID) -> None:
        now = datetime.now(timezone.utc)
        result = await db.execute(select(AssetUnit).where(AssetUnit.device_id == device_id))
        unit = result.scalar_one_or_none()
        if unit:
            await _close_all_open_history(db, device_id=device_id, released_at=now)
            unit.device_id = None
            await db.commit()
            logger.info(f"Released device {device_id} from AssetUnit {unit.unit_id}")


async def _open_history(db: AsyncSession, device_id: UUID, unit: AssetUnit, assigned_at: datetime) -> None:
    """Buka record history baru untuk assignment device → unit."""
    loc_name: str | None = None
    if unit.location_id:
        loc_result = await db.execute(select(Location).where(Location.id == unit.location_id))
        loc = loc_result.scalar_one_or_none()
        if loc:
            loc_name = loc.name

    dev_result = await db.execute(select(Device).where(Device.id == device_id))
    dev = dev_result.scalar_one_or_none()

    history = DeviceUnitHistory(
        id=_uuid.uuid4(),
        device_id=device_id,
        device_name=dev.name if dev else "unknown",
        device_mac=dev.mac if dev else "00:00:00:00:00:00",
        unit_id=unit.id,
        unit_code=unit.unit_id,
        unit_name=unit.name,
        unit_type=unit.type,
        location_id=unit.location_id,
        location_name=loc_name,
        assigned_at=assigned_at,
        released_at=None,
    )
    db.add(history)


async def _close_all_open_history(db: AsyncSession, device_id: UUID, released_at: datetime) -> None:
    """Tutup semua open history record untuk device ini, apa pun unit-nya."""
    await db.execute(
        update(DeviceUnitHistory)
        .where(
            and_(
                DeviceUnitHistory.device_id == device_id,
                DeviceUnitHistory.released_at == None,
            )
        )
        .values(released_at=released_at)
    )


def _build_response(unit: AssetUnit, loc_name: str | None, dev_name: str | None) -> dict:
    return {
        "id":            unit.id,
        "unit_id":       unit.unit_id,
        "name":          unit.name,
        "type":          unit.type,
        "location_id":   unit.location_id,
        "location_name": loc_name,
        "device_id":     unit.device_id,
        "device_name":   dev_name,
        "is_active":     unit.is_active,
        "available":     unit.device_id is None,
        "odoo_id":       unit.odoo_id,
        "created_at":    unit.created_at,
        "updated_at":    unit.updated_at,
    }
