import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload, Radio, CheckCircle, Trash2, X, AlertTriangle, Cpu,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  listSmartBuddyFirmware, uploadSmartBuddyFirmware,
  activateSmartBuddyFirmware, deleteSmartBuddyFirmware,
  triggerSmartBuddyOTAManaged, broadcastSmartBuddyOTA,
  getSmartBuddyDevices,
} from '@/lib/api'
import type { SmartBuddyFirmware } from '@/lib/api'

function fmtSize(bytes: number) {
  if (bytes < 1024)        return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
}

/* ── Upload Modal ────────────────────────────────────────────── */
function UploadModal({ onClose }: { onClose: () => void }) {
  const qc        = useQueryClient()
  const fileRef   = useRef<HTMLInputElement>(null)
  const [file,    setFile]    = useState<File | null>(null)
  const [version, setVersion] = useState('')
  const [desc,    setDesc]    = useState('')
  const [dragging, setDragging] = useState(false)

  const { mutate: doUpload, isPending } = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      fd.append('file', file!)
      fd.append('version', version.trim())
      if (desc.trim()) fd.append('description', desc.trim())
      return uploadSmartBuddyFirmware(fd)
    },
    onSuccess: () => {
      toast.success('Firmware uploaded')
      qc.invalidateQueries({ queryKey: ['sb-firmware-list'] })
      onClose()
    },
    onError: (e: any) => toast.error(e?.detail ?? e?.message ?? 'Upload failed'),
  })

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f?.name.endsWith('.bin')) setFile(f)
    else toast.error('Only .bin files are accepted')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(10,12,26,0.80)' }}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md rounded-2xl flex flex-col"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
        <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: '1px solid var(--c-border)' }}>
          <h2 className="text-white font-semibold">Upload Firmware SmartBuddy</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg transition-colors hover:bg-white/5" style={{ color: 'var(--c-muted)' }}>
            <X size={16} />
          </button>
        </div>
        <div className="p-6 flex flex-col gap-5">
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className="p-6 rounded-xl border-2 border-dashed flex flex-col items-center gap-3 cursor-pointer transition-colors"
            style={{ borderColor: dragging ? '#C9A84C' : 'var(--c-border)', background: dragging ? 'rgba(201,168,76,0.05)' : 'var(--bg-base)' }}>
            <div className="w-12 h-12 flex items-center justify-center rounded-xl"
              style={{ background: 'rgba(201,168,76,0.10)', border: '1px solid rgba(201,168,76,0.25)' }}>
              <Upload size={20} style={{ color: '#C9A84C' }} />
            </div>
            {file ? (
              <div className="text-center">
                <p className="text-white text-sm font-semibold">{file.name}</p>
                <p className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--c-muted)' }}>{fmtSize(file.size)}</p>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-white text-sm font-semibold">Drop .bin file here</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--c-muted)' }}>or click to browse</p>
              </div>
            )}
            <input ref={fileRef} type="file" accept=".bin" className="hidden"
              onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
              Version <span style={{ color: '#F44336' }}>*</span>
            </label>
            <input value={version} onChange={e => setVersion(e.target.value)}
              placeholder="e.g. v1.2.0"
              className="py-3 px-4 rounded-xl text-sm focus:outline-none"
              style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
              onFocus={e => (e.currentTarget.style.borderColor = '#C9A84C')}
              onBlur={e  => (e.currentTarget.style.borderColor = 'var(--c-border)')} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Description</label>
            <textarea value={desc} onChange={e => setDesc(e.target.value)}
              placeholder="Optional release notes…" rows={3}
              className="py-3 px-4 rounded-xl text-sm focus:outline-none resize-none"
              style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
              onFocus={e => (e.currentTarget.style.borderColor = '#C9A84C')}
              onBlur={e  => (e.currentTarget.style.borderColor = 'var(--c-border)')} />
          </div>

          <div className="flex gap-3 pt-1">
            <button onClick={onClose}
              className="flex-1 py-3 rounded-xl text-sm font-semibold"
              style={{ background: 'rgba(160,168,192,0.10)', color: 'var(--c-muted)', border: '1px solid var(--c-border)' }}>
              Cancel
            </button>
            <button onClick={() => doUpload()} disabled={!file || !version.trim() || isPending}
              className="flex-1 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #C9A84C, #E8C96A)', color: 'var(--bg-base)' }}>
              {isPending
                ? <motion.div className="w-4 h-4 rounded-full border-2"
                    style={{ borderColor: 'rgba(0,0,0,0.3)', borderTopColor: 'var(--bg-base)' }}
                    animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }} />
                : <><Upload size={14} />Upload</>}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

