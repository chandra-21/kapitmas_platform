from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from uuid import UUID


class DeviceResponse(BaseModel):
    id:            UUID
    mac:           str
    name:          str
    type:          str
    location_id:   Optional[UUID]  = None
    location_name: Optional[str]   = None
    firmware:      Optional[str]   = None
    ip_address:    Optional[str]   = None
    chip:          Optional[str]   = None
    online:        bool
    last_seen:     Optional[datetime] = None
    registered_at: datetime
    config:        Optional[dict]  = None

    model_config = {"from_attributes": True}


class DeviceStatusResponse(BaseModel):
    mac:         str
    name:        str
    type:        str
    online:      bool
    last_seen:   Optional[datetime]
    location_id: Optional[UUID]

    model_config = {"from_attributes": True}


class DeviceUpdate(BaseModel):
    name:        Optional[str]  = Field(None, min_length=1, max_length=100)
    location_id: Optional[UUID] = None


class ProvisioningRequest(BaseModel):
    """Dikirim oleh ESP32 setelah WiFi connect"""
    mac:            str            = Field(..., description="MAC address ESP32")
    name:           str            = Field(..., description="Nama device dari NVS")
    type:           str            = Field(default="other")
    location:       str            = Field(default="")    # legacy — diabaikan
    firmware:       str            = Field(default="")
    chip:           str            = Field(default="ESP32")
    ip:             str            = Field(default="")
    asset_unit_id:  Optional[UUID] = Field(default=None, description="ID AssetUnit dari Flutter")


class ProvisioningResponse(BaseModel):
    success:   bool
    device_id: str
    message:   str
