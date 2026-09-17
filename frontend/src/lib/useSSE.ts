import { useEffect, useRef } from 'react'
import { getToken } from '@/lib/auth'

export type SSEEvent = {
  type:
    | 'weight' | 'status' | 'activity'
    | 'smartbuddy_status' | 'smartbuddy_ac' | 'smartbuddy_lamp'
    | 'smartbuddy_pir' | 'smartbuddy_ir_result'
  data: Record<string, unknown>
}

export function useSSE(onEvent: (e: SSEEvent) => void, url = '/api/timbangan/events') {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    let cancelled = false
    let es: EventSource | null = null

    function connect() {
      if (cancelled) return
      const token = getToken()

      const endpoint = token
        ? `${url}?token=${encodeURIComponent(token)}`
        : url

      es = new EventSource(endpoint)

      es.onmessage = (e) => {
        try {
          const parsed = JSON.parse(e.data) as SSEEvent
          onEventRef.current(parsed)
        } catch {
          // heartbeat or malformed — ignore
        }
      }

      es.onerror = () => {
        es?.close()
        if (!cancelled) setTimeout(connect, 3000)
      }
    }

    connect()

    return () => {
      cancelled = true
      es?.close()
    }
  }, [url])
}
