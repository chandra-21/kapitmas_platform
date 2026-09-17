import { motion } from 'framer-motion'
import { Server, Wifi, WifiOff, AlertTriangle } from 'lucide-react'
import type { SystemHealth } from '@/lib/api'

interface Props {
  health?: SystemHealth
}

export default function SummaryCards({ health }: Props) {
  const d       = health?.devices
  const total   = (d?.timbangan.total  ?? 0) + (d?.smartbuddy.total  ?? 0)
  const online  = (d?.timbangan.online ?? 0) + (d?.smartbuddy.online ?? 0)
  const offline = total - online
  const pct     = total > 0 ? ((online / total) * 100).toFixed(0) : '0'
  const alerts  = offline

  const cards = [
    {
      label:    'TOTAL DEVICES',
      value:    total,
      sub:      `${pct}% connectivity`,
      Icon:     Server,
      accent:   '#C9A84C',
      valueFmt: String(total),
    },
    {
      label:    'ONLINE',
      value:    online,
      sub:      'Live & operational',
      Icon:     Wifi,
      accent:   '#4CAF50',
      valueFmt: String(online),
      pulse:    true,
    },
    {
      label:    'OFFLINE',
      value:    offline,
      sub:      offline > 0 ? 'Needs attention' : 'All systems OK',
      Icon:     WifiOff,
      accent:   offline > 0 ? '#F44336' : 'var(--c-muted)',
      valueFmt: String(offline),
    },
    {
      label:    'ACTIVE ALERTS',
      value:    alerts,
      sub:      'Last 24 hours',
      Icon:     AlertTriangle,
      accent:   alerts > 0 ? '#FFC107' : 'var(--c-muted)',
      valueFmt: String(alerts),
    },
  ]

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
      {cards.map(({ label, sub, Icon, accent, valueFmt, pulse }, i) => (
        <motion.div
          key={label}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.07, duration: 0.4 }}
          className="relative p-5 rounded-xl flex flex-col gap-4 overflow-hidden"
          style={{
            background: 'var(--bg-surface)',
            border: `1px solid var(--c-border)`,
            borderTop: `2px solid ${accent}`,
          }}
        >
          {/* Watermark icon */}
          <div className="absolute right-4 bottom-4 opacity-5 pointer-events-none" style={{ color: accent }}>
            <Icon size={52} />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between relative">
            <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
              {label}
            </span>
            <div
              className="w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0"
              style={{ background: `${accent}15`, color: accent }}
            >
              <Icon size={14} />
            </div>
          </div>

          {/* Value */}
          <div className="relative">
            <div className="flex items-end gap-2">
              <span className="font-mono text-4xl font-bold tabular-nums" style={{ color: 'var(--c-primary)' }}>
                {valueFmt}
              </span>
              {pulse && (
                <div className="flex items-center gap-1 mb-1.5">
                  <motion.span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: '#4CAF50' }}
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ repeat: Infinity, duration: 1.8 }}
                  />
                  <span className="font-mono text-[9px] font-bold uppercase" style={{ color: '#4CAF50' }}>
                    LIVE
                  </span>
                </div>
              )}
            </div>
            <p className="font-sans text-xs mt-1" style={{ color: 'var(--c-muted)' }}>{sub}</p>
          </div>
        </motion.div>
      ))}
    </div>
  )
}
