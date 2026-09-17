from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime
from uuid import UUID

AssetUnitType = Literal['timbangan', 'doorlock', 'smartbuddy', 'other']


class AssetUnitCreate(BaseModel):
    unit_id:     str           = Field(..., min_length=1, max_length=100, description="e.g. KapitMas/Scales/0021")
    name:        str           = Field(..., min_length=1, max_length=100, description="e.g. Timbangan Ke-21")
    type:        AssetUnitType = Field(default='timbangan')
    location_id: Optional[UUID] = None


class AssetUnitUpdate(BaseModel):
    name:        Optional[str]           = Field(None, min_length=1, max_length=100)
    type:        Optional[AssetUnitType] = None
    location_id: Optional[UUID]          = None
    is_active:   Optional[bool]          = None


class AssetUnitResponse(BaseModel):
    id:            UUID
    unit_id:       str
    name:          str
    type:          str
    location_id:   Optional[UUID]     = None
    location_name: Optional[str]      = None
    device_id:     Optional[UUID]     = None
    device_name:   Optional[str]      = None
    is_active:     bool
    available:     bool
    odoo_id:       Optional[int]      = None
    created_at:    datetime
    updated_at:    Optional[datetime] = None

    model_config = {"from_attributes": True}


class AssetUnitAssignRequest(BaseModel):
    device_id: Optional[UUID] = None  # None = unassign


class AssetUnitProvisioningResponse(BaseModel):
    """Untuk Flutter provisioning app — unit available + unit dengan device offline (bisa diganti)."""
    id:                    UUID
    unit_id:               str
    name:                  str
    type:                  str
    current_device_name:   Optional[str]  = None   # None = kosong/available
    current_device_online: Optional[bool] = None   # None = tidak ada device

    model_config = {"from_attributes": True}
