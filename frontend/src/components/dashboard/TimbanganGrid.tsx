import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Scale, MapPin, Clock, RefreshCw, Wifi } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getTimbanganDevices } from '@/lib/api'
import { useSSE } from '@/lib/useSSE'
import type { SSEEvent } from '@/lib/useSSE'
import type { TimbanganDevice } from '@/lib/api'

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60)  return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
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
  if (!device.online) {
    return (
      <span
        className="px-2 py-0.5 rounded font-mono text-[9px] font-bold uppercase tracking-wider"
        style={{ background: 'rgba(244,67,54,0.12)', color: '#F44336', border: '1px solid rgba(244,67,54,0.25)' }}
      >
        Offline
      </span>
    )
  }
  if (device.weight == null) {
    return (
      <span
        className="px-2 py-0.5 rounded font-mono text-[9px] font-bold uppercase tracking-wider"
        style={{ background: 'rgba(160,168,192,0.10)', color: 'var(--c-muted)', border: '1px solid rgba(160,168,192,0.20)' }}
      >
        No Data
      </span>
    )
  }
  if (device.expired) {
    return (
      <span
        className="px-2 py-0.5 rounded font-mono text-[9px] font-bold uppercase tracking-wider"
        style={{ background: 'rgba(255,152,0,0.12)', color: '#FF9800', border: '1px solid rgba(255,152,0,0.25)' }}
      >
        Expired
      </span>
    )
  }
  if (device.consumed) {
    return (
      <span
        className="px-2 py-0.5 rounded font-mono text-[9px] font-bold uppercase tracking-wider"
        style={{ background: 'rgba(255,193,7,0.12)', color: '#FFC107', border: '1px solid rgba(255,193,7,0.25)' }}
      >
        Consumed
      </span>
    )
  }
  return (
    <span
      className="px-2 py-0.5 rounded font-mono text-[9px] font-bold uppercase tracking-wider"
      style={{ background: 'rgba(76,175,80,0.12)', color: '#4CAF50', border: '1px solid rgba(76,175,80,0.25)' }}
    >
      Available
    </span>
  )
}

function DeviceCard({
  device,
  freshId,
}: {
  device: TimbanganDevice
  freshId: string | null
}) {
  const isFresh  = freshId === device.name
  const isOnline = device.online
  const hasWeight = device.weight != null

  const borderColor = isOnline
    ? isFresh ? '#C9A84C' : '#4CAF50'
    : '#F44336'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="relative p-4 rounded-xl flex flex-col gap-3 overflow-hidden transition-all duration-300"
      style={{
        background: 'var(--bg-surface)',
        border: `1px solid ${borderColor}`,
        boxShadow: isFresh
          ? '0 0 16px rgba(201,168,76,0.20)'
          : isOnline
          ? '0 0 10px rgba(76,175,80,0.10)'
          : 'none',
      }}
    >
      {/* Fresh data flash overlay */}
      <AnimatePresence>
        {isFresh && (
          <motion.div
            key="flash"
            className="absolute inset-0 rounded-xl pointer-events-none"
            initial={{ opacity: 0.25 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 1.2 }}
            style={{ background: 'rgba(201,168,76,0.12)' }}
          />
        )}
      </AnimatePresence>

      {/* Header: device name + status dot */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0"
            style={{
              background: isOnline ? 'rgba(76,175,80,0.12)' : 'rgba(244,67,54,0.10)',
              color: isOnline ? '#4CAF50' : '#F44336',
            }}
          >
            <Scale size={13} />
          </div>
          <div className="min-w-0">
            <p className="text-white text-xs font-semibold truncate leading-tight">{device.name}</p>
            {device.location_id && (
              <p className="flex items-center gap-1 mt-0.5" style={{ color: 'var(--c-muted)' }}>
                <MapPin size={9} />
                <span className="font-mono text-[9px] truncate">{device.location_id}</span>
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <motion.span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: isOnline ? '#4CAF50' : '#F44336' }}
            animate={isOnline ? { opacity: [1, 0.4, 1] } : { opacity: 1 }}
            transition={{ repeat: Infinity, duration: 2 }}
          />
          <span className="font-mono text-[9px] font-bold uppercase" style={{ color: isOnline ? '#4CAF50' : '#F44336' }}>
            {isOnline ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>

      {/* Weight display */}
      <div className="flex items-end justify-between gap-2">
        <div>
          {hasWeight ? (
            <div className="flex items-baseline gap-1">
              <span
                className="font-mono font-bold tabular-nums leading-none"
                style={{ fontSize: 32, color: isFresh ? '#C9A84C' : 'var(--c-primary)' }}
              >
                {device.weight_str ?? String(device.weight!)}
              </span>
              <span className="font-mono text-sm font-medium" style={{ color: 'var(--c-muted)' }}>{device.unit ?? 'kg'}</span>
            </div>
          ) : (
            <span className="font-mono text-2xl font-bold" style={{ color: 'var(--c-border)' }}>—</span>
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
    </motion.div>
  )
}

export default function TimbanganGrid() {
  const [freshId, setFreshId] = useState<string | null>(null)
  const freshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: devices = [], refetch } = useQuery({
    queryKey: ['timbangan-devices'],
    queryFn: getTimbanganDevices,
    refetchInterval: 30_000,
  })

  const handleSSE = useCallback((e: SSEEvent) => {
    if (e.type === 'weight') {
      const name = (e.data as Record<string, unknown>).device_name as string | undefined
      if (name) {
        setFreshId(name)
        if (freshTimer.current) clearTimeout(freshTimer.current)
        freshTimer.current = setTimeout(() => setFreshId(null), 2500)
      }
      refetch()
    }
    if (e.type === 'status') refetch()
  }, [refetch])

  useSSE(handleSSE)

  useEffect(() => () => { if (freshTimer.current) clearTimeout(freshTimer.current) }, [])

  const sorted = [...devices].sort((a, b) => {
    if (a.online !== b.online) return b.online ? 1 : -1
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="w-1 h-5 rounded-full flex-shrink-0" style={{ background: '#C9A84C' }} />
          <h2 className="text-white text-base font-semibold">Realtime Timbangan</h2>
          <span
            className="px-2 py-0.5 rounded font-mono text-[9px] font-bold uppercase"
            style={{ background: 'rgba(201,168,76,0.12)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.20)' }}
          >
            {devices.filter(d => d.online).length}/{devices.length} Online
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
            style={{ color: 'var(--c-muted)' }}
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
          <NavLink
            to="/timbangan"
            className="font-mono text-[10px] font-bold uppercase tracking-wider hover:opacity-80 transition-opacity"
            style={{ color: '#C9A84C' }}
          >
            View All →
          </NavLink>
        </div>
      </div>

      {/* Grid */}
      {sorted.length === 0 ? (
        <div
          className="flex-1 flex flex-col items-center justify-center rounded-xl p-8 gap-3"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}
        >
          <Scale size={32} style={{ color: 'var(--c-border)' }} />
          <p className="text-sm" style={{ color: 'var(--c-muted)' }}>No timbangan devices registered</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <AnimatePresence>
            {sorted.map(dev => (
              <DeviceCard key={dev.name} device={dev} freshId={freshId} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
