import { type ReactNode } from 'react'
import Sidebar from './Sidebar'
import TopNav  from './TopNav'

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <Sidebar />
      <TopNav />
      <main className="ml-[280px] pt-16 min-h-screen">
        {children}
      </main>
    </div>
  )
}