/* ── Trigger Modal ───────────────────────────────────────────── */
function TriggerModal({
  firmware, devices, onClose,
}: {
  firmware: SmartBuddyFirmware[]
  devices:  { id: number; name: string; online: boolean; firmware: string | null }[]
  onClose:  () => void
}) {
  const [selectedFw,   setSelectedFw]   = useState<number | ''>('')
  const [targetDevice, setTargetDevice] = useState<number | 'all'>('all')
  const [sending,      setSending]      = useState(false)

  async function handleTrigger() {
    if (!selectedFw) return
    setSending(true)
    try {
      if (targetDevice === 'all') {
        const res = await broadcastSmartBuddyOTA(Number(selectedFw))
        toast.success(`Broadcast sent to ${res.devices_triggered.length} device(s)`)
      } else {
        await triggerSmartBuddyOTAManaged(Number(targetDevice), Number(selectedFw))
        toast.success('OTA triggered successfully')
      }
      onClose()
    } catch (e: any) {
      toast.error(e?.detail ?? e?.message ?? 'Failed to trigger OTA')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(10,12,26,0.80)' }}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md rounded-2xl flex flex-col"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
        <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: '1px solid var(--c-border)' }}>
          <h2 className="text-white font-semibold">Trigger OTA Update</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: 'var(--c-muted)' }}>
            <X size={16} />
          </button>
        </div>
        <div className="p-6 flex flex-col gap-5">

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Firmware Version</label>
            <select value={selectedFw} onChange={e => setSelectedFw(Number(e.target.value) || '')}
              className="py-3 px-4 rounded-xl text-sm focus:outline-none"
              style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
              onFocus={e => (e.currentTarget.style.borderColor = '#C9A84C')}
              onBlur={e  => (e.currentTarget.style.borderColor = 'var(--c-border)')}>
              <option value="">Select version…</option>
              {firmware.map(fw => (
                <option key={fw.id} value={fw.id}>
                  {fw.version}{fw.is_active ? ' (active)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Target Device</label>
            <select value={targetDevice === 'all' ? 'all' : targetDevice}
              onChange={e => setTargetDevice(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="py-3 px-4 rounded-xl text-sm focus:outline-none"
              style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
              onFocus={e => (e.currentTarget.style.borderColor = '#C9A84C')}
              onBlur={e  => (e.currentTarget.style.borderColor = 'var(--c-border)')}>
              <option value="all">Broadcast to All Devices</option>
              {devices.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}{d.online ? '' : ' (offline)'}{d.firmware ? ` — v${d.firmware}` : ''}
                </option>
              ))}
            </select>
          </div>

          {targetDevice === 'all' && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl"
              style={{ background: 'rgba(255,193,7,0.08)', border: '1px solid rgba(255,193,7,0.20)' }}>
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" style={{ color: '#FFC107' }} />
              <p className="text-xs leading-relaxed" style={{ color: '#FFC107' }}>
                Akan dikirim ke semua {devices.length} SmartBuddy device. Device akan restart saat update.
              </p>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button onClick={onClose}
              className="flex-1 py-3 rounded-xl text-sm font-semibold"
              style={{ background: 'rgba(160,168,192,0.10)', color: 'var(--c-muted)', border: '1px solid var(--c-border)' }}>
              Cancel
            </button>
            <button onClick={handleTrigger} disabled={!selectedFw || sending}
              className="flex-1 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #C9A84C, #E8C96A)', color: 'var(--bg-base)' }}>
              {sending
                ? <motion.div className="w-4 h-4 rounded-full border-2"
                    style={{ borderColor: 'rgba(0,0,0,0.3)', borderTopColor: 'var(--bg-base)' }}
                    animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }} />
                : <><Radio size={14} />{targetDevice === 'all' ? 'Broadcast' : 'Trigger OTA'}</>}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

/* ── Main Page ───────────────────────────────────────────────── */
export default function SmartBuddyOTAPage() {
  const qc = useQueryClient()
  const [showUpload,  setShowUpload]  = useState(false)
  const [showTrigger, setShowTrigger] = useState(false)

  const { data: firmware = [], isLoading } = useQuery({
    queryKey: ['sb-firmware-list'],
    queryFn:  listSmartBuddyFirmware,
  })

  const { data: devices = [] } = useQuery({
    queryKey: ['smartbuddy-devices'],
    queryFn:  getSmartBuddyDevices,
  })

  const { mutate: doActivate, isPending: activating } = useMutation({
    mutationFn: (id: number) => activateSmartBuddyFirmware(id),
    onSuccess:  (_, id) => {
      const fw = firmware.find(f => f.id === id)
      toast.success(`${fw?.version ?? 'Firmware'} set as active`)
      qc.invalidateQueries({ queryKey: ['sb-firmware-list'] })
    },
    onError: (e: any) => toast.error(e?.detail ?? 'Failed to activate'),
  })

  const { mutate: doDelete } = useMutation({
    mutationFn: (id: number) => deleteSmartBuddyFirmware(id),
    onSuccess:  (_, id) => {
      const fw = firmware.find(f => f.id === id)
      toast.success(`${fw?.version ?? 'Firmware'} deleted`)
      qc.invalidateQueries({ queryKey: ['sb-firmware-list'] })
    },
    onError: (e: any) => toast.error(e?.detail ?? 'Failed to delete'),
  })

  const deviceList = devices.map(d => ({
    id: d.id, name: d.name, online: d.online, firmware: d.firmware,
  }))

  return (
    <>
      <AnimatePresence>
        {showUpload  && <UploadModal onClose={() => setShowUpload(false)} />}
        {showTrigger && (
          <TriggerModal
            firmware={firmware}
            devices={deviceList}
            onClose={() => setShowTrigger(false)}
          />
        )}
      </AnimatePresence>

      <div className="p-6 flex flex-col gap-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-white text-2xl font-bold">OTA Firmware</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--c-muted)' }}>
              Upload dan deploy firmware ke SmartBuddy devices
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowUpload(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: 'rgba(201,168,76,0.15)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.30)' }}>
              <Upload size={14} />Upload Firmware
            </button>
            <button onClick={() => setShowTrigger(true)} disabled={firmware.length === 0}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#C9A84C,#E8C96A)', color: 'var(--bg-base)' }}>
              <Radio size={14} />Deploy OTA
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Versions', value: firmware.length },
            { label: 'Active',  value: firmware.filter(f => f.is_active).length },
            { label: 'Devices', value: devices.length },
            { label: 'Online',  value: devices.filter(d => d.online).length },
          ].map(s => (
            <div key={s.label} className="p-4 rounded-xl"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
              <p className="font-mono text-[9px] uppercase tracking-widest" style={{ color: 'var(--c-faint)' }}>{s.label}</p>
              <p className="font-mono text-2xl font-bold mt-1" style={{ color: '#C9A84C' }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Firmware table */}
        <div className="rounded-xl overflow-hidden"
          style={{ background: 'rgba(var(--bg-surface-rgb),0.70)', border: '1px solid var(--c-border)' }}>
          <div className="px-4 py-2.5 border-b" style={{ borderColor: 'var(--c-border)', background: 'rgba(var(--c-border-rgb),0.20)' }}>
            <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: '#C9A84C' }}>
              Firmware Versions
            </span>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <motion.div className="w-6 h-6 rounded-full border-2"
                style={{ borderColor: 'rgba(201,168,76,0.3)', borderTopColor: '#C9A84C' }}
                animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }} />
            </div>
          ) : firmware.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-3">
              <Cpu size={28} style={{ color: 'var(--c-faint)' }} />
              <p className="font-mono text-sm" style={{ color: 'var(--c-faint)' }}>No firmware uploaded yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
                    {['Version', 'Size', 'Checksum', 'Date', 'Description', 'Status', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-left font-mono text-[9px] uppercase tracking-widest"
                        style={{ color: 'var(--c-faint)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {firmware.map((fw, i) => (
                    <tr key={fw.id}
                      style={{ borderBottom: i < firmware.length - 1 ? '1px solid var(--c-border)88' : undefined }}>
                      <td className="px-4 py-3">
                        <span className="font-mono font-semibold text-sm" style={{ color: 'var(--c-primary)' }}>
                          {fw.version}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs" style={{ color: 'var(--c-muted)' }}>
                          {fmtSize(fw.size)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-[10px]" style={{ color: 'var(--c-faint)' }}>
                          {fw.checksum.slice(0, 8)}…
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs" style={{ color: 'var(--c-muted)' }}>
                          {fmtDate(fw.created_at)}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-[160px]">
                        <span className="text-xs truncate block" style={{ color: 'var(--c-muted)' }}>
                          {fw.description ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {fw.is_active ? (
                          <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold"
                            style={{ color: '#4CAF50' }}>
                            <CheckCircle size={11} />Active
                          </span>
                        ) : (
                          <button
                            disabled={activating}
                            onClick={() => doActivate(fw.id)}
                            className="font-mono text-[10px] px-2.5 py-1 rounded-lg transition-all disabled:opacity-40"
                            style={{ background: 'rgba(201,168,76,0.10)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.25)' }}>
                            Set Active
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {!fw.is_active && (
                          <button
                            onClick={() => { if (confirm(`Delete ${fw.version}?`)) doDelete(fw.id) }}
                            className="p-1.5 rounded-lg transition-colors hover:bg-red-500/10"
                            style={{ color: '#F44336' }}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Device firmware status */}
        {devices.length > 0 && (
          <div className="rounded-xl overflow-hidden"
            style={{ background: 'rgba(var(--bg-surface-rgb),0.70)', border: '1px solid var(--c-border)' }}>
            <div className="px-4 py-2.5 border-b" style={{ borderColor: 'var(--c-border)', background: 'rgba(var(--c-border-rgb),0.20)' }}>
              <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: '#C9A84C' }}>
                Device Firmware Status
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
                    {['Device', 'Current Firmware', 'Status'].map(h => (
                      <th key={h} className="px-4 py-3 text-left font-mono text-[9px] uppercase tracking-widest"
                        style={{ color: 'var(--c-faint)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d, i) => (
                    <tr key={d.id}
                      style={{ borderBottom: i < devices.length - 1 ? '1px solid var(--c-border)88' : undefined }}>
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm font-semibold" style={{ color: 'var(--c-primary)' }}>{d.name}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs" style={{ color: 'var(--c-muted)' }}>
                          {d.firmware ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full"
                            style={{ background: d.online ? '#4CAF50' : '#F44336' }} />
                          <span className="font-mono text-[10px]"
                            style={{ color: d.online ? '#4CAF50' : '#F44336' }}>
                            {d.online ? 'Online' : 'Offline'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
