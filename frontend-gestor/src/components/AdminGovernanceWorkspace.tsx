import { Fragment, useCallback, useEffect, useState } from 'react'
import { listAdminUsers } from '../services/api/admin'
import { listAdminAudit } from '../services/api/governance'
import { isGestorAuthenticationError } from '../services/api/gestor'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import type { AdminUser } from '../types/admin'
import type { AdminAuditEvent } from '../types/governance'
import { SearchIcon } from './Icons'

interface AdminGovernanceWorkspaceProps {
  onSessionExpired: () => void
}

interface AuditChange {
  field: string
  before?: string
  after?: string
}

const PAGE_SIZE = 200

function formatDate(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}

function parseState(value?: string): unknown {
  if (value === undefined || value === '') return undefined
  try { return JSON.parse(value) as unknown } catch { return value }
}

function displayValue(value: unknown): string {
  if (value === undefined) return '—'
  if (typeof value === 'string') return value
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function flattenState(value: unknown, path = '', result = new Map<string, string>()): Map<string, string> {
  if (Array.isArray(value)) {
    if (value.length === 0) result.set(path || 'Estado', '[]')
    value.forEach((item, index) => flattenState(item, `${path}[${index}]`, result))
    return result
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) result.set(path || 'Estado', '{}')
    entries.forEach(([key, item]) => flattenState(item, path ? `${path}.${key}` : key, result))
    return result
  }
  result.set(path || 'Estado', displayValue(value))
  return result
}

function auditChanges(event: AdminAuditEvent): { kind: 'created' | 'updated' | 'removed' | 'unavailable'; changes: AuditChange[] } {
  const beforeState = parseState(event.antes_json)
  const afterState = parseState(event.depois_json)
  const hasBefore = beforeState !== undefined
  const hasAfter = afterState !== undefined
  if (!hasBefore && !hasAfter) return { kind: 'unavailable', changes: [] }

  const before = hasBefore ? flattenState(beforeState) : new Map<string, string>()
  const after = hasAfter ? flattenState(afterState) : new Map<string, string>()
  const fields = new Set([...before.keys(), ...after.keys()])
  const changes = [...fields]
    .map((field) => ({ field, before: before.get(field), after: after.get(field) }))
    .filter((change) => change.before !== change.after)

  return { kind: !hasBefore ? 'created' : !hasAfter ? 'removed' : 'updated', changes }
}

function actionLabel(action: string): string {
  return action.replaceAll('_', ' ')
}

