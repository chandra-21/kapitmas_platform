import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, MapPin, MoreHorizontal, BarChart2, Download,
  ArrowUpCircle, Edit2, Trash2, CheckCircle2, Activity, X, Wifi, Plus, Layers, Clock,
} from 'lucide-react'
import { usePermissions } from '@/hooks/usePermissions'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import {
  getTimbanganDevice, getDevice, getUnitAnalytics, getTimbanganLogs,
  getLocations, createLocation, updateTimbanganDevice, deleteTimbanganDevice, getExportCsvUrl,
  getDeviceUnitHistory,
} from '@/lib/api'
import type { DeviceUnitHistoryEntry } from '@/lib/api'
import { useColors } from '@/lib/theme'

function rssiColor(rssi: number): string {
  if (rssi >= -60) return '#4CAF50'
  if (rssi >= -75) return '#FFC107'
  return '#F44336'
}

type ChartRange = '24H' | '7D' | '30D'

const RANGE_MAP: Record<ChartRange, string> = {
  '24H': 'today',
  '7D':  '7days',
  '30D': '30days',
}

function fmt(iso: string | null, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', opts ?? {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function InfoRow({ label, value, valueColor }: { label: string; value: React.ReactNode; valueColor?: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b last:border-0"
      style={{ borderColor: 'var(--c-border)88' }}>
      <span className="text-sm" style={{ color: 'var(--c-muted)' }}>{label}</span>
      <span className="font-mono text-sm text-right" style={{ color: valueColor ?? 'var(--c-primary)' }}>
        {value}
      </span>
    </div>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(var(--bg-surface-rgb),0.70)', border: '1px solid var(--c-border)' }}>
      <div className="px-4 py-2.5 border-b" style={{ borderColor: 'var(--c-border)', background: 'rgba(var(--c-border-rgb),0.20)' }}>
        <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: '#C9A84C' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

export default function TimbanganDeviceDetailPage() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const devId    = Number(id)

  const qc = useQueryClient()
  const colors = useColors()
  const { can } = usePermissions()

  const [chartRange,       setChartRange]      = useState<ChartRange>('24H')
  const [editOpen,         setEditOpen]        = useState(false)
  const [editName,         setEditName]        = useState('')
  const [editLocation,     setEditLocation]    = useState('')
  const [editSaving,       setEditSaving]      = useState(false)
  const [deleteOpen,       setDeleteOpen]      = useState(false)
  const [deleting,         setDeleting]        = useState(false)

  // Quick-create location inline
  const [locQuickOpen,     setLocQuickOpen]    = useState(false)
  const [locQuickName,     setLocQuickName]    = useState('')
  const [locQuickAddr,     setLocQuickAddr]    = useState('')
  const [locQuickCreating, setLocQuickCreating]= useState(false)

  const { data: timbangan, isLoading: loadingT, refetch: refetchDevice } = useQuery({
    queryKey: ['timbangan-device', devId],
    queryFn:  () => getTimbanganDevice(devId),
    enabled:  !!devId,
    refetchInterval: 15_000,
  })

  const { data: globalDev } = useQuery({
    queryKey: ['global-device', timbangan?.device_id],
    queryFn:  () => getDevice(timbangan!.device_id),
    enabled:  !!timbangan?.device_id,
  })

  const { data: unitHistory = [] } = useQuery({
    queryKey: ['device-unit-history', globalDev?.id],
    queryFn:  () => getDeviceUnitHistory(globalDev!.id),
    enabled:  !!globalDev?.id,
  })

  // Find current active unit assignment for this device
  const currentUnitEntry = (unitHistory as DeviceUnitHistoryEntry[]).find(h => !h.released_at)
  const currentUnitId    = currentUnitEntry?.unit_id ?? null

  const { data: analytics } = useQuery({
    queryKey: ['unit-analytics', currentUnitId, RANGE_MAP[chartRange]],
    queryFn:  () => getUnitAnalytics(currentUnitId!, RANGE_MAP[chartRange]),
    enabled:  !!currentUnitId,
  })

  const today = new Date().toISOString().slice(0, 10)
  const { data: logsAll = [] } = useQuery({
    queryKey: ['timbangan-logs', today],
    queryFn:  () => getTimbanganLogs(today),
  })

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn:  getLocations,
    enabled:  editOpen,
  })

  // Find logs for the current unit (by unit_id)
  const deviceLogs = logsAll.find(d => d.unit_id === currentUnitId)?.logs ?? []
  const recentLogs = deviceLogs.slice(0, 5)

  const timeSeries  = analytics?.time_series ?? []
  const dailyToday  = analytics?.daily_data?.[0]
  const todayCount  = dailyToday?.count ?? 0
  const todayAvg    = dailyToday?.avg_weight ?? 0
  const todayMax    = timeSeries.length ? Math.max(...timeSeries.map(t => t.weight)) : 0

  const chartData = timeSeries.map(t => ({
    time:   new Date(t.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
    weight: t.weight,
  }))

  const statusLabel = !timbangan?.online
    ? 'Offline'
    : timbangan?.expired
      ? 'Expired'
      : timbangan?.consumed
        ? 'Consumed'
        : 'Available'

  const statusColor = !timbangan?.online
    ? '#F44336'
    : timbangan?.expired
      ? '#FF9800'
      : timbangan?.consumed
        ? '#FFC107'
        : '#4CAF50'

  function openEdit() {
    setEditName(timbangan?.name ?? '')
    setEditLocation(timbangan?.location_id ?? '')
    setEditOpen(true)
  }

  async function handleEdit() {
    setEditSaving(true)
    try {
      await updateTimbanganDevice(devId, {
        name:     editName || undefined,
        location: editLocation || undefined,
      })
      await refetchDevice()
      setEditOpen(false)
      toast.success('Device updated')
    } catch {
      toast.error('Failed to update device')
    } finally {
      setEditSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteTimbanganDevice(devId)
      toast.success('Device deleted')
      navigate('/timbangan/devices')
    } catch {
      toast.error('Failed to delete device')
    } finally {
      setDeleting(false)
    }
  }

  function handleExportCSV() {
    if (!currentUnitId) return
    window.open(getExportCsvUrl(currentUnitId, today), '_blank')
  }

  async function handleQuickCreateLocation() {
    if (!locQuickName.trim()) { toast.error('Location name is required'); return }
    setLocQuickCreating(true)
    try {
      const created = await createLocation(locQuickName.trim(), locQuickAddr.trim() || undefined)
      qc.invalidateQueries({ queryKey: ['locations'] })
      setEditLocation(created.name)
      setLocQuickOpen(false)
      setLocQuickName('')
      setLocQuickAddr('')
      toast.success('Location created')
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to create location')
    } finally {
      setLocQuickCreating(false)
    }
  }

  if (loadingT) {
    return (
      <div className="flex items-center justify-center h-full py-32">
        <p className="font-mono text-sm" style={{ color: 'var(--c-muted)' }}>Loading device...</p>
      </div>
    )
  }

  if (!timbangan) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-32 gap-4">
        <p className="text-white text-lg font-semibold">Device not found</p>
        <button onClick={() => navigate('/timbangan/devices')}
          className="font-mono text-sm" style={{ color: '#C9A84C' }}>
          ← Back to Devices
        </button>
      </div>
    )
  }

  const macParts  = globalDev?.mac?.split(':') ?? []
  const bleSuffix = macParts.length === 6
    ? `${macParts[3]}${macParts[4]}${macParts[5]}`.toUpperCase()
    : null
  const serialNum = bleSuffix ? `Kapitmas-timbangan-${bleSuffix}` : '—'
  const modelName = globalDev?.chip ?? (globalDev?.config as any)?.model ?? '—'

  return (
    <div className="flex flex-col min-h-full">

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-20 flex items-center justify-between px-6 py-4 border-b"
        style={{ background: 'rgba(var(--bg-surface-rgb),0.95)', borderColor: 'var(--c-border)', backdropFilter: 'blur(12px)' }}>
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/timbangan/devices')}
            className="p-2 rounded-lg transition-colors hover:bg-white/5" style={{ color: 'var(--c-muted)' }}>
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-white text-lg font-semibold leading-none">{timbangan.name}</h1>
            {timbangan.location_id && (
              <div className="flex items-center gap-1 mt-1">
                <MapPin size={10} style={{ color: 'var(--c-muted)' }} />
                <span className="font-mono text-[10px]" style={{ color: 'var(--c-muted)' }}>{timbangan.location_id}</span>
              </div>
            )}
          </div>
          {/* Online badge */}
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full"
            style={{ background: `${timbangan.online ? '#4CAF50' : '#F44336'}18`, border: `1px solid ${timbangan.online ? '#4CAF50' : '#F44336'}44` }}>
            <motion.span className="w-1.5 h-1.5 rounded-full"
              style={{ background: timbangan.online ? '#4CAF50' : '#F44336' }}
              animate={timbangan.online ? { opacity: [1, 0.4, 1] } : {}}
              transition={{ repeat: Infinity, duration: 2 }}
            />
            <span className="font-mono text-[10px] font-bold uppercase"
              style={{ color: timbangan.online ? '#4CAF50' : '#F44336' }}>
              {timbangan.online ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs" style={{ color: 'var(--c-muted)' }}>
            Last seen: {timbangan.last_seen ? fmtTime(timbangan.last_seen) : 'Never'}
          </span>
          <button className="p-2 rounded-lg transition-colors hover:bg-white/5" style={{ color: 'var(--c-muted)' }}>
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="p-6 flex flex-col gap-6 max-w-5xl">

        {/* Current Load + Stats */}
        <div className="rounded-xl p-6 flex flex-col gap-5"
          style={{ background: 'rgba(var(--bg-surface-rgb),0.70)', border: '1px solid rgba(201,168,76,0.35)', backdropFilter: 'blur(8px)' }}>
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
                Current Load
              </span>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: statusColor }} />
                <span className="text-sm font-medium" style={{ color: statusColor }}>{statusLabel}</span>
              </div>
            </div>
            <span className="font-mono text-xs" style={{ color: 'var(--c-muted)' }}>
              {timbangan.timestamp ? fmtTime(timbangan.timestamp) : '—'}
            </span>
          </div>

          {/* Weight */}
          <div className="flex items-baseline gap-2 pb-2">
            <span className="font-mono font-bold tabular-nums" style={{ fontSize: 52, lineHeight: 1, color: '#C9A84C' }}>
              {timbangan.weight != null ? (timbangan.weight_str ?? String(timbangan.weight)) : '—'}
            </span>
            {timbangan.weight != null && (
              <span className="text-2xl font-medium" style={{ color: 'var(--c-muted)' }}>{timbangan.unit ?? 'kg'}</span>
            )}
          </div>

          {/* Today's stats */}
          <div className="pt-4 border-t flex flex-wrap gap-8" style={{ borderColor: 'var(--c-border)' }}>
            {[
              { label: "Today's Total", value: todayCount,          unit: 'msr' },
              { label: 'Average',       value: todayAvg.toFixed(1), unit: timbangan.unit ?? 'kg' },
              { label: 'Max',           value: todayMax.toFixed(1), unit: timbangan.unit ?? 'kg' },
            ].map(({ label, value, unit }) => (
              <div key={label} className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-wide" style={{ color: 'var(--c-muted)' }}>{label}</span>
                <div className="flex items-baseline gap-1">
                  <span className="font-mono text-base font-semibold text-white">{value}</span>
                  <span className="font-mono text-xs" style={{ color: 'var(--c-muted)' }}>{unit}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              className="flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-bold transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #C9A84C, #E8C96A)', color: 'var(--bg-base)' }}
            >
              <CheckCircle2 size={15} />
              Mark as Consumed
            </button>
            <button
              className="p-3 rounded-lg transition-colors hover:bg-white/5"
              style={{ border: '1px solid var(--c-border)', color: '#C9A84C' }}
              title="Analytics"
              onClick={() => navigate('/timbangan/analytics')}
            >
              <Activity size={16} />
            </button>
          </div>
        </div>

        {/* Weight History Chart */}
        <div className="rounded-xl p-6 flex flex-col gap-5"
          style={{ background: 'rgba(var(--bg-surface-rgb),0.70)', border: '1px solid var(--c-border)' }}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <BarChart2 size={16} style={{ color: '#C9A84C' }} />
              <span className="text-white text-base font-medium">Weight History</span>
            </div>
            <div className="flex p-0.5 rounded-lg gap-0.5" style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)' }}>
              {(['24H', '7D', '30D'] as ChartRange[]).map(r => (
                <button key={r} onClick={() => setChartRange(r)}
                  className="px-4 py-1.5 rounded-md font-mono text-xs transition-all"
                  style={chartRange === r
                    ? { background: 'var(--c-border)', color: '#C9A84C' }
                    : { color: 'var(--c-muted)' }
                  }>{r}</button>
              ))}
            </div>
          </div>

          <div style={{ height: 180 }}>
            {chartData.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="font-mono text-xs" style={{ color: 'var(--c-faint)' }}>No data for this period</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="wGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#C9A84C" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#C9A84C" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke={colors.border} strokeDasharray="3 3" />
                  <XAxis dataKey="time" tick={{ fontFamily: 'JetBrains Mono', fontSize: 9, fill: colors.muted }}
                    axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontFamily: 'JetBrains Mono', fontSize: 9, fill: colors.muted }}
                    axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-base)', border: '1px solid #C9A84C', borderRadius: 8, fontFamily: 'JetBrains Mono', fontSize: 11 }}
                    labelStyle={{ color: '#C9A84C', fontSize: 10 }}
                    itemStyle={{ color: 'var(--c-primary)' }}
                    formatter={(v) => [`${Number(v)} ${timbangan.unit ?? 'kg'}`, 'Weight']}
                  />
                  <Area type="monotone" dataKey="weight" stroke="#C9A84C" strokeWidth={1.5}
                    fill="url(#wGrad)" dot={false} activeDot={{ r: 3, fill: '#C9A84C' }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Device info tables */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SectionCard title="Device Identity">
            <InfoRow label="Internal Name"  value={timbangan.name} />
            <InfoRow label="Serial Number"  value={serialNum} />
            <InfoRow label="Location"       value={timbangan.location_id ?? '—'} />
          </SectionCard>

          <SectionCard title="Network">
            <InfoRow label="MAC Address"   value={globalDev?.mac ?? '—'} />
            <InfoRow label="IP Address"    value={globalDev?.ip_address ?? '—'} />
            <InfoRow label="RSSI Strength"
              value={timbangan.rssi != null
                ? <span className="flex items-center gap-1.5">
                    <Wifi size={12} style={{ color: rssiColor(timbangan.rssi) }} />
                    {timbangan.rssi} dBm
                  </span>
                : '—'
              }
              valueColor={timbangan.rssi != null ? rssiColor(timbangan.rssi) : undefined}
            />
          </SectionCard>

          <SectionCard title="Hardware & Firmware">
            <InfoRow label="Model"            value={modelName} />
            <InfoRow label="Firmware Version" value={timbangan.firmware ?? '—'} />
            <InfoRow label="Last Calibrated"  value="—" />
          </SectionCard>

          <SectionCard title="Timestamps">
            <InfoRow label="Provisioned On"   value={fmt(globalDev?.registered_at ?? null)} />
            <InfoRow label="Last OTA Update"  value="—" />
            <InfoRow label="Warranty Expiry"  value="—" />
          </SectionCard>
        </div>

        {/* Recent Logs */}
        <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(var(--bg-surface-rgb),0.70)', border: '1px solid var(--c-border)' }}>
          <div className="px-6 py-4 border-b flex items-center justify-between"
            style={{ borderColor: 'var(--c-border)' }}>
            <div className="flex items-center gap-2">
              <Activity size={14} style={{ color: '#C9A84C' }} />
              <span className="text-white text-sm font-medium">Recent Logs</span>
            </div>
            <button onClick={() => {
                const unitName = logsAll.find(d => d.unit_id === currentUnitId)?.unit_name
                navigate(`/timbangan/logs${unitName ? `?unit=${encodeURIComponent(unitName)}` : ''}`)
              }}
              className="font-mono text-[10px] uppercase tracking-wider transition-opacity hover:opacity-70"
              style={{ color: '#C9A84C' }}>
              View All Logs →
            </button>
          </div>

          {recentLogs.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <p className="text-sm" style={{ color: 'var(--c-muted)' }}>No logs for today</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr style={{ background: 'var(--bg-base)', borderBottom: '1px solid var(--c-border)' }}>
                  {['Timestamp', 'Weight', 'Used By', 'Status'].map(col => (
                    <th key={col} className="px-5 py-2.5 text-left font-mono text-[9px] uppercase tracking-widest"
                      style={{ color: 'var(--c-muted)' }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentLogs.map((log, i) => (
                  <tr key={log.id}
                    className="border-b transition-colors hover:bg-white/[0.02]"
                    style={{ borderColor: 'rgba(var(--c-border-rgb), 0.27)', background: i % 2 ? 'rgba(var(--bg-base-rgb),0.20)' : undefined }}>
                    <td className="px-5 py-3">
                      <span className="font-mono text-xs" style={{ color: '#CBD0D8' }}>
                        {fmtTime(log.timestamp)}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="font-mono text-sm font-medium" style={{ color: '#C9A84C' }}>
                        {log.weight.toFixed(3)} {log.unit ?? timbangan.unit ?? 'kg'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="font-mono text-xs" style={{ color: '#CBD0D8' }}>
                        {log.used_for ?? '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="px-2 py-0.5 rounded font-mono text-[9px] font-bold uppercase"
                        style={{ background: 'rgba(76,175,80,0.10)', color: '#4CAF50', border: '1px solid rgba(76,175,80,0.25)' }}>
                        Synced
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Unit Assignment History */}
        <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(var(--bg-surface-rgb),0.70)', border: '1px solid var(--c-border)' }}>
          <div className="px-6 py-4 border-b flex items-center gap-2"
            style={{ borderColor: 'var(--c-border)' }}>
            <Layers size={14} style={{ color: '#C9A84C' }} />
            <span className="text-white text-sm font-medium">Unit Assignment History</span>
            <span className="font-mono text-[10px] ml-auto" style={{ color: 'var(--c-muted)' }}>
              {(unitHistory as DeviceUnitHistoryEntry[]).length} entries
            </span>
          </div>

          {(unitHistory as DeviceUnitHistoryEntry[]).length === 0 ? (
            <div className="px-6 py-10 flex flex-col items-center gap-2">
              <Clock size={22} style={{ color: 'var(--c-border)' }} />
              <p className="text-sm" style={{ color: 'var(--c-muted)' }}>No unit assignment history yet</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr style={{ background: 'var(--bg-base)', borderBottom: '1px solid var(--c-border)' }}>
                  {['Unit ID', 'Unit Name', 'Type', 'Location', 'From', 'Until'].map(col => (
                    <th key={col} className="px-5 py-2.5 text-left font-mono text-[9px] uppercase tracking-widest"
                      style={{ color: 'var(--c-muted)' }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(unitHistory as DeviceUnitHistoryEntry[]).map((entry, i) => {
                  const isActive = !entry.released_at
                  const typeColors: Record<string, string> = {
                    timbangan: '#C9A84C', doorlock: '#4A90D9', smartbuddy: '#CE93D8', other: 'var(--c-muted)',
                  }
                  const tc = typeColors[entry.unit_type] ?? 'var(--c-muted)'
                  return (
                    <tr key={entry.id}
                      className="border-b transition-colors hover:bg-white/[0.02]"
                      style={{ borderColor: 'rgba(var(--c-border-rgb), 0.27)', background: isActive ? `${tc}06` : (i % 2 ? 'rgba(var(--bg-base-rgb),0.20)' : undefined) }}>
                      <td className="px-5 py-3">
                        <span className="font-mono text-xs" style={{ color: tc }}>{entry.unit_code}</span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-white">{entry.unit_name}</span>
                          {isActive && (
                            <span className="font-mono text-[8px] px-1.5 py-0.5 rounded uppercase font-bold"
                              style={{ background: 'rgba(76,175,80,0.12)', color: '#4CAF50', border: '1px solid rgba(76,175,80,0.25)' }}>
                              Active
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-mono text-[9px] px-1.5 py-0.5 rounded uppercase"
                          style={{ background: `${tc}15`, color: tc, border: `1px solid ${tc}30` }}>
                          {entry.unit_type}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {entry.location_name ? (
                          <div className="flex items-center gap-1">
                            <MapPin size={10} style={{ color: 'var(--c-muted)' }} />
                            <span className="text-xs" style={{ color: 'var(--c-muted)' }}>{entry.location_name}</span>
                          </div>
                        ) : <span style={{ color: 'var(--c-faint)' }}>—</span>}
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-mono text-[10px]" style={{ color: '#CBD0D8' }}>
                          {fmt(entry.assigned_at)}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-mono text-[10px]" style={{ color: isActive ? '#4CAF50' : 'var(--c-dim)' }}>
                          {entry.released_at ? fmt(entry.released_at) : '— present'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3 pb-6">
          {[
            { label: 'Analytics',  Icon: BarChart2,     action: () => navigate('/timbangan/analytics'), permission: 'report.view'    },
            { label: 'Export CSV', Icon: Download,      action: handleExportCSV,                        permission: 'report.export'  },
            { label: 'OTA Update', Icon: ArrowUpCircle, action: () => navigate('/timbangan/ota'),       permission: 'timbangan.ota'  },
            { label: 'Edit',       Icon: Edit2,         action: openEdit,                               permission: 'timbangan.edit' },
          ].filter(btn => can(btn.permission)).map(({ label, Icon, action }) => (
            <button key={label} onClick={action}
              className="flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-medium transition-colors hover:bg-white/5"
              style={{ border: '1px solid #C9A84C55', color: '#C9A84C' }}>
              <Icon size={15} />
              {label}
            </button>
          ))}
          {can('timbangan.delete') && (
            <button
              onClick={() => setDeleteOpen(true)}
              className="flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-medium transition-colors hover:bg-red-500/10"
              style={{ border: '1px solid rgba(244,67,54,0.35)', color: '#F44336' }}>
              <Trash2 size={15} />
              Delete
            </button>
          )}
        </div>

        {/* ── Edit Modal ── */}
        <AnimatePresence>
          {editOpen && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
              onClick={() => setEditOpen(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="w-full max-w-sm p-6 rounded-2xl flex flex-col gap-5"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--c-border)' }}
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-white font-semibold">Edit Device</h3>
                  <button onClick={() => setEditOpen(false)}
                    className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                    style={{ color: 'var(--c-muted)' }}>
                    <X size={16} />
                  </button>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
                      Name
                    </label>
                    <input
                      type="text" value={editName}
                      onChange={e => setEditName(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none transition-all"
                      style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
                      onFocus={e => (e.currentTarget.style.borderColor = '#C9A84C')}
                      onBlur={e  => (e.currentTarget.style.borderColor = 'var(--c-border)')}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
                        Location
                      </label>
                      <button
                        type="button"
                        onClick={() => { setLocQuickName(''); setLocQuickAddr(''); setLocQuickOpen(true) }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-mono transition-colors hover:bg-white/5"
                        style={{ color: '#C9A84C', border: '1px solid rgba(201,168,76,0.25)' }}>
                        <Plus size={10} />
                        New
                      </button>
                    </div>
                    <select
                      value={editLocation}
                      onChange={e => setEditLocation(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none transition-all appearance-none"
                      style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
                      onFocus={e => (e.currentTarget.style.borderColor = '#C9A84C')}
                      onBlur={e  => (e.currentTarget.style.borderColor = 'var(--c-border)')}
                    >
                      <option value="">— None —</option>
                      {locations.map(loc => (
                        <option key={loc.id} value={loc.name}>{loc.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button onClick={() => setEditOpen(false)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium"
                    style={{ border: '1px solid var(--c-border)', color: 'var(--c-muted)' }}>
                    Cancel
                  </button>
                  <button
                    onClick={handleEdit}
                    disabled={editSaving}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #C9A84C, #E8C96A)', color: 'var(--bg-base)' }}>
                    {editSaving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Quick Create Location ── */}
        <AnimatePresence>
          {locQuickOpen && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] flex items-center justify-center p-4"
              style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
              onClick={() => setLocQuickOpen(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="w-full max-w-xs p-5 rounded-2xl flex flex-col gap-4"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--c-border)' }}
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-white text-sm font-semibold">New Location</h4>
                  <button onClick={() => setLocQuickOpen(false)}
                    className="p-1 rounded-lg hover:bg-white/5 transition-colors" style={{ color: 'var(--c-muted)' }}>
                    <X size={14} />
                  </button>
                </div>
                <div className="flex flex-col gap-2.5">
                  <div className="flex flex-col gap-1.5">
                    <label className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Name</label>
                    <input
                      type="text" value={locQuickName} onChange={e => setLocQuickName(e.target.value)}
                      placeholder="e.g. Warehouse A" autoFocus
                      className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none transition-all"
                      style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
                      onFocus={e => (e.currentTarget.style.borderColor = '#C9A84C')}
                      onBlur={e  => (e.currentTarget.style.borderColor = 'var(--c-border)')}
                      onKeyDown={e => e.key === 'Enter' && handleQuickCreateLocation()}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Address (optional)</label>
                    <input
                      type="text" value={locQuickAddr} onChange={e => setLocQuickAddr(e.target.value)}
                      placeholder="123 Example St"
                      className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none transition-all"
                      style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
                      onFocus={e => (e.currentTarget.style.borderColor = '#C9A84C')}
                      onBlur={e  => (e.currentTarget.style.borderColor = 'var(--c-border)')}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setLocQuickOpen(false)}
                    className="flex-1 py-2 rounded-xl text-sm font-medium"
                    style={{ border: '1px solid var(--c-border)', color: 'var(--c-muted)' }}>
                    Cancel
                  </button>
                  <button
                    onClick={handleQuickCreateLocation}
                    disabled={locQuickCreating}
                    className="flex-1 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #C9A84C, #E8C96A)', color: 'var(--bg-base)' }}>
                    {locQuickCreating ? 'Creating...' : 'Create'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Delete Confirm ── */}
        <AnimatePresence>
          {deleteOpen && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
              onClick={() => setDeleteOpen(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="w-full max-w-sm p-6 rounded-2xl flex flex-col gap-5"
                style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(244,67,54,0.35)' }}
                onClick={e => e.stopPropagation()}
              >
                <div>
                  <h3 className="text-white font-semibold">Delete Device?</h3>
                  <p className="text-sm mt-2" style={{ color: 'var(--c-muted)' }}>
                    Device <span className="text-white font-medium">{timbangan.name}</span> will be
                    permanently deleted along with all its log data. This action cannot be undone.
                  </p>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setDeleteOpen(false)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium"
                    style={{ border: '1px solid var(--c-border)', color: 'var(--c-muted)' }}>
                    Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: 'rgba(244,67,54,0.90)', color: 'var(--c-primary)' }}>
                    {deleting ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  )
}
