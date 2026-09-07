import { useCallback, useEffect, useMemo, useState } from 'react'
import { APP_RELEASE_VERSION } from '../release'
import type { GestorSession } from '../services/api/auth'
import {
  getAdminCommercialAccess,
  getPlatformMotorCatalog,
  publishPlatformMotorCatalog,
  rollbackPlatformMotorCatalog,
  savePlatformMotorCatalogDraft,
  validatePlatformMotorCatalog,
} from '../services/api/admin'
import { isGestorAuthenticationError } from '../services/api/gestor'
import type {
  AdminCommercialAccess,
  AdminCommercialFeatureCode,
  PlatformMotorCatalog,
  PlatformMotorCatalogControl,
  PlatformMotorCatalogDraft,
  PlatformMotorCatalogValidation,
  PlatformMotorCatalogVersion,
  PlatformMotorPlan,
  PlatformMotorPlanCode,
} from '../types/admin'

interface PlatformMotorWorkspaceProps {
  session: GestorSession
  loggingOut: boolean
  onSessionExpired: () => void
  onLogout: () => void
}

type CatalogAction = '' | 'validating' | 'saving' | 'publishing' | 'rolling-back'

const REQUIRED_FEATURES = new Set<AdminCommercialFeatureCode>([
  'CADASTROS',
  'ORDENS_SERVICO',
  'MOTOR_LIMITADO',
])

function formatDate(value?: string): string {
  if (!value) return 'Não informado'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(parsed)
}

function countdown(expiresAt: number, now: number): string {
  const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000))
  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function subscriptionSource(value?: string): string {
  if (value === 'ASSINATURA_DE_PLATAFORMA') return 'Assinatura interna validada'
  if (value === 'COMPATIBILIDADE_1_4_0') return 'Compatibilidade segura'
  return 'Política interna protegida'
}

function clonePlans(plans: PlatformMotorPlan[]): PlatformMotorPlan[] {
  return plans.map((plan) => ({
    codigo: plan.codigo,
    nome: plan.nome,
    recursos: [...plan.recursos],
  }))
}

function isValidStoredDraft(
  value: PlatformMotorCatalogControl['rascunho'] | undefined,
): value is PlatformMotorCatalogDraft {
  return Boolean(value && 'id' in value)
}

function formatPlanOrigin(value?: string): string {
  if (value === 'ROLLBACK') return 'Restauração controlada'
  if (value === 'PUBLICACAO') return 'Publicação interna'
  return 'Padrão protegido do código'
}

