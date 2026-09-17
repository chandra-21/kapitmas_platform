import { useState, useEffect } from 'react'
import { Search, Bell, Sun, Moon } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { NavLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { usePermissions } from '@/hooks/usePermissions'
import { getNotifications } from '@/lib/api'
import { useTheme } from '@/lib/theme'

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function TopNav() {
  const [now, setNow] = useState(new Date())
  const { profile, isAdmin } = usePermissions()
  const { theme, toggle } = useTheme()

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => getNotifications(10),
  })

  const hasAlert = notifications.length > 0

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })

  const displayName = profile?.display_name ?? '...'
  const roleLabel   = isAdmin ? 'Admin' : 'PIC'

  return (
    <header
      className="fixed left-[280px] right-0 top-0 h-16 z-30 flex items-center justify-between px-8 gap-4"
      style={{ background: 'rgba(var(--bg-surface-rgb), 0.92)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--c-border)' }}
    >
      {/* Left: Greeting */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-none" style={{ color: 'var(--c-primary)' }}>
            {getGreeting()}, {displayName}
          </p>
          <p className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--c-muted)' }}>
            Kapitmas IoT Operations Center
          </p>
        </div>
        <span
          className="flex-shrink-0 px-2.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider rounded-sm"
          style={{ background: 'rgba(201,168,76,0.12)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.25)' }}
        >
          {roleLabel}
        </span>
      </div>

      {/* Right: Search + Theme + Bell + Clock */}
      <div className="flex items-center gap-4 flex-shrink-0">
        {/* Search */}
        <div className="relative hidden md:block">
          <Search
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--c-muted)' }}
          />
          <input
            type="text"
            placeholder="Search devices..."
            className="w-52 pl-9 pr-4 py-1.5 text-xs font-sans rounded-md focus:outline-none transition-colors"
            style={{
              background: 'var(--bg-base)',
              border: '1px solid var(--c-border)',
              color: 'var(--c-primary)',
            }}
            onFocus={e => (e.currentTarget.style.borderColor = '#C9A84C')}
            onBlur={e  => (e.currentTarget.style.borderColor = 'var(--c-border)')}
          />
        </div>

        {/* Divider */}
        <div className="w-px h-5" style={{ background: 'var(--c-border)' }} />

        {/* Theme toggle */}
        <button
          onClick={toggle}
          className="p-1 rounded transition-colors hover:bg-white/5"
          style={{ color: 'var(--c-muted)' }}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        {/* Divider */}
        <div className="w-px h-5" style={{ background: 'var(--c-border)' }} />

        {/* Notification bell */}
        <NavLink to="/notifications" className="relative p-1 rounded transition-colors hover:bg-white/5" style={{ color: 'var(--c-muted)' }}>
          <Bell size={16} />
          <AnimatePresence>
            {hasAlert && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full"
                style={{ background: '#F44336' }}
              />
            )}
          </AnimatePresence>
        </NavLink>

        {/* Divider */}
        <div className="w-px h-5" style={{ background: 'var(--c-border)' }} />

        {/* Clock */}
        <div className="text-right hidden sm:block">
          <p className="font-mono text-sm font-medium tabular-nums" style={{ color: 'var(--c-primary)' }}>
            {timeStr}
          </p>
          <p className="font-mono text-[9px] uppercase tracking-wide" style={{ color: 'var(--c-muted)' }}>
            {dateStr}
          </p>
        </div>
      </div>
    </header>
  )
}
