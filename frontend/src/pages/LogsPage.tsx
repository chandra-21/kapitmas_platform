import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { getTimbanganLogs } from '@/lib/api'
import { Download, Calendar, Filter, Scale } from 'lucide-react'

export default function LogsPage() {
  const [searchParams] = useSearchParams()
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [selectedDevice, setSelectedDevice] = useState(() => searchParams.get('unit') ?? 'all')

  const { data: logs = [] } = useQuery({
    queryKey: ['timbangan-logs', selectedDate],
    queryFn: () => getTimbanganLogs(selectedDate),
  })

  const allEntries = logs
    .filter(d => selectedDevice === 'all' || d.unit_name === selectedDevice)
    .flatMap(d => d.logs.map(l => ({ ...l, device: d.unit_name })))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  function exportCSV() {
    const rows = [
      ['Timestamp', 'Device', 'Weight (kg)', 'Used For'],
      ...allEntries.map(e => [e.timestamp, e.device, e.weight, e.used_for ?? '']),
    ]
    const csv  = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url
    a.download = `kaiis-logs-${selectedDate}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-6 flex flex-col gap-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-white text-2xl font-bold">Weight Logs</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--c-muted)' }}>
            Historical measurement records — {allEntries.length} entries
          </p>
        </div>
        <button onClick={exportCSV}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, #C9A84C, #E8C96A)', color: 'var(--bg-base)' }}>
          <Download size={13} />
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
          <Calendar size={13} style={{ color: 'var(--c-muted)' }} />
          <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
            className="focus:outline-none text-sm bg-transparent" style={{ color: 'var(--c-primary)' }} />
        </div>

        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
          <Filter size={12} style={{ color: 'var(--c-muted)' }} />
          <select value={selectedDevice} onChange={e => setSelectedDevice(e.target.value)}
            className="focus:outline-none text-sm bg-transparent" style={{ color: 'var(--c-primary)' }}>
            <option value="all">All Units</option>
            {logs.map(d => <option key={d.unit_id} value={d.unit_name}>{d.unit_name}</option>)}
          </select>
        </div>
      </div>

      {/* Log table */}
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--c-border)', background: 'var(--bg-base)' }}>
              {['Timestamp', 'Unit', 'Weight', 'Used For'].map(col => (
                <th key={col} className="px-5 py-3 text-left font-mono text-[10px] uppercase tracking-widest"
                  style={{ color: 'var(--c-muted)' }}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allEntries.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-16 text-center">
                  <Scale size={32} className="mx-auto mb-3" style={{ color: 'var(--c-border)' }} />
                  <p className="text-sm" style={{ color: 'var(--c-muted)' }}>No logs for selected date and device</p>
                </td>
              </tr>
            ) : (
              allEntries.map((entry, i) => (
                <motion.tr key={entry.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(i * 0.02, 0.5) }}
                  className="border-b transition-colors hover:bg-white/[0.02]"
                  style={{ borderColor: 'var(--c-border)' }}>
                  <td className="px-5 py-3.5 font-mono text-xs" style={{ color: 'var(--c-muted)' }}>
                    {new Date(entry.timestamp).toLocaleString('en-US')}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <Scale size={11} style={{ color: '#C9A84C' }} />
                      <span className="text-sm text-white">{entry.device}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="font-mono text-sm font-bold" style={{ color: 'var(--c-primary)' }}>
                      {entry.weight_str ?? String(entry.weight)}
                    </span>
                    <span className="font-mono text-xs ml-1" style={{ color: 'var(--c-muted)' }}>{entry.unit ?? 'kg'}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-xs" style={{ color: 'var(--c-muted)' }}>{entry.used_for || '—'}</span>
                  </td>
                </motion.tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
