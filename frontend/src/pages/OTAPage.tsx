import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload, ArrowUpCircle, CheckCircle, Cpu, Radio, Trash2,
  Download, X, AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  getTimbanganDevices, listFirmware, uploadFirmware,
  activateFirmware, deleteFirmware, triggerOTA, broadcastOTA,
  getFirmwareDownloadUrl,
} from '@/lib/api'
import type { TimbanganFirmware } from '@/lib/api'

function fmtSize(bytes: number) {
  if (bytes < 1024)       return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
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
      return uploadFirmware(fd)
    },
    onSuccess: () => {
      toast.success('Firmware uploaded')
      qc.invalidateQueries({ queryKey: ['firmware-list'] })
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

  const canSubmit = file && version.trim() && !isPending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(10,12,26,0.80)' }}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md rounded-2xl flex flex-col"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: '1px solid var(--c-border)' }}>
          <h2 className="text-white font-semibold">Upload Firmware</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg transition-colors hover:bg-white/5" style={{ color: 'var(--c-muted)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-5">
          {/* Drop zone */}
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

          {/* Version */}
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
              Version <span style={{ color: '#F44336' }}>*</span>
            </label>
            <input value={version} onChange={e => setVersion(e.target.value)}
              placeholder="e.g. v1.5.0"
              className="py-3 px-4 rounded-xl text-sm focus:outline-none transition-colors"
              style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
              onFocus={e => (e.currentTarget.style.borderColor = '#C9A84C')}
              onBlur={e  => (e.currentTarget.style.borderColor = 'var(--c-border)')}
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Description</label>
            <textarea value={desc} onChange={e => setDesc(e.target.value)}
              placeholder="Optional release notes…" rows={3}
              className="py-3 px-4 rounded-xl text-sm focus:outline-none transition-colors resize-none"
              style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
              onFocus={e => (e.currentTarget.style.borderColor = '#C9A84C')}
              onBlur={e  => (e.currentTarget.style.borderColor = 'var(--c-border)')}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose}
              className="flex-1 py-3 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
              style={{ background: 'rgba(160,168,192,0.10)', color: 'var(--c-muted)', border: '1px solid var(--c-border)' }}>
              Cancel
            </button>
            <button onClick={() => doUpload()} disabled={!canSubmit}
              className="flex-1 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-opacity disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #C9A84C, #E8C96A)', color: 'var(--bg-base)' }}>
              {isPending
                ? <motion.div className="w-4 h-4 rounded-full border-2"
                    style={{ borderColor: 'rgba(var(--bg-base-rgb),0.3)', borderTopColor: 'var(--bg-base)' }}
                    animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }} />
                : <><Upload size={14} />Upload</>
              }
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

