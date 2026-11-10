export function clonePcmPrintBoard(board: HTMLElement, targetDocument: Document): HTMLElement {
  const copy = targetDocument.importNode(board, true) as HTMLElement
  const originals = [board, ...board.querySelectorAll<HTMLElement | SVGElement>('*')]
  const clones = [copy, ...copy.querySelectorAll<HTMLElement | SVGElement>('*')]
  const view = board.ownerDocument.defaultView
  if (!view) return copy
  originals.forEach((element, index) => {
    const clone = clones[index]
    const computed = view.getComputedStyle(element)
    for (const property of Array.from(computed)) clone.style.setProperty(property, computed.getPropertyValue(property), 'important')
    clone.style.setProperty('animation', 'none', 'important')
    clone.style.setProperty('transition', 'none', 'important')
    clone.style.setProperty('print-color-adjust', 'exact', 'important')
    clone.style.setProperty('-webkit-print-color-adjust', 'exact', 'important')
  })
  copy.removeAttribute('id')
  copy.querySelectorAll('.pcm-canvas__group-controls, .pcm-canvas__resize-handle, .pcm-canvas__select-handle, .pcm-canvas__palette-control, .pcm-canvas__context-menu').forEach(element => element.remove())
  return copy
}
