from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class TimbanganDeviceSimple(BaseModel):
    """Untuk list ringkas di dropdown dll."""
    id:       int
    name:     str
    location: Optional[str] = None
    online:   bool = False

    class Config:
        from_attributes = True


class TimbanganDeviceResponse(BaseModel):
    """Response lengkap untuk device list & detail — matches frontend TimbanganDevice type."""
    id:          int
    device_id:   str               # UUID dari tabel devices
    name:        str
    location_id: Optional[str] = None   # location name string (bukan UUID)
    weight:      Optional[float] = None
    weight_str:  Optional[str] = None   # "31.0" — presisi asli, jangan format ulang
    unit:        Optional[str] = None   # "kg", "lb", "g", "t"
    timestamp:   Optional[datetime] = None
    consumed:    bool = False
    expired:     bool = False
    online:      bool = False
    last_seen:   Optional[datetime] = None
    firmware:    Optional[str] = None
    rssi:        Optional[int] = None   # dBm, dari heartbeat MQTT, disimpan di device.config

    class Config:
        from_attributes = True


class TimbanganDeviceCreate(BaseModel):
    name:     str = Field(..., min_length=1, max_length=100)
    location: Optional[str] = Field(None, max_length=100)


class TimbanganDeviceUpdate(BaseModel):
    name:     Optional[str] = Field(None, min_length=1, max_length=100)
    location: Optional[str] = Field(None, max_length=100)


class TimbanganDeviceAvailable(BaseModel):
    id:        int
    name:      str
    location:  Optional[str] = None
    weight:    float
    timestamp: datetime

    class Config:
        from_attributes = True


class TimbanganWeightResponse(BaseModel):
    """Response untuk Odoo — tidak boleh berubah."""
    device_id: int
    name:      str
    weight:    float
    timestamp: datetime


class TimbanganLogEntry(BaseModel):
    id:              int
    weight:          float
    weight_str:      Optional[str] = None
    unit:            Optional[str] = None
    timestamp:       datetime
    used_for:        Optional[str] = None
    iot_device_name: Optional[str] = None

    class Config:
        from_attributes = True


class TimbanganUnitLogsResponse(BaseModel):
    unit_id:   str
    unit_name: str
    logs:      List[TimbanganLogEntry]


class TimbanganBackupFileResponse(BaseModel):
    filename: str
    size:     int
    mtime:    str


class TimbanganAuthRequest(BaseModel):
    password: str


class TimbanganAuthResponse(BaseModel):
    success: bool
    error:   Optional[str] = None


class TimbanganStatusResponse(BaseModel):
    status: dict


class TimbanganAnalyticsSummary(BaseModel):
    total_measurements: int
    avg_weight:         float
    min_weight:         float
    max_weight:         float
    total_weight:       float


class TimbanganAnalyticsOverviewResponse(BaseModel):
    summary:           TimbanganAnalyticsSummary
    time_series:       dict
    device_comparison: list
    heatmap:           List[List[int]]
    range:             str


class TimbanganDeviceTimeSeriesData(BaseModel):
    time:   str
    weight: float


class TimbanganDeviceDailyData(BaseModel):
    date:       str
    count:      int
    avg_weight: float


class TimbanganDeviceUsageData(BaseModel):
    system: str
    count:  int


class TimbanganDeviceAnalyticsResponse(BaseModel):
    time_series: List[TimbanganDeviceTimeSeriesData]
    daily_data:  List[TimbanganDeviceDailyData]
    usage_data:  List[TimbanganDeviceUsageData]


class TimbanganFirmwareResponse(BaseModel):
    id:          int
    version:     str
    filename:    str
    size:        int
    checksum:    str
    description: Optional[str] = None
    is_active:   bool
    created_at:  datetime

    class Config:
        from_attributes = True


class TimbanganOTARequest(BaseModel):
    device_id:   int
    firmware_id: int


class TimbanganOTABroadcastRequest(BaseModel):
    firmware_id: int
