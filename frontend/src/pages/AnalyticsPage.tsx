import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  LineChart, Line, BarChart, Bar, ComposedChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from 'recharts'
import {
  getAnalyticsOverview, getUnitAnalytics, getAssetUnits, getTimbanganDevices,
} from '@/lib/api'
import { Calendar, TrendingUp, Activity, BarChart2, Download } from 'lucide-react'
import { toast } from 'sonner'
import { useColors } from '@/lib/theme'

const toWIBLabel = (time: string): string => {
  const d = new Date(time.includes('Z') || time.includes('+') ? time : time + 'Z')
  return time.length > 10
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

type Range = 'today' | '7d' | '30d' | '90d'
const RANGE_LABELS: [Range, string][] = [['today', 'Today'], ['7d', '7 Days'], ['30d', '30 Days'], ['90d', '90 Days']]
const COLORS = ['#C9A84C', '#4A90D9', '#4CAF50', '#F44336', '#FFC107', '#A78BFA', '#34D399', '#F87171']
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const TT = { background: 'var(--bg-base)', border: '1px solid #C9A84C', borderRadius: 8, fontFamily: 'JetBrains Mono', fontSize: 11, color: 'var(--c-primary)' }
const TT_LABEL = { color: '#C9A84C', fontSize: 10 }

function SCard({ label, value, Icon, color }: { label: string; value: string | number; Icon: React.FC<any>; color: string }) {
  return (
    <div className="p-5 rounded-xl flex flex-col gap-3"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)', borderTop: `2px solid ${color}` }}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>{label}</span>
        <div className="w-8 h-8 flex items-center justify-center rounded-lg" style={{ background: `${color}20`, color }}>
          <Icon size={14} />
        </div>
      </div>
      <span className="font-mono text-2xl font-bold text-white">{value}</span>
    </div>
  )
}

