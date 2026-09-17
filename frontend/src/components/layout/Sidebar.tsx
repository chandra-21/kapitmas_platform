import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, HardDrive, Scale, BarChart2,
  ScrollText, ArrowUpCircle, Settings, LogOut, Bell, User2, Archive,
  ChevronDown, ChevronRight, MapPin, Layers, Thermometer, Radio,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { logout } from '@/lib/auth'
import { usePermissions } from '@/hooks/usePermissions'
import logoImg from '@/assets/logo.png'

const TOP_NAV = [
  { to: '/dashboard', label: 'Dashboard',  Icon: LayoutDashboard, permission: null          },
  { to: '/devices',   label: 'All Devices', Icon: HardDrive,       permission: 'timbangan.view' },
]

const MODULES = [
  {
    id:     'timbangan',
    label:  'Scales',
    Icon:   Scale,
    prefix: '/timbangan',
    color:  '#C9A84C',
    items: [
      { to: '/timbangan/devices',   label: 'Devices',    Icon: HardDrive,     permission: 'timbangan.view' },
      { to: '/timbangan/logs',      label: 'Logs',       Icon: ScrollText,    permission: 'report.view'    },
      { to: '/timbangan/analytics', label: 'Analytics',  Icon: BarChart2,     permission: 'report.view'    },
      { to: '/timbangan/backups',   label: 'Backup',     Icon: Archive,       permission: 'report.export'  },
      { to: '/timbangan/ota',       label: 'OTA Update', Icon: ArrowUpCircle, permission: 'timbangan.ota'  },
    ],
  },
  {
    id:     'smartbuddy',
    label:  'SmartBuddy',
    Icon:   Thermometer,
    prefix: '/smartbuddy',
    color:  '#26C6DA',
    items: [
      { to: '/smartbuddy',     label: 'Devices', Icon: HardDrive, permission: 'smartbuddy.view' },
      { to: '/smartbuddy/ota', label: 'OTA',     Icon: Radio,     permission: 'smartbuddy.ota'  },
    ],
  },
]

const COMING_SOON = [
  { label: 'DoorLock' },
]

const BOTTOM_NAV = [
  { to: '/notifications', label: 'Notifications', Icon: Bell,     permission: null              },
  { to: '/locations',     label: 'Locations',      Icon: MapPin,   permission: 'location.view'   },
  { to: '/scales-units',  label: 'Asset Units',    Icon: Layers,   permission: 'location.manage' },
  { to: '/settings',      label: 'Settings',       Icon: Settings, permission: null              },
]

