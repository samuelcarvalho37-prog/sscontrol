interface OperationOverlayProps {
  visible: boolean
  title: string
  description?: string
}

export function OperationOverlay({
  visible,
  title,
  description,
}: OperationOverlayProps) {
  if (!visible) return null

  return (
    <div className="operation-overlay" role="alertdialog" aria-modal="true" aria-live="assertive">
      <article className="operation-overlay__card">
        <div className="operation-overlay__spinner" aria-hidden="true" />
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </article>
    </div>
  )
}
