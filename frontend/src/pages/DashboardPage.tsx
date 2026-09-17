import { useEffect, useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'

import {
  getTimbanganStatus, getTimbanganLogs, getActivityFeed, getSystemHealth,
} from '@/lib/api'
import { useSSE } from '@/lib/useSSE'
import type { SSEEvent } from '@/lib/useSSE'

import SummaryCards from '@/components/dashboard/SummaryCards'
import SystemHealthPanel from '@/components/dashboard/SystemHealthPanel'
import ActivityFeed, {
  sseEventToFeedItem, activityToFeedItem,
} from '@/components/dashboard/ActivityFeed'
import type { FeedItem } from '@/components/dashboard/ActivityFeed'
import ScalesChart from '@/components/dashboard/ScalesChart'

const todayStr = () => new Date().toISOString().slice(0, 10)
const FEED_MAX  = 50

export default function DashboardPage() {
  const [feed, setFeed] = useState<FeedItem[]>([])

  const {refetch: refetchStatus } = useQuery({
    queryKey: ['timbangan-status'],
    queryFn:  getTimbanganStatus,
    refetchInterval: 30_000,
  })

  const { data: logsData } = useQuery({
    queryKey: ['timbangan-logs', todayStr()],
    queryFn:  () => getTimbanganLogs(todayStr()),
  })

  const { data: activityData } = useQuery({
    queryKey: ['activity-feed'],
    queryFn:  () => getActivityFeed(40),
    refetchInterval: 60_000,
  })

  const { data: health } = useQuery({
    queryKey: ['system-health'],
    queryFn:  getSystemHealth,
    refetchInterval: 30_000,
  })

  useEffect(() => {
    if (!activityData) return
    setFeed(prev => {
      const existing = new Set(prev.map(p => p.id))
      const next = activityData.map(activityToFeedItem).filter(i => !existing.has(i.id))
      return [...prev, ...next].sort((a, b) => b.time.getTime() - a.time.getTime()).slice(0, FEED_MAX)
    })
  }, [activityData])

  const handleSSE = useCallback((e: SSEEvent) => {
    const item = sseEventToFeedItem(e)
    if (item && e.type === 'activity') {
      setFeed(prev => prev.some(p => p.id === item.id) ? prev : [item, ...prev].slice(0, FEED_MAX))
    }
    if (e.type === 'status') refetchStatus()
  }, [refetchStatus])

  useSSE(handleSSE)

  //const status = statusData?.status ?? {}
  const logs   = logsData           ?? []

  return (
    <div className="p-6 flex flex-col gap-6 min-h-full">

      {/* Row 1: Summary stat cards */}
      <SummaryCards health={health} />

      {/* Row 2: System Health carousel (left) + Activity Feed (right) */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-6 items-start">
        {health
          ? <SystemHealthPanel health={health} />
          : <div className="rounded-xl p-8 flex items-center justify-center"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--c-border)' }}>
              <span className="font-mono text-xs" style={{ color: 'var(--c-muted)' }}>Loading...</span>
            </div>
        }
        <ActivityFeed items={feed} />
      </div>

      {/* Row 3: Weight trend chart */}
      <ScalesChart logs={logs} />

    </div>
  )
}
