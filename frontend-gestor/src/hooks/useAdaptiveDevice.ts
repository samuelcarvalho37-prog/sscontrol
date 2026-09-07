import { useEffect, useState } from 'react'

const COMPACT_QUERY = '(max-width: 1100px), (pointer: coarse)'

function matchesCompactDevice(): boolean {
  return window.matchMedia(COMPACT_QUERY).matches
}

export function useAdaptiveDevice(): boolean {
  const [compact, setCompact] = useState(matchesCompactDevice)

  useEffect(() => {
    const media = window.matchMedia(COMPACT_QUERY)
    const update = () => setCompact(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return compact
}