export default function Sidebar() {
  const { pathname } = useLocation()
  const { can, isAdmin, profile } = usePermissions()

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(MODULES.map(m => [m.id, pathname.startsWith(m.prefix)]))
  )

  function handleLogout() {
    logout()
  }

  function toggle(id: string) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }

  function showItem(permission: string | null): boolean {
    if (permission === null) return true
    return can(permission)
  }

  return (
    <aside
      className="fixed left-0 top-0 bottom-0 w-[280px] flex flex-col z-40"
      style={{ background: 'var(--bg-surface)', borderRight: '1px solid var(--c-border)' }}
    >
      {/* ── Brand ── */}
      <div className="px-7 pt-7 pb-6" style={{ borderBottom: '1px solid var(--c-border)' }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(201,168,76,0.10)', border: '1px solid rgba(201,168,76,0.25)', borderRadius: 8 }}>
            <img src={logoImg} alt="Kapitmas" style={{ width: 24, height: 24, objectFit: 'contain' }} />
          </div>
          <div>
            <p className="text-white font-black text-xl leading-none tracking-tight">KAIIS</p>
            <p className="font-mono text-[9px] uppercase tracking-widest mt-0.5" style={{ color: '#C9A84C' }}>
              IoT Integrated System
            </p>
          </div>
        </div>
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 py-4 flex flex-col overflow-y-auto">

        {/* Main */}
        <p className="px-7 mb-1 font-mono text-[9px] uppercase tracking-widest" style={{ color: 'var(--c-faint)' }}>Main</p>
        {TOP_NAV.filter(item => showItem(item.permission)).map(({ to, label, Icon }) => (
          <NavLink key={to} to={to}
            className="relative flex items-center gap-3 px-7 py-3 text-sm font-medium transition-all duration-150"
            style={({ isActive }) => ({
              color:      isActive ? 'var(--c-primary)' : 'var(--c-muted)',
              background: isActive ? 'rgba(201,168,76,0.08)' : undefined,
            })}
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full" style={{ background: '#C9A84C' }} />}
                <Icon size={15} className="flex-shrink-0" style={{ color: isActive ? '#C9A84C' : 'var(--c-muted)' }} />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}

        {/* Modules */}
        <p className="px-7 mt-5 mb-1 font-mono text-[9px] uppercase tracking-widest" style={{ color: 'var(--c-faint)' }}>Modules</p>

        {MODULES.map(({ id, label, Icon, prefix, color, items }) => {
          const visibleItems = items.filter(item => showItem(item.permission))
          if (visibleItems.length === 0) return null

          const isOpen    = expanded[id]
          const modActive = pathname.startsWith(prefix)

          return (
            <div key={id}>
              {/* Module row */}
              <button
                onClick={() => toggle(id)}
                className="w-full relative flex items-center gap-3 px-7 py-3 text-sm font-medium transition-all duration-150 text-left"
                style={{
                  color:      modActive ? 'var(--c-primary)' : 'var(--c-muted)',
                  background: modActive && !isOpen ? 'rgba(201,168,76,0.08)' : undefined,
                }}
              >
                {modActive && !isOpen && (
                  <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full" style={{ background: color }} />
                )}
                <Icon size={15} className="flex-shrink-0" style={{ color: modActive ? color : 'var(--c-muted)' }} />
                <span className="flex-1">{label}</span>
                <span style={{ color: 'var(--c-faint)' }}>
                  {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </span>
              </button>

              {/* Sub-items */}
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18, ease: 'easeInOut' }}
                    className="overflow-hidden"
                    style={{ borderLeft: '1px solid var(--c-border)', marginLeft: 34, marginBottom: 2 }}
                  >
                    {visibleItems.map(({ to, label: sub, Icon: SubIcon }) => (
                      <NavLink key={to} to={to} end
                        className="relative flex items-center gap-2.5 pl-7 pr-4 py-2.5 text-xs font-medium transition-all duration-150"
                        style={({ isActive }) => ({
                          color:      isActive ? color : 'var(--c-dim)',
                          background: isActive ? `${color}0f` : undefined,
                        })}
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full" style={{ background: color }} />}
                            <SubIcon size={13} className="flex-shrink-0" />
                            <span>{sub}</span>
                          </>
                        )}
                      </NavLink>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}

        {/* Coming soon modules */}
        {COMING_SOON.map(({ label }) => (
          <div key={label} className="flex items-center gap-3 px-7 py-3 text-sm cursor-not-allowed select-none"
            style={{ color: 'var(--c-faint)' }}>
            <HardDrive size={15} className="flex-shrink-0" />
            <span className="flex-1">{label}</span>
            <span className="font-mono text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(61,68,114,0.30)', color: 'var(--c-faint)', border: '1px solid var(--c-border)' }}>
              Soon
            </span>
          </div>
        ))}

        {/* System */}
        <p className="px-7 mt-5 mb-1 font-mono text-[9px] uppercase tracking-widest" style={{ color: 'var(--c-faint)' }}>System</p>
        {BOTTOM_NAV.filter(item => showItem(item.permission)).map(({ to, label, Icon }) => (
          <NavLink key={to} to={to}
            className="relative flex items-center gap-3 px-7 py-3 text-sm font-medium transition-all duration-150"
            style={({ isActive }) => ({
              color:      isActive ? 'var(--c-primary)' : 'var(--c-muted)',
              background: isActive ? 'rgba(201,168,76,0.08)' : undefined,
            })}
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full" style={{ background: '#C9A84C' }} />}
                <Icon size={15} className="flex-shrink-0" style={{ color: isActive ? '#C9A84C' : 'var(--c-muted)' }} />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ── User profile ── */}
      <div className="px-7 py-5" style={{ borderTop: '1px solid var(--c-border)' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(201,168,76,0.10)', border: '1px solid rgba(201,168,76,0.25)', borderRadius: 8 }}>
            <User2 size={16} style={{ color: '#C9A84C' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold leading-none truncate">
              {profile?.display_name ?? '—'}
            </p>
            <p className="font-mono text-[10px] mt-0.5 truncate" style={{ color: 'var(--c-muted)' }}>
              {isAdmin ? 'Administrator' : 'PIC'}
            </p>
          </div>
          <button onClick={handleLogout}
            className="flex-shrink-0 p-1.5 rounded transition-colors hover:bg-white/5"
            style={{ color: 'var(--c-muted)' }} title="Logout">
            <LogOut size={14} />
          </button>
        </div>
      </div>

      {/* ── Powered by ── */}
      <div className="px-7 py-4 flex items-center gap-2.5"
        style={{ borderTop: '1px solid var(--c-border)', background: 'rgba(201,168,76,0.03)' }}>
        <img src={logoImg} alt="Kapitmas" style={{ width: 18, height: 18, objectFit: 'contain' }} />
        <div>
          <p className="font-mono text-[9px] uppercase tracking-widest" style={{ color: 'var(--c-faint)' }}>Powered by</p>
          <p className="font-bold text-[11px] leading-none" style={{ color: '#C9A84C' }}>KAPITMAS</p>
        </div>
      </div>
    </aside>
  )
}