export function PlatformMotorWorkspace({
  session,
  loggingOut,
  onSessionExpired,
  onLogout,
}: PlatformMotorWorkspaceProps) {
  const [access, setAccess] = useState<AdminCommercialAccess | null>(null)
  const [catalog, setCatalog] = useState<PlatformMotorCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [now, setNow] = useState(Date.now())
  const [editing, setEditing] = useState(false)
  const [draftPlans, setDraftPlans] = useState<PlatformMotorPlan[]>([])
  const [savedDraft, setSavedDraft] = useState<PlatformMotorCatalogDraft | null>(null)
  const [validation, setValidation] = useState<PlatformMotorCatalogValidation | null>(null)
  const [catalogAction, setCatalogAction] = useState<CatalogAction>('')
  const [confirmPublish, setConfirmPublish] = useState(false)
  const [rollbackTarget, setRollbackTarget] = useState<PlatformMotorCatalogVersion | null>(null)
  const [rollbackReason, setRollbackReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [result, catalogResult] = await Promise.all([
        getAdminCommercialAccess(),
        getPlatformMotorCatalog(),
      ])
      if (!result.acesso_integral || !result.manutencao.aberta) {
        onSessionExpired()
        return
      }
      setAccess(result)
      setCatalog(catalogResult)
      const storedDraft = catalogResult.controle?.rascunho
      setSavedDraft(isValidStoredDraft(storedDraft) ? storedDraft : null)
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setError(cause instanceof Error ? cause.message : 'Não foi possível validar a janela interna.')
    } finally {
      setLoading(false)
    }
  }, [onSessionExpired])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const remaining = useMemo(
    () => countdown(session.expiresAt, now),
    [now, session.expiresAt],
  )

  const policyCoverage = useMemo(() => {
    if (!catalog) return []
    const featureNames = new Map(
      catalog.recursos.map((feature) => [feature.codigo, feature.nome]),
    )
    const totals = new Map<AdminCommercialFeatureCode, number>()
    catalog.politicas.regras.forEach((rule) => {
      totals.set(rule.recurso, (totals.get(rule.recurso) ?? 0) + 1)
    })
    return [...totals.entries()]
      .map(([code, total]) => ({
        code,
        name: featureNames.get(code) ?? code,
        total,
      }))
      .sort((left, right) => right.total - left.total)
  }, [catalog])

  const editorMatchesSavedDraft = useMemo(() => {
    if (!savedDraft) return false
    return JSON.stringify(draftPlans) === JSON.stringify(savedDraft.planos)
  }, [draftPlans, savedDraft])

  const activeVersionId = catalog?.controle?.ativa.id ?? ''
  const versions = catalog?.controle?.historico.versoes ?? []
  const busy = Boolean(catalogAction)

  const handleCatalogError = useCallback((cause: unknown, fallback: string) => {
    if (isGestorAuthenticationError(cause)) {
      onSessionExpired()
      return
    }
    setError(cause instanceof Error ? cause.message : fallback)
  }, [onSessionExpired])

  const beginEditing = () => {
    if (!catalog?.controle?.edicao_disponivel) return
    const storedDraft = catalog.controle.rascunho
    const initialPlans = isValidStoredDraft(storedDraft)
      ? storedDraft.planos
      : catalog.planos
    setDraftPlans(clonePlans(initialPlans))
    setSavedDraft(isValidStoredDraft(storedDraft) ? storedDraft : null)
    setValidation(isValidStoredDraft(storedDraft) ? storedDraft.validacao : null)
    setEditing(true)
    setConfirmPublish(false)
    setNotice('')
    setError('')
  }

  const cancelEditing = () => {
    if (busy) return
    setEditing(false)
    setDraftPlans([])
    setValidation(null)
    setConfirmPublish(false)
    setNotice('')
    setError('')
  }

  const renamePlan = (planCode: PlatformMotorPlanCode, name: string) => {
    setDraftPlans((current) => current.map((plan) => (
      plan.codigo === planCode ? { ...plan, nome: name } : plan
    )))
    setValidation(null)
    setConfirmPublish(false)
  }

  const toggleFeature = (
    planCode: PlatformMotorPlanCode,
    featureCode: AdminCommercialFeatureCode,
    enabled: boolean,
  ) => {
    if (planCode === 'COMPLETO' || REQUIRED_FEATURES.has(featureCode)) return
    setDraftPlans((current) => current.map((plan) => {
      let shouldEnable = plan.recursos.includes(featureCode)
      if (planCode === 'INICIAL') {
        if (enabled && (plan.codigo === 'INICIAL' || plan.codigo === 'BASICO' || plan.codigo === 'COMPLETO')) {
          shouldEnable = true
        }
        if (!enabled && plan.codigo === 'INICIAL') shouldEnable = false
      }
      if (planCode === 'BASICO') {
        if (enabled && (plan.codigo === 'BASICO' || plan.codigo === 'COMPLETO')) shouldEnable = true
        if (!enabled && (plan.codigo === 'INICIAL' || plan.codigo === 'BASICO')) shouldEnable = false
      }
      const resources = shouldEnable
        ? [...new Set([...plan.recursos, featureCode])]
        : plan.recursos.filter((code) => code !== featureCode)
      return { ...plan, recursos: resources }
    }))
    setValidation(null)
    setConfirmPublish(false)
  }

  const validateDraft = async () => {
    setCatalogAction('validating')
    setError('')
    setNotice('')
    try {
      const result = await validatePlatformMotorCatalog(draftPlans)
      setValidation(result)
      setDraftPlans(clonePlans(result.planos))
      setNotice(result.valido
        ? 'Catálogo consistente. Salve o rascunho antes de publicar.'
        : 'A validação encontrou itens que precisam de correção.')
    } catch (cause) {
      handleCatalogError(cause, 'Não foi possível validar o catálogo.')
    } finally {
      setCatalogAction('')
    }
  }

  const saveDraft = async () => {
    setCatalogAction('saving')
    setError('')
    setNotice('')
    try {
      const result = await savePlatformMotorCatalogDraft(draftPlans, activeVersionId)
      setSavedDraft(result)
      setValidation(result.validacao)
      setDraftPlans(clonePlans(result.planos))
      setNotice(result.validacao.valido
        ? 'Rascunho assinado e salvo. A publicação já pode ser confirmada.'
        : 'Rascunho salvo, mas ainda possui pendências de validação.')
    } catch (cause) {
      handleCatalogError(cause, 'Não foi possível salvar o rascunho.')
    } finally {
      setCatalogAction('')
    }
  }

  const publishDraft = async () => {
    if (!savedDraft || !editorMatchesSavedDraft || !savedDraft.validacao.valido) return
    setCatalogAction('publishing')
    setError('')
    setNotice('')
    try {
      const result = await publishPlatformMotorCatalog(savedDraft.id)
      setConfirmPublish(false)
      setEditing(false)
      setNotice(`Versão ${result.ativa.numero} publicada e ativada com trilha de auditoria.`)
      await load()
    } catch (cause) {
      handleCatalogError(cause, 'Não foi possível publicar o catálogo.')
    } finally {
      setCatalogAction('')
    }
  }

  const rollbackVersion = async () => {
    if (!rollbackTarget || rollbackReason.trim().length < 10) return
    setCatalogAction('rolling-back')
    setError('')
    setNotice('')
    try {
      const result = await rollbackPlatformMotorCatalog(
        rollbackTarget.id,
        activeVersionId,
        rollbackReason.trim(),
      )
      setRollbackTarget(null)
      setRollbackReason('')
      setNotice(`Versão ${result.ativa.numero} criada por restauração controlada.`)
      await load()
    } catch (cause) {
      handleCatalogError(cause, 'Não foi possível restaurar a versão selecionada.')
    } finally {
      setCatalogAction('')
    }
  }

  return (
    <main className="platform-motor-shell">
      <header className="platform-motor-topbar">
        <div className="platform-motor-brand">
          <span aria-hidden="true">FC</span>
          <div>
            <strong>Fab Control</strong>
            <small>Núcleo protegido do Motor</small>
          </div>
        </div>

        <div className="platform-motor-session">
          <span className="platform-motor-live"><i aria-hidden="true" />Janela ativa</span>
          <span><strong>{session.user.nome}</strong><small>SISTEMA</small></span>
          <b>{remaining}</b>
          <button type="button" disabled={loggingOut || busy} onClick={onLogout}>
            {loggingOut ? 'Encerrando…' : 'Encerrar sessão'}
          </button>
        </div>
      </header>

      <section className="platform-motor-content">
        <div className="platform-motor-heading">
          <div>
            <span className="eyebrow">ACESSO INTERNO TEMPORÁRIO</span>
            <h1>Motor de plataforma</h1>
            <p>A sessão está vinculada à empresa, ao ambiente e à janela assinada.</p>
          </div>
          <button type="button" disabled={loading || busy} onClick={() => void load()}>
            {loading ? 'Validando…' : 'Validar novamente'}
          </button>
        </div>

        {error ? <p className="feedback feedback--error">{error}</p> : null}
        {notice ? <p className="feedback feedback--success">{notice}</p> : null}

        <section className="platform-motor-status-grid" aria-label="Estado do acesso interno">
          <article>
            <span>Ambiente</span>
            <strong>{access?.manutencao.ambiente || access?.identidade_interna?.ambiente || 'Validando'}</strong>
            <small>Vinculado ao envelope assinado</small>
          </article>
          <article>
            <span>Janela</span>
            <strong>{access?.manutencao.estado || 'VALIDANDO'}</strong>
            <small>Expira em {formatDate(access?.manutencao.expira_em)}</small>
          </article>
          <article>
            <span>Assinatura do cliente</span>
            <strong>{access ? `Plano ${access.plano.nome}` : 'Validando'}</strong>
            <small>{access?.recursos.length ?? 0} grupo(s) contratado(s)</small>
          </article>
          <article>
            <span>Privilégio</span>
            <strong>{access?.acesso_integral ? 'INTEGRAL' : 'BLOQUEADO'}</strong>
            <small>Revalidado em todas as requisições</small>
          </article>
        </section>

        <section className="platform-motor-boundaries">
          <div>
            <span className="eyebrow">BARREIRAS ATIVAS</span>
            <h2>Proteção da manutenção</h2>
          </div>
          <ul>
            <li><strong>Código de uso único</strong><span>Uma nova entrada exige outra janela assinada.</span></li>
            <li><strong>Sessão curta</strong><span>Máximo de 30 minutos e nunca além da janela.</span></li>
            <li><strong>Isolamento por empresa</strong><span>Tenant e ambiente precisam coincidir no servidor.</span></li>
            <li><strong>Revogação imediata</strong><span>Alterar ou encerrar a janela invalida a próxima requisição.</span></li>
          </ul>
        </section>

        <section className="platform-motor-catalog">
          <div className="platform-motor-section-heading">
            <div>
              <span className="eyebrow">CATÁLOGO COMERCIAL</span>
              <h2>Recursos por assinatura</h2>
              <p>Planos versionados com validação, assinatura, publicação atômica e restauração auditável.</p>
            </div>
            <div className="platform-motor-catalog-actions">
              <span className="platform-motor-readonly">
                {editing ? 'Rascunho interno' : `Versão ${catalog?.controle?.ativa.numero || 'padrão'}`}
              </span>
              {!editing && catalog?.controle?.edicao_disponivel ? (
                <button type="button" disabled={loading || busy} onClick={beginEditing}>
                  Editar catálogo
                </button>
              ) : null}
            </div>
          </div>

          {!catalog?.controle?.edicao_disponivel ? (
            <div className="platform-motor-secure-notice">
              <strong>Edição protegida indisponível</strong>
              <span>Configure o segredo interno de assinatura durante uma manutenção autorizada. A operação comercial continua usando o padrão seguro do código.</span>
            </div>
          ) : null}

          {catalog?.controle?.rascunho?.integridade === 'INVALIDA' ? (
            <div className="platform-motor-secure-notice is-critical">
              <strong>Rascunho isolado por falha de integridade</strong>
              <span>O conteúdo não será publicado. Revise as propriedades assinadas antes de iniciar outra edição.</span>
            </div>
          ) : null}

          <div className="platform-motor-plan-grid">
            {(editing ? draftPlans : catalog?.planos ?? []).map((plan) => (
              <article
                key={plan.codigo}
                className={plan.codigo === catalog?.assinatura.plano.codigo ? 'is-current' : ''}
              >
                <header>
                  <div>
                    <span>{plan.codigo}</span>
                    {editing ? (
                      <input
                        aria-label={`Nome do plano ${plan.codigo}`}
                        maxLength={60}
                        value={plan.nome}
                        disabled={busy}
                        onChange={(event) => renamePlan(plan.codigo, event.target.value)}
                      />
                    ) : (
                      <h3>{plan.nome}</h3>
                    )}
                  </div>
                  {plan.codigo === catalog?.assinatura.plano.codigo ? <b>Atual</b> : null}
                </header>
                <ul>
                  {catalog?.recursos.map((feature) => {
                    const enabled = plan.recursos.includes(feature.codigo)
                    const locked = plan.codigo === 'COMPLETO' || REQUIRED_FEATURES.has(feature.codigo)
                    return (
                      <li key={feature.codigo} className={enabled ? 'is-enabled' : ''}>
                        {editing ? (
                          <label className={locked ? 'is-locked' : ''}>
                            <input
                              type="checkbox"
                              checked={enabled}
                              disabled={busy || locked}
                              onChange={(event) => toggleFeature(
                                plan.codigo,
                                feature.codigo,
                                event.target.checked,
                              )}
                            />
                            <span>{feature.nome}</span>
                            {locked ? <small>Protegido</small> : null}
                          </label>
                        ) : (
                          <>
                            <i aria-hidden="true">{enabled ? '✓' : '—'}</i>
                            <span>{feature.nome}</span>
                          </>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </article>
            ))}
          </div>

          {editing ? (
            <div className="platform-motor-editor-footer">
              <div>
                <strong>Fluxo de publicação protegido</strong>
                <span>Validar → salvar rascunho assinado → confirmar publicação.</span>
              </div>
              <div className="platform-motor-editor-actions">
                <button type="button" className="is-secondary" disabled={busy} onClick={cancelEditing}>
                  Cancelar
                </button>
                <button type="button" className="is-secondary" disabled={busy} onClick={() => void validateDraft()}>
                  {catalogAction === 'validating' ? 'Validando…' : 'Validar'}
                </button>
                <button type="button" className="is-secondary" disabled={busy} onClick={() => void saveDraft()}>
                  {catalogAction === 'saving' ? 'Salvando…' : 'Salvar rascunho'}
                </button>
                <button
                  type="button"
                  disabled={busy || !savedDraft?.validacao.valido || !editorMatchesSavedDraft}
                  onClick={() => setConfirmPublish(true)}
                >
                  Publicar versão
                </button>
              </div>
            </div>
          ) : null}

          {validation && !validation.valido ? (
            <div className="platform-motor-validation" role="alert">
              <strong>Corrija {validation.erros.length} pendência(s)</strong>
              <ul>
                {validation.erros.map((item, index) => (
                  <li key={`${item.plano}-${item.codigo}-${index}`}>
                    <b>{item.plano}</b>
                    <span>{item.mensagem}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <section className="platform-motor-history">
            <header>
              <div>
                <span className="eyebrow">HISTÓRICO IMUTÁVEL</span>
                <h3>Versões do catálogo</h3>
              </div>
              <small>{catalog?.controle?.historico.total ?? 0} versão(ões) retida(s)</small>
            </header>
            {versions.length ? (
              <ul>
                {versions.map((version) => (
                  <li key={version.id}>
                    <div>
                      <strong>Versão {version.numero}</strong>
                      <span>{formatPlanOrigin(version.origem)} · {formatDate(version.publicado_em)}</span>
                    </div>
                    <small>{version.publicado_por || 'Operador interno'}</small>
                    {version.id === activeVersionId ? (
                      <b>Ativa</b>
                    ) : (
                      <button
                        type="button"
                        disabled={busy || editing}
                        onClick={() => {
                          setRollbackTarget(version)
                          setRollbackReason('')
                        }}
                      >
                        Restaurar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p>A primeira publicação criará a versão 1. O padrão atual permanece protegido no código.</p>
            )}
          </section>
        </section>

        <section className="platform-motor-governance">
          <div className="platform-motor-section-heading">
            <div>
              <span className="eyebrow">GOVERNANÇA DE ROTAS</span>
              <h2>Cobertura das políticas</h2>
              <p>Ações novas continuam bloqueadas até receberem classificação comercial explícita.</p>
            </div>
          </div>

          <div className="platform-motor-governance-grid">
            <article className="platform-motor-governance-summary">
              <div>
                <span>Regras classificadas</span>
                <strong>{catalog?.politicas.regras.length ?? 0}</strong>
              </div>
              <div>
                <span>Ações do núcleo</span>
                <strong>{catalog?.politicas.acoes_nucleo.length ?? 0}</strong>
              </div>
              <div>
                <span>Política padrão</span>
                <strong>Negar</strong>
              </div>
              <small>{subscriptionSource(catalog?.assinatura.origem)}</small>
            </article>

            <article className="platform-motor-policy-list">
              <header>
                <strong>Distribuição por recurso</strong>
                <span>{policyCoverage.length} grupos cobertos</span>
              </header>
              <ul>
                {policyCoverage.map((item) => (
                  <li key={item.code}>
                    <span>{item.name}</span>
                    <b>{item.total} política(s)</b>
                  </li>
                ))}
              </ul>
            </article>
          </div>
        </section>

        <footer className="platform-motor-footer">
          <span>Versão {APP_RELEASE_VERSION}</span>
          <span>Janela {access?.manutencao.janela_id || 'protegida'}</span>
        </footer>
      </section>

      {confirmPublish ? (
        <div className="platform-motor-dialog-backdrop" role="presentation">
          <section className="platform-motor-dialog" role="dialog" aria-modal="true" aria-labelledby="publish-title">
            <header>
              <div>
                <span className="eyebrow">OPERAÇÃO AUDITADA</span>
                <h2 id="publish-title">Publicar catálogo comercial</h2>
              </div>
              <button type="button" aria-label="Fechar" disabled={busy} onClick={() => setConfirmPublish(false)}>×</button>
            </header>
            <p>A nova versão será assinada, ativada para todas as verificações comerciais e registrada na auditoria.</p>
            <div className="platform-motor-dialog-summary">
              <span>Base atual</span>
              <strong>{catalog?.controle?.ativa.numero ? `Versão ${catalog.controle.ativa.numero}` : 'Padrão do código'}</strong>
              <span>Integridade do rascunho</span>
              <strong>{savedDraft?.validacao.valido ? 'Validada' : 'Pendente'}</strong>
            </div>
            <footer>
              <button type="button" className="is-secondary" disabled={busy} onClick={() => setConfirmPublish(false)}>
                Cancelar
              </button>
              <button type="button" disabled={busy} onClick={() => void publishDraft()}>
                {catalogAction === 'publishing' ? 'Publicando…' : 'Confirmar publicação'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {rollbackTarget ? (
        <div className="platform-motor-dialog-backdrop" role="presentation">
          <section className="platform-motor-dialog" role="dialog" aria-modal="true" aria-labelledby="rollback-title">
            <header>
              <div>
                <span className="eyebrow">RESTAURAÇÃO CONTROLADA</span>
                <h2 id="rollback-title">Restaurar versão {rollbackTarget.numero}</h2>
              </div>
              <button type="button" aria-label="Fechar" disabled={busy} onClick={() => setRollbackTarget(null)}>×</button>
            </header>
            <p>A versão histórica não será alterada. O Motor criará uma nova versão ativa com o mesmo catálogo.</p>
            <label className="platform-motor-dialog-field">
              <span>Motivo da restauração *</span>
              <textarea
                rows={4}
                maxLength={500}
                value={rollbackReason}
                disabled={busy}
                placeholder="Descreva o motivo para a trilha de auditoria"
                onChange={(event) => setRollbackReason(event.target.value)}
              />
              <small>Mínimo de 10 caracteres.</small>
            </label>
            <footer>
              <button type="button" className="is-secondary" disabled={busy} onClick={() => setRollbackTarget(null)}>
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy || rollbackReason.trim().length < 10}
                onClick={() => void rollbackVersion()}
              >
                {catalogAction === 'rolling-back' ? 'Restaurando…' : 'Confirmar restauração'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  )
}
