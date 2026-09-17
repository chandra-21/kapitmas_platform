import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Layers, Plus, Pencil, Trash2, X, MapPin, HardDrive, ToggleLeft, ToggleRight } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  getAssetUnits, createAssetUnit, updateAssetUnit, deleteAssetUnit,
  getLocations,
  type AssetUnit, type Location,
} from '@/lib/api'

const UNIT_TYPES = [
  { value: 'timbangan',  label: 'Scale'  },
  { value: 'doorlock',   label: 'Door Lock'  },
  { value: 'smartbuddy', label: 'SmartBuddy' },
  { value: 'other',      label: 'Other'      },
]

function Field({ label, value, onChange, placeholder, disabled }: {
  label: string; value: string; onChange?: (v: string) => void
  placeholder?: string; disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
        {label}
      </label>
      <input
        type="text" value={value}
        onChange={e => onChange?.(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
        onFocus={e => { if (!disabled) e.currentTarget.style.borderColor = '#C9A84C' }}
        onBlur={e  => { e.currentTarget.style.borderColor = 'var(--c-border)' }}
      />
    </div>
  )
}

function SelectField({ label, value, onChange, options, placeholder }: {
  label: string; value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]; placeholder?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
        {label}
      </label>
      <select
        value={value} onChange={e => onChange(e.target.value)}
        className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none transition-all"
        style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: value ? 'var(--c-primary)' : 'var(--c-muted)' }}
      >
        <option value="">{placeholder ?? '— Select —'}</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, { bg: string; color: string; border: string }> = {
    timbangan:  { bg: 'rgba(201,168,76,0.10)',  color: '#C9A84C', border: 'rgba(201,168,76,0.25)'  },
    doorlock:   { bg: 'rgba(74,144,217,0.10)',  color: '#4A90D9', border: 'rgba(74,144,217,0.25)'  },
    smartbuddy: { bg: 'rgba(156,39,176,0.10)',  color: '#CE93D8', border: 'rgba(156,39,176,0.25)'  },
    other:      { bg: 'rgba(160,168,192,0.10)', color: 'var(--c-muted)', border: 'rgba(160,168,192,0.25)' },
  }
  const c = colors[type] ?? colors.other
  const label = UNIT_TYPES.find(t => t.value === type)?.label ?? type
  return (
    <span className="font-mono text-[9px] px-2 py-0.5 rounded uppercase"
      style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>
      {label}
    </span>
  )
}

