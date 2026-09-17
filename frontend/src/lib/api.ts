import { getToken, removeToken } from '@/lib/auth'

const BASE = '/api'

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`)
  return res.json()
}

export async function apiFetchAuth<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const { headers: extraHeaders, ...restInit } = init ?? {}
  const isFormData = restInit.body instanceof FormData
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(extraHeaders as Record<string, string> | undefined),
    },
    ...restInit,
  })
  if (res.status === 401) {
    removeToken()
    window.location.href = '/login'
    throw new Error('Session expired')
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? `API ${path}: ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export async function loginWithOdoo(username: string, password: string): Promise<{ access_token: string; user: UserResponse }> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Login failed' }))
    throw new Error(err.detail ?? 'Login failed')
  }
  return res.json()
}

// ═══════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════

export interface TimbanganDevice {
  id:          number
  device_id:   string
  name:        string
  weight:      number | null
  weight_str:  string | null   // "31.0" — raw string from the scale device, use this for display
  unit:        string | null   // "kg", "lb", "g", "t"
  timestamp:   string | null
  consumed:    boolean
  expired:     boolean
  location_id: string | null   // resolved location name
  online:      boolean
  last_seen:   string | null
  firmware:    string | null
  rssi:        number | null
}

export interface DeviceStatus {
  name:        string
  online:      boolean
  last_seen:   string | null
  location_id: string | null
}

export interface TimbanganStatusResponse {
  status: Record<string, DeviceStatus>
}

export interface LogEntry {
  id:              number
  weight:          number
  weight_str:      string | null
  unit:            string | null
  timestamp:       string
  used_for:        string | null
  iot_device_name: string | null
}

export interface UnitLogsResponse {
  unit_id:   string
  unit_name: string
  logs:      LogEntry[]
}

/** @deprecated use UnitLogsResponse */
export type DeviceLogsResponse = UnitLogsResponse

export interface NotificationLog {
  id:         number
  type:       string
  title:      string
  body:       string
  created_at: string
  device_id:  string | null
}

export interface SystemHealth {
  cpu:  { percent: number; cores: number }
  ram:  { percent: number; used_gb: number; total_gb: number }
  disk: { percent: number; used_gb: number; total_gb: number; free_gb: number }
  mqtt: { connected: boolean }
  devices: {
    timbangan:  { total: number; online: number; offline: number }
    smartbuddy: { total: number; online: number; offline: number }
    lamp:       { total: number; online: number; offline: number }
    ac:         { total: number; online: number; offline: number }
  }
}

export interface ActivityEvent {
  id:          number
  type:        'online' | 'offline' | 'firmware' | 'calibration' | 'sync' | string
  title:       string
  message:     string
  device_name: string | null
  created_at:  string | null
}

export interface BackupFile {
  filename: string
  size:     number
  mtime:    string
}

export interface DeviceUnitHistoryEntry {
  id:            string
  device_id:     string | null
  device_name:   string
  device_mac:    string
  unit_id:       string | null
  unit_code:     string
  unit_name:     string
  unit_type:     string
  location_id:   string | null
  location_name: string | null
  assigned_at:   string
  released_at:   string | null
}

export interface UserResponse {
  id:            string
  odoo_uid:      number
  email:         string
  display_name:  string
  role:          'admin' | 'pic'
  is_active:     boolean
  notif_enabled: boolean
  created_at:    string
}

export interface UserUpdate {
  display_name?:  string
  role?:          string
  is_active?:     boolean
  notif_enabled?: boolean
}

export interface ProfileUpdate {
  display_name?:  string
  notif_enabled?: boolean
}

export interface GlobalDevice {
  id:            string
  mac:           string
  name:          string
  type:          string
  location_id:   string | null
  location_name: string | null
  firmware:      string | null
  ip_address:    string | null
  chip:          string | null
  online:        boolean
  last_seen:     string | null
  registered_at: string
  config:        Record<string, unknown> | null
}

export interface Location {
  id:         string
  name:       string
  address:    string | null
  is_active:  boolean
  created_at: string
}

