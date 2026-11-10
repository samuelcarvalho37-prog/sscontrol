export const pcmOperationalAreas = [
  { id: 'priorities', label: 'Prioridades e paradas' },
  { id: 'availability', label: 'Disponibilidade e tempos' },
  { id: 'failures', label: 'Falhas e reincidências' },
  { id: 'work', label: 'Ordens e capacidade' },
  { id: 'planning', label: 'Planejamento preventivo' },
  { id: 'team', label: 'Equipe técnica' },
  { id: 'materials', label: 'Materiais e custos' },
  { id: 'results', label: 'Resultados' },
] as const

export function matchesPcmOperationalArea(widget: { id: string; categoryId: string }, area: string): boolean {
  const id = widget.id.split('::copy::')[0]
  switch (area) {
    case 'all': return true
    case 'priorities': return id.startsWith('attention-') || id === 'preventives-next'
    case 'availability': return id === 'reliability-availability' || ['time', 'comparison'].includes(widget.categoryId)
    case 'failures': return ['reliability-failures', 'reliability-recurrence', 'sector-failures', 'asset-failures'].includes(id)
    case 'work': return ['operational', 'orders'].includes(widget.categoryId) || ['result-orders-open', 'result-orders-closed'].includes(id)
    case 'planning': return widget.categoryId === 'planning' || id === 'preventives-next'
    case 'team': return widget.categoryId === 'team' || id === 'operational-active-technicians'
    case 'materials': return widget.categoryId === 'stock'
    case 'results': return ['results', 'orders'].includes(widget.categoryId) || id.startsWith('result-')
    default: return widget.categoryId === area
  }
}
