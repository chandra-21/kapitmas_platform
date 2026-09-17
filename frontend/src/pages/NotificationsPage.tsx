import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Bell, Wifi, WifiOff, UploadCloud, CheckCheck } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import type { NotificationLog } from '@/lib/api'

function timeLabel(iso: string): string {
  const d    = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60)   return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
}

function groupByDate(notifications: NotificationLog[]): Record<string, NotificationLog[]> {
  const today     = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const groups: Record<string, NotificationLog[]> = {}
  for (const n of notifications) {
    const day = n.created_at.slice(0, 10)
    const label = day === today ? 'Today' : day === yesterday ? 'Yesterday' : day
    if (!groups[label]) groups[label] = []
    groups[label].push(n)
  }
  return groups
}

const TYPE_META: Record<string, { Icon: typeof Bell; color: string; bg: string }> = {
  online:   { Icon: Wifi,        color: '#4CAF50', bg: 'rgba(76,175,80,0.12)'  },
  offline:  { Icon: WifiOff,     color: '#F44336', bg: 'rgba(244,67,54,0.12)' },
  firmware: { Icon: UploadCloud, color: '#C9A84C', bg: 'rgba(201,168,76,0.12)' },
}

export default function NotificationsPage() {
  const [read, setRead] = useState<Set<number>>(new Set())

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn:  () => apiFetch<NotificationLog[]>('/system/notifications?limit=50'),
    refetchInterval: 30_000,
  })

  const groups = groupByDate(notifications)
  const unreadCount = notifications.filter(n => !read.has(n.id)).length

  function markAllRead() {
    setRead(new Set(notifications.map(n => n.id)))
  }

  return (
    <div className="p-6 flex flex-col gap-6 max-w-2xl">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-white text-2xl font-bold">Notifications</h1>
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 rounded-full font-mono text-xs font-bold"
                style={{ background: 'rgba(244,67,54,0.15)', color: '#F44336', border: '1px solid rgba(244,67,54,0.25)' }}>
                {unreadCount}
              </span>
            )}
          </div>
          <p className="text-sm mt-1" style={{ color: 'var(--c-muted)' }}>
            Device alerts and system events
          </p>
        </div>
        {unreadCount > 0 && (
          <button onClick={markAllRead}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors hover:bg-white/5"
            style={{ color: 'var(--c-muted)', border: '1px solid var(--c-border)' }}>
            <CheckCheck size={13} />
            Mark all read
          </button>
        )}
      </div>

      {/* Groups */}
      {notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 rounded-xl"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
          <Bell size={36} style={{ color: 'var(--c-border)' }} />
          <p className="text-sm" style={{ color: 'var(--c-muted)' }}>No notifications yet</p>
        </div>
      ) : (
        Object.entries(groups).map(([label, items]) => (
          <div key={label} className="flex flex-col gap-2">
            <p className="font-mono text-[10px] uppercase tracking-widest px-1" style={{ color: 'var(--c-muted)' }}>
              {label}
            </p>
            <div className="flex flex-col gap-1.5">
              {items.map((n, i) => {
                const isRead = read.has(n.id)
                const meta   = TYPE_META[n.type] ?? { Icon: Bell, color: 'var(--c-muted)', bg: 'rgba(160,168,192,0.08)' }
                const { Icon } = meta
                return (
                  <motion.div key={n.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    onClick={() => setRead(prev => { const s = new Set(prev); s.add(n.id); return s })}
                    className="flex items-start gap-3 px-4 py-4 rounded-xl cursor-pointer transition-all"
                    style={{
                      background: isRead ? 'var(--bg-surface)' : 'rgba(201,168,76,0.04)',
                      border: `1px solid ${isRead ? 'var(--c-border)' : 'rgba(201,168,76,0.15)'}`,
                    }}>
                    <div className="w-8 h-8 flex items-center justify-center rounded-xl flex-shrink-0"
                      style={{ background: meta.bg, color: meta.color }}>
                      <Icon size={13} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-white leading-snug">{n.title}</p>
                        <span className="font-mono text-[9px] flex-shrink-0 mt-0.5" style={{ color: 'var(--c-muted)' }}>
                          {timeLabel(n.created_at)}
                        </span>
                      </div>
                      <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--c-muted)' }}>{n.body}</p>
                      {n.device_id && (
                        <p className="font-mono text-[9px] mt-1.5" style={{ color: 'var(--c-faint)' }}>{n.device_id}</p>
                      )}
                    </div>
                    {!isRead && (
                      <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1" style={{ background: '#C9A84C' }} />
                    )}
                  </motion.div>
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
