import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Archive, Download, HardDrive, Play, RefreshCw } from 'lucide-react'
import { listBackups, getBackupDownloadUrl, runBackup } from '@/lib/api'

function fmtSize(bytes: number) {
  if (bytes < 1024)        return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function BackupsPage() {
  const qc = useQueryClient()
  const [isRunning, setIsRunning] = useState(false)
  const [runMsg, setRunMsg]       = useState<string | null>(null)

  const { data: backups = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['backups'],
    queryFn:  listBackups,
    staleTime: 60_000,
  })

  async function handleRunBackup() {
    setIsRunning(true)
    setRunMsg(null)
    try {
      const res = await runBackup()
      setRunMsg(`Backup complete: ${res.count} file(s) for ${res.date}`)
      qc.invalidateQueries({ queryKey: ['backups'] })
    } catch {
      setRunMsg('Backup failed. Check server logs.')
    } finally {
      setIsRunning(false)
    }
  }

  const totalSize = backups.reduce((s, b) => s + b.size, 0)

  return (
    <div className="p-6 flex flex-col gap-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-white text-2xl font-bold">Backups</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--c-muted)' }}>Database backup files for timbangan system</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={handleRunBackup} disabled={isRunning}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: 'rgba(201,168,76,0.15)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.30)' }}>
            <Play size={14} className={isRunning ? 'animate-pulse' : ''} />
            {isRunning ? 'Running...' : 'Run Backup Now'}
          </button>
          <button onClick={() => refetch()} disabled={isFetching}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: 'rgba(74,144,217,0.15)', color: '#4A90D9', border: '1px solid rgba(74,144,217,0.30)' }}>
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {runMsg && (
        <div className="px-4 py-3 rounded-xl text-sm font-medium"
          style={{
            background: runMsg.includes('failed') ? 'rgba(244,67,54,0.10)' : 'rgba(76,175,80,0.10)',
            border: `1px solid ${runMsg.includes('failed') ? 'rgba(244,67,54,0.25)' : 'rgba(76,175,80,0.25)'}`,
            color: runMsg.includes('failed') ? '#F44336' : '#4CAF50',
          }}>
          {runMsg}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="p-5 rounded-xl flex flex-col gap-3"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)', borderTop: '2px solid #C9A84C' }}>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Total Backups</span>
            <div className="w-8 h-8 flex items-center justify-center rounded-lg"
              style={{ background: 'rgba(201,168,76,0.12)', color: '#C9A84C' }}>
              <Archive size={14} />
            </div>
          </div>
          <span className="font-mono text-2xl font-bold text-white">{backups.length}</span>
        </div>

        <div className="p-5 rounded-xl flex flex-col gap-3"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)', borderTop: '2px solid #4A90D9' }}>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Total Size</span>
            <div className="w-8 h-8 flex items-center justify-center rounded-lg"
              style={{ background: 'rgba(74,144,217,0.12)', color: '#4A90D9' }}>
              <HardDrive size={14} />
            </div>
          </div>
          <span className="font-mono text-2xl font-bold text-white">{fmtSize(totalSize)}</span>
        </div>

        <div className="col-span-2 lg:col-span-1 p-4 rounded-xl flex flex-col gap-2"
          style={{ background: 'rgba(76,175,80,0.06)', border: '1px solid rgba(76,175,80,0.20)' }}>
          <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: '#4CAF50' }}>Auto Backup</p>
          <p className="text-white text-sm font-semibold">Enabled</p>
          <p className="text-xs" style={{ color: 'var(--c-muted)' }}>
            Backups are created automatically. Download any file to restore the database manually.
          </p>
        </div>
      </div>

      {/* Backup list */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <span className="w-1 h-5 rounded-full" style={{ background: '#C9A84C' }} />
          <h2 className="text-white text-base font-semibold">Backup Files</h2>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: 'var(--bg-surface)' }} />
            ))}
          </div>
        ) : backups.length === 0 ? (
          <div className="py-20 flex flex-col items-center gap-3 rounded-xl"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
            <Archive size={32} style={{ color: 'var(--c-faint)' }} />
            <p className="text-sm" style={{ color: 'var(--c-muted)' }}>No backup files found</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {backups.map((backup, i) => (
              <motion.div key={backup.filename}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                className="flex items-center gap-4 px-5 py-4 rounded-xl"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>

                <div className="w-10 h-10 flex items-center justify-center rounded-xl flex-shrink-0"
                  style={{ background: 'rgba(201,168,76,0.10)', border: '1px solid rgba(201,168,76,0.20)' }}>
                  <Archive size={16} style={{ color: '#C9A84C' }} />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium font-mono truncate">{backup.filename}</p>
                  <p className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--c-muted)' }}>
                    {fmtSize(backup.size)} · {fmtDate(backup.mtime)}
                  </p>
                </div>

                <a href={getBackupDownloadUrl(backup.filename)} download
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors hover:opacity-90 flex-shrink-0"
                  style={{ background: 'rgba(74,144,217,0.12)', color: '#4A90D9', border: '1px solid rgba(74,144,217,0.25)' }}>
                  <Download size={12} />
                  Download
                </a>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
