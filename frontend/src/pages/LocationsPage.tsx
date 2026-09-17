import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MapPin, Plus, Pencil, ToggleLeft, ToggleRight, X } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getLocations, createLocation, updateLocation, type Location } from '@/lib/api'
import { usePermissions } from '@/hooks/usePermissions'

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
        {label}
      </label>
      <input
        type="text" value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none transition-all"
        style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
        onFocus={e => (e.currentTarget.style.borderColor = '#C9A84C')}
        onBlur={e  => (e.currentTarget.style.borderColor = 'var(--c-border)')}
      />
    </div>
  )
}

export default function LocationsPage() {
  const qc = useQueryClient()
  const { can } = usePermissions()
  const canManage = can('location.manage')

  const { data: locations = [], refetch } = useQuery({
    queryKey: ['locations'],
    queryFn:  getLocations,
  })

  const [createOpen, setCreateOpen] = useState(false)
  const [newName,    setNewName]    = useState('')
  const [newAddr,    setNewAddr]    = useState('')
  const [creating,   setCreating]   = useState(false)

  const [editingLoc,  setEditingLoc]  = useState<Location | null>(null)
  const [editName,    setEditName]    = useState('')
  const [editAddr,    setEditAddr]    = useState('')
  const [editSaving,  setEditSaving]  = useState(false)

  function openCreate() { setNewName(''); setNewAddr(''); setCreateOpen(true) }

  function openEdit(loc: Location) {
    setEditingLoc(loc)
    setEditName(loc.name)
    setEditAddr(loc.address ?? '')
  }

  async function handleCreate() {
    if (!newName.trim()) { toast.error('Location name is required'); return }
    setCreating(true)
    try {
      await createLocation(newName.trim(), newAddr.trim() || undefined)
      qc.invalidateQueries({ queryKey: ['locations'] })
      await refetch()
      setCreateOpen(false)
      toast.success('Location created')
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to create location')
    } finally {
      setCreating(false)
    }
  }

  async function handleEdit() {
    if (!editingLoc) return
    setEditSaving(true)
    try {
      await updateLocation(editingLoc.id, { name: editName.trim() || undefined, address: editAddr.trim() || undefined })
      qc.invalidateQueries({ queryKey: ['locations'] })
      await refetch()
      setEditingLoc(null)
      toast.success('Location updated')
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to update location')
    } finally {
      setEditSaving(false)
    }
  }

  async function handleToggle(loc: Location) {
    try {
      await updateLocation(loc.id, { is_active: !loc.is_active })
      qc.invalidateQueries({ queryKey: ['locations'] })
      await refetch()
      toast.success(`Location ${!loc.is_active ? 'activated' : 'deactivated'}`)
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to update location status')
    }
  }

  return (
    <div className="p-6 flex flex-col gap-6 max-w-3xl">

      <div>
        <h1 className="text-white text-2xl font-bold">Locations</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--c-muted)' }}>Manage locations for device categorisation</p>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: 'var(--c-muted)' }}>
          {locations.length} location{locations.length !== 1 ? 's' : ''} registered
        </p>
        {canManage && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #C9A84C, #E8C96A)', color: 'var(--bg-base)' }}>
            <Plus size={14} />
            Add Location
          </button>
        )}
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
        {locations.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-4">
            <div className="w-14 h-14 flex items-center justify-center rounded-2xl"
              style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.15)' }}>
              <MapPin size={22} style={{ color: '#C9A84C' }} />
            </div>
            <div className="text-center">
              <p className="text-white text-sm font-medium">No locations yet</p>
              <p className="text-xs mt-1" style={{ color: 'var(--c-muted)' }}>
                Click "Add Location" to add the first location
              </p>
            </div>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr style={{ background: 'var(--bg-base)', borderBottom: '1px solid var(--c-border)' }}>
                {['Name', 'Address', 'Status', ...(canManage ? [''] : [])].map(col => (
                  <th key={col} className="px-5 py-3 text-left font-mono text-[9px] uppercase tracking-widest"
                    style={{ color: 'var(--c-muted)' }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {locations.map(loc => (
                <tr key={loc.id} className="border-b transition-colors hover:bg-white/[0.02]"
                  style={{ borderColor: 'rgba(var(--c-border-rgb), 0.27)' }}>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <MapPin size={12} style={{ color: '#C9A84C', flexShrink: 0 }} />
                      <span className="text-sm font-medium text-white">{loc.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="font-mono text-xs" style={{ color: 'var(--c-muted)' }}>
                      {loc.address ?? '—'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="px-2 py-0.5 rounded font-mono text-[9px] font-bold uppercase"
                      style={{
                        background: loc.is_active ? 'rgba(76,175,80,0.10)' : 'rgba(244,67,54,0.10)',
                        color: loc.is_active ? '#4CAF50' : '#F44336',
                        border: `1px solid ${loc.is_active ? 'rgba(76,175,80,0.25)' : 'rgba(244,67,54,0.25)'}`,
                      }}>
                      {loc.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {canManage && (
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-3">
                        <button onClick={() => openEdit(loc)}
                          className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
                          style={{ color: '#C9A84C' }} title="Edit">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => handleToggle(loc)}
                          className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
                          style={{ color: loc.is_active ? '#F44336' : '#4CAF50' }}
                          title={loc.is_active ? 'Deactivate' : 'Activate'}>
                          {loc.is_active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Create Modal ── */}
      <AnimatePresence>
        {createOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
            onClick={() => setCreateOpen(false)}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm p-6 rounded-2xl flex flex-col gap-5"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--c-border)' }}
              onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-white font-semibold">New Location</h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--c-muted)' }}>
                    Locations are used to categorise devices
                  </p>
                </div>
                <button onClick={() => setCreateOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-white/5 transition-colors" style={{ color: 'var(--c-muted)' }}>
                  <X size={16} />
                </button>
              </div>
              <div className="flex flex-col gap-3">
                <Field label="Location Name" value={newName} onChange={setNewName} placeholder="e.g. Warehouse A" />
                <Field label="Address (optional)" value={newAddr} onChange={setNewAddr} placeholder="123 Example St" />
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
        {editingLoc && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
            onClick={() => setEditingLoc(null)}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm p-6 rounded-2xl flex flex-col gap-5"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--c-border)' }}
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-white font-semibold">Edit Location</h3>
                <button onClick={() => setEditingLoc(null)}
                  className="p-1.5 rounded-lg hover:bg-white/5 transition-colors" style={{ color: 'var(--c-muted)' }}>
                  <X size={16} />
                </button>
              </div>
              <div className="flex flex-col gap-3">
                <Field label="Location Name" value={editName} onChange={setEditName} />
                <Field label="Address (optional)" value={editAddr} onChange={setEditAddr} />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setEditingLoc(null)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium"
                  style={{ border: '1px solid var(--c-border)', color: 'var(--c-muted)' }}>Cancel</button>
                <button onClick={handleEdit} disabled={editSaving}
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
