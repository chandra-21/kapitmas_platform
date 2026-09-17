import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Thermometer, Lightbulb, Wind, Search, ChevronRight } from 'lucide-react'
import { getSmartBuddyDevices } from '@/lib/api'
import type { SmartBuddyDevice } from '@/lib/api'
import { useSSE } from '@/lib/useSSE'
import type { SSEEvent } from '@/lib/useSSE'

type Filter = 'all' | 'online' | 'offline'

const BRAND_LABEL: Record<string, string> = {
  daikin: 'Daikin', lg: 'LG', panasonic: 'Panasonic',
  samsung: 'Samsung', gree: 'Gree', midea: 'Midea', learned: 'Learned',
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60)   return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
}

function DeviceCard({ sb }: { sb: SmartBuddyDevice }) {
  const navigate = useNavigate()

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => navigate(`/smartbuddy/${sb.id}`)}
      className="p-5 rounded-xl flex flex-col gap-4 transition-all duration-200 cursor-pointer group"
      style={{
        background: 'var(--bg-surface)',
        border: `1px solid ${sb.online ? 'var(--c-border)' : '#3D2020'}`,
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate" style={{ color: 'var(--c-primary)' }}>
            {sb.name}
          </p>
          <p className="font-mono text-[10px] mt-0.5 truncate" style={{ color: 'var(--c-muted)' }}>
            {sb.location_name ?? sb.room_id?.replace(/_/g, ' ') ?? 'No location'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 px-2 py-1 rounded-full"
          style={{
            background: sb.online ? 'rgba(76,175,80,0.12)' : 'rgba(244,67,54,0.10)',
            border: `1px solid ${sb.online ? 'rgba(76,175,80,0.35)' : 'rgba(244,67,54,0.25)'}`,
          }}>
          <motion.span className="w-1.5 h-1.5 rounded-full"
            style={{ background: sb.online ? '#4CAF50' : '#F44336' }}
            animate={sb.online ? { opacity: [1, 0.4, 1] } : {}}
            transition={{ repeat: Infinity, duration: 2 }}
          />
          <span className="font-mono text-[9px] font-bold uppercase"
            style={{ color: sb.online ? '#4CAF50' : '#F44336' }}>
            {sb.online ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>

      {/* Capabilities */}
      <div className="flex flex-col gap-2">
        {sb.has_ac && (
          <div className="flex items-center justify-between px-3 py-2 rounded-lg"
            style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)' }}>
            <div className="flex items-center gap-2">
              <Wind size={12} style={{ color: sb.ac_state.power ? '#42A5F5' : 'var(--c-faint)' }} />
              <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--c-muted)' }}>AC</span>
              <span className="font-mono text-[10px]" style={{ color: 'var(--c-faint)' }}>
                {BRAND_LABEL[sb.ac_brand] ?? sb.ac_brand}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {sb.ac_state.power && (
                <span className="font-mono text-[9px]" style={{ color: '#42A5F5' }}>
                  {sb.ac_state.temp}°C · {sb.ac_state.mode}
                </span>
              )}
              <span className="px-1.5 py-0.5 rounded font-mono text-[9px] font-bold"
                style={{
                  background: sb.ac_state.power ? 'rgba(66,165,245,0.15)' : 'rgba(160,168,192,0.08)',
                  color: sb.ac_state.power ? '#42A5F5' : 'var(--c-faint)',
                }}>
                {sb.ac_state.power ? 'ON' : 'OFF'}
              </span>
            </div>
          </div>
        )}

        {sb.has_lamp && (
          <div className="flex items-center justify-between px-3 py-2 rounded-lg"
            style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)' }}>
            <div className="flex items-center gap-2">
              <Lightbulb size={12} style={{ color: sb.lamp_state.power ? '#FFB74D' : 'var(--c-faint)' }} />
              <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--c-muted)' }}>Lamp</span>
              {sb.lamp_state.mode !== 'manual' && (
                <span className="font-mono text-[9px]" style={{ color: 'var(--c-faint)' }}>
                  {sb.lamp_state.mode === 'auto_pir' ? 'Auto PIR' : 'Schedule'}
                </span>
              )}
            </div>
            <span className="px-1.5 py-0.5 rounded font-mono text-[9px] font-bold"
              style={{
                background: sb.lamp_state.power ? 'rgba(255,183,77,0.15)' : 'rgba(160,168,192,0.08)',
                color: sb.lamp_state.power ? '#FFB74D' : 'var(--c-faint)',
              }}>
              {sb.lamp_state.power ? 'ON' : 'OFF'}
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1" style={{ borderTop: '1px solid var(--c-border)' }}>
        <span className="font-mono text-[9px]" style={{ color: 'var(--c-faint)' }}>
          {timeAgo(sb.last_seen)}
        </span>
        <ChevronRight size={14} style={{ color: 'var(--c-faint)' }} />
      </div>
    </motion.div>
  )
}

