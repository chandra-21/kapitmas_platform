from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, field_validator


class UserUpdate(BaseModel):
    display_name:  str | None  = None
    role:          str | None  = None
    is_active:     bool | None = None
    notif_enabled: bool | None = None

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str | None) -> str | None:
        if v is not None and v not in ("admin", "pic"):
            raise ValueError("role harus 'admin' atau 'pic'")
        return v


class ProfileUpdate(BaseModel):
    display_name:  str | None  = None
    notif_enabled: bool | None = None


class UserResponse(BaseModel):
    id:            UUID
    odoo_uid:      int
    email:         str
    display_name:  str
    role:          str
    is_active:     bool
    notif_enabled: bool
    created_at:    datetime

    model_config = {"from_attributes": True}


class FCMTokenRegister(BaseModel):
    token:    str
    platform: str = "web"

    @field_validator("platform")
    @classmethod
    def validate_platform(cls, v: str) -> str:
        if v not in ("android", "ios", "web"):
            raise ValueError("platform harus 'android', 'ios', atau 'web'")
        return v


class FCMTokenDelete(BaseModel):
    token: str
