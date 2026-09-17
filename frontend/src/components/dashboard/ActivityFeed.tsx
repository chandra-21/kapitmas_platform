import { motion, AnimatePresence } from 'framer-motion'
import {
  Wifi, WifiOff, UploadCloud, SlidersHorizontal, CloudUpload, Activity,
} from 'lucide-react'
import { NavLink } from 'react-router-dom'
import type { ActivityEvent } from '@/lib/api'
import type { SSEEvent } from '@/lib/useSSE'

export interface FeedItem {
  id:      string
  type:    ActivityEvent['type']
  title:   string
  message: string
  time:    Date
}

interface Props {
  items: FeedItem[]
}

function timeLabel(d: Date) {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

const TYPE_META: Record<string, { Icon: typeof Wifi; bg: string; color: string }> = {
  online:      { Icon: Wifi,              bg: 'rgba(76,175,80,0.12)',    color: '#4CAF50' },
  offline:     { Icon: WifiOff,           bg: 'rgba(244,67,54,0.12)',    color: '#F44336' },
  firmware:    { Icon: UploadCloud,       bg: 'rgba(201,168,76,0.12)',   color: '#C9A84C' },
  calibration: { Icon: SlidersHorizontal, bg: 'rgba(74,144,217,0.12)',   color: '#4A90D9' },
  sync:        { Icon: CloudUpload,       bg: 'rgba(74,144,217,0.12)',   color: '#4A90D9' },
}

function ItemIcon({ type }: { type: FeedItem['type'] }) {
  const meta = TYPE_META[type] ?? { Icon: Activity, bg: 'rgba(160,168,192,0.10)', color: 'var(--c-muted)' }
  const { Icon } = meta
  return (
    <div
      className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
      style={{ background: meta.bg, color: meta.color }}
    >
      <Icon size={12} />
    </div>
  )
}

export function sseEventToFeedItem(e: SSEEvent): FeedItem | null {
  if (e.type !== 'activity') return null
  const d = e.data as Partial<ActivityEvent>
  if (!d.title) return null
  return {
    id:      d.id != null ? `db-${d.id}` : `sse-${Date.now()}-${Math.random()}`,
    type:    (d.type ?? 'unknown') as FeedItem['type'],
    title:   d.title,
    message: d.message ?? '',
    time:    d.created_at ? new Date(d.created_at) : new Date(),
  }
}

export function activityToFeedItem(a: ActivityEvent): FeedItem {
  return {
    id:      `db-${a.id}`,
    type:    a.type,
    title:   a.title,
    message: a.message,
    time:    a.created_at ? new Date(a.created_at) : new Date(),
  }
}

export default function ActivityFeed({ items }: Props) {
  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="w-1 h-5 rounded-full flex-shrink-0" style={{ background: '#4A90D9' }} />
          <h2 className="text-white text-base font-semibold">Activity Feed</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <motion.span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: '#4CAF50' }}
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ repeat: Infinity, duration: 1.8 }}
          />
          <span className="font-mono text-[9px] font-bold uppercase tracking-wider" style={{ color: '#4CAF50' }}>
            Live
          </span>
        </div>
      </div>

      {/* Card */}
      <div
        className="flex-1 flex flex-col rounded-xl overflow-hidden"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}
      >
        <div className="flex-1 overflow-y-auto max-h-[420px] p-4 flex flex-col gap-1">
          {items.length === 0 ? (
            <div className="py-10 flex flex-col items-center justify-center gap-2">
              <Activity size={24} style={{ color: 'var(--c-border)' }} />
              <p className="text-xs" style={{ color: 'var(--c-muted)' }}>Waiting for device events…</p>
            </div>
          ) : (
            <AnimatePresence initial={false} mode="popLayout">
              {items.map((item, idx) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, height: 0, y: -8 }}
                  animate={{ opacity: 1, height: 'auto', y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22 }}
                  className="flex items-start gap-3 py-3"
                  style={{ borderBottom: idx < items.length - 1 ? '1px solid var(--c-border)' : 'none' }}
                >
                  <ItemIcon type={item.type} />
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-white leading-snug">{item.title}</p>
                      <span className="font-mono text-[9px] flex-shrink-0 mt-0.5" style={{ color: 'var(--c-muted)' }}>
                        {timeLabel(item.time)}
                      </span>
                    </div>
                    <p className="text-xs leading-snug" style={{ color: 'var(--c-muted)' }}>{item.message}</p>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>

        {/* Footer */}
        <NavLink
          to="/logs"
          className="py-3 text-center block font-mono text-[10px] font-bold uppercase tracking-widest
                     transition-colors hover:text-white"
          style={{
            background: 'var(--bg-base)',
            borderTop:  '1px solid var(--c-border)',
            color:      'var(--c-muted)',
          }}
        >
          View Full Logs →
        </NavLink>
      </div>
    </div>
  )
}