export function AdminGovernanceWorkspace({ onSessionExpired }: AdminGovernanceWorkspaceProps) {
  const [events, setEvents] = useState<AdminAuditEvent[]>([])
  const [total, setTotal] = useState(0)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [search, setSearch] = useState('')
  const [action, setAction] = useState('')
  const [userId, setUserId] = useState('')
  const [offset, setOffset] = useState(0)
  const [expandedId, setExpandedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const handleFailure = useCallback((cause: unknown) => {
    if (isGestorAuthenticationError(cause)) {
      onSessionExpired()
      return
    }
    setError(cause instanceof Error ? cause.message : 'Não foi possível consultar a auditoria.')
  }, [onSessionExpired])

  const loadAll = useCallback(async (signal?: AbortSignal) => {
    const [audit, nextUsers] = await Promise.all([
      listAdminAudit({ busca: search, acao: action, responsavel_id: userId, limite: PAGE_SIZE, deslocamento: offset }, signal),
      listAdminUsers({}, signal),
    ])
    setEvents(audit.eventos)
    setTotal(audit.total)
    setUsers(nextUsers)
  }, [action, offset, search, userId])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const timer = window.setTimeout(() => {
      void loadAll(controller.signal).catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        handleFailure(cause)
      }).finally(() => setLoading(false))
    }, 180)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [handleFailure, loadAll])

  useAutoRefresh(async () => {
    try { await loadAll() } catch (cause) { handleFailure(cause) }
  }, { enabled: !expandedId, intervalMs: 15_000 })

  const userNames = new Map(users.map((user) => [user.id, user.nome]))
  const rangeStart = total === 0 ? 0 : offset + 1
  const rangeEnd = Math.min(offset + events.length, total)

  return (
    <section className="admin-governance-workspace">
      {error ? <div className="dashboard-error" role="alert"><strong>Auditoria indisponível.</strong><span>{error}</span></div> : null}

      <section className="admin-governance-toolbar" aria-label="Filtros de auditoria">
        <label className="search-field"><SearchIcon /><input value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0) }} placeholder="Buscar ação, pessoa, registro ou rastreamento" /></label>
        <label><span>Categoria</span><select value={action} onChange={(event) => { setAction(event.target.value); setOffset(0) }}><option value="">Todas as ações</option><option value="ADMIN_">Administração e acessos</option><option value="AUTH_">Autenticação</option><option value="ADMIN_BACKUP_">Backups</option><option value="ADMIN_IMPORT_">Importações</option><option value="ADMIN_DOCUMENT_">Documentos</option></select></label>
        <label><span>Responsável</span><select value={userId} onChange={(event) => { setUserId(event.target.value); setOffset(0) }}><option value="">Todos</option>{users.map((user) => <option value={user.id} key={user.id}>{user.nome} · {user.perfil}</option>)}</select></label>
      </section>

      <section className="admin-governance-table-card">
        <header><div><span className="eyebrow">REGISTROS RASTREÁVEIS</span><h2>Auditoria</h2></div><strong>{total} registro(s)</strong></header>
        <div className="admin-governance-table-wrap"><table className="admin-governance-table"><thead><tr><th>Data e hora</th><th>Responsável</th><th>Ação e registro</th></tr></thead><tbody>
          {events.map((event) => {
            const expanded = expandedId === event.id
            const changeSet = expanded ? auditChanges(event) : null
            const responsible = userNames.get(event.usuario_id) || event.responsavel || event.usuario_id
            return <Fragment key={event.id}>
              <tr className={`admin-audit-summary-row${expanded ? ' is-expanded' : ''}`}>
                <td colSpan={3}>
                  <details open={expanded} onToggle={(toggleEvent) => {
                    const isOpen = (toggleEvent.currentTarget as HTMLDetailsElement).open
                    setExpandedId((current) => isOpen ? event.id : current === event.id ? '' : current)
                  }}>
                    <summary className="admin-audit-summary">
                      <span><strong>{formatDate(event.criado_em)}</strong><small>ID {event.id}</small></span>
                      <span><strong>{responsible}</strong><small>{event.perfil || 'Perfil indisponível'}</small></span>
                      <span><strong>{actionLabel(event.acao)}</strong><small>{event.entidade} · {event.entidade_id || 'sem identificador'}</small></span>
                    </summary>
                    {changeSet ? <section className="admin-audit-expanded">
                      <header><strong>{changeSet.kind === 'created' ? 'Registro criado' : changeSet.kind === 'removed' ? 'Registro removido' : changeSet.kind === 'updated' ? 'Campos alterados' : 'Detalhe do evento'}</strong><span>{event.entidade} · {event.entidade_id || 'sem identificador'}</span></header>
                      {changeSet.kind === 'unavailable' ? <p>Este evento não contém estados anterior e posterior.</p> : changeSet.changes.length === 0 ? <p>Os estados anterior e posterior são iguais.</p> : (
                        <div className="admin-audit-change-table-wrap"><table className="admin-audit-change-table"><thead><tr><th>Campo</th>{changeSet.kind === 'updated' ? <th>Antes</th> : null}<th>{changeSet.kind === 'created' ? 'Estado criado' : changeSet.kind === 'removed' ? 'Último estado' : 'Depois'}</th></tr></thead><tbody>
                          {changeSet.changes.map((change) => <tr key={change.field}><th scope="row">{change.field}</th>{changeSet.kind === 'updated' ? <td>{change.before ?? '—'}</td> : null}<td>{changeSet.kind === 'removed' ? change.before ?? '—' : change.after ?? '—'}</td></tr>)}
                        </tbody></table></div>
                      )}
                      <dl className="admin-audit-identifiers">
                        <div><dt>Identificador do evento</dt><dd>{event.id}</dd></div>
                        <div><dt>Responsável</dt><dd>{responsible}{event.usuario_id ? ` · ${event.usuario_id}` : ''}</dd></div>
                        <div><dt>Rastreamento da requisição</dt><dd>{event.trace_id || 'Não informado por esta origem'}</dd></div>
                        <div><dt>Origem</dt><dd>{event.origem || 'Não informada'}</dd></div>
                        <div><dt>Endereço IP</dt><dd>{event.ip_address || 'Não informado'}</dd></div>
                        {event.campos_ocultos?.length ? <div><dt>Campos protegidos</dt><dd>{event.campos_ocultos.join(', ')}</dd></div> : null}
                      </dl>
                      {event.user_agent ? <small className="admin-audit-user-agent">Dispositivo: {event.user_agent}</small> : null}
                    </section> : null}
                  </details>
                </td>
              </tr>
            </Fragment>
          })}
          {!events.length ? <tr><td colSpan={3}><div className="admin-empty-state">{loading ? 'Carregando registros…' : 'Nenhum evento corresponde aos filtros.'}</div></td></tr> : null}
        </tbody></table></div>
        <footer className="admin-audit-pagination"><span>{rangeStart}–{rangeEnd} de {total}</span><div><button type="button" disabled={offset === 0 || loading} onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}>Mais recentes</button><button type="button" disabled={offset + events.length >= total || loading} onClick={() => setOffset((current) => current + PAGE_SIZE)}>Mais antigos</button></div></footer>
      </section>
    </section>
  )
}