export interface AssetUnit {
  id:            string
  unit_id:       string
  name:          string
  type:          string
  location_id:   string | null
  location_name: string | null
  device_id:     string | null
  device_name:   string | null
  is_active:     boolean
  available:     boolean
  odoo_id:       number | null
  created_at:    string
  updated_at:    string | null
}

// ── Analytics ──
export interface AnalyticsSummary {
  total_measurements: number
  avg_weight:         number
  min_weight:         number
  max_weight:         number
  total_weight:       number
}

export interface AnalyticsOverview {
  summary:           AnalyticsSummary
  time_series:       Record<string, Array<{ time: string; count: number; avg_weight: number; total_weight: number }>>
  device_comparison: Array<{ device_id: number; device_name: string; count: number }>
  heatmap:           number[][]
  range:             string
}

export interface DeviceAnalytics {
  time_series: Array<{ time: string; weight: number }>
  daily_data:  Array<{ date: string; count: number; avg_weight: number }>
  usage_data:  Array<{ system: string; count: number }>
}

// ── OTA ──
export interface TimbanganFirmware {
  id:          number
  version:     string
  filename:    string
  size:        number
  checksum:    string
  description: string | null
  is_active:   boolean
  created_at:  string
}

export interface OTATriggerResponse {
  success:          boolean
  device:           string
  firmware_version: string
  mqtt_topic:       string
  download_url:     string
}

export interface OTABroadcastResponse {
  success:           boolean
  firmware_version:  string
  devices_triggered: string[]
  count:             number
}

// ═══════════════════════════════════════════════════════
// API CALLS — TIMBANGAN
// ═══════════════════════════════════════════════════════

