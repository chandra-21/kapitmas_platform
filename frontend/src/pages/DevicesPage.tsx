import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Scale, HardDrive, DoorOpen, Search, Edit2, Trash2, ArrowUpCircle, MapPin, Wifi, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  getAllDevices, getLocations, getAssetUnits, updateDevice, assignDeviceToUnit, deleteDevice,
} from '@/lib/api'
import type { GlobalDevice, Location, AssetUnit } from '@/lib/api'

type TypeTab = 'all' | 'timbangan' | 'smartbuddy' | 'doorlock'

const TYPE_CONFIG: Record<string, { label: string; color: string; Icon: React.FC<any> }> = {
  timbangan:  { label: 'Scale',  color: '#C9A84C', Icon: Scale    },
  smartbuddy: { label: 'SmartBuddy', color: '#4A90D9', Icon: Wifi     },
  doorlock:   { label: 'DoorLock',   color: '#A78BFA', Icon: DoorOpen },
  other:      { label: 'Other',      color: 'var(--c-muted)', Icon: HardDrive },
}

function typeConfig(type: string) {
  return TYPE_CONFIG[type.toLowerCase()] ?? TYPE_CONFIG.other
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60)    return `${Math.floor(diff)}s ago`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const TABS: { key: TypeTab; label: string }[] = [
  { key: 'all',        label: 'All'        },
  { key: 'timbangan',  label: 'Scale'  },
  { key: 'smartbuddy', label: 'SmartBuddy' },
  { key: 'doorlock',   label: 'DoorLock'   },
]

function DeviceRow({ device, i, onEdit, onDelete }: {
  device: GlobalDevice; i: number
  onEdit:   (d: GlobalDevice) => void
  onDelete: (d: GlobalDevice) => void
}) {
  const navigate = useNavigate()
  const cfg      = typeConfig(device.type)

  return (
    <motion.tr
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.03 }}
      className="border-b transition-colors hover:bg-white/[0.02] cursor-pointer"
      style={{ borderColor: 'var(--c-border)' }}
      onClick={() => device.type === 'timbangan' && navigate('/timbangan/devices')}
    >
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0"
            style={{ background: `${cfg.color}18`, border: `1px solid ${cfg.color}33` }}>
            <cfg.Icon size={13} style={{ color: cfg.color }} />
          </div>
          <div>
            <p className="text-white text-sm font-medium">{device.name}</p>
            <p className="font-mono text-[9px] mt-0.5" style={{ color: 'var(--c-muted)' }}>{device.mac}</p>
          </div>
        </div>
      </td>

      <td className="px-5 py-3.5">
        <span className="px-2.5 py-1 rounded font-mono text-[10px] font-bold uppercase"
          style={{ background: `${cfg.color}18`, color: cfg.color, border: `1px solid ${cfg.color}33` }}>
          {cfg.label}
        </span>
      </td>

      <td className="px-5 py-3.5">
        {device.location_name ? (
          <div className="flex items-center gap-1.5">
            <MapPin size={11} style={{ color: 'var(--c-muted)' }} />
            <span className="text-sm" style={{ color: 'var(--c-muted)' }}>{device.location_name}</span>
          </div>
        ) : <span className="text-sm" style={{ color: 'var(--c-faint)' }}>—</span>}
      </td>

      <td className="px-5 py-3.5">
        <div className="flex items-center gap-1.5">
          <motion.span className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: device.online ? '#4CAF50' : '#F44336' }}
            animate={device.online ? { opacity: [1, 0.4, 1] } : {}}
            transition={{ repeat: Infinity, duration: 2 }}
          />
          <span className="font-mono text-xs font-bold"
            style={{ color: device.online ? '#4CAF50' : '#F44336' }}>
            {device.online ? 'Online' : 'Offline'}
          </span>
        </div>
      </td>

      <td className="px-5 py-3.5">
        <span className="font-mono text-xs" style={{ color: 'var(--c-muted)' }}>{device.firmware ?? '—'}</span>
      </td>

      <td className="px-5 py-3.5">
        <span className="font-mono text-xs" style={{ color: 'var(--c-muted)' }}>{device.ip_address ?? '—'}</span>
      </td>

      <td className="px-5 py-3.5">
        <span className="font-mono text-xs" style={{ color: 'var(--c-muted)' }}>{timeAgo(device.last_seen)}</span>
      </td>

      <td className="px-5 py-3.5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-1">
          <button onClick={() => onEdit(device)}
            className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
            style={{ color: 'var(--c-muted)' }} title="Edit">
            <Edit2 size={12} />
          </button>
          <button className="p-1.5 rounded-lg transition-colors hover:bg-blue-500/10"
            style={{ color: '#4A90D9' }} title="OTA Update">
            <ArrowUpCircle size={12} />
          </button>
          <button onClick={() => onDelete(device)}
            className="p-1.5 rounded-lg transition-colors hover:bg-red-500/10"
            style={{ color: '#F44336' }} title="Delete">
            <Trash2 size={12} />
          </button>
        </div>
      </td>
    </motion.tr>
  )
}

