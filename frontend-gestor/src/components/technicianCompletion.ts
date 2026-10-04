import { ApiRequestError } from '../services/api/client'
import type { TechnicalCompletionInput } from '../types/operatorActions'

export type TechnicalCompletionField =
  | 'diagnostico_tecnico'
  | 'acao_realizada'
  | 'pecas_materiais'
  | 'medicoes'
  | 'resultado'
  | 'observacao'

export interface TechnicalCompletionIssue {
  field: TechnicalCompletionField
  message: string
}

const validationFieldLabels: Readonly<Record<string, string>> = {
  '/relatorio_tecnico/diagnostico_tecnico': 'Diagnóstico técnico',
  '/relatorio_tecnico/acao_realizada': 'Ação realizada',
  '/relatorio_tecnico/pecas_materiais': 'Peças / materiais',
  '/relatorio_tecnico/medicoes': 'Medições',
  '/resultado': 'Resultado',
}

function validationPath(detail: unknown): string | null {
  if (!detail || typeof detail !== 'object' || !('instancePath' in detail)) return null
  return typeof detail.instancePath === 'string' ? detail.instancePath : null
}

export function normalizeTechnicalCompletionInput(input: TechnicalCompletionInput): TechnicalCompletionInput {
  return {
    ...input,
    relatorio_tecnico: input.relatorio_tecnico
      ? {
          diagnostico_tecnico: input.relatorio_tecnico.diagnostico_tecnico.trim(),
          acao_realizada: input.relatorio_tecnico.acao_realizada.trim(),
          pecas_materiais: input.relatorio_tecnico.pecas_materiais.trim(),
          medicoes: input.relatorio_tecnico.medicoes.trim(),
        }
      : undefined,
    resultado: input.resultado.trim(),
    observacao: input.observacao?.trim() || null,
  }
}

export function validateTechnicalCompletionInput(input: TechnicalCompletionInput): TechnicalCompletionIssue[] {
  const report = input.relatorio_tecnico
  const issues: TechnicalCompletionIssue[] = []
  if (!report?.diagnostico_tecnico.trim()) issues.push({ field: 'diagnostico_tecnico', message: 'Informe o diagnóstico técnico.' })
  if (!report?.acao_realizada.trim()) issues.push({ field: 'acao_realizada', message: 'Informe a ação realizada.' })
  if (!report?.pecas_materiais.trim()) issues.push({ field: 'pecas_materiais', message: 'Informe as peças/materiais utilizados ou registre que não houve utilização.' })
  if (!report?.medicoes.trim()) issues.push({ field: 'medicoes', message: 'Informe as medições realizadas ou registre que não se aplica.' })
  if (!input.resultado.trim()) issues.push({ field: 'resultado', message: 'Informe o resultado da intervenção.' })
  if (!input.observacao?.trim()) issues.push({ field: 'observacao', message: 'Informe a observação da intervenção.' })
  return issues
}

export function prepareTechnicalCompletionInput(input: TechnicalCompletionInput):
  | { ok: true; input: TechnicalCompletionInput }
  | { ok: false; issues: TechnicalCompletionIssue[] } {
  const normalized = normalizeTechnicalCompletionInput(input)
  const issues = validateTechnicalCompletionInput(normalized)
  return issues.length === 0 ? { ok: true, input: normalized } : { ok: false, issues }
}

export async function submitTechnicalCompletion<T>(
  input: TechnicalCompletionInput,
  submit: (normalized: TechnicalCompletionInput) => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; issues: TechnicalCompletionIssue[] }> {
  const prepared = prepareTechnicalCompletionInput(input)
  if (!prepared.ok) return prepared
  return { ok: true, data: await submit(prepared.input) }
}

export function completionErrorMessage(cause: unknown): string {
  if (!(cause instanceof ApiRequestError)) {
    return cause instanceof Error ? cause.message : 'Não foi possível concluir a execução.'
  }
  if (cause.code !== 'REQUEST_VALIDATION_FAILED' || !Array.isArray(cause.details)) return cause.message

  const fields = [...new Set(
    cause.details
      .map(validationPath)
      .filter((path): path is string => path !== null)
      .map((path) => validationFieldLabels[path])
      .filter((field): field is string => Boolean(field)),
  )]
  return fields.length > 0
    ? `Revise os campos obrigatórios: ${fields.join(', ')}.`
    : cause.message
}

export function requiresPostInterventionRelease(analysis: Record<string, unknown> | null): boolean {
  return analysis?.exige_liberacao_pos_intervencao === true
}

export function completionButtonLabel(requiresPostIntervention: boolean, busy: boolean): string {
  if (busy) return requiresPostIntervention ? 'Encaminhando…' : 'Concluindo…'
  return requiresPostIntervention ? 'Concluir e encaminhar para validação' : 'Concluir OS'
}
