import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckIcon, RefreshIcon, SettingsIcon, ShieldIcon } from './Icons'
import {
  getConfigurationEngineState,
  listConfigurationVersions,
  publishConfigurationDraft,
  rollbackConfiguration,
  saveConfigurationDraft,
  validateConfiguration,
} from '../services/api/admin'
import { isGestorAuthenticationError } from '../services/api/gestor'
import type {
  ConfigurationDefinition,
  ConfigurationEngineState,
  ConfigurationValidation,
  ConfigurationValue,
  ConfigurationVersion,
} from '../types/admin'

interface ConfigurationEnginePanelProps {
  onSessionExpired: () => void
}

const GROUP_LABELS: Record<ConfigurationDefinition['grupo'], string> = {
  OPERACAO: 'Operação e manutenção',
  EVIDENCIAS: 'Evidências',
  WORKFLOW: 'Validação técnica',
  INDICADORES: 'Indicadores e metas',
}

const CONFIG_OPTION_LABELS: Record<string, string> = {
  OBRIGATORIA: 'Obrigatória',
  DECISAO_EXECUTOR: 'Decisão do executor',
  SEM_PARADA: 'Sem parada',
}

const PROTECTED_KEY_LABELS: Record<string, string> = {
  'release.version': 'Versão de lançamento',
  'app.version': 'Versão do aplicativo',
  'api.version': 'Integração do sistema',
  'schema.version': 'Estrutura de dados',
  'contract.version': 'Contrato de integração',
  'frontend.version': 'Interface administrativa',
  'app.environment': 'Ambiente',
  'auth.schema.version': 'Segurança de acesso',
  'permissions.matrix.capabilities.v1': 'Matriz de permissões',
  'horimetro.regra': 'Regra de horímetro',
  'workflow.tecnico.schema.version': 'Fluxo técnico',
  'configuration.engine.schema.version': 'Motor de configuração',
  'configuration.runtime.snapshot.v1': 'Configuração publicada',
}

function configOptionLabel(value: string): string {
  return CONFIG_OPTION_LABELS[value] ?? value.replaceAll('_', ' ')
}