export const getAllDevices           = () => apiFetchAuth<GlobalDevice[]>('/devices')
export const getDevice              = (uuid: string) => apiFetchAuth<GlobalDevice>(`/devices/${uuid}`)
export const updateDevice           = (id: string, data: { name?: string; location_id?: string | null }) =>
  apiFetchAuth<{ success: boolean }>(`/devices/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteDevice           = (id: string) =>
  apiFetchAuth<void>(`/devices/${id}`, { method: 'DELETE' })
export const getDeviceUnitHistory   = (deviceId: string) =>
  apiFetchAuth<DeviceUnitHistoryEntry[]>(`/devices/${deviceId}/unit-history`)

export const getLocations           = () => apiFetchAuth<Location[]>('/locations/')
export const getLocationsPublic     = () => apiFetch<{ id: string; name: string }[]>('/locations/public')
export const createLocation         = (name: string, address?: string) =>
  apiFetchAuth<Location>('/locations/', { method: 'POST', body: JSON.stringify({ name, address }) })
export const updateLocation         = (id: string, data: { name?: string; address?: string; is_active?: boolean }) =>
  apiFetchAuth<Location>(`/locations/${id}`, { method: 'PATCH', body: JSON.stringify(data) })

export const getAssetUnits          = (location_id?: string, type?: string) => {
  const p = new URLSearchParams()
  if (location_id) p.set('location_id', location_id)
  if (type)        p.set('type', type)
  const q = p.toString()
  return apiFetchAuth<AssetUnit[]>(`/asset-units/${q ? `?${q}` : ''}`)
}
export const createAssetUnit        = (data: { unit_id: string; name: string; type?: string; location_id?: string }) =>
  apiFetchAuth<AssetUnit>('/asset-units/', { method: 'POST', body: JSON.stringify(data) })
export const updateAssetUnit        = (id: string, data: { name?: string; type?: string; location_id?: string | null; is_active?: boolean }) =>
  apiFetchAuth<AssetUnit>(`/asset-units/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
export const deleteAssetUnit        = (id: string) =>
  apiFetchAuth<void>(`/asset-units/${id}`, { method: 'DELETE' })
export const assignDeviceToUnit     = (unitId: string, deviceId: string | null) =>
  apiFetchAuth<AssetUnit>(`/asset-units/${unitId}/assign`, { method: 'POST', body: JSON.stringify({ device_id: deviceId }) })

/** @deprecated use getAssetUnits */
export const getScalesUnits   = (location_id?: string) => getAssetUnits(location_id, 'timbangan')
/** @deprecated use createAssetUnit */
export const createScalesUnit = (data: { unit_id: string; name: string; location_id?: string }) => createAssetUnit({ ...data, type: 'timbangan' })
/** @deprecated use updateAssetUnit */
export const updateScalesUnit = (id: string, data: { name?: string; location_id?: string | null; is_active?: boolean }) => updateAssetUnit(id, data)
/** @deprecated use deleteAssetUnit */
export const deleteScalesUnit = (id: string) => deleteAssetUnit(id)

export const getTimbanganDevices    = () => apiFetchAuth<TimbanganDevice[]>('/timbangan/devices')
export const getTimbanganDevice     = (id: number) => apiFetchAuth<TimbanganDevice>(`/timbangan/devices/${id}`)
export const getTimbanganStatus     = () => apiFetchAuth<TimbanganStatusResponse>('/timbangan/status')
export const getTimbanganLogs       = (date: string) => apiFetchAuth<UnitLogsResponse[]>(`/timbangan/logs?date=${date}`)

export const createTimbanganDevice  = (name: string, location?: string) =>
  apiFetchAuth<{ success: boolean; device_id: number; name: string }>('/timbangan/devices', {
    method: 'POST',
    body:   JSON.stringify({ name, location }),
  })

export const updateTimbanganDevice  = (id: number, data: { name?: string; location?: string }) =>
  apiFetchAuth<{ success: boolean }>(`/timbangan/devices/${id}`, {
    method: 'PUT',
    body:   JSON.stringify(data),
  })

export const deleteTimbanganDevice  = (id: number) =>
  apiFetchAuth<void>(`/timbangan/devices/${id}`, { method: 'DELETE' })

// ── Analytics ──
export const getAnalyticsOverview   = (range: string) =>
  apiFetchAuth<AnalyticsOverview>(`/timbangan/analytics/overview?range=${range}`)

export const getUnitAnalytics       = (unitId: string, range: string) =>
  apiFetchAuth<DeviceAnalytics>(`/timbangan/analytics/unit/${unitId}?range=${range}`)

/** @deprecated use getUnitAnalytics */
export const getDeviceAnalytics     = (deviceId: number, range: string) =>
  apiFetchAuth<DeviceAnalytics>(`/timbangan/analytics/unit/${deviceId}?range=${range}`)

// ── Backups ──
export const listBackups            = () => apiFetchAuth<BackupFile[]>('/timbangan/backups')
export const getBackupDownloadUrl   = (filename: string) => `${BASE}/timbangan/backups/${filename}`
export const runBackup              = (date?: string) =>
  apiFetchAuth<{ date: string; count: number; files: string[] }>(
    `/timbangan/backups/run${date ? `?date=${date}` : ''}`,
    { method: 'POST' }
  )

// ── OTA ──
export const listFirmware           = () => apiFetchAuth<TimbanganFirmware[]>('/timbangan/ota/firmware')
export const getActiveFirmware      = () => apiFetchAuth<TimbanganFirmware | null>('/timbangan/ota/firmware/active')

export const uploadFirmware         = async (formData: FormData): Promise<any> => {
  const token = getToken()
  const res = await fetch(`${BASE}/timbangan/ota/firmware`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  })
  if (!res.ok) return res.json().then(e => Promise.reject(e))
  return res.json()
}

export const activateFirmware       = (firmwareId: number) =>
  apiFetchAuth<{ success: boolean; active_version: string }>(
    `/timbangan/ota/firmware/${firmwareId}/activate`, { method: 'POST' }
  )

export const deleteFirmware         = (firmwareId: number) =>
  apiFetchAuth<void>(`/timbangan/ota/firmware/${firmwareId}`, { method: 'DELETE' })

export const triggerOTA             = (deviceId: number, firmwareId: number) =>
  apiFetchAuth<OTATriggerResponse>('/timbangan/ota/trigger', {
    method: 'POST',
    body:   JSON.stringify({ device_id: deviceId, firmware_id: firmwareId }),
  })

export const broadcastOTA           = (firmwareId: number) =>
  apiFetchAuth<OTABroadcastResponse>('/timbangan/ota/broadcast', {
    method: 'POST',
    body:   JSON.stringify({ firmware_id: firmwareId }),
  })

