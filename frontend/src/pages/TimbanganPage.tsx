import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Scale, MapPin, Clock, Search, RefreshCw, ArrowUpDown, Wifi } from 'lucide-react'
import { getTimbanganDevices } from '@/lib/api'
import { useSSE } from '@/lib/useSSE'
import type { SSEEvent } from '@/lib/useSSE'
import type { TimbanganDevice } from '@/lib/api'

type Filter = 'all' | 'online' | 'offline'
type SortKey = 'name' | 'weight' | 'status'

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60)  return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function rssiColor(rssi: number): string {
  if (rssi >= -60) return '#4CAF50'
  if (rssi >= -70) return '#8BC34A'
  if (rssi >= -80) return '#FFC107'
  return '#F44336'
}

function RssiBadge({ rssi }: { rssi: number | null }) {
  if (rssi == null) return null
  const color = rssiColor(rssi)
  return (
    <span className="flex items-center gap-1" title={`Signal: ${rssi} dBm`}>
      <Wifi size={9} style={{ color }} />
      <span className="font-mono text-[9px]" style={{ color }}>{rssi} dBm</span>
    </span>
  )
}

function WeightBadge({ device }: { device: TimbanganDevice }) {
  if (!device.online) return (
    <span className="px-2 py-0.5 rounded font-mono text-[9px] font-bold uppercase"
      style={{ background: 'rgba(244,67,54,0.12)', color: '#F44336', border: '1px solid rgba(244,67,54,0.25)' }}>
      Offline
    </span>
  )
  if (device.weight == null) return (
    <span className="px-2 py-0.5 rounded font-mono text-[9px] font-bold uppercase"
      style={{ background: 'rgba(160,168,192,0.10)', color: 'var(--c-muted)', border: '1px solid var(--c-border)' }}>
      No Data
    </span>
  )
  if (device.expired) return (
    <span className="px-2 py-0.5 rounded font-mono text-[9px] font-bold uppercase"
      style={{ background: 'rgba(255,152,0,0.12)', color: '#FF9800', border: '1px solid rgba(255,152,0,0.25)' }}>
      Expired
    </span>
  )
  if (device.consumed) return (
    <span className="px-2 py-0.5 rounded font-mono text-[9px] font-bold uppercase"
      style={{ background: 'rgba(255,193,7,0.12)', color: '#FFC107', border: '1px solid rgba(255,193,7,0.25)' }}>
      Consumed
    </span>
  )
  return (
    <span className="px-2 py-0.5 rounded font-mono text-[9px] font-bold uppercase"
      style={{ background: 'rgba(76,175,80,0.12)', color: '#4CAF50', border: '1px solid rgba(76,175,80,0.25)' }}>
      Available
    </span>
  )
}

