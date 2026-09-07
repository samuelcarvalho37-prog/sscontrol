import { useCallback, useEffect, useMemo, useState } from 'react'
import { PasswordResetDialog } from '../components/PasswordResetDialog'
import { UserEditorDialog } from '../components/UserEditorDialog'
import { ConfigurationEnginePanel } from '../components/ConfigurationEnginePanel'
import { AdminImportCenter } from '../components/AdminImportCenter'
import { AdminCatalogWorkspace } from '../components/AdminCatalogWorkspace'
import { AdminChecklistBuilder } from '../components/AdminChecklistBuilder'
import { AdminTechnicalStructure } from '../components/AdminTechnicalStructure'
import { AdminInterventionsWorkspace } from '../components/AdminInterventionsWorkspace'
import { AdminAnalyticsWorkspace } from '../components/AdminAnalyticsWorkspace'
import { AdminDocumentsWorkspace } from '../components/AdminDocumentsWorkspace'
import { AdminGovernanceWorkspace } from '../components/AdminGovernanceWorkspace'
import { AdminBackupWorkspace } from '../components/AdminBackupWorkspace'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { AssetIcon, CheckIcon, KeyIcon, SearchIcon, SettingsIcon, ShieldIcon, UsersIcon } from '../components/Icons'
import {
  getAdminPermissionMatrix,
  listAdminUsers,
  revokeAdminUserSessions,
  saveAdminPermissionProfile,
  unlockAdminUser,
} from '../services/api/admin'
import type { GestorSession } from '../services/api/auth'
import { isGestorAuthenticationError } from '../services/api/gestor'
import type {
  AdminNotificationTarget,
  AdminPermissionMatrix,
  AdminUser,
  AdminUserProfile,
  AdminUserStatus,
} from '../types/admin'

interface AdminPageProps {
  session: GestorSession
  onSessionExpired: () => void
  activeModule?: AdminModule
  embedded?: boolean
  notificationTarget?: AdminNotificationTarget | null
  onModuleChange?: (module: AdminModule) => void
}

export type AdminModule =
  | 'overview'
  | 'imports'
  | 'structure'
  | 'assets'
  | 'checklists'
  | 'maintenance'
  | 'inventory'
  | 'workforce'
  | 'operations'
  | 'analytics'
  | 'documents'
  | 'governance'
  | 'backup'
  | 'configuration'
  | 'users'
  | 'permissions'
type EditablePermissionProfile = 'GESTOR' | 'OPERADOR'

const PROFILE_LABELS: Record<AdminUserProfile, string> = {
  ADMIN: 'Administrador',
  GESTOR: 'Gestor',
  OPERADOR: 'Operador',
}

