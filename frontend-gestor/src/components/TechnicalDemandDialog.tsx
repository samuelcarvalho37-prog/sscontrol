import { useEffect, useState } from 'react'
import {
  decideGestorTechnicalDemand,
  getGestorChecklistModelDetail,
  isGestorAuthenticationError,
  validateGestorTechnicalDemand,
} from '../services/api/gestor'
import type {
  GestorChecklistModelDetail,
  GestorTechnicalContext,
  GestorTechnicalDemand,
} from '../types/gestor'
import {
  CheckIcon,
  ChecklistIcon,
  ChevronRightIcon,
  ShieldIcon,
  ValidationIcon,
} from './Icons'

interface TechnicalDemandDialogProps {
  demand: GestorTechnicalDemand
  context: GestorTechnicalContext
  onClose: () => void
  onProgress: (message: string) => Promise<void>
  onChanged: (message: string) => Promise<void>
  onSessionExpired: () => void
}

function upper(value: unknown): string {
  return String(value ?? '').trim().toLocaleUpperCase('pt-BR')
}

function humanize(value: unknown): string {
  const normalized = String(value ?? '')
    .trim()
    .replaceAll('_', ' ')
    .toLocaleLowerCase('pt-BR')
  return normalized
    ? normalized.charAt(0).toLocaleUpperCase('pt-BR') + normalized.slice(1)
    : 'Não informado'
}

function isChecklist(demand: GestorTechnicalDemand): boolean {
  return ['CHECKLIST_MODELO', 'PLANO_CHECKLIST'].includes(
    upper(demand.entidade_tipo),
  )
}

function policyLabel(value?: string): string {
  const labels: Record<string, string> = {
    QUALIDADE_OU_SEGURANCA: 'Qualidade ou Segurança',
    QUALIDADE: 'Somente Qualidade',
    SEGURANCA: 'Somente Segurança',
    QUALIDADE_E_SEGURANCA: 'Qualidade e Segurança',
    PERSONALIZADA: 'Validador autorizado',
  }
  return labels[upper(value)] || 'Filtro técnico'
}

