import { useEffect, useState } from 'react'
import {
  getGestorChecklistModelDetail,
  isGestorAuthenticationError,
  validateGestorChecklistModel,
} from '../services/api/gestor'
import type {
  GestorChecklistModel,
  GestorChecklistModelDecision,
  GestorChecklistModelDecisionResult,
  GestorChecklistModelDetail,
} from '../types/gestor'

export interface ChecklistModelReviewDialogProps {
  model: GestorChecklistModel
  onClose: () => void
  onDecisionComplete: (
    result: GestorChecklistModelDecisionResult,
  ) => void | Promise<void>
  onSessionExpired: () => void
}

function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function recordValue(
  record: Record<string, unknown> | null | undefined,
  keys: string[],
): string {
  if (!record) return ''
  for (const key of keys) {
    const value = record[key]
    if (value === null || value === undefined || value === '') continue
    if (typeof value === 'object') continue
    return String(value)
  }
  return ''
}

function formatDate(value?: string): string {
  if (!value) return 'Não informado'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

export function ChecklistModelReviewDialog({
  model,
  onClose,
  onDecisionComplete,
  onSessionExpired,
}: ChecklistModelReviewDialogProps) {
  const [detail, setDetail] = useState<GestorChecklistModelDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [justification, setJustification] = useState('')
  const [result, setResult] = useState<GestorChecklistModelDecisionResult | null>(null)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose, submitting])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')

    void getGestorChecklistModelDetail(model.id, controller.signal)
      .then(setDetail)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        if (isGestorAuthenticationError(cause)) {
          onSessionExpired()
          return
        }
        setError(
          cause instanceof Error
            ? cause.message
            : 'Não foi possível carregar o modelo técnico.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [model.id, onSessionExpired])

  const currentStatus = upper(detail?.plano.workflow_status ?? model.workflow_status)
  const canDecide = currentStatus === 'EM_VALIDACAO_GESTAO' && !result

  async function submitDecision(decision: GestorChecklistModelDecision) {
    if (!canDecide || submitting) return

    const normalized = justification.trim()
    if (decision === 'DEVOLVER' && normalized.length < 5) {
      setError('Informe uma justificativa técnica com pelo menos 5 caracteres.')
      return
    }

    const label = decision === 'APROVAR' ? 'aprovar' : 'devolver para correção'
    if (!window.confirm(`Confirma ${label} este modelo técnico?`)) return

    setSubmitting(true)
    setError('')
    try {
      const response = await validateGestorChecklistModel(
        model.id,
        decision,
        normalized || 'Estrutura técnica revisada e aprovada pela gestão.',
      )
      setResult(response)
      await onDecisionComplete(response)
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível registrar a decisão do modelo.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const title = detail?.plano.nome || model.nome || 'Modelo técnico'
  const asset =
    recordValue(detail?.ativo, ['tag', 'codigo', 'id']) ||
    detail?.plano.ativo_tag ||
    model.ativo_tag ||
    model.ativo_id ||
    'Ativo não informado'
  const assetName =
    recordValue(detail?.ativo, ['nome', 'descricao']) ||
    detail?.plano.ativo_nome ||
    model.ativo_nome ||
    ''
  const component =
    recordValue(detail?.componente, ['tag', 'nome', 'id']) ||
    detail?.plano.componente_nome ||
    model.componente_nome ||
    'Aplicação no ativo'

  return (
    <div className="review-overlay" role="presentation">
      <section
        className="review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-review-title"
      >
        <header className="review-header">
          <div>
            <span className="eyebrow">VALIDAÇÃO DE MODELO</span>
            <h2 id="model-review-title">{title}</h2>
            <p>{asset}{assetName ? ` · ${assetName}` : ''}</p>
          </div>
          <button className="review-close" type="button" disabled={submitting} onClick={onClose}>
            ×
          </button>
        </header>

        {loading ? <p className="review-state">Carregando estrutura técnica…</p> : null}
        {!loading && !detail ? (
          <div className="review-error" role="alert">
            {error || 'Modelo técnico indisponível.'}
          </div>
        ) : null}

        {detail ? (
          <div className="review-body">
            <div className="review-summary-grid">
              <article>
                <span>Revisão</span>
                <strong>{detail.plano.revisao ?? 1}</strong>
              </article>
              <article>
                <span>Criticidade</span>
                <strong>{detail.plano.criticidade || 'Não informada'}</strong>
              </article>
              <article>
                <span>Componente</span>
                <strong>{component}</strong>
              </article>
              <article>
                <span>Itens ativos</span>
                <strong>{detail.itens.length}</strong>
              </article>
            </div>

            <section className="review-section">
              <header>
                <div>
                  <span className="eyebrow">CONFIGURAÇÃO</span>
                  <h3>Regras de execução</h3>
                </div>
              </header>
              <dl className="review-facts">
                <div><dt>Tipo</dt><dd>{detail.plano.tipo || 'Não informado'}</dd></div>
                <div><dt>Tempo estimado</dt><dd>{detail.plano.tempo_estimado_min ?? 0} min</dd></div>
                <div><dt>Bloqueio</dt><dd>{detail.plano.requer_bloqueio || 'NÃO'}</dd></div>
                <div><dt>Evidência</dt><dd>{detail.plano.requer_evidencia || 'NÃO'}</dd></div>
              </dl>
            </section>

            <section className="review-section">
              <header>
                <div>
                  <span className="eyebrow">CHECKLIST TÉCNICO</span>
                  <h3>Sequência enviada pelo Administrador</h3>
                </div>
              </header>
              {detail.itens.length ? (
                <div className="model-item-list">
                  {detail.itens.map((item, index) => (
                    <article className="model-item" key={item.id}>
                      <span className="model-item__index">{item.ordem ?? index + 1}</span>
                      <div>
                        <div className="model-item__heading">
                          <h4>{item.titulo || 'Item sem título'}</h4>
                          <span className="status-pill">{item.tipo_resposta || 'RESPOSTA'}</span>
                        </div>
                        <p>{item.instrucao || 'Sem instrução complementar.'}</p>
                        <div className="model-item__rules">
                          <span>Obrigatório: {item.obrigatorio || 'NÃO'}</span>
                          <span>Evidência: {item.evidencia_obrigatoria || 'NÃO'}</span>
                          <span>Bloqueante: {item.bloqueia_finalizacao || 'NÃO'}</span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="review-warning">O modelo não possui itens para validação.</p>
              )}
            </section>

            {detail.ultimo_parecer ? (
              <section className="review-section">
                <header><div><span className="eyebrow">HISTÓRICO</span><h3>Último parecer</h3></div></header>
                <p className="review-history">
                  <strong>{detail.ultimo_parecer.decisao || 'REGISTRO'}</strong>
                  <span>{detail.ultimo_parecer.justificativa || 'Sem justificativa.'}</span>
                  <small>{formatDate(detail.ultimo_parecer.criado_em)}</small>
                </p>
              </section>
            ) : null}

            {error ? <div className="review-error" role="alert">{error}</div> : null}

            {result ? (
              <div className="review-success" role="status">
                <strong>{result.decisao === 'APROVAR' ? 'Modelo aprovado.' : 'Modelo devolvido.'}</strong>
                <span>Status final: {result.workflow_status}</span>
              </div>
            ) : (
              <section className="review-decision">
                <label>
                  Parecer técnico
                  <textarea
                    value={justification}
                    onChange={(event) => setJustification(event.target.value)}
                    placeholder="Registre critérios, ressalvas ou correções necessárias."
                    disabled={submitting}
                    rows={3}
                  />
                </label>
                <p className="review-warning">
                  A aprovação ativa o modelo para uso operacional. A devolução exige justificativa e retorna a revisão ao Administrador.
                </p>
                <div className="review-decision__actions">
                  <button
                    className="reject-button"
                    type="button"
                    disabled={!canDecide || submitting}
                    onClick={() => void submitDecision('DEVOLVER')}
                  >
                    {submitting ? 'Processando…' : 'Devolver para correção'}
                  </button>
                  <button
                    className="approve-button"
                    type="button"
                    disabled={!canDecide || submitting || detail.itens.length === 0}
                    onClick={() => void submitDecision('APROVAR')}
                  >
                    {submitting ? 'Processando…' : 'Aprovar modelo'}
                  </button>
                </div>
              </section>
            )}
          </div>
        ) : null}

        <footer className="review-footer">
          <button className="secondary-button" type="button" disabled={submitting} onClick={onClose}>
            {result ? 'Fechar' : 'Cancelar'}
          </button>
        </footer>
      </section>
    </div>
  )
}
