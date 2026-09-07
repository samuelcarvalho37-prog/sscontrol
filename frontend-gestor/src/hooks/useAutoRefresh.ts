import { useEffect, useRef } from 'react'

export const FAB_CONTROL_DATA_CHANGED_EVENT = 'fab-control:data-changed'

interface AutoRefreshOptions {
  enabled?: boolean
  intervalMs?: number
}

export function notifyDataChanged(): void {
  window.dispatchEvent(new Event(FAB_CONTROL_DATA_CHANGED_EVENT))
}

export function useAutoRefresh(
  refresh: () => void | Promise<void>,
  {
    enabled = true,
    intervalMs = 15_000,
  }: AutoRefreshOptions = {},
): void {
  const refreshRef = useRef(refresh)
  const runningRef = useRef(false)

  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  useEffect(() => {
    if (!enabled) return

    const run = async () => {
      if (
        runningRef.current ||
        document.visibilityState !== 'visible' ||
        !navigator.onLine
      ) {
        return
      }

      runningRef.current = true
      try {
        await refreshRef.current()
      } finally {
        runningRef.current = false
      }
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void run()
    }
    const refreshWhenOnline = () => void run()
    const refreshWhenFocused = () => void run()
    const refreshWhenChanged = () => void run()
    const timer = window.setInterval(() => void run(), intervalMs)

    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshWhenFocused)
    window.addEventListener('online', refreshWhenOnline)
    window.addEventListener(
      FAB_CONTROL_DATA_CHANGED_EVENT,
      refreshWhenChanged,
    )

    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshWhenFocused)
      window.removeEventListener('online', refreshWhenOnline)
      window.removeEventListener(
        FAB_CONTROL_DATA_CHANGED_EVENT,
        refreshWhenChanged,
      )
    }
  }, [enabled, intervalMs])
}