function formatDate(value?: string): string {
  if (!value) return 'Ainda não publicada'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function shortHash(value?: string): string {
  if (!value) return 'padrão protegido'
  return `${value.slice(0, 10)}…${value.slice(-6)}`
}

function sameConfiguration(
  left: Record<string, ConfigurationValue>,
  right: Record<string, ConfigurationValue>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function ConfigurationEnginePanel({ onSessionExpired }: ConfigurationEnginePanelProps) {
  const [engine, setEngine] = useState<ConfigurationEngineState | null>(null)
  const [versions, setVersions] = useState<ConfigurationVersion[]>([])
  const [values, setValues] = useState<Record<string, ConfigurationValue>>({})
  const [validation, setValidation] = useState<ConfigurationValidation | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async (signal?: AbortSignal) => {
    const [state, history] = await Promise.all([
      getConfigurationEngineState(signal),
      listConfigurationVersions(signal),
    ])
    setEngine(state)
    setVersions(history)
    setValues(state.rascunho?.configuracao ?? state.ativa.configuracao)
    setValidation(state.rascunho?.validacao ?? null)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void load(controller.signal)
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        if (isGestorAuthenticationError(cause)) return onSessionExpired()
        setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o motor.')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [load, onSessionExpired])

  const savedValues = engine?.rascunho?.configuracao ?? engine?.ativa.configuracao ?? {}
  const dirty = !sameConfiguration(values, savedValues)
  const changedKeys = useMemo(() => {
    if (!engine) return []
    return engine.catalogo.filter((definition) => (
      values[definition.chave] !== engine.ativa.configuracao[definition.chave]
    ))
  }, [engine, values])

  function handleFailure(cause: unknown, fallback: string) {
    if (isGestorAuthenticationError(cause)) {
      onSessionExpired()
      return
    }
    setError(cause instanceof Error ? cause.message : fallback)
  }

  async function refresh(message?: string) {
    setBusy('refresh')
    setError('')
    try {
      await load()
      if (message) setNotice(message)
    } catch (cause) {
      handleFailure(cause, 'Não foi possível atualizar o motor.')
    } finally {
      setBusy('')
    }
  }

  async function saveDraft() {
    if (!engine) return
    setBusy('save')
    setError('')
    setNotice('')
    try {
      const draft = await saveConfigurationDraft(values, engine.ativa.id)
      setEngine({ ...engine, rascunho: draft })
      setValues(draft.configuracao)
      setValidation(draft.validacao)
      setNotice(draft.validacao.valido
        ? 'Rascunho salvo e isolado do ambiente ativo.'
        : 'Rascunho salvo, mas ainda possui erros de validação.')
    } catch (cause) {
      handleFailure(cause, 'Não foi possível salvar o rascunho.')
    } finally {
      setBusy('')
    }
  }

  async function validate() {
    setBusy('validate')
    setError('')
    setNotice('')
    try {
      const result = await validateConfiguration(values)
      setValidation(result)
      setNotice(result.valido
        ? 'Validação concluída: tipos, limites, lista branca e integridade aprovados.'
        : `${result.erros.length} problema(s) impedem a publicação.`)
    } catch (cause) {
      handleFailure(cause, 'Não foi possível validar a configuração.')
    } finally {
      setBusy('')
    }
  }

  async function publish() {
    if (!engine?.rascunho || dirty || !validation?.valido) return
    if (!window.confirm(`Publicar ${changedKeys.length} alteração(ões) no ambiente ativo?`)) return
    setBusy('publish')
    setError('')
    try {
      const result = await publishConfigurationDraft(engine.rascunho.id)
      await refresh(result.aviso || `Versão ${result.ativa.numero} publicada com integridade validada.`)
    } catch (cause) {
      handleFailure(cause, 'Não foi possível publicar o rascunho.')
    } finally {
      setBusy('')
    }
  }

  async function rollback(version: ConfigurationVersion) {
    if (!engine || version.status === 'ATIVA') return
    const reason = window.prompt(`Motivo para restaurar a versão ${version.numero}:`, '')?.trim() ?? ''
    if (!reason) return
    if (reason.length < 10) {
      setError('O motivo do rollback deve ter pelo menos 10 caracteres.')
      return
    }
    setBusy(`rollback:${version.id}`)
    setError('')
    try {
      const result = await rollbackConfiguration(version.id, engine.ativa.id, reason)
      await refresh(result.aviso || `Rollback concluído como nova versão ${result.ativa.numero}.`)
    } catch (cause) {
      handleFailure(cause, 'Não foi possível concluir o rollback.')
    } finally {
      setBusy('')
    }
  }

  function updateValue(definition: ConfigurationDefinition, raw: string | boolean) {
    let next: ConfigurationValue = raw
    if (definition.tipo === 'INTEIRO') next = Math.floor(Number(raw))
    if (definition.tipo === 'NUMERO') next = Number(raw)
    setValues((current) => ({ ...current, [definition.chave]: next }))
    setValidation(null)
    setNotice('')
  }

  if (loading) return <div className="config-engine-loading">Carregando Motor de Configuração…</div>
  if (!engine) return <div className="dashboard-error"><strong>Motor indisponível.</strong><span>{error}</span></div>

  const groups = Array.from(new Set(engine.catalogo.map((item) => item.grupo)))

  return (
    <section className="config-engine" role="tabpanel">
      <header className="config-engine__hero">
        <div>
          <span className="eyebrow">NÚCLEO VERSIONADO</span>
          <h2>Motor de Configuração</h2>
          <p>Edite em rascunho, valide o contrato completo e só então publique um snapshot imutável.</p>
        </div>
        <button className="icon-text-button" type="button" disabled={Boolean(busy)} onClick={() => void refresh('Motor atualizado.') }>
          <RefreshIcon /> Atualizar
        </button>
      </header>

      {error ? <div className="dashboard-error" role="alert"><strong>Operação bloqueada.</strong><span>{error}</span></div> : null}
      {notice ? <div className="dashboard-notice" role="status">{notice}</div> : null}

      <div className="config-engine__status-grid">
        <article><span>Versão ativa</span><strong>{engine.ativa.numero ? `v${engine.ativa.numero}` : 'Padrão seguro'}</strong><small>{formatDate(engine.ativa.publicado_em)}</small></article>
        <article><span>Integridade</span><strong className="config-integrity"><ShieldIcon /> {engine.ativa.integridade}</strong><small>{shortHash(engine.ativa.hash_sha256)}</small></article>
        <article><span>Rascunho</span><strong>{engine.rascunho ? 'Em edição' : 'Nenhum'}</strong><small>{engine.rascunho ? formatDate(engine.rascunho.atualizado_em) : 'Runtime isolado'}</small></article>
        <article><span>Impacto preparado</span><strong>{changedKeys.length}</strong><small>parâmetro(s) diferente(s)</small></article>
      </div>

      <div className="config-engine__layout">
        <section className="config-editor">
          <div className="config-protected-notice">
            <ShieldIcon />
            <span><strong>Núcleo protegido</strong><small>Autenticação, versões da aplicação, schema, permissões, hashes e catálogo de checklist não podem ser alterados aqui.</small></span>
          </div>

          {groups.map((group) => (
            <section className="config-group" key={group}>
              <header><span>{GROUP_LABELS[group]}</span><small>{engine.catalogo.filter((item) => item.grupo === group).length} {engine.catalogo.filter((item) => item.grupo === group).length === 1 ? 'controle' : 'controles'}</small></header>
              <div className="config-fields">
                {engine.catalogo.filter((item) => item.grupo === group).map((definition) => {
                  const issue = validation?.erros.find((item) => item.chave === definition.chave)
                  return (
                    <label className={issue ? 'config-field is-invalid' : 'config-field'} key={definition.chave}>
                      <span><strong>{definition.nome}</strong><small>{definition.descricao}</small></span>
                      {definition.tipo === 'BOOLEANO' ? (
                        <span className="permission-switch">
                          <input type="checkbox" checked={Boolean(values[definition.chave])} onChange={(event) => updateValue(definition, event.target.checked)} />
                          <i aria-hidden="true" />
                        </span>
                      ) : definition.tipo === 'ENUM' ? (
                        <select value={String(values[definition.chave] ?? definition.padrao)} onChange={(event) => updateValue(definition, event.target.value)}>
                          {definition.opcoes?.map((option) => <option key={option} value={option}>{configOptionLabel(option)}</option>)}
                        </select>
                      ) : (
                        <span className="config-number-input">
                          <input
                            type="number"
                            min={definition.minimo}
                            max={definition.maximo}
                            step={definition.tipo === 'INTEIRO' ? 1 : 0.1}
                            value={Number(values[definition.chave] ?? definition.padrao)}
                            onChange={(event) => updateValue(definition, event.target.value)}
                          />
                          {definition.unidade ? <i>{definition.unidade}</i> : null}
                        </span>
                      )}
                      {issue ? <em>{issue.mensagem}</em> : null}
                    </label>
                  )
                })}
              </div>
            </section>
          ))}

          <footer className="config-actions">
            <span>{dirty ? 'Alterações ainda não salvas.' : validation?.valido ? 'Rascunho validado e pronto.' : 'Salve ou valide antes de publicar.'}</span>
            <button type="button" disabled={Boolean(busy) || !dirty} onClick={() => void saveDraft()}>{busy === 'save' ? 'Salvando…' : 'Salvar rascunho'}</button>
            <button type="button" disabled={Boolean(busy)} onClick={() => void validate()}><CheckIcon /> {busy === 'validate' ? 'Validando…' : 'Validar'}</button>
            <button className="primary-button" type="button" disabled={Boolean(busy) || dirty || !engine.rascunho || !validation?.valido || changedKeys.length === 0} onClick={() => void publish()}>
              {busy === 'publish' ? 'Publicando…' : 'Publicar versão'}
            </button>
          </footer>
        </section>

        <aside className="config-sidebar">
          <section>
            <header><SettingsIcon /><span><strong>Alterações preparadas</strong><small>Comparadas com a versão ativa</small></span></header>
            {changedKeys.length ? changedKeys.map((definition) => (
              <article className="config-change" key={definition.chave}>
                <strong>{definition.nome}</strong>
                <small>{String(engine.ativa.configuracao[definition.chave])} → {String(values[definition.chave])}</small>
              </article>
            )) : <p className="config-empty">Nenhuma diferença no rascunho.</p>}
          </section>

          <section>
            <header><ShieldIcon /><span><strong>Chaves bloqueadas</strong><small>{engine.protegidas.length} controles estruturais</small></span></header>
            <div className="config-protected-keys">{engine.protegidas.map((key) => <span key={key}>{PROTECTED_KEY_LABELS[key] ?? 'Controle protegido'}</span>)}</div>
          </section>

          <section>
            <header><RefreshIcon /><span><strong>Histórico imutável</strong><small>Rollback gera uma nova versão</small></span></header>
            <div className="config-version-list">
              {versions.length ? versions.map((version) => (
                <article key={version.id}>
                  <span><strong>v{version.numero}</strong><small>{version.origem === 'ROLLBACK' ? 'Rollback' : 'Publicação'} · {formatDate(version.criado_em)}</small><code>{shortHash(version.hash_sha256)}</code></span>
                  {version.status === 'ATIVA'
                    ? <b>Ativa</b>
                    : <button type="button" disabled={Boolean(busy)} onClick={() => void rollback(version)}>{busy === `rollback:${version.id}` ? 'Restaurando…' : 'Restaurar'}</button>}
                </article>
              )) : <p className="config-empty">A primeira publicação criará a versão 1.</p>}
            </div>
          </section>
        </aside>
      </div>
    </section>
  )
}