function Section({ accent = '#C9A84C', title, children }: { accent?: string; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-6 flex flex-col gap-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
      <div className="flex items-center gap-2.5">
        <span className="w-1 h-5 rounded-full" style={{ background: accent }} />
        <h2 className="text-white text-base font-semibold">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function Empty({ loading }: { loading?: boolean }) {
  return (
    <div className="h-full flex items-center justify-center">
      <p className="text-sm" style={{ color: 'var(--c-muted)' }}>{loading ? 'Loading…' : 'No data for selected range'}</p>
    </div>
  )
}

export default function AnalyticsPage() {
  const colors = useColors()
  const [range, setRange]          = useState<Range>('7d')
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null)

  const { data: overview, isLoading: ovLoading } = useQuery({
    queryKey: ['analytics-overview', range],
    queryFn:  () => getAnalyticsOverview(range),
  })

  const { data: assetUnits = [] } = useQuery({
    queryKey: ['asset-units', 'timbangan'],
    queryFn:  () => getAssetUnits(undefined, 'timbangan'),
  })

  const activeUnitId = selectedUnit ?? assetUnits[0]?.id ?? null

  const { data: timbanganDevices = [] } = useQuery({
    queryKey: ['timbangan-devices'],
    queryFn:  getTimbanganDevices,
  })

  const activeAssetUnit      = assetUnits.find(u => u.id === activeUnitId)
  const activeTimbanganDev   = timbanganDevices.find(d => d.device_id === activeAssetUnit?.device_id)
  const selectedDeviceUnit   = activeTimbanganDev?.unit ?? 'kg'
  const commonUnit           = timbanganDevices[0]?.unit ?? 'kg'

  const { data: deviceAnalytics, isLoading: devLoading } = useQuery({
    queryKey: ['analytics-unit', activeUnitId, range],
    queryFn:  () => getUnitAnalytics(activeUnitId!, range),
    enabled:  activeUnitId != null,
  })

  // Merge per-device time series into flat array for LineChart
  const allScalesData = useMemo(() => {
    if (!overview?.time_series) return []
    const names = Object.keys(overview.time_series)
    const map = new Map<string, Record<string, number>>()
    for (const name of names) {
      for (const pt of overview.time_series[name]) {
        if (!map.has(pt.time)) map.set(pt.time, {})
        map.get(pt.time)![name] = pt.avg_weight
      }
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([time, vals]) => ({
        time: toWIBLabel(time),
        ...vals,
      }))
  }, [overview])

  const deviceNames = overview ? Object.keys(overview.time_series) : []

  // Derive peak hours from heatmap (sum all days per hour)
  const peakHoursData = useMemo(() => {
    if (!overview?.heatmap) return []
    return Array.from({ length: 24 }, (_, h) => ({
      hour:  `${h.toString().padStart(2, '0')}:00`,
      count: overview.heatmap.reduce((s, row) => s + (row[h] ?? 0), 0),
    }))
  }, [overview])

  const heatmapMax = useMemo(
    () => Math.max(1, ...(overview?.heatmap?.flat() ?? [0])),
    [overview]
  )

  function exportCSV() {
    if (!overview) return
    const rows = [['Device', 'Time', `Avg Weight (${commonUnit})`, 'Count', `Total Weight (${commonUnit})`]]
    for (const [name, pts] of Object.entries(overview.time_series)) {
      for (const pt of pts)
        rows.push([name, pt.time, String(pt.avg_weight), String(pt.count), String(pt.total_weight)])
    }
    const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = Object.assign(document.createElement('a'), {
      href: url, download: `analytics_${range}_${new Date().toISOString().slice(0, 10)}.csv`,
    })
    a.click(); URL.revokeObjectURL(url)
    toast.success('CSV exported')
  }

  const s      = overview?.summary
  const fmtKg  = (v?: number) => v != null ? `${v.toFixed(2)} ${commonUnit}` : '—'
  const fmtNum = (v?: number) => v != null ? v.toLocaleString() : '—'

  return (
    <div className="p-6 flex flex-col gap-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-white text-2xl font-bold">Analytics</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--c-muted)' }}>Weight trends, device comparison, and usage patterns</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex p-0.5 rounded-xl" style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)' }}>
            {RANGE_LABELS.map(([r, label]) => (
              <button key={r} onClick={() => setRange(r)}
                className="px-4 py-2 rounded-lg font-mono text-[10px] uppercase tracking-wider font-bold transition-all"
                style={range === r
                  ? { background: 'var(--bg-surface)', color: '#C9A84C', border: '1px solid var(--c-border)' }
                  : { color: 'var(--c-muted)', border: '1px solid transparent' }
                }>
                {label}
              </button>
            ))}
          </div>
          <button onClick={exportCSV} disabled={!overview}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: 'rgba(74,144,217,0.15)', color: '#4A90D9', border: '1px solid rgba(74,144,217,0.30)' }}>
            <Download size={14} />
            Export CSV
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SCard label="Total Measurements" value={fmtNum(s?.total_measurements)} Icon={Activity}   color="#C9A84C" />
        <SCard label="Average Weight"     value={fmtKg(s?.avg_weight)}          Icon={TrendingUp} color="#4A90D9" />
        <SCard label="Minimum Weight"     value={fmtKg(s?.min_weight)}          Icon={BarChart2}  color="#4CAF50" />
        <SCard label="Maximum Weight"     value={fmtKg(s?.max_weight)}          Icon={Calendar}   color="#FFC107" />
      </div>

      {/* All scales comparison */}
      <Section title="All Scales — Weight Comparison">
        <div className="h-72">
          {allScalesData.length === 0
            ? <Empty loading={ovLoading} />
            : (
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <LineChart data={allScalesData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.border + '99'} vertical={false} />
                  <XAxis dataKey="time"
                    tick={{ fill: colors.muted, fontSize: 10, fontFamily: 'JetBrains Mono' }}
                    axisLine={{ stroke: colors.border }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: colors.muted, fontSize: 10, fontFamily: 'JetBrains Mono' }}
                    axisLine={false} tickLine={false} unit={` ${commonUnit}`} />
                  <Tooltip contentStyle={TT} labelStyle={TT_LABEL}
                    formatter={(v: unknown) => [`${Number(v).toFixed(2)} ${commonUnit}`]} />
                  <Legend wrapperStyle={{ paddingTop: 12, borderTop: '1px solid var(--c-border)', fontSize: 11, color: 'var(--c-muted)' }} />
                  {deviceNames.map((name, i) => (
                    <Line key={name} type="monotone" dataKey={name}
                      stroke={COLORS[i % COLORS.length]} strokeWidth={1.5}
                      dot={false} connectNulls activeDot={{ r: 4, strokeWidth: 0 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )
          }
        </div>
      </Section>

      {/* Measurements per scale + Peak hours */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section accent="#4A90D9" title="Measurements per Scale">
          <div className="h-56">
            {!overview?.device_comparison?.length
              ? <Empty loading={ovLoading} />
              : (
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <BarChart data={overview.device_comparison} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={colors.border + '99'} vertical={false} />
                    <XAxis dataKey="device_name" tick={{ fill: colors.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: colors.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={TT} labelStyle={TT_LABEL} />
                    <Bar dataKey="count" name="Measurements" fill="#4A90D9" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )
            }
          </div>
        </Section>

        <Section accent="#FFC107" title="Peak Usage Hours">
          <div className="h-56">
            {peakHoursData.length === 0
              ? <Empty loading={ovLoading} />
              : (
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <ComposedChart data={peakHoursData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={colors.border + '99'} vertical={false} />
                    <XAxis dataKey="hour" tick={{ fill: colors.muted, fontSize: 9, fontFamily: 'JetBrains Mono' }}
                      axisLine={false} tickLine={false} interval={3} />
                    <YAxis tick={{ fill: colors.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={TT} labelStyle={TT_LABEL} />
                    <Area type="monotone" dataKey="count"
                      fill="rgba(255,193,7,0.10)" stroke="rgba(255,193,7,0.30)" strokeWidth={1} />
                    <Bar dataKey="count" fill="#FFC107" radius={[3, 3, 0, 0]} opacity={0.85} />
                  </ComposedChart>
                </ResponsiveContainer>
              )
            }
          </div>
        </Section>
      </div>

      {/* Activity heatmap */}
      <Section accent="#4CAF50" title="Activity Heatmap — Day × Hour">
        {!overview?.heatmap
          ? <Empty loading={ovLoading} />
          : (
            <div className="overflow-x-auto">
              <div className="flex flex-col gap-1 min-w-[640px]">
                {/* Hour axis labels */}
                <div className="flex gap-1 pl-10">
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="flex-1 text-center font-mono text-[8px]" style={{ color: 'var(--c-faint)' }}>
                      {h % 3 === 0 ? h.toString().padStart(2, '0') : ''}
                    </div>
                  ))}
                </div>
                {/* Day rows */}
                {DAYS.map((day, di) => (
                  <div key={day} className="flex items-center gap-1">
                    <span className="w-9 text-right font-mono text-[9px] flex-shrink-0 pr-1" style={{ color: 'var(--c-muted)' }}>{day}</span>
                    {Array.from({ length: 24 }, (_, h) => {
                      const v = overview.heatmap[di]?.[h] ?? 0
                      const intensity = v / heatmapMax
                      return (
                        <div key={h}
                          title={`${day} ${h.toString().padStart(2, '0')}:00 — ${v} measurement${v !== 1 ? 's' : ''}`}
                          className="flex-1 h-6 rounded-sm"
                          style={{
                            background: intensity === 0
                              ? 'rgba(var(--c-border-rgb),0.40)'
                              : `rgba(76,175,80,${(0.15 + intensity * 0.85).toFixed(2)})`,
                          }}
                        />
                      )
                    })}
                  </div>
                ))}
                {/* Legend */}
                <div className="flex items-center gap-2 mt-2 pl-10">
                  <span className="font-mono text-[9px]" style={{ color: 'var(--c-faint)' }}>Less</span>
                  {[0.15, 0.35, 0.55, 0.75, 1.0].map(v => (
                    <div key={v} className="w-4 h-4 rounded-sm" style={{ background: `rgba(76,175,80,${v})` }} />
                  ))}
                  <span className="font-mono text-[9px]" style={{ color: 'var(--c-faint)' }}>More</span>
                </div>
              </div>
            </div>
          )
        }
      </Section>

      {/* Per unit analysis */}
      <Section accent="#A78BFA" title="Per Unit Analysis">
        <div className="flex items-center gap-3">
          <label className="font-mono text-[10px] uppercase tracking-widest flex-shrink-0" style={{ color: 'var(--c-muted)' }}>
            Unit
          </label>
          <select
            value={activeUnitId ?? ''}
            onChange={e => setSelectedUnit(e.target.value || null)}
            className="py-2.5 px-4 rounded-xl text-sm focus:outline-none transition-colors"
            style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
            onFocus={e => (e.currentTarget.style.borderColor = '#C9A84C')}
            onBlur={e  => (e.currentTarget.style.borderColor = 'var(--c-border)')}
          >
            {assetUnits.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>

        {!deviceAnalytics ? (
          <div className="h-40 flex items-center justify-center">
            <p className="text-sm" style={{ color: 'var(--c-muted)' }}>{devLoading ? 'Loading…' : 'Select a unit'}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Weight time series + Usage pie */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 flex flex-col gap-2">
                <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Weight Over Time</p>
                <div className="h-52">
                  {deviceAnalytics.time_series.length === 0
                    ? <Empty />
                    : (
                      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                        <LineChart data={deviceAnalytics.time_series} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke={colors.border + '99'} vertical={false} />
                          <XAxis dataKey="time" tick={{ fill: colors.muted, fontSize: 9, fontFamily: 'JetBrains Mono' }}
                            axisLine={false} tickLine={false} interval="preserveStartEnd" tickFormatter={toWIBLabel} />
                          <YAxis tick={{ fill: colors.muted, fontSize: 10 }} axisLine={false} tickLine={false} unit={` ${selectedDeviceUnit}`} />
                          <Tooltip contentStyle={TT} labelStyle={TT_LABEL}
                            formatter={(v: unknown) => [`${Number(v).toFixed(2)} ${selectedDeviceUnit}`]} />
                          <Line type="monotone" dataKey="weight" stroke="#A78BFA" strokeWidth={1.5}
                            dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: '#A78BFA' }} />
                        </LineChart>
                      </ResponsiveContainer>
                    )
                  }
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Usage by System</p>
                {deviceAnalytics.usage_data.length === 0
                  ? <div className="h-52 flex items-center justify-center"><Empty /></div>
                  : (
                    <div className="flex flex-col gap-2 w-full">
                      <ResponsiveContainer width="100%" height={160} minWidth={0}>
                        <PieChart>
                          <Pie data={deviceAnalytics.usage_data} dataKey="count" nameKey="system"
                            cx="50%" cy="50%" outerRadius={60} innerRadius={36} paddingAngle={2}>
                            {deviceAnalytics.usage_data.map((_, i) => (
                              <Cell key={i} fill={COLORS[i % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={TT} labelStyle={TT_LABEL} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="flex flex-col gap-1 w-full">
                        {deviceAnalytics.usage_data.map((u, i) => (
                          <div key={u.system} className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                              <span className="text-[10px]" style={{ color: 'var(--c-muted)' }}>{u.system}</span>
                            </div>
                            <span className="font-mono text-[10px] text-white">{u.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                }
              </div>
            </div>

            {/* Daily measurements */}
            <div className="flex flex-col gap-2">
              <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Daily Measurements</p>
              <div className="h-44">
                {deviceAnalytics.daily_data.length === 0
                  ? <Empty />
                  : (
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                      <BarChart data={deviceAnalytics.daily_data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={colors.border + '99'} vertical={false} />
                        <XAxis dataKey="date" tick={{ fill: colors.muted, fontSize: 9 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: colors.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={TT} labelStyle={TT_LABEL} />
                        <Bar dataKey="count" name="Measurements" fill="#A78BFA" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )
                }
              </div>
            </div>
          </div>
        )}
      </Section>

    </div>
  )
}