export default function AssetUnitsPage() {
  const qc = useQueryClient()

  const { data: units     = [] } = useQuery({ queryKey: ['asset-units'], queryFn: () => getAssetUnits() })
  const { data: locations = [] } = useQuery({ queryKey: ['locations'],   queryFn: getLocations })

  const locationOptions = locations.map((l: Location) => ({ value: l.id, label: l.name }))

  // ── Filter ──
  const [filterLoc,  setFilterLoc]  = useState('')
  const [filterType, setFilterType] = useState('')
  const filtered = units.filter((u: AssetUnit) => {
    if (filterLoc  && u.location_id !== filterLoc)  return false
    if (filterType && u.type        !== filterType)  return false
    return true
  })

  // ── Create ──
  const [createOpen, setCreateOpen] = useState(false)
  const [cUnitId,    setCUnitId]    = useState('')
  const [cName,      setCName]      = useState('')
  const [cType,      setCType]      = useState('timbangan')
  const [cLocId,     setCLocId]     = useState('')
  const [creating,   setCreating]   = useState(false)

  async function handleCreate() {
    if (!cUnitId.trim() || !cName.trim()) { toast.error('Unit ID and Name are required'); return }
    setCreating(true)
    try {
      await createAssetUnit({ unit_id: cUnitId.trim(), name: cName.trim(), type: cType, location_id: cLocId || undefined })
      qc.invalidateQueries({ queryKey: ['asset-units'] })
      setCreateOpen(false); setCUnitId(''); setCName(''); setCType('timbangan'); setCLocId('')
      toast.success('Asset unit created')
    } catch (e: any) { toast.error(e.message ?? 'Failed to create asset unit') }
    finally { setCreating(false) }
  }

  // ── Edit ──
  const [editing,  setEditing]  = useState<AssetUnit | null>(null)
  const [eName,    setEName]    = useState('')
  const [eType,    setEType]    = useState('')
  const [eLocId,   setELocId]   = useState('')
  const [eSaving,  setESaving]  = useState(false)

  function openEdit(u: AssetUnit) {
    setEditing(u); setEName(u.name); setEType(u.type); setELocId(u.location_id ?? '')
  }

  async function handleEdit() {
    if (!editing) return
    setESaving(true)
    try {
      await updateAssetUnit(editing.id, {
        name:        eName.trim() || undefined,
        type:        eType || undefined,
        location_id: eLocId || null,
      })
      qc.invalidateQueries({ queryKey: ['asset-units'] })
      setEditing(null)
      toast.success('Asset unit updated')
    } catch (e: any) { toast.error(e.message ?? 'Failed to update') }
    finally { setESaving(false) }
  }

  async function handleToggle(u: AssetUnit) {
    try {
      await updateAssetUnit(u.id, { is_active: !u.is_active })
      qc.invalidateQueries({ queryKey: ['asset-units'] })
      toast.success(`Unit ${!u.is_active ? 'activated' : 'deactivated'}`)
    } catch (e: any) { toast.error(e.message ?? 'Failed') }
  }

  async function handleDelete(u: AssetUnit) {
    if (u.device_id) { toast.error('Unassign the device before deleting this unit'); return }
    if (!confirm(`Delete unit "${u.unit_id}"?`)) return
    try {
      await deleteAssetUnit(u.id)
      qc.invalidateQueries({ queryKey: ['asset-units'] })
      toast.success('Unit deleted')
    } catch (e: any) { toast.error(e.message ?? 'Failed to delete') }
  }

  return (
    <div className="p-6 flex flex-col gap-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-white text-2xl font-bold">Asset Units</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--c-muted)' }}>
            Manage physical units per location — scales, door locks, and more
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, #C9A84C, #E8C96A)', color: 'var(--bg-base)' }}>
          <Plus size={14} />
          Add Unit
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <MapPin size={13} style={{ color: 'var(--c-muted)' }} />
          <select
            value={filterLoc} onChange={e => setFilterLoc(e.target.value)}
            className="px-4 py-2 rounded-xl text-sm focus:outline-none"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)', color: filterLoc ? 'var(--c-primary)' : 'var(--c-muted)' }}>
            <option value="">All Locations</option>
            {locations.map((l: Location) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Layers size={13} style={{ color: 'var(--c-muted)' }} />
          <select
            value={filterType} onChange={e => setFilterType(e.target.value)}
            className="px-4 py-2 rounded-xl text-sm focus:outline-none"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)', color: filterType ? 'var(--c-primary)' : 'var(--c-muted)' }}>
            <option value="">All Types</option>
            {UNIT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <span className="font-mono text-xs" style={{ color: 'var(--c-muted)' }}>
          {filtered.length} unit
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
        {filtered.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-4">
            <div className="w-14 h-14 flex items-center justify-center rounded-2xl"
              style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.15)' }}>
              <Layers size={22} style={{ color: '#C9A84C' }} />
            </div>
            <p className="text-sm" style={{ color: 'var(--c-muted)' }}>No asset units yet</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr style={{ background: 'var(--bg-base)', borderBottom: '1px solid var(--c-border)' }}>
                {['Unit ID', 'Name', 'Type', 'Location', 'Device', 'Status', ''].map(col => (
                  <th key={col} className="px-5 py-3 text-left font-mono text-[9px] uppercase tracking-widest"
                    style={{ color: 'var(--c-muted)' }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u: AssetUnit, i: number) => (
                <motion.tr key={u.id}
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02 }}
                  className="border-b hover:bg-white/[0.02] transition-colors"
                  style={{ borderColor: 'rgba(var(--c-border-rgb), 0.27)' }}>

                  <td className="px-5 py-3.5">
                    <span className="font-mono text-xs" style={{ color: '#C9A84C' }}>{u.unit_id}</span>
                  </td>

                  <td className="px-5 py-3.5">
                    <span className="text-sm text-white">{u.name}</span>
                  </td>

                  <td className="px-5 py-3.5">
                    <TypeBadge type={u.type} />
                  </td>

                  <td className="px-5 py-3.5">
                    {u.location_name ? (
                      <div className="flex items-center gap-1.5">
                        <MapPin size={11} style={{ color: 'var(--c-muted)' }} />
                        <span className="text-sm" style={{ color: 'var(--c-muted)' }}>{u.location_name}</span>
                      </div>
                    ) : <span style={{ color: 'var(--c-faint)' }}>—</span>}
                  </td>

                  <td className="px-5 py-3.5">
                    {u.device_name ? (
                      <div className="flex items-center gap-1.5">
                        <HardDrive size={11} style={{ color: '#4A90D9' }} />
                        <span className="text-sm" style={{ color: '#4A90D9' }}>{u.device_name}</span>
                      </div>
                    ) : (
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded"
                        style={{ background: 'rgba(76,175,80,0.10)', color: '#4CAF50', border: '1px solid rgba(76,175,80,0.25)' }}>
                        Available
                      </span>
                    )}
                  </td>

                  <td className="px-5 py-3.5">
                    <span className="font-mono text-[9px] px-2 py-0.5 rounded font-bold uppercase"
                      style={{
                        background: u.is_active ? 'rgba(76,175,80,0.10)' : 'rgba(244,67,54,0.10)',
                        color:      u.is_active ? '#4CAF50' : '#F44336',
                        border:     `1px solid ${u.is_active ? 'rgba(76,175,80,0.25)' : 'rgba(244,67,54,0.25)'}`,
                      }}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>

                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(u)}
                        className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                        style={{ color: '#C9A84C' }} title="Edit">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => handleToggle(u)}
                        className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                        style={{ color: u.is_active ? '#F44336' : '#4CAF50' }}>
                        {u.is_active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                      </button>
                      <button onClick={() => handleDelete(u)}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
                        style={{ color: u.device_id ? 'var(--c-faint)' : '#F44336' }}
                        title={u.device_id ? 'Unassign device first' : 'Delete'}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Create Modal ── */}
      <AnimatePresence>
        {createOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
            onClick={() => setCreateOpen(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm p-6 rounded-2xl flex flex-col gap-5"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--c-border)' }}
              onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-white font-semibold">New Asset Unit</h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--c-muted)' }}>Physical unit for one position at a location</p>
                </div>
                <button onClick={() => setCreateOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: 'var(--c-muted)' }}>
                  <X size={16} />
                </button>
              </div>
              <div className="flex flex-col gap-3">
                <Field label="Unit ID" value={cUnitId} onChange={setCUnitId} placeholder="KapitMas/Scales/0001" />
                <Field label="Name"   value={cName}   onChange={setCName}   placeholder="Scale Unit 1" />
                <SelectField label="Type" value={cType} onChange={setCType}
                  options={UNIT_TYPES} />
                <SelectField label="Location" value={cLocId} onChange={setCLocId}
                  options={locationOptions} placeholder="— No Location —" />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setCreateOpen(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium"
                  style={{ border: '1px solid var(--c-border)', color: 'var(--c-muted)' }}>Cancel</button>
                <button onClick={handleCreate} disabled={creating}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #C9A84C, #E8C96A)', color: 'var(--bg-base)' }}>
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Edit Modal ── */}
      <AnimatePresence>
        {editing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
            onClick={() => setEditing(null)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm p-6 rounded-2xl flex flex-col gap-5"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--c-border)' }}
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-white font-semibold">Edit Asset Unit</h3>
                <button onClick={() => setEditing(null)}
                  className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: 'var(--c-muted)' }}>
                  <X size={16} />
                </button>
              </div>
              <div className="flex flex-col gap-3">
                <Field label="Unit ID" value={editing.unit_id} disabled />
                <Field label="Name" value={eName} onChange={setEName} />
                <SelectField label="Type" value={eType} onChange={setEType} options={UNIT_TYPES} />
                <SelectField label="Location" value={eLocId} onChange={setELocId}
                  options={locationOptions} placeholder="— No Location —" />
                {editing.device_name && (
                  <div className="flex flex-col gap-1.5">
                    <label className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
                      Assigned Device
                    </label>
                    <div className="flex items-center gap-2 px-4 py-3 rounded-xl"
                      style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)' }}>
                      <HardDrive size={13} style={{ color: '#4A90D9' }} />
                      <span className="text-sm" style={{ color: '#4A90D9' }}>{editing.device_name}</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setEditing(null)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium"
                  style={{ border: '1px solid var(--c-border)', color: 'var(--c-muted)' }}>Cancel</button>
                <button onClick={handleEdit} disabled={eSaving}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #C9A84C, #E8C96A)', color: 'var(--bg-base)' }}>
                  {eSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  )
}
