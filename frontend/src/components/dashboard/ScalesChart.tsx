import { useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import type { UnitLogsResponse } from '@/lib/api'
import { useColors } from '@/lib/theme'

interface Props {
  logs: UnitLogsResponse[]
}

const COLORS = ['#C9A84C', '#4A90D9', '#4CAF50', '#F44336', '#FFC107', '#A78BFA']

type ViewMode = 'REALTIME' | 'DAILY AVG' | 'PEAKS'
const MODES: ViewMode[] = ['REALTIME', 'DAILY AVG', 'PEAKS']

function parseTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

interface ChartRow { time: string; [key: string]: number | string }

export default function ScalesChart({ logs }: Props) {
  const [mode, setMode] = useState<ViewMode>('REALTIME')
  const colors = useColors()

  const { rows, names } = useMemo(() => {
    if (!logs.length) return { rows: [], names: [] }
    const names   = logs.map(d => d.unit_name)
    const timeSet = new Set<string>()
    for (const dev of logs)
      for (const log of dev.logs) timeSet.add(log.timestamp)
    const times = [...timeSet].sort()
    const rows: ChartRow[] = times.map(ts => {
      const row: ChartRow = { time: parseTime(ts) }
      for (const dev of logs) {
        const entry = dev.logs.find(l => l.timestamp === ts)
        if (entry) row[dev.unit_name] = entry.weight
      }
      return row
    })
    return { rows, names }
  }, [logs])

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="w-1 h-5 rounded-full flex-shrink-0" style={{ background: '#C9A84C' }} />
          <h2 className="text-white text-base font-semibold">Weight Trend — Today</h2>
        </div>
        <div
          className="flex p-0.5 rounded-lg"
          style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)' }}
        >
          {MODES.map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="px-3 py-1.5 rounded-md font-mono text-[10px] font-bold uppercase tracking-wider transition-all"
              style={mode === m
                ? { background: 'var(--bg-surface)', color: '#C9A84C', border: '1px solid var(--c-border)' }
                : { color: 'var(--c-muted)', border: '1px solid transparent' }
              }
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Chart card */}
      <div
        className="h-80 p-6 rounded-xl relative overflow-hidden"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}
      >
        {rows.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <div
              className="w-16 h-16 flex items-center justify-center rounded-xl"
              style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.15)' }}
            >
              <span className="font-mono text-2xl" style={{ color: 'var(--c-border)' }}>—</span>
            </div>
            <p className="text-sm" style={{ color: 'var(--c-muted)' }}>No weight data recorded today</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={rows} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <filter id="goldGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="2.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border + '99'} vertical={false} />
              <XAxis
                dataKey="time"
                tick={{ fill: colors.muted, fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
                axisLine={{ stroke: colors.border }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: colors.muted, fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
                axisLine={false}
                tickLine={false}
                unit=" kg"
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--bg-base)',
                  border: '1px solid #C9A84C',
                  borderRadius: '8px',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '11px',
                  color: 'var(--c-primary)',
                  boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
                }}
                labelStyle={{ color: '#C9A84C', marginBottom: 4, fontFamily: 'Inter, sans-serif', fontSize: 10 }}
                cursor={{ stroke: colors.border, strokeWidth: 1 }}
              />
              <Legend
                wrapperStyle={{
                  paddingTop: '12px',
                  borderTop: '1px solid var(--c-border)',
                  fontFamily: 'Inter, sans-serif',
                  fontSize: '11px',
                  color: 'var(--c-muted)',
                }}
              />
              {names.map((name, i) => (
                <Line
                  key={name}
                  type="monotone"
                  dataKey={name}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={i === 0 ? 2 : 1.5}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0, fill: COLORS[i % COLORS.length] }}
                  connectNulls
                  opacity={i === 0 ? 1 : 0.65}
                  filter={i === 0 ? 'url(#goldGlow)' : undefined}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
