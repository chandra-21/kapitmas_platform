import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  User2, Shield, LogOut, Save, X, Key, Sun, Moon, Palette,
} from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { logout } from '@/lib/auth'
import {
  getMyProfile, updateMyProfile, listUsers, deactivateUser, updateUser,
  getUserPermissions, setUserPermissions,
  type UserResponse,
} from '@/lib/api'
import { useTheme } from '@/lib/theme'

// ── Shared sub-components ──────────────────────────────────

function Field({ label, value, onChange, type = 'text', placeholder, readOnly }: {
  label: string; value: string; onChange?: (v: string) => void
  type?: string; placeholder?: string; readOnly?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
        {label}
      </label>
      <input
        type={type} value={value}
        onChange={e => onChange?.(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none transition-all"
        style={{
          background: readOnly ? 'rgba(var(--bg-base-rgb),0.4)' : 'var(--bg-base)',
          border: '1px solid var(--c-border)',
          color: readOnly ? 'var(--c-muted)' : 'var(--c-primary)',
        }}
        onFocus={e => { if (!readOnly) e.currentTarget.style.borderColor = '#C9A84C' }}
        onBlur={e  => { if (!readOnly) e.currentTarget.style.borderColor = 'var(--c-border)' }}
      />
    </div>
  )
}

function Toggle({ label, desc, value, onChange }: {
  label: string; desc?: string; value: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div>
        <p className="text-white text-sm font-medium">{label}</p>
        {desc && <p className="text-xs mt-0.5" style={{ color: 'var(--c-muted)' }}>{desc}</p>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className="relative w-11 h-6 rounded-full transition-colors flex-shrink-0 focus:outline-none"
        style={{ background: value ? '#C9A84C' : 'var(--c-border)' }}
      >
        <span
          className="absolute top-1 left-1 w-4 h-4 rounded-full transition-transform duration-200"
          style={{
            background: value ? 'var(--c-primary)' : 'var(--c-muted)',
            transform: value ? 'translateX(18px)' : 'translateX(0px)',
          }}
        />
      </button>
    </div>
  )
}

function RoleBadge({ role }: { role: string }) {
  const isAdmin = role === 'admin'
  return (
    <span className="px-2 py-0.5 rounded font-mono text-[9px] font-bold uppercase"
      style={{
        background: isAdmin ? 'rgba(201,168,76,0.12)' : 'rgba(100,130,255,0.12)',
        color: isAdmin ? '#C9A84C' : '#6482FF',
        border: `1px solid ${isAdmin ? 'rgba(201,168,76,0.25)' : 'rgba(100,130,255,0.25)'}`,
      }}>
      {isAdmin ? 'Admin' : 'PIC'}
    </span>
  )
}

// ── Permission groups definition ──────────────────────────

const PERMISSION_GROUPS = [
  {
    label: 'TIMBANGAN DEVICES',
    items: [
      { key: 'timbangan.view',   label: 'View Data & Status' },
      { key: 'timbangan.add',    label: 'Add Device' },
      { key: 'timbangan.edit',   label: 'Edit Device' },
      { key: 'timbangan.delete', label: 'Delete Device' },
      { key: 'timbangan.ota',    label: 'Update Firmware (OTA)' },
    ],
  },
  {
    label: 'SMARTBUDDY DEVICES',
    items: [
      { key: 'smartbuddy.view',    label: 'View AC & Lamp Status' },
      { key: 'smartbuddy.control', label: 'Control AC & Lamp' },
    ],
  },
  {
    label: 'LOCATIONS',
    items: [
      { key: 'location.view',   label: 'View Locations' },
      { key: 'location.manage', label: 'Manage Locations' },
    ],
  },
  {
    label: 'REPORTS',
    items: [
      { key: 'report.view',   label: 'View Logs & Analytics' },
      { key: 'report.export', label: 'Export & Download' },
    ],
  },
] as const

// ── Permission Modal ───────────────────────────────────────

function PermissionModal({ user, onClose }: { user: UserResponse; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getUserPermissions(user.id).then(keys => {
      setSelected(new Set(keys))
      setLoading(false)
    }).catch(() => {
      setLoading(false)
    })
  }, [user.id])

  function toggle(key: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    try {
      await setUserPermissions(user.id, Array.from(selected))
      queryClient.invalidateQueries({ queryKey: ['my-permissions'] })
      toast.success('Permissions saved')
      onClose()
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to save permissions')
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-md p-6 rounded-2xl flex flex-col gap-5"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--c-border)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-white font-semibold">Permissions — {user.display_name}</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--c-muted)' }}>
              Unchecked = blocked. Admins always have full access.
            </p>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors" style={{ color: 'var(--c-muted)' }}>
            <X size={16} />
          </button>
        </div>

        {/* Permission groups */}
        {loading ? (
          <p className="text-sm text-center py-4" style={{ color: 'var(--c-muted)' }}>Loading permissions...</p>
        ) : (
          <div className="flex flex-col gap-4 max-h-96 overflow-y-auto pr-1">
            {PERMISSION_GROUPS.map(group => (
              <div key={group.label}>
                <p className="font-mono text-[9px] uppercase tracking-widest mb-2" style={{ color: 'var(--c-muted)' }}>
                  {group.label}
                </p>
                <div className="flex flex-col gap-2 pl-1">
                  {group.items.map(item => (
                    <Toggle
                      key={item.key}
                      label={item.label}
                      value={selected.has(item.key)}
                      onChange={() => toggle(item.key)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors"
            style={{ border: '1px solid var(--c-border)', color: 'var(--c-muted)' }}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #C9A84C, #E8C96A)', color: 'var(--bg-base)' }}>
            {saving ? 'Saving...' : 'Save Permissions'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Main ───────────────────────────────────────────────────

type Tab = 'profile' | 'notifications' | 'appearance' | 'security' | 'users'

export default function SettingsPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('profile')
  const { theme, toggle } = useTheme()

  const { data: me, refetch: refetchMe } = useQuery({
    queryKey: ['my-profile'],
    queryFn:  getMyProfile,
  })

  const { data: users = [], refetch: refetchUsers } = useQuery({
    queryKey: ['users'],
    queryFn:  listUsers,
    enabled:  me?.role === 'admin' && tab === 'users',
  })

  // Profile state
  const [displayName,  setDisplayName]  = useState('')
  const [saving,       setSaving]       = useState(false)

  // Notif state
  const [notifEnabled, setNotifEnabled] = useState(true)
  const [savingNotif,  setSavingNotif]  = useState(false)

  useEffect(() => {
    if (me) {
      setDisplayName(me.display_name)
      setNotifEnabled(me.notif_enabled)
    }
  }, [me])

  // Permission modal
  const [permUser, setPermUser] = useState<UserResponse | null>(null)

  // (users are auto-created when they log in via Odoo — no manual create needed)

  // ── Handlers ──

  async function handleSaveProfile() {
    setSaving(true)
    try {
      await updateMyProfile({ display_name: displayName })
      await refetchMe()
      toast.success('Profile saved')
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveNotif() {
    setSavingNotif(true)
    try {
      await updateMyProfile({ notif_enabled: notifEnabled })
      await refetchMe()
      toast.success('Notification settings saved')
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to save settings')
    } finally {
      setSavingNotif(false)
    }
  }

  async function handleDeactivate(u: UserResponse) {
    try {
      await deactivateUser(u.id)
      await refetchUsers()
      toast.success(`${u.display_name} deactivated`)
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to deactivate user')
    }
  }

  async function handleActivate(u: UserResponse) {
    try {
      await updateUser(u.id, { is_active: true })
      await refetchUsers()
      toast.success(`${u.display_name} activated`)
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to activate user')
    }
  }

  async function handleRoleChange(u: UserResponse, newRole: 'admin' | 'pic') {
    try {
      await updateUser(u.id, { role: newRole })
      await refetchUsers()
      queryClient.invalidateQueries({ queryKey: ['my-permissions'] })
      toast.success(`${u.display_name}'s role changed to ${newRole}`)
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to change role')
    }
  }

  function handleLogout() {
    logout()
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'profile',       label: 'Profile' },
    { key: 'notifications', label: 'Notifications' },
    { key: 'appearance',    label: 'Appearance' },
    { key: 'security',      label: 'Security' },
    ...(me?.role === 'admin' ? [
      { key: 'users' as Tab, label: 'Users' },
    ] : []),
  ]

  return (
    <div className="p-6 flex flex-col gap-6">

      <div>
        <h1 className="text-white text-2xl font-bold">Settings</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--c-muted)' }}>Account and system preferences</p>
      </div>

      {/* Two-column layout: sidebar tabs on desktop, horizontal bar on mobile */}
      <div className="flex flex-col md:flex-row gap-6 items-start">

        {/* Tab nav */}
        <div
          className="flex md:flex-col gap-1 p-1 rounded-xl md:w-44 w-full flex-shrink-0"
          style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)' }}
        >
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex-1 md:flex-none py-2 px-3 rounded-lg text-sm font-medium transition-all md:text-left"
              style={tab === t.key ? { background: 'var(--c-border)', color: '#C9A84C' } : { color: 'var(--c-muted)' }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">

          {/* ── Profile ── */}
          {tab === 'profile' && (
            <div className="flex flex-col gap-4">
              <div className="p-5 rounded-xl flex items-center gap-4"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
                <div className="w-14 h-14 flex items-center justify-center rounded-xl flex-shrink-0"
                  style={{ background: 'rgba(201,168,76,0.10)', border: '1px solid rgba(201,168,76,0.25)' }}>
                  <User2 size={22} style={{ color: '#C9A84C' }} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <p className="text-white font-semibold">{me?.display_name ?? '—'}</p>
                  <p className="font-mono text-xs" style={{ color: 'var(--c-muted)' }}>{me?.email ?? '—'}</p>
                  {me && <RoleBadge role={me.role} />}
                </div>
              </div>

              <div className="p-5 rounded-xl flex flex-col gap-4"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
                <Field label="Display Name" value={displayName} onChange={setDisplayName} placeholder="Display name" />
                <Field label="Email" value={me?.email ?? ''} readOnly type="email" />
                <button
                  onClick={handleSaveProfile}
                  disabled={saving}
                  className="self-start flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #C9A84C, #E8C96A)', color: 'var(--bg-base)' }}>
                  <Save size={13} />
                  {saving ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </div>
          )}

          {/* ── Notifications ── */}
          {tab === 'notifications' && (
            <div className="p-5 rounded-xl flex flex-col gap-4"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
              <Toggle
                label="Push Notifications"
                desc="Receive push notifications for device events (offline, firmware, etc.)"
                value={notifEnabled}
                onChange={setNotifEnabled}
              />
              <div style={{ borderTop: '1px solid var(--c-border)' }} />
              <p className="text-xs" style={{ color: 'var(--c-muted)' }}>
                Notifications are sent via Firebase Cloud Messaging. Make sure browser notification permission is enabled.
              </p>
              <button
                onClick={handleSaveNotif}
                disabled={savingNotif}
                className="self-start flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #C9A84C, #E8C96A)', color: 'var(--bg-base)' }}>
                <Save size={13} />
                {savingNotif ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}

          {/* ── Appearance ── */}
          {tab === 'appearance' && (
            <div className="p-5 rounded-xl flex flex-col gap-5"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
              <div className="flex items-start gap-3 pb-4" style={{ borderBottom: '1px solid var(--c-border)' }}>
                <div className="w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0 mt-0.5"
                  style={{ background: 'rgba(201,168,76,0.10)', border: '1px solid rgba(201,168,76,0.25)' }}>
                  <Palette size={14} style={{ color: '#C9A84C' }} />
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--c-primary)' }}>Interface Theme</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--c-muted)' }}>
                    Switch between dark and light mode. Your preference is saved automatically.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(['dark', 'light'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => { if (theme !== t) toggle() }}
                    className="flex flex-col items-center gap-3 p-5 rounded-xl transition-all"
                    style={{
                      background: theme === t ? 'rgba(201,168,76,0.08)' : 'var(--bg-base)',
                      border: theme === t ? '2px solid #C9A84C' : '1px solid var(--c-border)',
                    }}
                  >
                    {t === 'dark'
                      ? <Moon size={22} style={{ color: theme === t ? '#C9A84C' : 'var(--c-muted)' }} />
                      : <Sun  size={22} style={{ color: theme === t ? '#C9A84C' : 'var(--c-muted)' }} />
                    }
                    <span className="text-sm font-medium" style={{ color: theme === t ? '#C9A84C' : 'var(--c-muted)' }}>
                      {t === 'dark' ? 'Dark' : 'Light'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Security ── */}
          {tab === 'security' && (
            <div className="flex flex-col gap-4">
              <div className="p-5 rounded-xl flex flex-col gap-4"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0 mt-0.5"
                    style={{ background: 'rgba(76,175,80,0.10)', border: '1px solid rgba(76,175,80,0.25)' }}>
                    <Shield size={14} style={{ color: '#4CAF50' }} />
                  </div>
                  <div>
                    <p className="text-white text-sm font-semibold">Firebase Authentication</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--c-muted)' }}>
                      Sessions are encrypted using Firebase Auth. Tokens are refreshed automatically every hour.
                      Access is restricted to authorized Kapitmas personnel.
                    </p>
                  </div>
                </div>
                {[
                  { label: 'Provider',     value: 'Email / Password', color: '#4CAF50' },
                  { label: 'App Version',  value: 'KAIIS v2.1.0',     color: '#C9A84C' },
                  { label: 'Role',         value: me?.role === 'admin' ? 'Administrator' : 'PIC', color: 'var(--c-muted)' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex items-center justify-between p-3 rounded-xl"
                    style={{ background: 'var(--bg-base)', border: '1px solid var(--c-border)' }}>
                    <span className="font-mono text-xs" style={{ color: 'var(--c-muted)' }}>{label}</span>
                    <span className="font-mono text-xs font-bold" style={{ color }}>{value}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={handleLogout}
                className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-colors self-start"
                style={{ background: 'rgba(244,67,54,0.10)', color: '#F44336', border: '1px solid rgba(244,67,54,0.25)' }}>
                <LogOut size={14} />
                Sign Out
              </button>
            </div>
          )}

          {/* ── Users (admin only) ── */}
          {tab === 'users' && me?.role === 'admin' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white text-sm font-semibold">User Management</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--c-muted)' }}>{users.length} users registered</p>
                </div>
                <p className="text-xs px-1" style={{ color: 'var(--c-muted)' }}>Users auto-register on first Odoo login</p>
              </div>

              <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
                {users.length === 0 ? (
                  <div className="py-12 text-center">
                    <p className="text-sm" style={{ color: 'var(--c-muted)' }}>No users yet</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr style={{ background: 'var(--bg-base)', borderBottom: '1px solid var(--c-border)' }}>
                          {['Name', 'Email', 'Role', 'Status', 'Permissions', ''].map(col => (
                            <th key={col} className="px-4 py-3 text-left font-mono text-[9px] uppercase tracking-widest"
                              style={{ color: 'var(--c-muted)' }}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {users.map(u => (
                          <tr key={u.id} className="border-b transition-colors hover:bg-white/[0.02]"
                            style={{ borderColor: 'rgba(var(--c-border-rgb), 0.27)' }}>
                            <td className="px-4 py-3">
                              <span className="text-sm font-medium text-white">{u.display_name}</span>
                              {u.id === me.id && (
                                <span className="ml-2 font-mono text-[8px] uppercase" style={{ color: 'var(--c-muted)' }}>(You)</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className="font-mono text-xs" style={{ color: 'var(--c-muted)' }}>{u.email}</span>
                            </td>
                            <td className="px-4 py-3">
                              {u.id === me.id ? (
                                <RoleBadge role={u.role} />
                              ) : (
                                <select
                                  value={u.role}
                                  onChange={e => handleRoleChange(u, e.target.value as 'admin' | 'pic')}
                                  className="px-2 py-0.5 rounded font-mono text-[9px] font-bold uppercase appearance-none focus:outline-none"
                                  style={{
                                    background: u.role === 'admin' ? 'rgba(201,168,76,0.12)' : 'rgba(100,130,255,0.12)',
                                    color: u.role === 'admin' ? '#C9A84C' : '#6482FF',
                                    border: `1px solid ${u.role === 'admin' ? 'rgba(201,168,76,0.25)' : 'rgba(100,130,255,0.25)'}`,
                                    cursor: 'pointer',
                                  }}
                                >
                                  <option value="pic">PIC</option>
                                  <option value="admin">Admin</option>
                                </select>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className="px-2 py-0.5 rounded font-mono text-[9px] font-bold uppercase"
                                style={{
                                  background: u.is_active ? 'rgba(76,175,80,0.10)' : 'rgba(244,67,54,0.10)',
                                  color: u.is_active ? '#4CAF50' : '#F44336',
                                  border: `1px solid ${u.is_active ? 'rgba(76,175,80,0.25)' : 'rgba(244,67,54,0.25)'}`,
                                }}>
                                {u.is_active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {u.role === 'admin' ? (
                                <span className="font-mono text-[9px]" style={{ color: 'var(--c-muted)' }}>Full Access</span>
                              ) : (
                                <button
                                  onClick={() => setPermUser(u)}
                                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-mono font-semibold uppercase tracking-wide transition-colors hover:bg-white/5"
                                  style={{ color: '#C9A84C', border: '1px solid rgba(201,168,76,0.25)' }}>
                                  <Key size={10} />
                                  Set Permissions
                                </button>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {u.id !== me.id && (
                                u.is_active ? (
                                  <button onClick={() => handleDeactivate(u)}
                                    className="font-mono text-[10px] uppercase tracking-wide transition-opacity hover:opacity-70"
                                    style={{ color: '#F44336' }}>
                                    Deactivate
                                  </button>
                                ) : (
                                  <button onClick={() => handleActivate(u)}
                                    className="font-mono text-[10px] uppercase tracking-wide transition-opacity hover:opacity-70"
                                    style={{ color: '#4CAF50' }}>
                                    Activate
                                  </button>
                                )
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── Permission Modal ── */}
      <AnimatePresence>
        {permUser && (
          <PermissionModal user={permUser} onClose={() => setPermUser(null)} />
        )}
      </AnimatePresence>

    </div>
  )
}
