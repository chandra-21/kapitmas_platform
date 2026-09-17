from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel, Field


# ==================== PROVISIONING ====================

class SmartBuddyProvisioningRequest(BaseModel):
    mac:      str
    name:     str
    type:     str = "smartbuddy"
    room_id:  str = ""
    firmware: str = ""
    chip:     str = "ESP32"
    ip:       str = ""
    has_ac:   bool = True
    has_lamp: bool = True
    ac_brand: str  = "daikin"


class SmartBuddyProvisioningResponse(BaseModel):
    success:   bool
    device_id: str
    message:   str = ""


# ==================== AC ====================

class ACCommandRequest(BaseModel):
    power:   bool
    mode:    str = Field(default="cool", pattern="^(cool|heat|dry|fan|auto)$")
    temp:    int = Field(default=25, ge=16, le=30)
    fan:     str = Field(default="auto", pattern="^(auto|quiet|low|medium|high)$")
    swing_v: bool = False


class ACStateResponse(BaseModel):
    power:   bool
    mode:    str
    temp:    int
    fan:     str
    swing_v: bool
    last_cmd: Optional[datetime] = None


# ==================== LAMP ====================

class LampCommandRequest(BaseModel):
    power:       bool
    mode:        str  = Field(default="manual", pattern="^(manual|auto_pir|schedule)$")
    pir_timeout: Optional[int] = Field(default=None, ge=10, le=3600)  # detik


class LampStateResponse(BaseModel):
    power:       bool
    mode:        str
    pir_timeout: int
    last_cmd:    Optional[datetime] = None


# ==================== SCHEDULE ====================

class ScheduleEntry(BaseModel):
    enabled:     bool = True
    hour:        int  = Field(ge=0, le=23)
    minute:      int  = Field(ge=0, le=59)
    days:        List[bool] = Field(default_factory=lambda: [True]*7)
    target:      str  = Field(pattern="^(ac|lamp)$")
    power:       bool = True
    ac_temp:     Optional[int] = Field(default=25, ge=16, le=30)
    ac_mode:     Optional[int] = 1   # AC_MODE enum value
    ac_fan:      Optional[int] = 0   # AC_FAN enum value
    valid_until: Optional[int] = None  # unix timestamp, None = no expiry


class ScheduleUpdateRequest(BaseModel):
    schedules: List[ScheduleEntry]


# ==================== IR LEARNING ====================

class IRLearnRequest(BaseModel):
    slot: str = Field(..., min_length=1, max_length=32,
                      description="Nama slot IR (e.g. 'power_on_25')")


class IRLearnResult(BaseModel):
    slot:    str
    success: bool
    timings: Optional[List[int]] = None


# ==================== OTA ====================

class SmartBuddyOTARequest(BaseModel):
    url: str = Field(..., min_length=1)


class SmartBuddyFirmwareResponse(BaseModel):
    id:          int
    version:     str
    filename:    str
    size:        int
    checksum:    str
    description: Optional[str] = None
    is_active:   bool
    created_at:  Optional[datetime] = None

    class Config:
        from_attributes = True


# ==================== UPDATE ====================

class SmartBuddyUpdateRequest(BaseModel):
    name:     Optional[str] = None
    location: Optional[str] = None


# ==================== DEVICE RESPONSE ====================

class SmartBuddyDeviceResponse(BaseModel):
    id:          int
    device_id:   str
    name:        str
    mac:         str
    room_id:     Optional[str] = None
    location_id:   Optional[str] = None
    location_name: Optional[str] = None
    online:      bool
    last_seen:   Optional[datetime] = None
    firmware:    Optional[str] = None
    ip_address:  Optional[str] = None

    has_ac:   bool
    has_lamp: bool
    ac_brand: str

    ac_state:   ACStateResponse
    lamp_state: LampStateResponse

    schedules: Optional[Any] = None

    class Config:
        from_attributes = True
