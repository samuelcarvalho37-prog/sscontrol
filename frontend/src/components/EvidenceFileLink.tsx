import { useEffect, useState } from 'react'

import { usesNodeApiTransport } from '../services/api/client'
import { loadOperatorEvidenceBlob } from '../services/api/operator'
import type { EvidenceRecord } from '../types/api'

interface EvidenceFileLinkProps {
  readonly evidence: EvidenceRecord
  readonly index: number
  readonly className?: string
  readonly showFileName?: boolean
}

export function EvidenceFileLink({
  evidence,
  index,
  className,
  showFileName = false,
}: EvidenceFileLinkProps) {
  const directUrl = evidence.thumbnail_url || evidence.url || ''
  const isPrivateNodeFile =
    usesNodeApiTransport() &&
    Boolean(evidence.arquivo_id) &&
    evidence.url?.startsWith('/v1/maintenance/evidence-files/')
  const [resolvedUrl, setResolvedUrl] = useState(
    isPrivateNodeFile ? '' : directUrl,
  )
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!isPrivateNodeFile || !evidence.arquivo_id) {
      setResolvedUrl(directUrl)
      setFailed(false)
      return
    }

    let active = true
    let objectUrl = ''
    setResolvedUrl('')
    setFailed(false)
    void loadOperatorEvidenceBlob(evidence.arquivo_id)
      .then((blob) => {
        if (!active) return
        objectUrl = URL.createObjectURL(blob)
        setResolvedUrl(objectUrl)
      })
      .catch(() => {
        if (active) setFailed(true)
      })

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [directUrl, evidence.arquivo_id, isPrivateNodeFile])

  const fileName = evidence.nome_arquivo || `Evidência ${index + 1}`
  return (
    <a
      className={className}
      href={resolvedUrl || undefined}
      target="_blank"
      rel="noreferrer"
      aria-disabled={!resolvedUrl}
      onClick={(event) => {
        if (!resolvedUrl) event.preventDefault()
      }}
    >
      {resolvedUrl ? (
        <img src={resolvedUrl} alt={fileName} />
      ) : (
        <span>{failed ? 'Indisponível' : 'Carregando…'}</span>
      )}
      {showFileName && <strong>{fileName}</strong>}
    </a>
  )
}
