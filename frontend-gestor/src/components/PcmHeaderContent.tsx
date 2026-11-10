import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function PcmHeaderContent({ slot, children, tools = false, fallback = true, watch = false }: { slot: string; children: ReactNode; tools?: boolean; fallback?: boolean; watch?: boolean }) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const update = () => setHost(document.getElementById(slot))
    update()
    if (!watch) return
    const observer = new MutationObserver(update)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [slot, watch])
  if (!host) return fallback ? <>{children}</> : null
  return createPortal(<div className={tools ? 'pcm-canvas pcm-header-tools' : 'pcm-header-content'}>{children}</div>, host)
}
