import { useEffect, useRef } from 'react'

/** Keyboard focus stays in the active modal and returns to its trigger on close. */
export function useDialogFocus(onClose: () => void, busy = false) {
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  const busyRef = useRef(busy)
  useEffect(() => { closeRef.current = onClose; busyRef.current = busy }, [onClose, busy])
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    if (!dialog) return
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
    )).filter(element => element.getClientRects().length > 0)
    controls()[0]?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault(); event.stopPropagation(); closeRef.current(); return
      }
      if (event.key !== 'Tab') return
      const elements = controls()
      const first = elements[0], last = elements.at(-1)
      if (!first || !last) { event.preventDefault(); return }
      if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', keydown, true)
    return () => { document.removeEventListener('keydown', keydown, true); if (previous?.isConnected) previous.focus() }
  }, [])
  return dialogRef
}
