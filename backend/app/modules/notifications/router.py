from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_db
from app.modules.auth.dependencies import get_current_user
from app.models.user import User
from app.modules.notifications.service import NotificationService

router = APIRouter(prefix="/notifications", tags=["Notifications"])


class NotificationLogResponse(BaseModel):
    id: int
    device_id: UUID | None
    type: str
    message: str
    sent_at: datetime
    success: bool

    model_config = {"from_attributes": True}


@router.get("/logs", response_model=list[NotificationLogResponse])
async def get_notification_logs(
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    return await NotificationService.get_my_notification_logs(
        db, current_user.id, limit=min(limit, 200)
    )