function formatDate(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function isUserBlocked(user: AdminUser): boolean {
  if (!user.bloqueado_ate) return false
  const date = new Date(user.bloqueado_ate)
  return !Number.isNaN(date.getTime()) && date.getTime() > Date.now()
}

function normalizeAttempts(user: AdminUser): number {
  const value = Number(user.tentativas_login ?? 0)
  return Number.isFinite(value) ? value : 0
}

export function AdminPage({
  session,
  onSessionExpired,
  activeModule,
  embedded = false,
  notificationTarget,
  onModuleChange,
}: AdminPageProps) {
  const [internalModule, setInternalModule] = useState<AdminModule>('overview')
  const tab = activeModule ?? internalModule
  const setTab = (module: AdminModule) => {
    setInternalModule(module)
    onModuleChange?.(module)
  }
  const [users, setUsers] = useState<AdminUser[]>([])
  const [permissionMatrix, setPermissionMatrix] = useState<AdminPermissionMatrix | null>(null)
  const [selectedPermissionProfile, setSelectedPermissionProfile] = useState<EditablePermissionProfile>('GESTOR')
  const [search, setSearch] = useState('')
  const [profileFilter, setProfileFilter] = useState<AdminUserProfile | ''>('')
  const [statusFilter, setStatusFilter] = useState<AdminUserStatus | ''>('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [savingPermissions, setSavingPermissions] = useState(false)
  const [actionUserId, setActionUserId] = useState('')
  const [editingUser, setEditingUser] = useState<AdminUser | null | undefined>(undefined)
  const [resetUser, setResetUser] = useState<AdminUser | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadData = useCallback(async (signal?: AbortSignal) => {
    const [nextUsers, nextMatrix] = await Promise.all([
      listAdminUsers({}, signal),
      getAdminPermissionMatrix(signal),
    ])
    setUsers(nextUsers)
    setPermissionMatrix(nextMatrix)
  }, [])

  useEffect(() => {
    if (['configuration', 'imports', 'structure', 'assets', 'checklists', 'maintenance', 'inventory', 'workforce', 'operations', 'analytics', 'documents', 'governance', 'backup'].includes(tab)) {
      setLoading(false)
      return undefined
    }
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void loadData(controller.signal)
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        if (isGestorAuthenticationError(cause)) {
          onSessionExpired()
          return
        }
        setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a administração.')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [loadData, onSessionExpired, tab])

  const visibleUsers = useMemo(() => {
    const term = search.trim().toLowerCase()
    return users.filter((user) => {
      if (profileFilter && user.perfil !== profileFilter) return false
      if (statusFilter && user.status !== statusFilter) return false
      if (!term) return true
      return [user.nome, user.email, user.matricula, user.id]
        .some((value) => value.toLowerCase().includes(term))
    })
  }, [profileFilter, search, statusFilter, users])

  const metrics = useMemo(() => ({
    total: users.length,
    active: users.filter((user) => user.status === 'ATIVO').length,
    blocked: users.filter(isUserBlocked).length,
    recovery: users.filter((user) => user.recuperacao_pendente).length,
  }), [users])

  const selectedPermissions = permissionMatrix?.perfis.find(
    (profile) => profile.perfil === selectedPermissionProfile,
  )

  async function refresh(message?: string) {
    setRefreshing(true)
    setError('')
    try {
      await loadData()
      if (message) setNotice(message)
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar os dados.')
    } finally {
      setRefreshing(false)
    }
  }

  useAutoRefresh(
    () => refresh(),
    {
      enabled:
        ['overview', 'users', 'permissions'].includes(tab) &&
        editingUser === undefined &&
        !resetUser,
      intervalMs: 20_000,
    },
  )

  async function unlockUser(user: AdminUser) {
    setActionUserId(user.id)
    setError('')
    try {
      await unlockAdminUser(user.id)
      await refresh(`Acesso de ${user.nome} desbloqueado.`)
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setError(cause instanceof Error ? cause.message : 'Não foi possível desbloquear o usuário.')
    } finally {
      setActionUserId('')
    }
  }

  async function revokeSessions(user: AdminUser) {
    if (!window.confirm(`Encerrar todas as sessões ativas de ${user.nome}?`)) return
    setActionUserId(user.id)
    setError('')
    try {
      const result = await revokeAdminUserSessions(user.id)
      await refresh(`${result.sessoes_revogadas} sessão(ões) de ${user.nome} encerrada(s).`)
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setError(cause instanceof Error ? cause.message : 'Não foi possível revogar as sessões.')
    } finally {
      setActionUserId('')
    }
  }

  function togglePermission(capabilityId: string, allowed: boolean) {
    setPermissionMatrix((current) => {
      if (!current) return current
      return {
        ...current,
        perfis: current.perfis.map((profile) => (
          profile.perfil !== selectedPermissionProfile
            ? profile
            : {
                ...profile,
                capacidades: profile.capacidades.map((capability) => (
                  capability.id === capabilityId
                    ? { ...capability, permitido: allowed }
                    : capability
                )),
              }
        )),
      }
    })
    setNotice('')
  }

  async function savePermissions() {
    if (!selectedPermissions) return
    const permissions = Object.fromEntries(
      selectedPermissions.capacidades.map((capability) => [capability.id, capability.permitido]),
    )
    setSavingPermissions(true)
    setError('')
    try {
      const result = await saveAdminPermissionProfile(selectedPermissionProfile, permissions)
      setPermissionMatrix((current) => {
        if (!current) return current
        return {
          ...current,
          perfis: current.perfis.map((profile) => (
            profile.perfil === result.matriz.perfil ? result.matriz : profile
          )),
        }
      })
      setNotice(`Permissões do perfil ${PROFILE_LABELS[selectedPermissionProfile]} atualizadas e auditadas.`)
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar as permissões.')
    } finally {
      setSavingPermissions(false)
    }
  }

  if (loading) {
    return <div className="dashboard-loading">Carregando administração…</div>
  }

  return (
    <main className={embedded ? 'admin-workspace-module' : 'content admin-page'}>
      {!embedded ? (
        <>
          <section className="admin-mobile-block">
            <ShieldIcon />
            <h1>Command Workspace</h1>
            <p>O ambiente administrativo foi protegido para uso em computador. Acesse em uma tela com pelo menos 901 px de largura.</p>
          </section>
          <section className="page-heading">
            <div>
              <span className="eyebrow">ADMINISTRAÇÃO E SEGURANÇA</span>
              <h1>Command Workspace</h1>
              <p>Configuração versionada, identidades e capacidades com proteção de runtime e trilha de auditoria.</p>
            </div>
          </section>
        </>
      ) : null}

      {error ? <div className="dashboard-error" role="alert"><strong>Falha administrativa.</strong><span>{error}</span></div> : null}
      {notice ? <div className="dashboard-notice" role="status">{notice}</div> : null}

      {!embedded ? <section className="admin-tabs" role="tablist" aria-label="Administração">
        <button type="button" role="tab" aria-selected={tab === 'overview'} className={tab === 'overview' ? 'is-active' : ''} onClick={() => setTab('overview')}>
          <SettingsIcon /> Visão geral
        </button>
        <button type="button" role="tab" aria-selected={tab === 'configuration'} className={tab === 'configuration' ? 'is-active' : ''} onClick={() => setTab('configuration')}>
          <SettingsIcon /> Motor
        </button>
        <button type="button" role="tab" aria-selected={tab === 'imports'} className={tab === 'imports' ? 'is-active' : ''} onClick={() => setTab('imports')}>
          <SettingsIcon /> Importação
        </button>
        <button type="button" role="tab" aria-selected={tab === 'users'} className={tab === 'users' ? 'is-active' : ''} onClick={() => setTab('users')}>
          <UsersIcon /> Usuários
        </button>
        <button type="button" role="tab" aria-selected={tab === 'permissions'} className={tab === 'permissions' ? 'is-active' : ''} onClick={() => setTab('permissions')}>
          <ShieldIcon /> Permissões
        </button>
      </section> : null}

      {tab === 'overview' ? (
        <section className="admin-command-overview" role="tabpanel">
          <div className="admin-command-kpis">
            <article><span>Identidades</span><strong>{metrics.total}</strong><small>{metrics.active} com acesso ativo</small></article>
            <article className={metrics.blocked ? 'is-warning' : ''}><span>Segurança</span><strong>{metrics.blocked}</strong><small>contas temporariamente bloqueadas</small></article>
            <article className={metrics.recovery ? 'is-warning' : ''}><span>Recuperações</span><strong>{metrics.recovery}</strong><small>solicitações aguardando ação</small></article>
            <article><span>Capacidades</span><strong>{permissionMatrix?.perfis.reduce((total, profile) => total + profile.capacidades.filter((item) => item.permitido).length, 0) ?? 0}</strong><small>regras ativas na matriz</small></article>
          </div>

          <div className="admin-command-dashboard-grid">
            <section className="admin-command-control-panel">
              <header><div><span className="eyebrow">CONTROLES CENTRAIS</span><h2>Governança do sistema</h2></div><span className={`manager-live-sync manager-live-sync--compact${refreshing ? ' is-syncing' : ''}`}><i aria-hidden="true" />{refreshing ? 'Sincronizando' : 'Ao vivo'}</span></header>
              <div className="admin-command-module-grid">
                <button type="button" onClick={() => setTab('structure')}><AssetIcon /><span><strong>Estrutura fabril</strong><small>Plantas, setores e linhas com vínculos controlados.</small></span><b>Assistida</b></button>
                <button type="button" onClick={() => setTab('assets')}><AssetIcon /><span><strong>Cadastro técnico</strong><small>Equipamentos, componentes, criticidade e localização.</small></span><b>Rastreável</b></button>
                <button type="button" onClick={() => setTab('checklists')}><CheckIcon /><span><strong>Construtor de checklist</strong><small>Etapas dinâmicas, evidências e filtro técnico.</small></span><b>Validado</b></button>
                <button type="button" onClick={() => setTab('operations')}><SettingsIcon /><span><strong>Programação, intervenções e OS</strong><small>Planos, gatilhos, demandas planejadas e não planejadas.</small></span><b>Unificada</b></button>
                <button type="button" onClick={() => setTab('inventory')}><AssetIcon /><span><strong>Materiais e peças</strong><small>Itens, unidades, saldo e estoque mínimo.</small></span><b>Controlado</b></button>
                <button type="button" onClick={() => setTab('workforce')}><UsersIcon /><span><strong>Áreas e cargos técnicos</strong><small>Destinos, especialistas e permissão de assinatura.</small></span><b>Roteável</b></button>
                <button type="button" onClick={() => setTab('analytics')}><SettingsIcon /><span><strong>Indicadores e relatórios</strong><small>Disponibilidade, falhas, MTTR, MTBF, lead time e SLA.</small></span><b>Calculado</b></button>
                <button type="button" onClick={() => setTab('documents')}><AssetIcon /><span><strong>Documentos técnicos</strong><small>Arquivos privados, validade e revisões imutáveis.</small></span><b>Versionado</b></button>
                <button type="button" onClick={() => setTab('governance')}><ShieldIcon /><span><strong>Auditoria e monitoramento</strong><small>Integridade, eventos e alterações com dados sensíveis protegidos.</small></span><b>Observável</b></button>
                <button type="button" onClick={() => setTab('backup')}><ShieldIcon /><span><strong>Backup e continuidade</strong><small>Pontos integrais privados com criação confirmada e auditada.</small></span><b>Protegido</b></button>
                <button type="button" onClick={() => setTab('imports')}><SettingsIcon /><span><strong>Implantação e Importação</strong><small>Modelos de planilha, pré-análise, confirmação e rollback por lote.</small></span><b>Governada</b></button>
                <button type="button" onClick={() => setTab('configuration')}><SettingsIcon /><span><strong>Motor de Configuração</strong><small>Rascunhos, validação, publicação e rollback imutável.</small></span><b>Seguro</b></button>
                <button type="button" onClick={() => setTab('users')}><UsersIcon /><span><strong>Identidades e perfis</strong><small>Usuários, áreas técnicas, cargos, sessões e recuperação.</small></span><b>{metrics.active} ativos</b></button>
                <button type="button" onClick={() => setTab('permissions')}><ShieldIcon /><span><strong>Matriz de capacidades</strong><small>Permissões efetivas para gestor e operador.</small></span><b>Auditada</b></button>
              </div>
            </section>

            <aside className="admin-command-safety-panel">
              <span className="eyebrow">NÚCLEO PROTEGIDO</span>
              <h2>Barreiras de segurança</h2>
              <ul>
                <li><ShieldIcon /><span><strong>Runtime isolado</strong><small>Rascunhos nunca alteram a operação.</small></span></li>
                <li><ShieldIcon /><span><strong>Lista branca</strong><small>Somente parâmetros tipados podem ser publicados.</small></span></li>
                <li><ShieldIcon /><span><strong>Histórico imutável</strong><small>Rollback cria uma nova versão auditada.</small></span></li>
                <li><ShieldIcon /><span><strong>Concorrência bloqueada</strong><small>Versões obsoletas são recusadas.</small></span></li>
              </ul>
            </aside>
          </div>

          <section className="admin-command-flow-panel">
            <header><span className="eyebrow">FLUXO CORPORATIVO</span><h2>Como a governança chega ao chão de fábrica</h2></header>
            <div className="admin-command-flow">
              <article><b>01</b><span><strong>Administrador</strong><small>Cria planos, modelos e políticas.</small></span></article>
              <i aria-hidden="true">→</i>
              <article><b>02</b><span><strong>Filtro técnico</strong><small>Gestor valida, encaminha e solicita assinatura.</small></span></article>
              <i aria-hidden="true">→</i>
              <article><b>03</b><span><strong>Especialista</strong><small>Qualidade, manutenção ou segurança libera.</small></span></article>
              <i aria-hidden="true">→</i>
              <article><b>04</b><span><strong>Operador</strong><small>Executa a ordem e registra evidências.</small></span></article>
            </div>
          </section>
        </section>
      ) : null}

      {tab === 'configuration' ? <ConfigurationEnginePanel onSessionExpired={onSessionExpired} /> : null}

      {tab === 'imports' ? <AdminImportCenter onSessionExpired={onSessionExpired} /> : null}

      {tab === 'structure' ? <AdminCatalogWorkspace scope="structure" onSessionExpired={onSessionExpired} onOpenImports={() => setTab('imports')} /> : null}

      {tab === 'assets' ? <AdminCatalogWorkspace scope="assets" onSessionExpired={onSessionExpired} onOpenImports={() => setTab('imports')} /> : null}

      {tab === 'inventory' ? <AdminCatalogWorkspace scope="inventory" onSessionExpired={onSessionExpired} onOpenImports={() => setTab('imports')} /> : null}

      {tab === 'checklists' ? (
        <AdminChecklistBuilder
          onSessionExpired={onSessionExpired}
          focusTarget={notificationTarget}
        />
      ) : null}

      {tab === 'workforce' ? <AdminTechnicalStructure onSessionExpired={onSessionExpired} /> : null}

      {tab === 'operations' || tab === 'maintenance' ? (
        <AdminInterventionsWorkspace
          onSessionExpired={onSessionExpired}
          focusTarget={notificationTarget}
          onOpenChecklists={() => setTab('checklists')}
          onOpenImports={() => setTab('imports')}
        />
      ) : null}

      {tab === 'analytics' ? <AdminAnalyticsWorkspace onSessionExpired={onSessionExpired} /> : null}

      {tab === 'documents' ? <AdminDocumentsWorkspace onSessionExpired={onSessionExpired} /> : null}

      {tab === 'governance' ? <AdminGovernanceWorkspace onSessionExpired={onSessionExpired} /> : null}

      {tab === 'backup' ? <AdminBackupWorkspace onSessionExpired={onSessionExpired} /> : null}

      {tab === 'users' ? (
        <section className="admin-users" role="tabpanel">
          <div className="admin-metric-grid">
            <article><span>Total</span><strong>{metrics.total}</strong><small>identidades cadastradas</small></article>
            <article><span>Ativos</span><strong>{metrics.active}</strong><small>com acesso permitido</small></article>
            <article className={metrics.blocked ? 'is-warning' : ''}><span>Bloqueados</span><strong>{metrics.blocked}</strong><small>por tentativas inválidas</small></article>
            <article className={metrics.recovery ? 'is-warning' : ''}><span>Recuperações</span><strong>{metrics.recovery}</strong><small>aguardando administrador</small></article>
          </div>

          <section className="admin-user-panel">
            <header className="admin-user-panel__header">
              <div><span className="eyebrow">DIRETÓRIO</span><h2>Usuários cadastrados</h2></div>
              <button className="primary-button" type="button" onClick={() => setEditingUser(null)}>Novo usuário</button>
            </header>

            <div className="admin-filter-bar">
              <label className="search-field">
                <SearchIcon />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nome, matrícula ou e-mail" />
              </label>
              <label>
                <span>Perfil</span>
                <select value={profileFilter} onChange={(event) => setProfileFilter(event.target.value as AdminUserProfile | '')}>
                  <option value="">Todos</option>
                  <option value="ADMIN">Administrador</option>
                  <option value="GESTOR">Gestor</option>
                  <option value="OPERADOR">Operador</option>
                </select>
              </label>
              <label>
                <span>Status</span>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AdminUserStatus | '')}>
                  <option value="">Todos</option>
                  <option value="ATIVO">Ativos</option>
                  <option value="INATIVO">Inativos</option>
                </select>
              </label>
            </div>

            <div className="admin-user-table">
              <div className="admin-user-table__head">
                <span>Identidade</span><span>Perfil</span><span>Segurança</span><span>Último acesso</span><span>Ações</span>
              </div>
              {visibleUsers.length ? visibleUsers.map((user) => {
                const blocked = isUserBlocked(user)
                const busy = actionUserId === user.id
                const self = user.id === session.user.id
                return (
                  <article className="admin-user-row" key={user.id}>
                    <div className="admin-user-identity">
                      <span className="admin-user-avatar">{user.nome.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
                      <span><strong>{user.nome}{self ? ' · Você' : ''}</strong><small>{user.matricula} · {user.email}</small></span>
                    </div>
                    <div><span className={`profile-chip profile-chip--${user.perfil.toLowerCase()}`}>{PROFILE_LABELS[user.perfil]}</span><small className={user.status === 'ATIVO' ? 'user-status user-status--active' : 'user-status'}>{user.status}</small></div>
                    <div className="admin-user-security">
                      {blocked ? <span className="security-flag security-flag--danger">Bloqueado até {formatDate(user.bloqueado_ate)}</span> : null}
                      {user.recuperacao_pendente ? <span className="security-flag security-flag--warning">Recuperação {user.recuperacao_referencia}</span> : null}
                      {String(user.primeiro_acesso).toUpperCase() === 'SIM' ? <span className="security-flag">Primeiro acesso pendente</span> : null}
                      {!blocked && !user.recuperacao_pendente && String(user.primeiro_acesso).toUpperCase() !== 'SIM' ? <span className="security-flag security-flag--ok">Regular</span> : null}
                      <small>{normalizeAttempts(user)} tentativa(s) · {user.sessoes_ativas ?? 0} sessão(ões)</small>
                    </div>
                    <div className="admin-user-last-access"><strong>{formatDate(user.ultimo_login_em)}</strong><small>senha: {formatDate(user.senha_atualizada_em)}</small></div>
                    <div className="admin-user-actions">
                      <button type="button" disabled={busy} onClick={() => setEditingUser(user)}>Editar</button>
                      {blocked ? <button type="button" disabled={busy} onClick={() => void unlockUser(user)}>Desbloquear</button> : null}
                      {!self ? <button type="button" disabled={busy} onClick={() => setResetUser(user)}><KeyIcon /> Senha</button> : null}
                      {!self && Number(user.sessoes_ativas ?? 0) > 0 ? <button type="button" disabled={busy} onClick={() => void revokeSessions(user)}>Revogar</button> : null}
                    </div>
                  </article>
                )
              }) : <div className="admin-empty-state">Nenhum usuário corresponde aos filtros.</div>}
            </div>
          </section>
        </section>
      ) : null}

      {tab === 'permissions' ? (
        <section className="permission-panel" role="tabpanel">
          <aside className="permission-profiles">
            <div><span className="eyebrow">PERFIS</span><h2>Matriz de capacidades</h2><p>Alterações passam a valer nas próximas requisições e ficam registradas na auditoria.</p></div>
            <article className="permission-profile-card permission-profile-card--locked">
              <ShieldIcon /><span><strong>Administrador</strong><small>Acesso técnico integral e protegido contra bloqueio.</small></span><b>Protegido</b>
            </article>
            {(['GESTOR', 'OPERADOR'] as EditablePermissionProfile[]).map((profile) => (
              <button
                key={profile}
                type="button"
                className={selectedPermissionProfile === profile ? 'permission-profile-card is-active' : 'permission-profile-card'}
                onClick={() => setSelectedPermissionProfile(profile)}
              >
                <UsersIcon /><span><strong>{PROFILE_LABELS[profile]}</strong><small>{permissionMatrix?.perfis.find((item) => item.perfil === profile)?.capacidades.filter((item) => item.permitido).length ?? 0} capacidades habilitadas</small></span>
              </button>
            ))}
          </aside>

          <section className="permission-capabilities">
            <header>
              <div><span className="eyebrow">{selectedPermissionProfile}</span><h2>Capacidades do perfil</h2><p>Desative somente o necessário. O backend continua validando propriedade, sessão e contexto de cada operação.</p></div>
              <button className="primary-button" type="button" disabled={savingPermissions} onClick={() => void savePermissions()}>{savingPermissions ? 'Salvando…' : 'Salvar matriz'}</button>
            </header>
            <div className="permission-capability-list">
              {selectedPermissions?.capacidades.map((capability) => (
                <label className="permission-capability" key={capability.id}>
                  <span className="permission-capability__icon"><ShieldIcon /></span>
                  <span><strong>{capability.nome}</strong><small>{capability.descricao}</small><i>{capability.acoes.length} {capability.acoes.length === 1 ? 'operação protegida' : 'operações protegidas'}</i></span>
                  <span className="permission-switch" title={capability.permitido ? 'Capacidade habilitada' : 'Capacidade desabilitada'}>
                    <input
                      type="checkbox"
                      checked={capability.permitido}
                      aria-label={`${capability.nome}: ${capability.permitido ? 'habilitada' : 'desabilitada'}`}
                      onChange={(event) => togglePermission(capability.id, event.target.checked)}
                    />
                    <i aria-hidden="true" />
                  </span>
                </label>
              ))}
            </div>
          </section>
        </section>
      ) : null}

      {editingUser !== undefined ? (
        <UserEditorDialog
          user={editingUser}
          currentUserId={session.user.id}
          onClose={() => setEditingUser(undefined)}
          onSaved={(message) => {
            setEditingUser(undefined)
            void refresh(message)
          }}
        />
      ) : null}

      {resetUser ? (
        <PasswordResetDialog
          user={resetUser}
          onClose={() => setResetUser(null)}
          onReset={(message) => {
            setResetUser(null)
            void refresh(message)
          }}
        />
      ) : null}
    </main>
  )
}