export default function SmartBuddyPage() {
  //const navigate   = useNavigate()
  const qc         = useQueryClient()
  const [filter,   setFilter]  = useState<Filter>('all')
  const [search,   setSearch]  = useState('')

  const { data: devices = [], isLoading } = useQuery({
    queryKey: ['smartbuddy-devices'],
    queryFn:  getSmartBuddyDevices,
    refetchInterval: 30_000,
  })

  const handleSSE = useCallback((e: SSEEvent) => {
    if (e.type === 'smartbuddy_status' || e.type === 'smartbuddy_ac' || e.type === 'smartbuddy_lamp') {
      qc.invalidateQueries({ queryKey: ['smartbuddy-devices'] })
    }
  }, [qc])
  useSSE(handleSSE, '/api/smartbuddy/events')

  const filtered = devices
    .filter(d => filter === 'all' || (filter === 'online' ? d.online : !d.online))
    .filter(d => !search || d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.location_name?.toLowerCase().includes(search.toLowerCase()) ||
      d.room_id?.toLowerCase().includes(search.toLowerCase()))

  const online  = devices.filter(d => d.online).length
  const offline = devices.length - online

  return (
    <div className="flex flex-col min-h-full">

      {/* Sticky header */}
      <div className="sticky top-0 z-20 flex items-center justify-between px-6 py-4 border-b"
        style={{ background: 'rgba(var(--bg-surface-rgb),0.95)', borderColor: 'var(--c-border)', backdropFilter: 'blur(12px)' }}>
        <div>
          <h1 className="text-white text-lg font-semibold leading-none">SmartBuddy</h1>
          <p className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--c-muted)' }}>
            AC & Lamp Controller
          </p>
        </div>
        <div className="flex items-center gap-4">
          {[
            { label: 'Total',   value: devices.length, color: '#C9A84C' },
            { label: 'Online',  value: online,          color: '#4CAF50' },
            { label: 'Offline', value: offline,         color: offline > 0 ? '#F44336' : 'var(--c-faint)' },
          ].map(s => (
            <div key={s.label} className="text-right">
              <p className="font-mono text-xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
              <p className="font-mono text-[9px] uppercase tracking-wider" style={{ color: 'var(--c-faint)' }}>{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-4 border-b" style={{ borderColor: 'var(--c-border)' }}>
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--c-faint)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search device or location..."
            className="w-full pl-8 pr-4 py-2 rounded-lg font-mono text-xs"
            style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
          />
        </div>
        {/* Filter tabs */}
        <div className="flex p-0.5 rounded-lg gap-0.5" style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)' }}>
          {(['all', 'online', 'offline'] as Filter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="px-4 py-1.5 rounded-md font-mono text-xs capitalize transition-all"
              style={filter === f
                ? { background: 'var(--c-border)', color: '#C9A84C' }
                : { color: 'var(--c-muted)' }
              }>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-xl h-44 animate-pulse"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Thermometer size={32} style={{ color: 'var(--c-faint)' }} />
            <p className="font-mono text-sm" style={{ color: 'var(--c-faint)' }}>
              {devices.length === 0 ? 'No SmartBuddy devices — provision via BLE' : 'No devices match filter'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map(sb => <DeviceCard key={sb.id} sb={sb} />)}
          </div>
        )}
      </div>
    </div>
  )
}
