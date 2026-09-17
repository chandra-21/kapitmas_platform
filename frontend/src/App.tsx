import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'

import AppLayout                  from './components/layout/AppLayout'
import LoginPage                  from './pages/LoginPage'
import DashboardPage              from './pages/DashboardPage'
import TimbanganPage              from './pages/TimbanganPage'
import TimbanganDeviceDetailPage  from './pages/TimbanganDeviceDetailPage'
import DevicesPage                from './pages/DevicesPage'
import AnalyticsPage              from './pages/AnalyticsPage'
import LogsPage                   from './pages/LogsPage'
import OTAPage                    from './pages/OTAPage'
import NotificationsPage          from './pages/NotificationsPage'
import SettingsPage               from './pages/SettingsPage'
import BackupsPage                from './pages/BackupsPage'
import LocationsPage              from './pages/LocationsPage'
import ScalesUnitsPage            from './pages/ScalesUnitsPage'
import SmartBuddyPage             from './pages/SmartBuddyPage'
import SmartBuddyDetailPage       from './pages/SmartBuddyDetailPage'
import SmartBuddyOTAPage          from './pages/SmartBuddyOTAPage'
import { usePermissions }         from './hooks/usePermissions'
import { isLoggedIn }             from './lib/auth'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

function RequireAuth() {
  if (!isLoggedIn()) return <Navigate to="/login" replace />
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  )
}

function PermissionGuard({ permission, children }: { permission: string; children: React.ReactNode }) {
  const { can, loading } = usePermissions()
  if (loading) return null
  if (!can(permission)) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            {/* Global */}
            <Route path="/dashboard"     element={<DashboardPage />} />
            <Route path="/devices"       element={<PermissionGuard permission="timbangan.view"><DevicesPage /></PermissionGuard>} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/settings"      element={<SettingsPage />} />
            <Route path="/locations"     element={<PermissionGuard permission="location.view"><LocationsPage /></PermissionGuard>} />
            <Route path="/scales-units"  element={<PermissionGuard permission="location.manage"><ScalesUnitsPage /></PermissionGuard>} />

            {/* Timbangan module */}
            <Route path="/timbangan" element={<Navigate to="/timbangan/devices" replace />} />
            <Route path="/timbangan/devices"     element={<PermissionGuard permission="timbangan.view"><TimbanganPage /></PermissionGuard>} />
            <Route path="/timbangan/devices/:id" element={<PermissionGuard permission="timbangan.view"><TimbanganDeviceDetailPage /></PermissionGuard>} />
            <Route path="/timbangan/logs"        element={<PermissionGuard permission="report.view"><LogsPage /></PermissionGuard>} />
            <Route path="/timbangan/analytics"   element={<PermissionGuard permission="report.view"><AnalyticsPage /></PermissionGuard>} />
            <Route path="/timbangan/backups"     element={<PermissionGuard permission="report.export"><BackupsPage /></PermissionGuard>} />
            <Route path="/timbangan/ota"         element={<PermissionGuard permission="timbangan.ota"><OTAPage /></PermissionGuard>} />

            {/* SmartBuddy module */}
            <Route path="/smartbuddy"         element={<PermissionGuard permission="smartbuddy.view"><SmartBuddyPage /></PermissionGuard>} />
            <Route path="/smartbuddy/:id"     element={<PermissionGuard permission="smartbuddy.view"><SmartBuddyDetailPage /></PermissionGuard>} />
            <Route path="/smartbuddy/ota"     element={<PermissionGuard permission="smartbuddy.ota"><SmartBuddyOTAPage /></PermissionGuard>} />

            {/* Legacy redirects */}
            <Route path="/analytics"  element={<Navigate to="/timbangan/analytics" replace />} />
            <Route path="/logs"       element={<Navigate to="/timbangan/logs"      replace />} />
            <Route path="/ota"        element={<Navigate to="/timbangan/ota"       replace />} />
            <Route path="/backups"    element={<Navigate to="/timbangan/backups"   replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster
        theme="dark"
        toastOptions={{
          style: {
            background: 'var(--bg-surface)',
            border: '1px solid var(--c-border)',
            color: 'var(--c-primary)',
            fontFamily: 'Inter, sans-serif',
          },
        }}
      />
    </QueryClientProvider>
  )
}
