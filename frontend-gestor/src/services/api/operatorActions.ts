import { API_TIMEOUT_MS, ApiRequestError, callApi } from './client'
import { getApiUrl, getGestorToken } from './config'
import type {
  Execution,
  ExecutionItem,
  ExecutionValidation,
  ConsumableMaterial,
  OperatorAction,
  OperatorActionDetail,
  StopMode,
  TechnicalCompletionInput,
  EligibleSupportTechnician,
  ImprovementCategory,
  ExecutionParticipant,
  PartShortage,
} from '../../types/operatorActions'
import type { AdminEntityRecord } from '../../types/catalog'

function token(): string {
  const value = getGestorToken()
  if (!value) throw new ApiRequestError('Sessão não encontrada. Entre novamente.', 'GESTOR_SESSION_MISSING')
  return value
}

function requireData<T>(data: T | undefined, action: string): T {
  if (data === undefined) throw new ApiRequestError(`A API não retornou dados para ${action}.`, 'OPERATOR_ACTION_EMPTY_RESPONSE')
  return data
}

export async function listOperatorActions(history = false, signal?: AbortSignal): Promise<OperatorAction[]> {
  const response = await callApi<{ itens?: OperatorAction[] }>('operator-actions.list', { token: token(), limite: 100, historico: history }, signal, { timeoutMs: API_TIMEOUT_MS.DETAIL_READ, dedupe: true })
  return requireData(response.data, 'operator-actions.list').itens ?? []
}

/** Read-only plan library for technicians. A plan is never executable until PCM
 * generates, releases and assigns its OS to the technician. */
export async function listTechnicianPlans(signal?: AbortSignal): Promise<AdminEntityRecord[]> {
  const response = await callApi<{ rows?: AdminEntityRecord[] }>(
    'admin.listar',
    { token: token(), entidade: 'planos', limite: 2_000 },
    signal,
    { timeoutMs: API_TIMEOUT_MS.DETAIL_READ, dedupe: true },
  )
  return requireData(response.data, 'maintenance.plans.list').rows ?? []
}

export async function getOperatorAction(actionId: string, signal?: AbortSignal): Promise<{ acao: OperatorActionDetail; execucao: Execution | null; tecnicos_elegiveis: EligibleSupportTechnician[]; participantes: ExecutionParticipant[] }> {
  const response = await callApi<{ acao: OperatorActionDetail; execucao: Execution | null; tecnicos_elegiveis?: EligibleSupportTechnician[]; participantes?: ExecutionParticipant[] }>('operator-actions.get', { token: token(), acao_id: actionId }, signal, { timeoutMs: API_TIMEOUT_MS.DETAIL_READ })
  const data = requireData(response.data, 'operator-actions.get')
  return { ...data, tecnicos_elegiveis: data.tecnicos_elegiveis ?? [], participantes: data.participantes ?? [] }
}

export async function startOperatorAction(actionId: string, modoParada: StopMode): Promise<Execution> {
  const response = await callApi<{ execucao: Execution }>('operator-actions.start', { token: token(), acao_id: actionId, modo_parada: modoParada }, undefined, { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE })
  return requireData(response.data, 'operator-actions.start').execucao
}

export async function claimOperatorAction(actionId: string): Promise<void> {
  const response = await callApi<Record<string, unknown>>('operator-actions.assume', { token: token(), acao_id: actionId }, undefined, { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE })
  requireData(response.data, 'operator-actions.assume')
}

export async function inviteActionCollaborator(actionId: string, userId: string): Promise<void> {
  const response = await callApi<Record<string, unknown>>('operator-actions.collaborators.invite', { token: token(), acao_id: actionId, usuario_id: userId }, undefined, { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE })
  requireData(response.data, 'operator-actions.collaborators.invite')
}

export async function respondToCollaboratorInvite(actionId: string, participantId: string, accept: boolean): Promise<void> {
  const response = await callApi<Record<string, unknown>>(accept ? 'operator-actions.collaborators.accept' : 'operator-actions.collaborators.decline', { token: token(), acao_id: actionId, participant_id: participantId }, undefined, { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE })
  requireData(response.data, 'operator-actions.collaborators.respond')
}