export function TechnicalDemandDialog({
  demand,
  context,
  onClose,
  onProgress,
  onChanged,
  onSessionExpired,
}: TechnicalDemandDialogProps) {
  const [detail, setDetail] = useState<GestorChecklistModelDetail | null>(null)
  const [showAllItems, setShowAllItems] = useState(false)
  const [returning, setReturning] = useState(false)
  const [opinion, setOpinion] = useState(
    'Documento revisado. Escopo, etapas, riscos e critérios de aceite estão adequados.',
  )
  const [submitting, setSubmitting] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isChecklist(demand) || !demand.entidade_id) return
    const controller = new AbortController()
    setLoadingDetail(true)
    void getGestorChecklistModelDetail(demand.entidade_id, controller.signal)
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
            : 'Não foi possível abrir o conteúdo do checklist.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingDetail(false)
      })
    return () => controller.abort()
  }, [demand, onSessionExpired])

  const required = Math.max(1, Number(demand.assinaturas_necessarias ?? 1))
  const completed = Math.max(0, Number(demand.assinaturas_realizadas ?? 0))
  const pending = Math.max(0, required - completed)
  const visibleItems = showAllItems ? detail?.itens : detail?.itens.slice(0, 4)

  function fail(cause: unknown, fallback: string) {
    if (isGestorAuthenticationError(cause)) {
      onSessionExpired()
      return
    }
    setError(cause instanceof Error ? cause.message : fallback)
  }

  async function approve() {
    if (!context.pode_validar) {
      setError('Seu perfil é de acompanhamento e não possui permissão para assinar.')
      return
    }
    if (opinion.trim().length < 5) {
      setError('Registre um parecer técnico objetivo.')
      return
    }
    if (detail && detail.itens.length === 0) {
      setError('Este checklist não possui etapas. Solicite a correção ao Administrador.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const result = await validateGestorTechnicalDemand(
        demand.id,
        opinion.trim(),
      )
      if (result.completed) {
        await onChanged(
          upper(demand.entidade_tipo) === 'ORDEM_SERVICO_RASCUNHO'
            ? 'Documento assinado e liberado para o Operador.'
            : 'Documento assinado e aprovado.',
        )
        return
      }
      await onProgress(
        `Assinatura permanente registrada. Falta ${result.assinaturas_pendentes ?? 1} assinatura.`,
      )
      onClose()
    } catch (cause) {
      fail(cause, 'Não foi possível assinar e aprovar o documento.')
    } finally {
      setSubmitting(false)
    }
  }

  async function requestCorrection() {
    if (opinion.trim().length < 5) {
      setError('Explique o ajuste que o Administrador precisa fazer.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await decideGestorTechnicalDemand(
        demand.id,
        'DEVOLVER_ADMIN',
        opinion.trim(),
      )
      await onChanged('Documento devolvido ao Administrador para correção.')
    } catch (cause) {
      fail(cause, 'Não foi possível solicitar a correção.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="review-overlay validation-gate-overlay" role="presentation">
      <section
        className="review-dialog validation-gate-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="validation-gate-title"
      >
        <header>
          <div>
            <span className="eyebrow">
              VALIDAÇÃO TÉCNICA · {context.identidade.area_nome}
            </span>
            <h2 id="validation-gate-title">{demand.titulo}</h2>
            <p>{humanize(demand.entidade_tipo)} · {demand.entidade_id}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">×</button>
        </header>

        <div className="validation-gate-dialog__body">
          <section className="validation-gate-summary">
            <span><ShieldIcon /></span>
            <div>
              <small>O ADMINISTRADOR SOLICITOU</small>
              <strong>{demand.descricao || 'Revise o documento e confirme se ele pode seguir.'}</strong>
              <p>{humanize(demand.prioridade)} · {policyLabel(demand.politica_assinatura)}</p>
            </div>
          </section>

          <section className="validation-gate-progress">
            <header>
              <strong>Assinaturas desta versão</strong>
              <span>{completed}/{required}</span>
            </header>
            <div>
              {(demand.areas_validadoras || []).map((area) => (
                <article className={area.assinada || area.necessaria === false ? 'is-complete' : ''} key={area.id}>
                  {area.assinada || area.necessaria === false ? <CheckIcon /> : <ShieldIcon />}
                  <span>
                    <strong>{area.nome || humanize(area.codigo)}</strong>
                    <small>
                      {area.assinada
                        ? 'Assinatura registrada'
                        : area.necessaria === false
                          ? 'Assinatura alternativa não necessária'
                          : 'Aguardando assinatura'}
                    </small>
                  </span>
                </article>
              ))}
              {!demand.areas_validadoras?.length ? (
                <article>
                  <ShieldIcon />
                  <span>
                    <strong>{policyLabel(demand.politica_assinatura)}</strong>
                    <small>{pending} assinatura(s) pendente(s)</small>
                  </span>
                </article>
              ) : null}
            </div>
          </section>

          {isChecklist(demand) ? (
            <section className="validation-gate-checklist">
              <header>
                <span><ChecklistIcon /></span>
                <div>
                  <small>CONTEÚDO PARA CONFERÊNCIA</small>
                  <strong>{detail?.plano.nome || demand.titulo}</strong>
                  <p>
                    {loadingDetail
                      ? 'Carregando etapas…'
                      : `${detail?.itens.length ?? 0} etapa(s) · revisão ${detail?.plano.revisao ?? 1}`}
                  </p>
                </div>
              </header>
              <div>
                {visibleItems?.map((item, index) => (
                  <article key={item.id}>
                    <b>{String(item.ordem ?? index + 1).padStart(2, '0')}</b>
                    <span>
                      <strong>{item.titulo || 'Etapa sem título'}</strong>
                      <small>
                        {humanize(item.tipo_resposta)}
                        {upper(item.evidencia_obrigatoria) === 'SIM'
                          ? ' · evidência obrigatória'
                          : ''}
                      </small>
                    </span>
                  </article>
                ))}
              </div>
              {(detail?.itens.length ?? 0) > 4 ? (
                <button type="button" onClick={() => setShowAllItems((value) => !value)}>
                  {showAllItems ? 'Mostrar resumo' : `Ver todas as ${detail?.itens.length} etapas`}
                </button>
              ) : null}
            </section>
          ) : null}

          <label className="validation-gate-opinion">
            <span>{returning ? 'Correção necessária *' : 'Parecer técnico *'}</span>
            <textarea
              rows={3}
              value={opinion}
              onChange={(event) => setOpinion(event.target.value)}
              placeholder={
                returning
                  ? 'Descreva objetivamente o que deve ser corrigido.'
                  : 'Registre a conclusão da sua revisão.'
              }
            />
          </label>

          {error ? <div className="feedback feedback--error" role="alert">{error}</div> : null}
        </div>

        <footer>
          <button
            className="secondary-button"
            type="button"
            disabled={submitting}
            onClick={() => {
              setReturning((value) => !value)
              setOpinion('')
              setError('')
            }}
          >
            <ValidationIcon />
            {returning ? 'Voltar à aprovação' : 'Solicitar correção'}
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={submitting || loadingDetail}
            onClick={() => void (returning ? requestCorrection() : approve())}
          >
            {submitting
              ? 'Registrando…'
              : returning
                ? 'Devolver ao Administrador'
                : 'Assinar e aprovar'}
            {!submitting ? <ChevronRightIcon /> : null}
          </button>
        </footer>
      </section>
    </div>
  )
}
