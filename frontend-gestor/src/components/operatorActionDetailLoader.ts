import { getOperatorAction, listOperatorMaterials, startOperatorAction } from '../services/api/operatorActions'
import type { StopMode } from '../types/operatorActions'

type Detail = Awaited<ReturnType<typeof getOperatorAction>>
type Materials = Awaited<ReturnType<typeof listOperatorMaterials>>

export function createOperatorActionDetailLoader(
  apply: (detail: Detail, materials: Materials) => void,
  setBusy: (busy: boolean) => void,
  setError: (message: string) => void,
  applyExecution: (execution: Awaited<ReturnType<typeof startOperatorAction>>) => void,
  api = { getOperatorAction, listOperatorMaterials, startOperatorAction },
) {
  let revision = 0
  let selectedId: string | null = null

  async function load(actionId: string, ticket: number) {
    const [detail, materials] = await Promise.all([
      api.getOperatorAction(actionId), api.listOperatorMaterials(actionId),
    ])
    if (ticket === revision && selectedId === actionId) apply(detail, materials)
  }

  async function run(actionId: string, ticket: number, operation: () => Promise<void>) {
    setBusy(true)
    setError('')
    try { await operation(); return ticket === revision && selectedId === actionId }
    catch (cause) {
      if (ticket === revision) setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar a ação.')
      return false
    } finally {
      if (ticket === revision && selectedId === actionId) setBusy(false)
    }
  }

  return {
    open(actionId: string) {
      selectedId = actionId
      const ticket = ++revision
      return run(actionId, ticket, () => load(actionId, ticket))
    },
    start(actionId: string, mode: StopMode) {
      if (selectedId !== actionId) return Promise.resolve(false)
      const ticket = ++revision
      return run(actionId, ticket, async () => {
        const execution = await api.startOperatorAction(actionId, mode)
        if (ticket !== revision || selectedId !== actionId) return
        applyExecution(execution)
        await load(actionId, ticket)
      })
    },
    clear() { selectedId = null; revision += 1 },
  }
}