export async function startParticipantSession(executionId: string): Promise<Execution> {
  const response = await callApi<Execution>('execution.sessions.start', { token: token(), execucao_id: executionId }, undefined, { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE })
  return requireData(response.data, 'execution.sessions.start')
}

export async function pauseParticipantSession(executionId: string, reason: string): Promise<Execution> {
  const response = await callApi<Execution>('execution.sessions.pause', { token: token(), execucao_id: executionId, motivo: reason }, undefined, { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE })
  return requireData(response.data, 'execution.sessions.pause')
}

export async function endParticipantSession(executionId: string): Promise<Execution> {
  const response = await callApi<Execution>('execution.sessions.end', { token: token(), execucao_id: executionId }, undefined, { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE })
  return requireData(response.data, 'execution.sessions.end')
}

export async function createPartShortage(executionId: string, input: {
  partCode: string | null; description: string; quantity: number; unit: string;
  observation: string | null; blocking: boolean; photo: File | null;
}): Promise<Execution> {
  const form = new FormData()
  form.append('codigo_peca', input.partCode ?? '')
  form.append('descricao', input.description)
  form.append('quantidade', String(input.quantity))
  form.append('unidade', input.unit)
  form.append('observacao', input.observation ?? '')
  form.append('impeditiva', String(input.blocking))
  if (input.photo) form.append('foto', input.photo)
  const response = await callApi<Execution>('execution.part-shortages.create', { token: token(), execucao_id: executionId, form_data: form }, undefined, { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE })
  return requireData(response.data, 'execution.part-shortages.create')
}

export async function listPlantPartShortages(): Promise<PartShortage[]> {
  const response=await callApi<{pendencias_peca?:PartShortage[]}>('maintenance.part-shortages.list',{token:token()},undefined,{timeoutMs:API_TIMEOUT_MS.DETAIL_READ})
  return requireData(response.data,'maintenance.part-shortages.list').pendencias_peca ?? []
}

export async function getPlantPartShortage(shortageId:string):Promise<PartShortage>{
  const response=await callApi<{pendencia_peca:PartShortage}>('maintenance.part-shortages.get',{token:token(),pendencia_id:shortageId},undefined,{timeoutMs:API_TIMEOUT_MS.DETAIL_READ})
  return requireData(response.data,'maintenance.part-shortages.get').pendencia_peca
}

export async function transitionPartShortage(workOrderId:string, shortageId:string, transition:'resolve'|'cancel', justification:string):Promise<void>{
  await callApi<Record<string,unknown>>(`work-orders.part-shortages.${transition}`,{token:token(),ordem_id:workOrderId,pendencia_id:shortageId,justificativa:justification},undefined,{timeoutMs:API_TIMEOUT_MS.CRITICAL_WRITE})
}

export async function createShiftHandoff(executionId:string,input:{equipmentCondition:string;pendingWork:string;recommendedNextStep:string;workPending:boolean}):Promise<Execution>{
  const response=await callApi<Execution>('execution.shift-handoffs.create',{token:token(),execucao_id:executionId,condicao_equipamento:input.equipmentCondition,trabalho_pendente:input.pendingWork,proximo_passo:input.recommendedNextStep,ha_trabalho_pendente:input.workPending},undefined,{timeoutMs:API_TIMEOUT_MS.CRITICAL_WRITE})
  return requireData(response.data,'execution.shift-handoffs.create')
}

export async function resumeExecutionForWorkOrder(workOrderId:string,executionId:string):Promise<Execution>{
  const response=await callApi<Execution>('work-orders.execution.resume',{token:token(),ordem_id:workOrderId,execucao_id:executionId},undefined,{timeoutMs:API_TIMEOUT_MS.CRITICAL_WRITE})
  return requireData(response.data,'work-orders.execution.resume')
}