export const getFirmwareDownloadUrl = (firmwareId: number) => `${BASE}/timbangan/ota/download/${firmwareId}`

// ═══════════════════════════════════════════════════════
// API CALLS — SYSTEM
// ═══════════════════════════════════════════════════════

export const getSystemHealth        = () => apiFetchAuth<SystemHealth>('/system/health')
export const getActivityFeed        = (limit = 20) => apiFetchAuth<ActivityEvent[]>(`/system/activity?limit=${limit}`)
export const getNotifications       = (limit = 50) => apiFetchAuth<NotificationLog[]>(`/system/notifications?limit=${limit}`)

// ═══════════════════════════════════════════════════════
// API CALLS — USERS (auth required)
// ═══════════════════════════════════════════════════════

export const getMyProfile    = () => apiFetchAuth<UserResponse>('/users/me/profile')
export const updateMyProfile = (data: ProfileUpdate) =>
  apiFetchAuth<UserResponse>('/users/me/profile', { method: 'PATCH', body: JSON.stringify(data) })

export const listUsers       = () => apiFetchAuth<UserResponse[]>('/users/')
export const updateUser      = (id: string, data: UserUpdate) =>
  apiFetchAuth<UserResponse>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
export const deactivateUser  = (id: string) =>
  apiFetchAuth<void>(`/users/${id}`, { method: 'DELETE' })

// ── CSV Export ──
export const getExportCsvUrl = (unitId: string, date: string) =>
  `${BASE}/timbangan/units/${unitId}/export?date=${date}`

// ═══════════════════════════════════════════════════════
// PERMISSIONS
// ═══════════════════════════════════════════════════════

export const ALL_PERMISSIONS = [
  "timbangan.view",
  "timbangan.add",
  "timbangan.edit",
  "timbangan.delete",
  "timbangan.ota",
  "location.view",
  "location.manage",
  "report.view",
  "report.export",
  "smartbuddy.view",
  "smartbuddy.control",
  "smartbuddy.ota",
] as const

export type PermissionKey = typeof ALL_PERMISSIONS[number]

export const getUserPermissions = (userId: string) =>
  apiFetchAuth<string[]>(`/users/${userId}/permissions`)

export const setUserPermissions = (userId: string, permissions: string[]) =>
  apiFetchAuth<string[]>(`/users/${userId}/permissions`, {
    method: 'PUT',
    body: JSON.stringify({ permissions }),
  })

export const getMyPermissions = () =>
  apiFetchAuth<string[]>('/users/me/permissions')

// ═══════════════════════════════════════════════════════
// TYPES — SMARTBUDDY
// ═══════════════════════════════════════════════════════

export type ACMode  = 'cool' | 'heat' | 'dry' | 'fan' | 'auto'
export type ACFan   = 'auto' | 'quiet' | 'low' | 'medium' | 'high'
export type LampMode = 'manual' | 'auto_pir' | 'schedule'

export interface ACState {
  power:    boolean
  mode:     ACMode
  temp:     number
  fan:      ACFan
  swing_v:  boolean
  last_cmd: string | null
}

export interface LampState {
  power:       boolean
  mode:        LampMode
  pir_timeout: number
  last_cmd:    string | null
}

export interface ScheduleEntry {
  enabled:     boolean
  hour:        number
  minute:      number
  days:        boolean[]   // [Sun, Mon, Tue, Wed, Thu, Fri, Sat]
  target:      'ac' | 'lamp'
  power:       boolean
  ac_temp?:    number
  ac_mode?:    number      // ACMode enum index: 0=auto,1=cool,2=heat,3=dry,4=fan
  ac_fan?:     number      // ACFan enum index
  valid_until?: number | null
}

export interface SmartBuddyDevice {
  id:            number
  device_id:     string
  name:          string
  mac:           string
  room_id:       string | null
  location_id:   string | null
  location_name: string | null
  online:        boolean
  last_seen:     string | null
  firmware:      string | null
  ip_address:    string | null
  has_ac:        boolean
  has_lamp:      boolean
  ac_brand:      string
  ac_state:      ACState
  lamp_state:    LampState
  schedules:     ScheduleEntry[] | null
}

// ═══════════════════════════════════════════════════════
// API CALLS — SMARTBUDDY
// ═══════════════════════════════════════════════════════