export default function DevicesPage() {
  const qc = useQueryClient()
  const [tab,    setTab]    = useState<TypeTab>('all')
  const [search, setSearch] = useState('')

  const { data: devices   = [], isLoading } = useQuery({ queryKey: ['all-devices'],  queryFn: getAllDevices, refetchInterval: 30_000 })
  const { data: locations = [] }            = useQuery({ queryKey: ['locations'],     queryFn: getLocations })
  const { data: allUnits  = [] }            = useQuery({ queryKey: ['asset-units'],  queryFn: () => getAssetUnits() })

  // ── Edit modal ──
  const [editDevice,   setEditDevice]   = useState<GlobalDevice | null>(null)
  const [editLocId,    setEditLocId]    = useState('')
  const [editUnitId,   setEditUnitId]   = useState('')
  const [editSaving,   setEditSaving]   = useState(false)

  const currentUnit  = allUnits.find((u: AssetUnit) => u.device_id === editDevice?.id)
  const unitOptions  = (allUnits as AssetUnit[]).filter(u =>
    (!editLocId || u.location_id === editLocId) &&
    u.type === editDevice?.type
  )
  const selectedUnit = allUnits.find((u: AssetUnit) => u.id === editUnitId)

  function openEdit(d: GlobalDevice) {
    setEditDevice(d)
    setEditLocId(d.location_id ?? '')
    const unit = allUnits.find((u: AssetUnit) => u.device_id === d.id)
    setEditUnitId(unit?.id ?? '')
  }

  useEffect(() => {
    if (editDevice && editLocId !== currentUnit?.location_id) setEditUnitId('')
  }, [editLocId])

  async function handleEditSave() {
    if (!editDevice) return
    setEditSaving(true)
    try {
      if (editLocId !== (editDevice.location_id ?? '')) {
        await updateDevice(editDevice.id, { location_id: editLocId || null })
      }
      const prevUnitId = currentUnit?.id ?? ''
      if (editUnitId !== prevUnitId) {
        if (editUnitId) {
          // Assign ke unit baru — backend handle swap atomik:
          // tutup history lama (apa pun unit-nya) + lepas device dari unit lama.
          await assignDeviceToUnit(editUnitId, editDevice.id)
        } else if (prevUnitId) {
          // Hanya lepaskan dari unit saat ini, tidak pindah ke unit baru
          await assignDeviceToUnit(prevUnitId, null)
        }
      }
      qc.invalidateQueries({ queryKey: ['all-devices'] })
      qc.invalidateQueries({ queryKey: ['asset-units'] })
      setEditDevice(null)
      toast.success('Device updated')
    } catch (e: any) { toast.error(e.message ?? 'Failed to save') }
    finally { setEditSaving(false) }
  }

  async function handleDelete(d: GlobalDevice) {
    if (!confirm(`Delete device "${d.name}" (${d.mac})?`)) return
    try {
      await deleteDevice(d.id)
      qc.invalidateQueries({ queryKey: ['all-devices'] })
      toast.success('Device deleted')
    } catch (e: any) { toast.error(e.message ?? 'Failed to delete') }
  }

  const counts = {
    all:        devices.length,
    timbangan:  devices.filter(d => d.type === 'timbangan').length,
    smartbuddy: devices.filter(d => d.type === 'smartbuddy').length,
    doorlock:   devices.filter(d => d.type === 'doorlock').length,
  }

  const filtered = devices.filter(d => {
    if (tab !== 'all' && d.type !== tab) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        d.name.toLowerCase().includes(q)        ||
        d.mac.toLowerCase().includes(q)         ||
        (d.location_name ?? '').toLowerCase().includes(q) ||
        (d.ip_address    ?? '').includes(q)
      )
    }
    return true
  })

  const onlineCount = filtered.filter(d => d.online).length

  return (
    <div className="p-6 flex flex-col gap-6">

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-white text-2xl font-bold">Device Management</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--c-muted)' }}>All registered IoT devices across modules</p>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        {[
          { label: 'Total',   value: counts.all,                       color: '#C9A84C' },
          { label: 'Online',  value: onlineCount,                      color: '#4CAF50' },
          { label: 'Offline', value: filtered.length - onlineCount,    color: '#F44336' },
        ].map(({ label, value, color }) => (
          <div key={label} className="flex items-center gap-2 px-4 py-2 rounded-xl"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
            <span className="font-mono text-xs" style={{ color: 'var(--c-muted)' }}>{label}</span>
            <span className="font-mono text-sm font-bold" style={{ color }}>{value}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex p-0.5 rounded-xl" style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)' }}>
          {TABS.map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className="px-4 py-2 rounded-lg font-mono text-[10px] uppercase tracking-wider font-bold transition-all"
              style={tab === key
                ? { background: 'var(--bg-surface)', color: '#C9A84C', border: '1px solid var(--c-border)' }
                : { color: 'var(--c-faint)', border: '1px solid transparent' }
              }>
              {label}
              <span className="ml-1.5 font-mono text-[9px]" style={{ color: tab === key ? '#C9A84C' : 'var(--c-faint)' }}>
                {counts[key]}
              </span>
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--c-muted)' }} />
          <input type="text" placeholder="Search by name, MAC, IP, or location..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm font-sans focus:outline-none transition-all"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
            onFocus={e => (e.currentTarget.style.borderColor = '#C9A84C')}
            onBlur={e  => (e.currentTarget.style.borderColor = 'var(--c-border)')}
          />
        </div>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--c-border)', background: 'var(--bg-base)' }}>
              {['Device', 'Type', 'Location', 'Status', 'Firmware', 'IP Address', 'Last Seen', 'Actions'].map(col => (
                <th key={col} className="px-5 py-3 text-left font-mono text-[10px] uppercase tracking-widest"
                  style={{ color: 'var(--c-muted)' }}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="px-5 py-16 text-center">
                <p className="text-sm" style={{ color: 'var(--c-muted)' }}>Loading devices...</p>
              </td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-5 py-16 text-center">
                <HardDrive size={36} className="mx-auto mb-3" style={{ color: 'var(--c-border)' }} />
                <p className="text-sm" style={{ color: 'var(--c-muted)' }}>
                  {tab === 'all' ? 'No devices found' : `No ${tab} devices registered`}
                </p>
              </td></tr>
            ) : (
              filtered.map((dev, i) => (
                <DeviceRow key={dev.id} device={dev} i={i}
                  onEdit={openEdit} onDelete={handleDelete} />
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs" style={{ color: 'var(--c-muted)' }}>
        Showing {filtered.length} of {devices.length} devices
      </p>

      {/* ── Edit Modal ── */}
      <AnimatePresence>
        {editDevice && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
            onClick={() => setEditDevice(null)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md p-6 rounded-2xl flex flex-col gap-5"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--c-border)' }}
              onClick={e => e.stopPropagation()}>

              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-white font-semibold">Edit Device</h3>
                  <p className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--c-muted)' }}>{editDevice.mac}</p>
                </div>
                <button onClick={() => setEditDevice(null)}
                  className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: 'var(--c-muted)' }}>
                  <X size={16} />
                </button>
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Location</label>
                  <select value={editLocId} onChange={e => setEditLocId(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none"
                    style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: editLocId ? 'var(--c-primary)' : 'var(--c-muted)' }}>
                    <option value="">— No Location —</option>
                    {(locations as Location[]).map(l => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-3 p-4 rounded-xl" style={{ background: 'var(--bg-deep)', border: '1px solid var(--c-border)' }}>
                  <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: '#C9A84C' }}>
                    Asset Assignment
                  </p>
                  <div className="flex flex-col gap-1.5">
                    <label className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Asset Unit ID</label>
                    <select value={editUnitId} onChange={e => setEditUnitId(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none"
                      style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: editUnitId ? 'var(--c-primary)' : 'var(--c-muted)' }}>
                      <option value="">— Not assigned —</option>
                      {unitOptions.map((u: AssetUnit) => (
                        <option key={u.id} value={u.id}>
                          {u.unit_id}{u.device_name && u.id !== currentUnit?.id ? ` (${u.device_name})` : ''}
                        </option>
                      ))}
                    </select>
                    {!editLocId && (
                      <p className="text-[10px]" style={{ color: 'var(--c-muted)' }}>Select a location first to filter asset units</p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Unit Name</label>
                    <div className="px-4 py-3 rounded-xl text-sm"
                      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--c-border)', color: selectedUnit ? 'var(--c-primary)' : 'var(--c-faint)' }}>
                      {selectedUnit?.name ?? '—'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={() => setEditDevice(null)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium"
                  style={{ border: '1px solid var(--c-border)', color: 'var(--c-muted)' }}>Cancel</button>
                <button onClick={handleEditSave} disabled={editSaving}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #C9A84C, #E8C96A)', color: 'var(--bg-base)' }}>
                  {editSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