function DeviceCard({ device }: { device: TimbanganDevice }) {
  const navigate = useNavigate()

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => navigate(`/timbangan/devices/${device.id}`)}
      className="p-5 rounded-xl flex flex-col gap-4 transition-all duration-200 cursor-pointer group"
      style={{
        background: 'var(--bg-surface)',
        border: `1px solid ${device.online ? 'var(--c-border)' : '#3D2020'}`,
      }}
      whileHover={{ borderColor: device.online ? '#C9A84C' : '#F44336', scale: 1.01 }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: device.online ? 'rgba(76,175,80,0.10)' : 'rgba(244,67,54,0.08)',
              border: `1px solid ${device.online ? 'rgba(76,175,80,0.25)' : 'rgba(244,67,54,0.20)'}`,
            }}>
            <Scale size={16} style={{ color: device.online ? '#4CAF50' : '#F44336' }} />
          </div>
          <div className="min-w-0">
            <p className="text-white text-sm font-semibold truncate">{device.name}</p>
            {device.location_id && (
              <p className="flex items-center gap-1 mt-0.5" style={{ color: 'var(--c-muted)' }}>
                <MapPin size={9} />
                <span className="font-mono text-[9px] truncate">{device.location_id}</span>
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <motion.span className="w-2 h-2 rounded-full"
            style={{ background: device.online ? '#4CAF50' : '#F44336' }}
            animate={device.online ? { opacity: [1, 0.4, 1] } : {}}
            transition={{ repeat: Infinity, duration: 2 }}
          />
          <span className="font-mono text-[9px] font-bold uppercase"
            style={{ color: device.online ? '#4CAF50' : '#F44336' }}>
            {device.online ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>

      {/* Weight */}
      <div className="flex items-end justify-between">
        <div>
          {device.weight != null ? (
            <div className="flex items-baseline gap-1">
              <span className="font-mono font-bold tabular-nums" style={{ fontSize: 36, color: 'var(--c-primary)' }}>
                {device.weight_str ?? String(device.weight)}
              </span>
              <span className="font-mono text-base font-medium" style={{ color: 'var(--c-muted)' }}>{device.unit ?? 'kg'}</span>
            </div>
          ) : (
            <span className="font-mono text-3xl font-bold" style={{ color: 'var(--c-border)' }}>—</span>
          )}
          {device.timestamp && (
            <p className="flex items-center gap-1 mt-1" style={{ color: 'var(--c-muted)' }}>
              <Clock size={9} />
              <span className="font-mono text-[9px]">{timeAgo(device.timestamp)}</span>
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <WeightBadge device={device} />
          {device.online && <RssiBadge rssi={device.rssi} />}
        </div>
      </div>

      {/* Footer: firmware */}
      {device.firmware && (
        <p className="font-mono text-[9px] uppercase tracking-wider pt-2" style={{
          color: 'var(--c-faint)', borderTop: '1px solid var(--c-border)',
        }}>
          FW: {device.firmware}
        </p>
      )}
    </motion.div>
  )
}

export default function TimbanganPage() {
  const [filter, setFilter]   = useState<Filter>('all')
  const [search, setSearch]   = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')

  const { data: devices = [], refetch, isFetching } = useQuery({
    queryKey: ['timbangan-devices'],
    queryFn: getTimbanganDevices,
    refetchInterval: 30_000,
  })

  const handleSSE = useCallback((e: SSEEvent) => {
    if (e.type === 'weight' || e.type === 'status') refetch()
  }, [refetch])

  useSSE(handleSSE)

  const filtered = devices
    .filter(d => {
      if (filter === 'online'  && !d.online) return false
      if (filter === 'offline' && d.online)  return false
      if (search && !d.name.toLowerCase().includes(search.toLowerCase()) &&
          !d.location_id?.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
    .sort((a, b) => {
      if (sortKey === 'status') return (b.online ? 1 : 0) - (a.online ? 1 : 0)
      if (sortKey === 'weight') return (b.weight ?? -1) - (a.weight ?? -1)
      return a.name.localeCompare(b.name)
    })

  const onlineCount  = devices.filter(d => d.online).length
  const offlineCount = devices.length - onlineCount

  return (
    <div className="p-6 flex flex-col gap-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-white text-2xl font-bold">Scales</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--c-muted)' }}>
            Industrial scale devices — realtime weight monitoring
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)', color: 'var(--c-muted)' }}
        >
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Status bar */}
      <div className="flex gap-3 flex-wrap">
        {[
          { label: 'Total',   value: devices.length,  color: '#C9A84C' },
          { label: 'Online',  value: onlineCount,      color: '#4CAF50' },
          { label: 'Offline', value: offlineCount,     color: '#F44336' },
        ].map(({ label, value, color }) => (
          <div key={label} className="flex items-center gap-2 px-4 py-2 rounded-xl"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
            <span className="font-mono text-xs" style={{ color: 'var(--c-muted)' }}>{label}</span>
            <span className="font-mono text-sm font-bold" style={{ color }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Filters + Search + Sort */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Filter tabs */}
        <div className="flex p-0.5 rounded-xl" style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
          {(['all', 'online', 'offline'] as Filter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="px-4 py-2 rounded-lg font-mono text-[10px] uppercase tracking-wider font-bold transition-all capitalize"
              style={filter === f
                ? { background: 'var(--bg-base)', color: '#C9A84C', border: '1px solid var(--c-border)' }
                : { color: 'var(--c-muted)', border: '1px solid transparent' }
              }>
              {f}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--c-muted)' }} />
          <input type="text" placeholder="Search by name or location..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm font-sans focus:outline-none transition-all"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
            onFocus={e => (e.currentTarget.style.borderColor = '#C9A84C')}
            onBlur={e  => (e.currentTarget.style.borderColor = 'var(--c-border)')}
          />
        </div>

        {/* Sort */}
        <div className="flex items-center gap-2">
          <ArrowUpDown size={12} style={{ color: 'var(--c-muted)' }} />
          <select
            value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}
            className="py-2.5 px-3 rounded-xl text-sm font-sans focus:outline-none"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)', color: 'var(--c-muted)' }}
          >
            <option value="name">Sort: Name</option>
            <option value="weight">Sort: Weight</option>
            <option value="status">Sort: Status</option>
          </select>
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)', borderRadius: 12 }}>
          <Scale size={40} style={{ color: 'var(--c-border)' }} />
          <p className="text-sm" style={{ color: 'var(--c-muted)' }}>No devices match your filter</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          <AnimatePresence>
            {filtered.map(dev => <DeviceCard key={dev.name} device={dev} />)}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