export async function pauseExecution(executionId: string, motivoCodigo: string, motivoDetalhe: string | null): Promise<Execution> {
  const response = await callApi<Execution>('maintenance.executions.pause', { token: token(), execucao_id: executionId, motivo_codigo: motivoCodigo, motivo_detalhe: motivoDetalhe }, undefined, { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE })
  return requireData(response.data, 'maintenance.executions.pause')
}

export async function resumeExecution(executionId: string): Promise<Execution> {
  const response = await callApi<Execution>('maintenance.executions.resume', { token: token(), execucao_id: executionId }, undefined, { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE })
  return requireData(response.data, 'maintenance.executions.resume')
}

export async function saveOperatorResponses(actionId: string, itens: Array<Pick<ExecutionItem, 'id'> & { resposta: string | null; valor: number | null; observacao: string | null }>): Promise<Execution> {
  const response = await callApi<{ execucao: Execution }>('operator-actions.responses', { token: token(), acao_id: actionId, itens: itens.map(({ id, resposta, valor, observacao }) => ({ item_id: id, resposta, valor, observacao })) }, undefined, { timeoutMs: API_TIMEOUT_MS.SAVE })
  return requireData(response.data, 'operator-actions.responses').execucao
}

export async function validateOperatorActionCompletion(actionId: string): Promise<ExecutionValidation> {
  const response = await callApi<ExecutionValidation>('operator-actions.validation', { token: token(), acao_id: actionId }, undefined, { timeoutMs: API_TIMEOUT_MS.DETAIL_READ })
  return requireData(response.data, 'operator-actions.validation')
}

export async function listOperatorMaterials(actionId: string): Promise<ConsumableMaterial[]> {
  const response = await callApi<{ materiais?: ConsumableMaterial[] }>('operator-actions.materials.list', { token: token(), acao_id: actionId }, undefined, { timeoutMs: API_TIMEOUT_MS.DETAIL_READ })
  return requireData(response.data, 'operator-actions.materials.list').materiais ?? []
}

export async function consumeOperatorMaterial(actionId: string, materialId: string, quantity: number, observation: string | null): Promise<Execution> {
  const response = await callApi<{ execucao: Execution }>('operator-actions.materials.consume', { token: token(), acao_id: actionId, material_id: materialId, quantidade: quantity, observacao: observation }, undefined, { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE })
  return requireData(response.data, 'operator-actions.materials.consume').execucao
}

export async function createImprovementRequest(input: {
  assetId: string
  category: ImprovementCategory
  suggestion: string
  reason: string
}): Promise<void> {
  const response = await callApi<{ solicitacao?: { id: string } }>('improvement-requests.create', {
    token: token(), ativo_id: input.assetId, categoria: input.category,
    sugestao: input.suggestion, motivo: input.reason, objeto_evidencia_id: null,
  }, undefined, { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE })
  requireData(response.data, 'improvement-requests.create')
}

export async function completeOperatorAction(actionId: string, input: TechnicalCompletionInput): Promise<Execution> {
  const response = await callApi<{ execucao: Execution }>('operator-actions.complete', { token: token(), acao_id: actionId, ...input }, undefined, { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE })
  return requireData(response.data, 'operator-actions.complete').execucao
}

export async function uploadExecutionEvidence(
  executionId: string,
  itemId: string,
  file: File,
  observation: string | null,
): Promise<Execution> {
  const form = new FormData()
  form.set('file', file)
  if (observation) form.set('observacao', observation)
  const baseUrl = getApiUrl().replace(/\/+$/, '').replace(/\/v1$/, '')
  const response = await fetch(
    `${baseUrl}/v1/maintenance/executions/${encodeURIComponent(executionId)}/items/${encodeURIComponent(itemId)}/evidence-file`,
    { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: form },
  )
  const envelope = await response.json() as { ok?: boolean; data?: Execution; error?: { code?: string; message?: string; details?: unknown } }
  if (!response.ok || !envelope.ok || !envelope.data) {
    throw new ApiRequestError(envelope.error?.message ?? `Não foi possível enviar a evidência (${response.status}).`, envelope.error?.code ?? 'EVIDENCE_UPLOAD_FAILED', envelope.error?.details)
  }
  return envelope.data
}
