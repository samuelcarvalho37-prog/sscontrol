import type { AdminIntervention } from '../types/interventions'

export interface OperationalOrderReference {
  id: string
  raw: AdminIntervention
}

export interface WorkOrderDetailRequest {
  requestId: number
  workOrderId: string
}

export function createWorkOrderDetailRequestGate() {
  let latestRequestId = 0

  return {
    begin(workOrderId: string): WorkOrderDetailRequest {
      latestRequestId += 1
      return { requestId: latestRequestId, workOrderId }
    },
    isCurrent(request: WorkOrderDetailRequest): boolean {
      return request.requestId === latestRequestId
    },
    commit<T>(request: WorkOrderDetailRequest, apply: () => T): T | undefined {
      return request.requestId === latestRequestId ? apply() : undefined
    },
    invalidate(): void {
      latestRequestId += 1
    },
  }
}

export function loadOperationalWorkOrder<T>(
  order: OperationalOrderReference,
  loadById: (workOrderId: string) => Promise<T>,
): Promise<T> {
  return loadById(order.raw.id)
}

export function assertWorkOrderDetailMatchesSelection(
  detail: { id: string },
  request: WorkOrderDetailRequest,
): void {
  if (detail.id !== request.workOrderId) {
    throw new Error('A API retornou uma ordem diferente da selecionada. Atualize a fila e tente novamente.')
  }
}

export function focusWorkOrderDetail(
  panel: Pick<HTMLElement, 'scrollIntoView'>,
  heading: Pick<HTMLElement, 'focus'>,
): void {
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' })
  heading.focus({ preventScroll: true })
}

export function workOrderDetailHeadingCode(
  detailCode: string | undefined,
  selectedCode: string,
): string {
  return detailCode || selectedCode || 'Detalhes da ordem'
}
