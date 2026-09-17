from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class LocationCreate(BaseModel):
    name: str
    address: str | None = None


class LocationUpdate(BaseModel):
    name: str | None = None
    address: str | None = None
    is_active: bool | None = None


class LocationResponse(BaseModel):
    id: UUID
    name: str
    address: str | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class AssignUserRequest(BaseModel):
    user_id: UUID


class UnassignUserRequest(BaseModel):
    user_id: UUID


class LocationUserResponse(BaseModel):
    user_id: UUID
    display_name: str
    email: str
    role: str
    assigned_at: datetime

    model_config = {"from_attributes": True}