/* ── OTA Trigger Modal ───────────────────────────────────────── */
function TriggerModal({
  firmware, devices, onClose,
}: {
  firmware: TimbanganFirmware[]
  devices: { id: number; name: string; online: boolean; firmware: string | null }[]
  onClose: () => void
}) {
  const [selectedFw, setSelectedFw]     = useState<number | ''>('')
  const [targetDevice, setTargetDevice] = useState<number | 'all'>('all')
  const [sending, setSending]           = useState(false)

  async function handleTrigger() {
    if (!selectedFw) return
    setSending(true)
    try {
      if (targetDevice === 'all') {
        const res = await broadcastOTA(selectedFw)
        toast.success(`Broadcast sent to ${res.devices_triggered.length} device(s)`)
      } else {
        await triggerOTA(targetDevice, selectedFw)
        toast.success('OTA triggered successfully')
      }
      onClose()
    } catch (e: any) {
      toast.error(e?.detail ?? e?.message ?? 'Failed to trigger OTA')
    } finally {
      setSending(false)
    }
  }

  const activeFw = firmware.find(f => f.is_active)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(10,12,26,0.80)' }}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md rounded-2xl flex flex-col"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>

        <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: '1px solid var(--c-border)' }}>
          <h2 className="text-white font-semibold">Trigger OTA Update</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg transition-colors hover:bg-white/5" style={{ color: 'var(--c-muted)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-5">
          {/* Firmware version */}
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
              Firmware Version
            </label>
            <select value={selectedFw} onChange={e => setSelectedFw(Number(e.target.value) || '')}
              className="py-3 px-4 rounded-xl text-sm focus:outline-none transition-colors"
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

          {/* Target device */}
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
              Target Device
            </label>
            <select value={targetDevice === 'all' ? 'all' : targetDevice}
              onChange={e => setTargetDevice(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="py-3 px-4 rounded-xl text-sm focus:outline-none transition-colors"
              style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
              onFocus={e => (e.currentTarget.style.borderColor = '#C9A84C')}
              onBlur={e  => (e.currentTarget.style.borderColor = 'var(--c-border)')}>
              <option value="all">Broadcast to All Devices</option>
              {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>

          {/* Warning */}
          {targetDevice === 'all' && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl"
              style={{ background: 'rgba(255,193,7,0.08)', border: '1px solid rgba(255,193,7,0.20)' }}>
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" style={{ color: '#FFC107' }} />
              <p className="text-xs leading-relaxed" style={{ color: '#FFC107' }}>
                This will update all {devices.length} timbangan device{devices.length !== 1 ? 's' : ''}. Devices will restart during the update.
              </p>
            </div>
          )}

          {/* Active fw info */}
          {activeFw && selectedFw === activeFw.id && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl"
              style={{ background: 'rgba(76,175,80,0.08)', border: '1px solid rgba(76,175,80,0.20)' }}>
              <CheckCircle size={13} className="mt-0.5 flex-shrink-0" style={{ color: '#4CAF50' }} />
              <p className="text-xs" style={{ color: '#4CAF50' }}>This is the currently active firmware version.</p>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button onClick={onClose}
              className="flex-1 py-3 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
              style={{ background: 'rgba(160,168,192,0.10)', color: 'var(--c-muted)', border: '1px solid var(--c-border)' }}>
              Cancel
            </button>
            <button onClick={handleTrigger} disabled={!selectedFw || sending}
              className="flex-1 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-opacity disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #C9A84C, #E8C96A)', color: 'var(--bg-base)' }}>
              {sending
                ? <motion.div className="w-4 h-4 rounded-full border-2"
                    style={{ borderColor: 'rgba(var(--bg-base-rgb),0.3)', borderTopColor: 'var(--bg-base)' }}
                    animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }} />
                : <><Radio size={14} />{targetDevice === 'all' ? 'Broadcast' : 'Trigger OTA'}</>
              }
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

/* ── Main Page ───────────────────────────────────────────────── */
export default function OTAPage() {
  const qc = useQueryClient()
  const [showUpload,  setShowUpload]  = useState(false)
  const [showTrigger, setShowTrigger] = useState(false)

  const { data: firmware = [], isLoading: fwLoading } = useQuery({
    queryKey: ['firmware-list'],
    queryFn:  listFirmware,
  })

  const { data: devices = [] } = useQuery({
    queryKey: ['timbangan-devices'],
    queryFn:  getTimbanganDevices,
  })

  const { mutate: doActivate, isPending: activating } = useMutation({
    mutationFn: (id: number) => activateFirmware(id),
    onSuccess:  (_, id) => {
      const fw = firmware.find(f => f.id === id)
      toast.success(`${fw?.version ?? 'Firmware'} set as active`)
      qc.invalidateQueries({ queryKey: ['firmware-list'] })
    },
    onError: (e: any) => toast.error(e?.detail ?? 'Failed to activate'),
  })

  const { mutate: doDelete } = useMutation({
    mutationFn: (id: number) => deleteFirmware(id),
    onSuccess:  (_, id) => {
      const fw = firmware.find(f => f.id === id)
      toast.success(`${fw?.version ?? 'Firmware'} deleted`)
      qc.invalidateQueries({ queryKey: ['firmware-list'] })
    },
    onError: (e: any) => toast.error(e?.detail ?? 'Failed to delete'),
  })

  function confirmDelete(fw: TimbanganFirmware) {
    if (!confirm(`Delete firmware ${fw.version}? This cannot be undone.`)) return
    doDelete(fw.id)
  }

  return (
    <>
      {/* Modals */}
      <AnimatePresence>
        {showUpload  && <UploadModal onClose={() => setShowUpload(false)} />}
        {showTrigger && (
          <TriggerModal
            firmware={firmware}
            devices={devices}
            onClose={() => setShowTrigger(false)}
          />
        )}
      </AnimatePresence>

      <div className="p-6 flex flex-col gap-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-white text-2xl font-bold">OTA Firmware</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--c-muted)' }}>Upload and deploy firmware to timbangan devices</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowUpload(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ background: 'rgba(201,168,76,0.15)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.30)' }}>
              <Upload size={14} />Upload Firmware
            </button>
            <button onClick={() => setShowTrigger(true)} disabled={firmware.length === 0}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #C9A84C, #E8C96A)', color: 'var(--bg-base)' }}>
              <ArrowUpCircle size={14} />Trigger OTA
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">

          {/* Left: Firmware list */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2.5">
              <span className="w-1 h-5 rounded-full" style={{ background: '#C9A84C' }} />
              <h2 className="text-white text-base font-semibold">Available Versions</h2>
              <span className="ml-auto font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
                {firmware.length} version{firmware.length !== 1 ? 's' : ''}
              </span>
            </div>

            {fwLoading ? (
              <div className="flex flex-col gap-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: 'var(--bg-surface)' }} />
                ))}
              </div>
            ) : firmware.length === 0 ? (
              <div className="py-16 flex flex-col items-center gap-3 rounded-xl"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
                <Cpu size={28} style={{ color: 'var(--c-faint)' }} />
                <p className="text-sm" style={{ color: 'var(--c-muted)' }}>No firmware uploaded yet</p>
                <button onClick={() => setShowUpload(true)}
                  className="px-5 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
                  style={{ background: 'rgba(201,168,76,0.15)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.30)' }}>
                  Upload first firmware
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {firmware.map((fw, i) => (
                  <motion.div key={fw.id}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                    className="flex items-center gap-4 px-5 py-4 rounded-xl"
                    style={{ background: 'var(--bg-surface)', border: `1px solid ${fw.is_active ? 'rgba(76,175,80,0.35)' : 'var(--c-border)'}` }}>

                    <div className="w-10 h-10 flex items-center justify-center rounded-xl flex-shrink-0"
                      style={{
                        background: fw.is_active ? 'rgba(76,175,80,0.12)' : 'rgba(160,168,192,0.08)',
                        border: `1px solid ${fw.is_active ? 'rgba(76,175,80,0.30)' : 'var(--c-border)'}`,
                      }}>
                      <Cpu size={16} style={{ color: fw.is_active ? '#4CAF50' : 'var(--c-muted)' }} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-white text-sm font-semibold">{fw.version}</p>
                        {fw.is_active && (
                          <span className="px-1.5 py-0.5 rounded font-mono text-[8px] font-bold uppercase"
                            style={{ background: 'rgba(76,175,80,0.15)', color: '#4CAF50', border: '1px solid rgba(76,175,80,0.25)' }}>
                            Active
                          </span>
                        )}
                      </div>
                      <p className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--c-muted)' }}>
                        {fmtSize(fw.size)} · Uploaded {fmtDate(fw.created_at)}
                      </p>
                      {fw.description && (
                        <p className="text-xs mt-1 truncate" style={{ color: 'var(--c-muted)' }}>{fw.description}</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <a href={getFirmwareDownloadUrl(fw.id)} download
                        className="p-2 rounded-lg transition-colors hover:bg-white/5"
                        title="Download" style={{ color: '#4A90D9' }}>
                        <Download size={14} />
                      </a>
                      {!fw.is_active && (
                        <button onClick={() => doActivate(fw.id)} disabled={activating}
                          className="p-2 rounded-lg transition-colors hover:bg-white/5 disabled:opacity-40"
                          title="Set as active" style={{ color: '#4CAF50' }}>
                          <CheckCircle size={14} />
                        </button>
                      )}
                      {!fw.is_active && (
                        <button onClick={() => confirmDelete(fw)}
                          className="p-2 rounded-lg transition-colors hover:bg-white/5"
                          title="Delete" style={{ color: '#F44336' }}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Device status */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2.5">
              <span className="w-1 h-5 rounded-full" style={{ background: '#4A90D9' }} />
              <h2 className="text-white text-base font-semibold">Device Status</h2>
            </div>

            {devices.length === 0 ? (
              <div className="py-10 flex flex-col items-center gap-2 rounded-xl"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
                <p className="text-sm" style={{ color: 'var(--c-muted)' }}>No devices registered</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {devices.map(dev => (
                  <div key={dev.id} className="flex items-center justify-between px-4 py-3 rounded-xl"
                    style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-xs font-medium truncate">{dev.name}</p>
                      <p className="font-mono text-[9px] mt-0.5" style={{ color: 'var(--c-muted)' }}>
                        FW: {dev.firmware ?? 'Unknown'}
                      </p>
                      {dev.location_id && (
                        <p className="font-mono text-[9px]" style={{ color: 'var(--c-faint)' }}>{dev.location_id}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                      <span className="w-1.5 h-1.5 rounded-full"
                        style={{ background: dev.online ? '#4CAF50' : '#F44336' }} />
                      <span className="font-mono text-[9px]" style={{ color: dev.online ? '#4CAF50' : '#F44336' }}>
                        {dev.online ? 'Online' : 'Offline'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Summary */}
            {firmware.length > 0 && (
              <div className="p-4 rounded-xl flex flex-col gap-2"
                style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.20)' }}>
                <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: '#C9A84C' }}>Active Firmware</p>
                {firmware.filter(f => f.is_active).map(fw => (
                  <div key={fw.id}>
                    <p className="text-white text-sm font-semibold">{fw.version}</p>
                    <p className="font-mono text-[9px] mt-0.5" style={{ color: 'var(--c-muted)' }}>
                      Uploaded {fmtDate(fw.created_at)}
                    </p>
                  </div>
                ))}
                {!firmware.some(f => f.is_active) && (
                  <p className="text-xs" style={{ color: 'var(--c-muted)' }}>No active version set</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