export const getSmartBuddyDevices = () =>
  apiFetchAuth<SmartBuddyDevice[]>('/smartbuddy/status')

export const getSmartBuddyDevice = (id: number) =>
  apiFetchAuth<SmartBuddyDevice>(`/smartbuddy/${id}`)

export const updateSmartBuddyDevice = (id: number, body: { name?: string; location?: string }) =>
  apiFetchAuth<{ success: boolean }>(`/smartbuddy/${id}`, {
    method: 'PUT',
    body:   JSON.stringify(body),
  })

export const deleteSmartBuddyDevice = (id: number) =>
  apiFetchAuth<void>(`/smartbuddy/${id}`, { method: 'DELETE' })

export const sendACCommand = (id: number, cmd: {
  power: boolean; mode: ACMode; temp: number; fan: ACFan; swing_v: boolean
}) => apiFetchAuth<{ success: boolean }>(`/smartbuddy/${id}/ac/command`, {
  method: 'POST',
  body:   JSON.stringify(cmd),
})

export const sendLampCommand = (id: number, cmd: {
  power: boolean; mode: LampMode; pir_timeout?: number
}) => apiFetchAuth<{ success: boolean }>(`/smartbuddy/${id}/lamp/command`, {
  method: 'POST',
  body:   JSON.stringify(cmd),
})

export const updateSmartBuddySchedule = (id: number, schedules: ScheduleEntry[]) =>
  apiFetchAuth<{ success: boolean }>(`/smartbuddy/${id}/schedule`, {
    method: 'PUT',
    body:   JSON.stringify({ schedules }),
  })

export const triggerSmartBuddyIRLearn = (id: number, slot: string) =>
  apiFetchAuth<{ success: boolean; message: string }>(`/smartbuddy/${id}/ir/learn`, {
    method: 'POST',
    body:   JSON.stringify({ slot }),
  })

export const triggerSmartBuddyOTA = (id: number, url: string) =>
  apiFetchAuth<{ success: boolean }>(`/smartbuddy/${id}/ota`, {
    method: 'POST',
    body:   JSON.stringify({ url }),
  })

// ── SmartBuddy OTA firmware management ──────────────────────────────────────

export interface SmartBuddyFirmware {
  id:          number
  version:     string
  filename:    string
  size:        number
  checksum:    string
  description: string | null
  is_active:   boolean
  created_at:  string | null
}

export const listSmartBuddyFirmware = () =>
  apiFetchAuth<SmartBuddyFirmware[]>('/smartbuddy/ota/firmware')

export const getActiveSmartBuddyFirmware = () =>
  apiFetchAuth<SmartBuddyFirmware | null>('/smartbuddy/ota/firmware/active')

export const uploadSmartBuddyFirmware = (fd: FormData) =>
  apiFetchAuth<{ success: boolean; firmware_id: number; version: string; size: number; checksum: string }>(
    '/smartbuddy/ota/firmware',
    { method: 'POST', body: fd }
  )

export const activateSmartBuddyFirmware = (id: number) =>
  apiFetchAuth<{ success: boolean; active_version: string }>(
    `/smartbuddy/ota/firmware/${id}/activate`,
    { method: 'POST' }
  )

export const deleteSmartBuddyFirmware = (id: number) =>
  apiFetchAuth<void>(`/smartbuddy/ota/firmware/${id}`, { method: 'DELETE' })

export const triggerSmartBuddyOTAManaged = (sb_id: number, firmware_id: number) => {
  const fd = new FormData()
  fd.append('sb_id', String(sb_id))
  fd.append('firmware_id', String(firmware_id))
  return apiFetchAuth<{ success: boolean; device: string; firmware_version: string }>(
    '/smartbuddy/ota/trigger',
    { method: 'POST', body: fd }
  )
}

export const broadcastSmartBuddyOTA = (firmware_id: number) => {
  const fd = new FormData()
  fd.append('firmware_id', String(firmware_id))
  return apiFetchAuth<{ success: boolean; firmware_version: string; devices_triggered: string[] }>(
    '/smartbuddy/ota/broadcast',
    { method: 'POST', body: fd }
  )
}
