import { useEffect, useMemo, useState } from 'react'
import {
  getGestorActionAudit,
  getGestorActionDetail,
  isGestorAuthenticationError,
  validateGestorAction,
} from '../services/api/gestor'
import type {
  GestorAction,
  GestorActionAudit,
  GestorActionDetail,
  GestorChecklistItem,
  GestorDecision,
  GestorDecisionResult,
  GestorEvidence,
} from '../types/gestor'

export interface ActionReviewDialogProps {
  action: GestorAction
  readOnly?: boolean
  onClose: () => void
  onDecisionComplete: (result: GestorDecisionResult) => void | Promise<void>
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

function checklistValue(
  item: GestorChecklistItem,
  keys: string[],
): string {
  return recordValue(item, keys)
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

function evidenceFileUrl(evidence: GestorEvidence): string {
  const explicitUrl = recordValue(evidence, [
    'url',
    'download_url',
    'arquivo_url',
    'drive_url',
  ])
  if (explicitUrl) return explicitUrl

  const fileId = recordValue(evidence, ['arquivo_id', 'file_id'])
  return fileId
    ? `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`
    : ''
}

function evidencePreviewUrl(evidence: GestorEvidence): string {
  const explicitPreview = recordValue(evidence, [
    'thumbnail_url',
    'preview_url',
  ])
  if (explicitPreview) return explicitPreview

  const fileId = recordValue(evidence, ['arquivo_id', 'file_id'])
  if (fileId && isImageEvidence(evidence)) {
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w800`
  }

  return evidenceFileUrl(evidence)
}

function isImageEvidence(evidence: GestorEvidence): boolean {
  const mimeType = recordValue(evidence, ['mime_type', 'tipo_mime'])
    .toLocaleLowerCase('pt-BR')
  const fileName = String(evidence.nome_arquivo ?? evidenceFileUrl(evidence))
    .toLocaleLowerCase('pt-BR')
  return mimeType.startsWith('image/') ||
    /\.(avif|gif|jpe?g|png|webp)(?:$|[?#])/.test(fileName)
}

function humanizeAuditEvent(value: unknown): string {
  const normalized = String(value ?? '')
    .trim()
    .replaceAll('_', ' ')
    .toLocaleLowerCase('pt-BR')
  return normalized
    ? normalized.charAt(0).toLocaleUpperCase('pt-BR') + normalized.slice(1)
    : 'Evento registrado'
}

function checklistAnswered(item: GestorChecklistItem): boolean {
  return (
    item.respondido === true ||
    upper(item.status) === 'RESPONDIDO' ||
    Boolean(checklistValue(item, ['resposta', 'valor', 'resultado']))
  )
}

function auditIntegrity(audit: GestorActionAudit | null): boolean {
  return audit?.auditoria?.integridade_ok === true
}

function auditCanFinalize(audit: GestorActionAudit | null): boolean {
  return audit?.finalizacao?.can_finalize === true
}

export function ActionReviewDialog({
  action,
  readOnly = false,
  onClose,
  onDecisionComplete,
  onSessionExpired,
}: ActionReviewDialogProps) {
  const [detail, setDetail] = useState<GestorActionDetail | null>(null)
  const [audit, setAudit] = useState<GestorActionAudit | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [comment, setComment] = useState('')
  const [result, setResult] = useState<GestorDecisionResult | null>(null)

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

    async function load() {
      setLoading(true)
      setError('')

      try {
        const [detailData, auditData] = await Promise.all([
          getGestorActionDetail(action.id, controller.signal),
          getGestorActionAudit(action.id, controller.signal),
        ])

        setDetail(detailData)
        setAudit(auditData)
      } catch (cause) {
        if (controller.signal.aborted) return

        if (isGestorAuthenticationError(cause)) {
          onSessionExpired()
          return
        }

        setError(
          cause instanceof Error
            ? cause.message
            : 'Não foi possível carregar a revisão da ação.',
        )
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [action.id, onSessionExpired])

  const evidenceByChecklist = useMemo(() => {
    const grouped = new Map<string, GestorEvidence[]>()

    for (const evidence of detail?.evidencias ?? []) {
      const checklistId = String(evidence.checklist_execucao_id ?? '')
      if (!checklistId) continue
      grouped.set(checklistId, [
        ...(grouped.get(checklistId) ?? []),
        evidence,
      ])
    }

    return grouped
  }, [detail?.evidencias])

  const currentStatus = upper(detail?.acao.status ?? action.status)
  const integrityOk = auditIntegrity(audit)
  const canFinalize = auditCanFinalize(audit)
  const canDecide =
    !readOnly && currentStatus === 'AGUARDANDO_VALIDACAO' && !result
  const canApprove = canDecide && integrityOk && canFinalize
  const answeredCount = (detail?.checklist ?? []).filter(checklistAnswered).length
  const checklistTotal = detail?.checklist.length ?? 0

  async function submitDecision(decision: GestorDecision) {
    if (!canDecide || submitting) return

    const normalizedComment = comment.trim()
    if (decision === 'REPROVAR' && normalizedComment.length < 5) {
      setError('Informe um motivo de reprovação com pelo menos 5 caracteres.')
      return
    }

    const decisionLabel = decision === 'APROVAR' ? 'aprovar' : 'reprovar'
    const confirmed = window.confirm(
      'Confirma ' + decisionLabel + ' esta execução?',
    )

    if (!confirmed) return

    setSubmitting(true)
    setError('')

    try {
      const response = await validateGestorAction(
        action.id,
        decision,
        normalizedComment ||
          'Validação registrada pelo painel do gestor.',
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
          : 'Não foi possível registrar a decisão.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const title = detail?.acao.titulo?.trim() || action.titulo?.trim() || 'Revisão da ação'
  const asset =
    recordValue(detail?.ativo, ['tag', 'codigo', 'id']) ||
    detail?.acao.ativo_tag ||
    detail?.acao.ativo_id ||
    action.ativo_tag ||
    action.ativo_id ||
    'Ativo não informado'
  const assetName =
    recordValue(detail?.ativo, ['nome', 'descricao']) ||
    detail?.acao.ativo_nome ||
    action.ativo_nome ||
    ''
  const execution = detail?.execucoes.at(0) ?? null
  const executionUser = recordValue(execution, [
    'usuario_id',
    'operador_id',
    'executado_por',
  ])
  const operationalResult =
    recordValue(detail?.acao, [
      'resultado_operacional',
      'resultado_final',
      'resultado',
    ]) ||
    recordValue(execution, [
      'resultado_operacional',
      'resultado_final',
      'resultado',
    ])
  const technicalResult =
    recordValue(detail?.acao, ['resultado_tecnico']) ||
    recordValue(execution, ['resultado_tecnico'])

  return (
    <div className="review-overlay" role="presentation">
      <section
        className="review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
      >
        <header className="review-header">
          <div>
            <span className="eyebrow">
              {readOnly ? 'REGISTRO TÉCNICO CONCLUÍDO' : 'VALIDAÇÃO DA EXECUÇÃO'}
            </span>
            <h2 id="review-title">{title}</h2>
            <p>
              {asset}
              {assetName ? ' — ' + assetName : ''}
            </p>
          </div>

          <button
            className="review-close"
            type="button"
            disabled={submitting}
            onClick={onClose}
            aria-label="Fechar revisão"
          >
            ×
          </button>
        </header>

        {loading ? (
          <div className="review-state">Carregando detalhe e auditoria…</div>
        ) : error && !detail ? (
          <div className="review-error" role="alert">{error}</div>
        ) : detail ? (
          <div className="review-body">
            <section className="review-summary-grid">
              <article>
                <span>Status</span>
                <strong>{currentStatus || 'Não informado'}</strong>
              </article>
              <article>
                <span>Checklist</span>
                <strong>{answeredCount}/{checklistTotal}</strong>
              </article>
              <article>
                <span>Auditoria</span>
                <strong>
                  {audit?.auditoria
                    ? integrityOk ? 'Íntegra' : 'Divergência'
                    : 'Registro preservado'}
                </strong>
              </article>
              <article>
                <span>{readOnly ? 'Encerramento' : 'Liberação técnica'}</span>
                <strong>
                  {readOnly
                    ? formatDate(detail.acao.finalizado_em || detail.acao.atualizado_em)
                    : canFinalize ? 'Liberada' : 'Bloqueada'}
                </strong>
              </article>
            </section>

            {readOnly && detail.evidencias.length ? (
              <section className="review-section">
                <header>
                  <div>
                    <span className="eyebrow">EVIDÊNCIAS</span>
                    <h3>Arquivos e registros de campo</h3>
                  </div>
                  <span className="panel-count">{detail.evidencias.length}</span>
                </header>
                <div className="review-checklist-evidence-list">
                  {detail.evidencias.map((evidence, index) => {
                    const evidenceName =
                      evidence.nome_arquivo ||
                      evidence.tipo ||
                      `Evidência ${index + 1}`
                    const fileUrl = evidenceFileUrl(evidence)
                    const previewUrl = evidencePreviewUrl(evidence)
                    const content = (
                      <>
                        {fileUrl && isImageEvidence(evidence) ? (
                          <img
                            src={previewUrl}
                            alt={`Prévia de ${evidenceName}`}
                            loading="lazy"
                          />
                        ) : (
                          <span>{String(index + 1).padStart(2, '0')}</span>
                        )}
                        <div>
                          <strong>{evidenceName}</strong>
                          <small>
                            {evidence.observacao ||
                              (fileUrl
                                ? 'Clique para consultar a evidência.'
                                : 'Registro preservado sem arquivo anexado.')}
                          </small>
                          <small>
                            {evidence.usuario_id || 'Autoria preservada'} ·{' '}
                            {formatDate(evidence.criado_em)}
                          </small>
                        </div>
                      </>
                    )

                    if (fileUrl) {
                      return (
                        <a
                          href={fileUrl}
                          target="_blank"
                          rel="noreferrer"
                          key={String(evidence.id ?? index)}
                          aria-label={`Abrir evidência ${evidenceName}`}
                        >
                          {content}
                        </a>
                      )
                    }

                    return (
                      <article key={String(evidence.id ?? index)}>
                        {content}
                      </article>
                    )
                  })}
                </div>
              </section>
            ) : null}

            {readOnly && detail.materiais.length ? (
              <section className="review-section">
                <header>
                  <div>
                    <span className="eyebrow">MATERIAIS</span>
                    <h3>Consumo registrado</h3>
                  </div>
                  <span className="panel-count">{detail.materiais.length}</span>
                </header>
                <div className="review-record-list">
                  {detail.materiais.map((material, index) => (
                    <article key={recordValue(material, ['id', 'material_id']) || index}>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <div>
                        <strong>
                          {recordValue(material, [
                            'material_nome',
                            'nome',
                            'descricao',
                            'material_id',
                          ]) || `Material ${index + 1}`}
                        </strong>
                        <small>
                          Quantidade: {recordValue(material, [
                            'quantidade_utilizada',
                            'quantidade',
                            'qtd',
                          ]) || 'não registrada'}
                          {recordValue(material, ['unidade', 'unidade_medida'])
                            ? ` ${recordValue(material, ['unidade', 'unidade_medida'])}`
                            : ''}
                        </small>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="review-section">
              <header>
                <div>
                  <span className="eyebrow">EXECUÇÃO</span>
                  <h3>Resultado registrado</h3>
                </div>
              </header>

              <dl className="review-facts">
                <div>
                  <dt>Operador</dt>
                  <dd>{executionUser || 'Não informado'}</dd>
                </div>
                <div>
                  <dt>Início</dt>
                  <dd>{formatDate(execution?.iniciou_em)}</dd>
                </div>
                <div>
                  <dt>Resultado operacional</dt>
                  <dd>{operationalResult || 'Não informado'}</dd>
                </div>
                <div>
                  <dt>Resultado técnico</dt>
                  <dd>{technicalResult || 'Não informado'}</dd>
                </div>
              </dl>
            </section>

            <section className="review-section">
              <header>
                <div>
                  <span className="eyebrow">CHECKLIST</span>
                  <h3>Respostas e evidências</h3>
                </div>
                <span className="panel-count">{checklistTotal}</span>
              </header>

              {checklistTotal === 0 ? (
                <p className="review-empty">Nenhum item de checklist encontrado.</p>
              ) : (
                <div className="review-checklist">
                  {detail.checklist.map((item, index) => {
                    const itemId = String(item.id ?? item.item_id ?? index)
                    const description =
                      checklistValue(item, [
                        'descricao',
                        'pergunta',
                        'titulo',
                        'nome',
                      ]) || 'Item ' + (index + 1)
                    const response =
                      checklistValue(item, [
                        'resposta',
                        'valor',
                        'resultado',
                      ]) || 'Sem resposta'
                    const observation =
                      checklistValue(item, [
                        'observacao',
                        'comentario',
                        'observacoes',
                      ])
                    const itemEvidence =
                      evidenceByChecklist.get(String(item.id ?? '')) ??
                      evidenceByChecklist.get(String(item.item_id ?? '')) ??
                      []

                    return (
                      <article className="review-checklist-item" key={itemId}>
                        <div className="review-checklist-item__heading">
                          <strong>{description}</strong>
                          <span
                            className={
                              checklistAnswered(item)
                                ? 'answer-status answer-status--ok'
                                : 'answer-status answer-status--pending'
                            }
                          >
                            {checklistAnswered(item) ? 'Respondido' : 'Pendente'}
                          </span>
                        </div>

                        <dl>
                          <div>
                            <dt>Resposta</dt>
                            <dd>{response}</dd>
                          </div>
                          <div>
                            <dt>Observação</dt>
                            <dd>{observation || 'Sem observação'}</dd>
                          </div>
                          <div>
                            <dt>Evidências</dt>
                            <dd>
                              {itemEvidence.length
                                ? `${itemEvidence.length} arquivo(s)`
                                : 'Nenhuma evidência'}
                            </dd>
                          </div>
                        </dl>
                        {itemEvidence.length ? (
                          <div
                            className="review-checklist-evidence-list"
                            aria-label={`Evidências de ${description}`}
                          >
                            {itemEvidence.map((evidence, evidenceIndex) => {
                              const fileUrl = evidenceFileUrl(evidence)
                              const previewUrl = evidencePreviewUrl(evidence)
                              const evidenceName =
                                evidence.nome_arquivo ||
                                evidence.tipo ||
                                `Evidência ${evidenceIndex + 1}`
                              const content = (
                                <>
                                  {previewUrl && isImageEvidence(evidence) ? (
                                    <img
                                      src={previewUrl}
                                      alt={`Prévia de ${evidenceName}`}
                                      loading="lazy"
                                    />
                                  ) : (
                                    <span aria-hidden="true">
                                      {String(evidenceIndex + 1).padStart(2, '0')}
                                    </span>
                                  )}
                                  <div>
                                    <strong>{evidenceName}</strong>
                                    <small>
                                      {evidence.observacao ||
                                        (fileUrl
                                          ? 'Clique para consultar o arquivo.'
                                          : 'Registro sem arquivo consultável.')}
                                    </small>
                                  </div>
                                </>
                              )

                              return fileUrl ? (
                                <a
                                  href={fileUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  key={String(evidence.id ?? evidenceIndex)}
                                >
                                  {content}
                                </a>
                              ) : (
                                <article key={String(evidence.id ?? evidenceIndex)}>
                                  {content}
                                </article>
                              )
                            })}
                          </div>
                        ) : null}
                      </article>
                    )
                  })}
                </div>
              )}
            </section>

            <section className="review-section">
              <header>
                <div>
                  <span className="eyebrow">AUDITORIA</span>
                  <h3>{readOnly ? 'Rastreabilidade do registro' : 'Integridade para decisão'}</h3>
                </div>
              </header>

              <div className="audit-grid">
                <article className={integrityOk ? 'audit-ok' : 'audit-error'}>
                  <span>Autoria e histórico</span>
                  <strong>{integrityOk ? 'Verificados' : 'Com divergência'}</strong>
                </article>
                <article className={canFinalize ? 'audit-ok' : 'audit-error'}>
                  <span>Checklist obrigatório</span>
                  <strong>{canFinalize ? 'Completo' : 'Incompleto'}</strong>
                </article>
                <article>
                  <span>Evidências registradas</span>
                  <strong>{detail.evidencias.length}</strong>
                </article>
                <article>
                  <span>Locks ativos</span>
                  <strong>{detail.locks.length}</strong>
                </article>
              </div>
            </section>

            {readOnly ? (
              <section className="review-section">
                <header>
                  <div>
                    <span className="eyebrow">LINHA DO TEMPO</span>
                    <h3>Histórico imutável da execução</h3>
                  </div>
                  <span className="panel-count">{detail.historico.length}</span>
                </header>
                {detail.historico.length ? (
                  <ol className="review-history-list">
                    {detail.historico.map((item, index) => (
                      <li key={String(item.id ?? index)}>
                        <i aria-hidden="true" />
                        <div>
                          <strong>
                            {item.descricao || humanizeAuditEvent(item.evento)}
                          </strong>
                          <span>
                            {item.usuario_id || 'Sistema'} · {humanizeAuditEvent(item.perfil)}
                          </span>
                        </div>
                        <time>{formatDate(item.criado_em)}</time>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="review-empty">
                    O encerramento está preservado, sem eventos adicionais retornados pela API.
                  </p>
                )}
              </section>
            ) : null}

            {error ? <div className="review-error" role="alert">{error}</div> : null}

            {readOnly ? (
              <div className="review-success review-success--readonly" role="status">
                <strong>Execução encerrada e preservada para auditoria.</strong>
                <span>Este registro não aceita novas decisões operacionais.</span>
              </div>
            ) : result ? (
              <div className="review-success" role="status">
                <strong>
                  {result.decisao === 'APROVAR'
                    ? 'Execução aprovada.'
                    : 'Execução reprovada.'}
                </strong>
                <span>Status final: {result.status}</span>
              </div>
            ) : (
              <section className="review-decision">
                <label>
                  Comentário da decisão
                  <textarea
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder="Registre a justificativa da decisão."
                    disabled={submitting}
                    rows={3}
                  />
                </label>

                {!canApprove ? (
                  <p className="review-warning">
                    A aprovação permanece bloqueada até a API confirmar
                    checklist completo e auditoria íntegra. A reprovação continua
                    disponível para devolver a ação ao operador.
                  </p>
                ) : null}

                <div className="review-decision__actions">
                  <button
                    className="reject-button"
                    type="button"
                    disabled={!canDecide || submitting}
                    onClick={() => void submitDecision('REPROVAR')}
                  >
                    {submitting ? 'Processando…' : 'Reprovar'}
                  </button>

                  <button
                    className="approve-button"
                    type="button"
                    disabled={!canApprove || submitting}
                    onClick={() => void submitDecision('APROVAR')}
                  >
                    {submitting ? 'Processando…' : 'Aprovar execução'}
                  </button>
                </div>
              </section>
            )}
          </div>
        ) : null}

        <footer className="review-footer">
          <button
            className="secondary-button"
            type="button"
            disabled={submitting}
            onClick={onClose}
          >
            {readOnly || result ? 'Fechar' : 'Cancelar'}
          </button>
        </footer>
      </section>
    </div>
  )
}
