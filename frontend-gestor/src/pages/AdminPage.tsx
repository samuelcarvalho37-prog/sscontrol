import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { UserEditorDialog, type AccountCredentialReceipt } from '../components/UserEditorDialog'
import { AdminUserBulkImportDialog } from '../components/AdminUserBulkImportDialog'
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
import { TenantSupportWorkspace } from '../components/TenantSupportWorkspace'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { KeyIcon, PlusIcon, SearchIcon, SettingsIcon, ShieldIcon, StopIcon, UsersIcon } from '../components/Icons'
import {
  getAdminPermissionMatrix,
  listAdminUsers,
  listTechnicalAreas,
  listTechnicalRoles,
  revokeAdminUserSessions,
  resetAdminUserPassword,
  saveAdminUser,
  saveAdminPermissionProfile,
  createAdminPermissionProfile,
  provisionDefaultAdminPermissionProfiles,
  unlockAdminUser,
} from '../services/api/admin'
import type { GestorSession } from '../services/api/auth'
import { isGestorAuthenticationError } from '../services/api/gestor'
import { getAdminMonitoring, listAdminAudit } from '../services/api/governance'
import { listAdminEntity } from '../services/api/catalog'
import type {
  AdminCommercialAccess,
  AdminNotificationTarget,
  AdminPermissionMatrix,
  AdminUser,
  AdminUserProfile,
  AdminUserStatus,
  TechnicalArea,
  TechnicalRole,
} from '../types/admin'
import type { AdminMonitoringState } from '../types/governance'
import type { AdminAuditEvent } from '../types/governance'
import type { AdminEntityRecord } from '../types/catalog'
import type { AdminImportRetryRequest } from '../types/imports'

interface AdminPageProps {
  session: GestorSession
  onSessionExpired: () => void
  activeModule?: AdminModule
  embedded?: boolean
  detachedTechnicalPanel?: 'areas' | 'roles'
  detachedTechnicalPanels?: Array<'areas' | 'roles'>
  onDetachTechnicalPanel?: (panel: 'areas' | 'roles') => void
  selectedTechnicalAreaId?: string
  onSelectedTechnicalAreaChange?: (areaId: string) => void
  notificationTarget?: AdminNotificationTarget | null
  permissionProfileRequest?: { profile: string; capabilityName?: string; requestId: number } | null
  onModuleChange?: (module: AdminModule) => void
  onOpenImportSection?: (section: 'structure' | 'technical' | 'stock' | 'master', operation: 'import' | 'export') => void
  onOpenImportZone?: (operation: 'import' | 'export') => void
  onRestoreImportZone?: (operation: 'import' | 'export') => void
  onOpenImportHistory?: () => void
  onOpenImportReimport?: (request: AdminImportRetryRequest, file: File) => void
  importReimportRequest?: (AdminImportRetryRequest & { requestId: number; file: File }) | null
  importExportRequest?: { operation: 'import' | 'export'; section: 'structure' | 'technical' | 'stock' | 'master'; requestId: number } | null
  userSettingsUser?: AdminUser | null
  userCredentialReceipt?: AccountCredentialReceipt
  userSettingsSection?: 'identity' | 'specialties' | 'scope'
  onOpenUserSettings?: (user: AdminUser | null, section: 'identity' | 'specialties' | 'scope') => void
  onCloseUserSettings?: () => void
  onUserSaved?: (message: string) => void
  onOpenCredentialDelivery?: (user: AdminUser, receipt: AccountCredentialReceipt) => void
  onPasswordResetSuccess?: (userName: string) => void
  userDataRevision?: number
  onReviewCapability?: (profile: string, capabilityName: string) => void
  inspectedModule?: AdminModule
  onInspectModule?: (module: AdminModule) => void
  onOpenOperationalModule?: (module: AdminModule) => void
  moduleStatuses?: AdminWorkspaceModuleStatus[]
  commercialAccess?: AdminCommercialAccess | null
  commercialAccessError?: string
  companyName?: string
}

export type AdminModule =
  | 'overview'
  | 'imports'
  | 'imports-structure'
  | 'imports-technical'
  | 'imports-stock'
  | 'imports-master'
  | 'imports-zone'
  | 'exports-structure'
  | 'exports-technical'
  | 'exports-stock'
  | 'exports-master'
  | 'exports-zone'
  | 'import-history'
  | 'structure'
  | 'assets'
  | 'checklists'
  | 'maintenance'
  | 'plan-approvals'
  | 'inventory'
  | 'workforce'
  | 'workforce-areas'
  | 'workforce-roles'
  | 'operations'
  | 'analytics'
  | 'documents'
  | 'governance'
  | 'backup'
  | 'configuration'
  | 'users'
  | 'permissions'
  | 'support'
  | 'module-inspector'
  | `user-settings:${string}`
export interface AdminWorkspaceModuleStatus {
  module: AdminModule
  label: string
  feature?: AdminCommercialAccess['recursos'][number]['codigo']
  available: boolean
  open: boolean
}

interface CapabilityModuleBinding {
  module: AdminModule
  label: string
  feature: AdminCommercialAccess['recursos'][number]['codigo']
}

const CAPABILITY_MODULE_BINDINGS: Array<{ matches: (code: string) => boolean; binding: CapabilityModuleBinding }> = [
  { matches: (code) => code === 'admin.technical-structure.manage', binding: { module: 'workforce', label: 'Equipes técnicas', feature: 'GESTAO_TECNICA' } },
  { matches: (code) => code.startsWith('cmms.structure.'), binding: { module: 'structure', label: 'Estrutura fabril', feature: 'CADASTROS' } },
  { matches: (code) => code.startsWith('cmms.assets.') || code.startsWith('cmms.parameters.') || code === 'cmms.readings.create', binding: { module: 'assets', label: 'Cadastro técnico', feature: 'CADASTROS' } },
  { matches: (code) => code.startsWith('cmms.materials.'), binding: { module: 'inventory', label: 'Materiais e peças', feature: 'CADASTROS' } },
  { matches: (code) => code.startsWith('maintenance.checklists.'), binding: { module: 'checklists', label: 'Checklists', feature: 'CHECKLISTS' } },
  { matches: (code) => code.startsWith('maintenance.plans.'), binding: { module: 'plan-approvals', label: 'Planos de manutenção', feature: 'GESTAO_TECNICA' } },
  { matches: (code) => code.startsWith('maintenance.work-orders.') || code.startsWith('maintenance.executions.') || code.startsWith('maintenance.occurrences.') || code.startsWith('maintenance.stops.') || code.startsWith('maintenance.alerts.'), binding: { module: 'operations', label: 'Operação de manutenção', feature: 'GESTAO_TECNICA' } },
  { matches: (code) => code.startsWith('analytics.'), binding: { module: 'analytics', label: 'Indicadores', feature: 'INDICADORES' } },
  { matches: (code) => code.startsWith('admin.identity.'), binding: { module: 'users', label: 'Identidades e usuários', feature: 'CADASTROS' } },
  { matches: (code) => code.startsWith('admin.governance.'), binding: { module: 'governance', label: 'Auditoria', feature: 'AUDITORIA' } },
  { matches: (code) => code.startsWith('admin.configuration.'), binding: { module: 'configuration', label: 'Configurações avançadas', feature: 'MOTOR_LIMITADO' } },
]

const MODULE_COMPOSITION: Partial<Record<AdminModule, string[]>> = {
  assets: [
    'Ativos e componentes técnicos',
    'Parâmetros técnicos e leituras operacionais',
    'Vínculos usados por planos, checklists e ordens de serviço',
  ],
  checklists: [
    'Modelos, revisões, etapas e validação',
    'Respostas dinâmicas: conformidade, confirmação, parâmetro, número, seleção, texto, evidência, leitura e instrução',
    'Evidências obrigatórias e critérios que podem bloquear a conclusão',
    'Vínculo dos checklists publicados aos planos e às ordens de serviço',
  ],
  'plan-approvals': [
    'Planos de manutenção, gatilhos e intervalos',
    'Checklist de execução vinculado ao plano',
    'Validação e publicação de revisões',
  ],
  operations: [
    'Programação e intervenções planejadas ou não planejadas',
    'Ordens de serviço vinculadas a ativos, componentes e checklists',
    'Modo de parada, validações e conclusão da execução',
    'Ocorrências, alertas e etapas do fluxo operacional',
  ],
}

function capabilityModuleBinding(code: string): CapabilityModuleBinding | null {
  return CAPABILITY_MODULE_BINDINGS.find((item) => item.matches(code))?.binding ?? null
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  AUTH_LOGIN_SUCCEEDED: 'Acesso realizado',
  AUTH_LOGOUT: 'Sessão encerrada',
  ADMIN_USER_CREATED: 'Usuário cadastrado',
  ADMIN_USER_UPDATED: 'Usuário atualizado',
  ADMIN_PASSWORD_RESET: 'Credencial redefinida',
  ADMIN_PERMISSION_PROFILE_UPDATED: 'Permissões atualizadas',
}

function presentAuditAction(action: string): string {
  const normalized = action.trim().toUpperCase()
  if (AUDIT_ACTION_LABELS[normalized]) return AUDIT_ACTION_LABELS[normalized]
  if (normalized.includes('PERMISSION')) return 'Permissões atualizadas'
  if (normalized.includes('PASSWORD') || normalized.includes('CREDENTIAL')) return 'Credencial redefinida'
  if (normalized.includes('USER')) return 'Cadastro de usuário atualizado'
  return 'Alteração administrativa registrada'
}

function presentProfile(profile: string): string {
  const normalized = profile.trim().toUpperCase()
  const labels: Record<string, string> = {
    ADMIN: 'TI',
    GESTOR: 'Gestor técnico',
    GESTOR_TECNICO: 'Gestor técnico',
    TECNICO: 'Técnico',
    TECNICO_MANUTENCAO: 'Técnico',
    OPERADOR: 'Operador',
    PCM: 'PCM',
    PRODUCAO: 'Produção',
    QUALIDADE: 'Especialista de Qualidade',
    SEGURANCA: 'Especialista de Segurança',
  }
  return labels[normalized] ?? 'Perfil autorizado'
}

type EditablePermissionProfile = string

const PROFILE_LABELS: Record<AdminUserProfile, string> = {
  ADMIN: 'TI',
  GESTOR: 'Gestor técnico',
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

function hasUserAccessAlert(user: AdminUser): boolean {
  return isUserBlocked(user) || Boolean(user.recuperacao_pendente)
}

function normalizeAttempts(user: AdminUser): number {
  const value = Number(user.tentativas_login ?? 0)
  return Number.isFinite(value) ? value : 0
}

function parseUserAssignments(value?: string): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return value.split(',').map((item) => item.trim()).filter(Boolean)
  }
}

function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*+-_'
  const random = new Uint32Array(20)
  crypto.getRandomValues(random)
  const characters = Array.from(random, (value) => alphabet[value % alphabet.length])
  characters[0] = 'A'
  characters[1] = 'm'
  characters[2] = '7'
  characters[3] = '!'
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = random[index] % (index + 1)
    ;[characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]]
  }
  return characters.join('')
}

interface UserStatusDragSession {
  pointerId: number
  startX: number
  startY: number
  desiredStatus: AdminUserStatus
  targetIds: Set<string>
  moved: boolean
}

function describeCapability(description: string): string {
  return description
    .replaceAll('Administrador', 'Centro de Comando')
    .replaceAll('administrador', 'Centro de Comando')
}

function describePermissionImpact(profile: string, capability: { id: string; nome: string; descricao: string }): string {
  const profileLabel = PROFILE_LABELS[profile as AdminUserProfile] ?? presentProfile(profile)
  const id = capability.id.toLocaleLowerCase('pt-BR')
  const name = capability.nome.toLocaleLowerCase('pt-BR')
  let effect = `perderá acesso a “${capability.nome}”`
  if (id.startsWith('cmms.assets.') && name.includes('consult')) {
    effect = 'deixará de consultar ativos técnicos e seus componentes; as permissões de ordens de serviço e checklists continuam definidas pelas capacidades correspondentes'
  } else if (id.startsWith('maintenance.work-orders.') || name.includes('ordens de serviço')) {
    effect = 'deixará de consultar ou executar as operações de ordem de serviço descritas nesta capacidade'
  } else if (id.startsWith('maintenance.checklists.') || name.includes('checklist')) {
    effect = 'deixará de consultar ou executar as operações de checklist descritas nesta capacidade'
  } else if (id.startsWith('maintenance.plans.') || name.includes('plano de manutenção')) {
    effect = 'deixará de consultar ou executar as operações de plano descritas nesta capacidade'
  }
  return `Ao salvar, ${profileLabel} ${effect}. ${describeCapability(capability.descricao)}`
}

export function AdminPage({
  session,
  onSessionExpired,
  activeModule,
  embedded = false,
  detachedTechnicalPanel,
  detachedTechnicalPanels = [],
  onDetachTechnicalPanel,
  selectedTechnicalAreaId,
  onSelectedTechnicalAreaChange,
  notificationTarget,
  permissionProfileRequest,
  onModuleChange,
  onOpenImportSection,
  onOpenImportZone,
  onRestoreImportZone,
  onOpenImportHistory,
  onOpenImportReimport,
  importReimportRequest,
  importExportRequest,
  onReviewCapability,
  inspectedModule,
  onInspectModule,
  onOpenOperationalModule,
  moduleStatuses = [],
  commercialAccess = null,
  commercialAccessError = '',
  companyName = '',
  userSettingsUser = undefined,
  userCredentialReceipt,
  userSettingsSection = 'identity',
  onOpenUserSettings,
  onCloseUserSettings,
  onUserSaved,
  onOpenCredentialDelivery,
  onPasswordResetSuccess,
  userDataRevision = 0,
}: AdminPageProps) {
  const [internalModule, setInternalModule] = useState<AdminModule>('overview')
  const tab = activeModule ?? internalModule
  const setTab = (module: AdminModule) => {
    setInternalModule(module)
    onModuleChange?.(module)
  }
  const [users, setUsers] = useState<AdminUser[]>([])
  const [userBulkImportOpen, setUserBulkImportOpen] = useState(false)
  const [permissionMatrix, setPermissionMatrix] = useState<AdminPermissionMatrix | null>(null)
  const [savedPermissionMatrix, setSavedPermissionMatrix] = useState<AdminPermissionMatrix | null>(null)
  const [selectedPermissionProfile, setSelectedPermissionProfile] = useState<EditablePermissionProfile>('GESTOR')
  const [permissionSearch, setPermissionSearch] = useState('')
  const [permissionStateFilter, setPermissionStateFilter] = useState<'all' | 'on' | 'off'>('all')
  const lastPermissionProfileRequestRef = useRef<number | null>(null)
  const [monitoring, setMonitoring] = useState<AdminMonitoringState | null>(null)
  const [monitoringError, setMonitoringError] = useState('')
  const [monitoringRefreshing, setMonitoringRefreshing] = useState(false)
  const [expandedImpactModule, setExpandedImpactModule] = useState<string>('')
  const [recentAuditEvents, setRecentAuditEvents] = useState<AdminAuditEvent[]>([])
  const [auditError, setAuditError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<AdminUserStatus | ''>('')
  const [alertsOnly, setAlertsOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [savingPermissions, setSavingPermissions] = useState(false)
  const [profileCreateOpen, setProfileCreateOpen] = useState(false)
  const [profileDraftName, setProfileDraftName] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [provisioningDefaultProfiles, setProvisioningDefaultProfiles] = useState(false)
  const defaultProfilesProvisionAttempted = useRef(false)
  const [actionUserId, setActionUserId] = useState('')
  const [savingUserStatuses, setSavingUserStatuses] = useState(false)
  const [statusDragActive, setStatusDragActive] = useState(false)
  const [bulkStatusPreview, setBulkStatusPreview] = useState<{ status: AdminUserStatus; ids: string[] } | null>(null)
  const [bulkStatusConfirm, setBulkStatusConfirm] = useState<{ status: AdminUserStatus; ids: string[] } | null>(null)
  const userStatusDragRef = useRef<UserStatusDragSession | null>(null)
  const suppressStatusClickRef = useRef(false)
  const [expandedUserId, setExpandedUserId] = useState('')
  const [expandedUserDetailTab, setExpandedUserDetailTab] = useState<'identity' | 'assignments' | 'security'>('identity')
  const [userAudit, setUserAudit] = useState<Record<string, AdminAuditEvent[]>>({})
  const [userAuditTotals, setUserAuditTotals] = useState<Record<string, number>>({})
  const [userAuditLoading, setUserAuditLoading] = useState('')
  const [expandedAuditUserId, setExpandedAuditUserId] = useState('')
  const [technicalAreas, setTechnicalAreas] = useState<TechnicalArea[]>([])
  const [technicalRoles, setTechnicalRoles] = useState<TechnicalRole[]>([])
  const [scopeCatalog, setScopeCatalog] = useState<{ plants: AdminEntityRecord[]; sectors: AdminEntityRecord[]; lines: AdminEntityRecord[] }>({ plants: [], sectors: [], lines: [] })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadData = useCallback(async (signal?: AbortSignal) => {
    const [nextUsers, nextMatrix] = await Promise.all([
      listAdminUsers({}, signal),
      getAdminPermissionMatrix(signal),
    ])
    setUsers(nextUsers)
    setPermissionMatrix(nextMatrix)
    setSavedPermissionMatrix(nextMatrix)
    setSelectedPermissionProfile((current) => nextMatrix.perfis.some((item) => item.perfil === current && item.editavel)
      ? current : nextMatrix.perfis.find((item) => item.editavel)?.perfil ?? '')
  }, [])

  useEffect(() => {
    if (['configuration', 'imports', 'structure', 'assets', 'checklists', 'maintenance', 'plan-approvals', 'inventory', 'workforce', 'operations', 'analytics', 'documents', 'governance', 'backup'].includes(tab) || tab.startsWith('user-settings:')) {
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
        setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o Centro de Comando.')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [loadData, onSessionExpired, tab, userDataRevision])

  useEffect(() => {
    if (tab !== 'permissions' || !permissionMatrix || defaultProfilesProvisionAttempted.current) return
    const selectableProfiles = permissionMatrix.perfis.filter((profile) => profile.roleType?.toLocaleUpperCase('pt-BR') !== 'ADMIN' && profile.perfil.toLocaleUpperCase('pt-BR') !== 'ADMIN')
    if (selectableProfiles.some((profile) => profile.editavel)) {
      defaultProfilesProvisionAttempted.current = true
      return
    }
    defaultProfilesProvisionAttempted.current = true
    setProvisioningDefaultProfiles(true)
    void provisionDefaultAdminPermissionProfiles().then((matrix) => {
      setPermissionMatrix(matrix)
      setSavedPermissionMatrix(matrix)
      const firstEditable = matrix.perfis.find((profile) => profile.roleType?.toLocaleUpperCase('pt-BR') !== 'ADMIN' && profile.perfil.toLocaleUpperCase('pt-BR') !== 'ADMIN' && profile.editavel)
      setSelectedPermissionProfile(firstEditable?.perfil ?? '')
      setNotice(firstEditable ? 'Perfis padrão prontos.' : 'A API não retornou perfis operacionais. Verifique se o servidor foi atualizado.')
    }).catch((cause: unknown) => {
      defaultProfilesProvisionAttempted.current = false
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      const message = cause instanceof Error ? cause.message : ''
      setError(/404|rota não encontrada|route not found/i.test(message)
        ? 'A API ativa ainda não reconhece a preparação de perfis. Atualize e reinicie o servidor da empresa e tente novamente.'
        : message || 'Não foi possível preparar os perfis padrão.')
    }).finally(() => setProvisioningDefaultProfiles(false))
  }, [onSessionExpired, permissionMatrix, tab])

  const visibleUsers = useMemo(() => {
    const term = search.trim().toLowerCase()
    return users.filter((user) => {
      if (statusFilter && user.status !== statusFilter) return false
      if (alertsOnly && !hasUserAccessAlert(user)) return false
      if (!term) return true
      return [user.nome, user.email, user.matricula, user.id]
        .some((value) => value.toLowerCase().includes(term))
    })
  }, [alertsOnly, search, statusFilter, users])

  const metrics = useMemo(() => ({
    total: users.length,
    active: users.filter((user) => user.status === 'ATIVO').length,
    inactive: users.filter((user) => user.status !== 'ATIVO').length,
    blocked: users.filter(hasUserAccessAlert).length,
  }), [users])
  const isUserSettingsModule = tab.startsWith('user-settings:')

  const capabilityImpacts = useMemo(() => {
    const grouped = new Map<string, {
      binding: CapabilityModuleBinding
      available: boolean | null
      enabled: Array<{
        capabilityId: string
        capability: string
        description: string
        profiles: Array<{ profile: string; label: string }>
      }>
    }>()
    for (const profile of permissionMatrix?.perfis ?? []) {
      for (const capability of profile.capacidades) {
        if (!capability.permitido) continue
        const binding = capabilityModuleBinding(capability.id)
        if (!binding) continue
        const moduleStatus = moduleStatuses.find((item) => item.module === binding.module)
        const available = commercialAccess && moduleStatus ? moduleStatus.available : commercialAccess
          ? commercialAccess.status === 'ATIVA' && commercialAccess.recursos.some((resource) => resource.codigo === binding.feature)
          : null
        const group = grouped.get(binding.module) ?? { binding, available, enabled: [] }
        const enabledCapability = group.enabled.find((item) => item.capabilityId === capability.id)
        const canonicalProfileLabel = PROFILE_LABELS[profile.perfil as AdminUserProfile] ?? presentProfile(profile.perfil)
        const profileLabel = canonicalProfileLabel === 'Perfil autorizado' ? profile.nome ?? canonicalProfileLabel : canonicalProfileLabel
        if (enabledCapability) {
          if (!enabledCapability.profiles.some((item) => item.profile === profile.perfil)) {
            enabledCapability.profiles.push({ profile: profile.perfil, label: profileLabel })
          }
        } else {
          group.enabled.push({
            capabilityId: capability.id,
            capability: capability.nome,
            description: capability.descricao,
            profiles: [{ profile: profile.perfil, label: profileLabel }],
          })
        }
        grouped.set(binding.module, group)
      }
    }
    return [...grouped.values()].sort((first, second) => {
      const firstIssue = first.available === false ? 0 : 1
      const secondIssue = second.available === false ? 0 : 1
      return firstIssue - secondIssue || first.binding.label.localeCompare(second.binding.label, 'pt-BR')
    })
  }, [commercialAccess, moduleStatuses, permissionMatrix])
  const inspectedModuleData = useMemo(() => {
    if (!inspectedModule || !permissionMatrix) return null
    const binding = CAPABILITY_MODULE_BINDINGS.find((item) => item.binding.module === inspectedModule)?.binding
    if (!binding) return null
    const capabilities = new Map<string, {
      id: string
      name: string
      description: string
      protectedOperations: number
      profiles: Array<{ id: string; label: string; enabled: boolean }>
    }>()
    for (const profile of permissionMatrix.perfis) {
      for (const capability of profile.capacidades) {
        if (capabilityModuleBinding(capability.id)?.module !== inspectedModule) continue
        const item = capabilities.get(capability.id) ?? {
          id: capability.id,
          name: capability.nome,
          description: capability.descricao,
          protectedOperations: capability.acoes.length,
          profiles: [],
        }
        item.profiles.push({
          id: profile.perfil,
          label: PROFILE_LABELS[profile.perfil as AdminUserProfile] ?? presentProfile(profile.perfil),
          enabled: capability.permitido,
        })
        capabilities.set(capability.id, item)
      }
    }
    const impact = capabilityImpacts.find((item) => item.binding.module === inspectedModule)
    return {
      binding,
      available: impact?.available ?? null,
      composition: MODULE_COMPOSITION[inspectedModule] ?? [],
      capabilities: [...capabilities.values()].sort((first, second) => first.name.localeCompare(second.name, 'pt-BR')),
    }
  }, [capabilityImpacts, inspectedModule, permissionMatrix])
  const runtimeCapabilities = useMemo(() => new Map(
    (monitoring?.telemetria?.modules ?? []).flatMap((module) => module.capabilities.map((capability) => [capability.capability, { ...capability, module: module.module }] as const)),
  ), [monitoring])
  const runtimeAlerts = useMemo(
    () => [...runtimeCapabilities.values()].filter((item) => item.state === 'WARNING' || item.state === 'CRITICAL'),
    [runtimeCapabilities],
  )
  const runtimeCallCount = [...runtimeCapabilities.values()].reduce((sum, item) => sum + item.calls, 0)
  const runtimeServerErrors = [...runtimeCapabilities.values()].reduce((sum, item) => sum + item.serverErrors, 0)
  const diagnosticFindings = useMemo(() => {
    type Finding = {
      key: string
      module: AdminModule | null
      moduleLabel: string
      capabilityId: string
      capability: string
      profiles: Array<{ profile: string; label: string }>
      planConflict: boolean
      telemetry: (typeof runtimeAlerts)[number] | null
    }
    const findings = new Map<string, Finding>()
    for (const impact of capabilityImpacts) {
      for (const capability of impact.enabled) {
        const telemetry = runtimeCapabilities.get(capability.capabilityId)
        const isTelemetryAlert = telemetry?.state === 'WARNING' || telemetry?.state === 'CRITICAL'
        if (impact.available !== false && !isTelemetryAlert) continue
        findings.set(capability.capabilityId, {
          key: capability.capabilityId,
          module: impact.binding.module,
          moduleLabel: impact.binding.label,
          capabilityId: capability.capabilityId,
          capability: capability.capability,
          profiles: [...capability.profiles],
          planConflict: impact.available === false,
          telemetry: isTelemetryAlert ? telemetry : null,
        })
      }
    }
    for (const telemetry of runtimeAlerts) {
      const finding = findings.get(telemetry.capability)
      if (finding) {
        finding.telemetry = telemetry
        continue
      }
      const binding = capabilityModuleBinding(telemetry.capability)
      const capability = permissionMatrix?.perfis.flatMap((profile) => profile.capacidades).find((item) => item.id === telemetry.capability)
      const profiles = permissionMatrix?.perfis
        .filter((profile) => profile.capacidades.some((item) => item.id === telemetry.capability && item.permitido))
        .map((profile) => ({
          profile: profile.perfil,
          label: PROFILE_LABELS[profile.perfil as AdminUserProfile] ?? (presentProfile(profile.perfil) === 'Perfil autorizado' ? profile.nome ?? 'Perfil autorizado' : presentProfile(profile.perfil)),
        })) ?? []
      findings.set(telemetry.capability, {
        key: telemetry.capability,
        module: binding?.module ?? null,
        moduleLabel: binding?.label ?? telemetry.module,
        capabilityId: telemetry.capability,
        capability: capability?.nome ?? 'Capacidade monitorada',
        profiles,
        planConflict: false,
        telemetry,
      })
    }
    return [...findings.values()].sort((first, second) => {
      const firstRank = first.telemetry?.state === 'CRITICAL' ? 0 : first.planConflict ? 1 : 2
      const secondRank = second.telemetry?.state === 'CRITICAL' ? 0 : second.planConflict ? 1 : 2
      return firstRank - secondRank || first.moduleLabel.localeCompare(second.moduleLabel, 'pt-BR') || first.capability.localeCompare(second.capability, 'pt-BR')
    })
  }, [capabilityImpacts, permissionMatrix, runtimeAlerts, runtimeCapabilities])
  const permissionConflictCount = capabilityImpacts.reduce((count, impact) => count + (impact.available === false ? impact.enabled.length : 0), 0)

  function reviewCapability(profile: string, capabilityName: string) {
    if (onReviewCapability) {
      onReviewCapability(profile, capabilityName)
      return
    }
    setSelectedPermissionProfile(profile)
    setPermissionSearch(capabilityName)
    setPermissionStateFilter('all')
    setTab('permissions')
  }

  function openModule(module: AdminModule) {
    onInspectModule?.(module)
  }

  async function toggleUserDetails(user: AdminUser) {
    if (expandedUserId === user.id) {
      setExpandedUserId('')
      return
    }
    setExpandedUserId(user.id)
    setExpandedUserDetailTab('identity')
    if (Object.prototype.hasOwnProperty.call(userAudit, user.id)) return
    setUserAuditLoading(user.id)
    try {
      const result = await listAdminAudit({ usuario_id: user.id })
      setUserAudit((current) => ({ ...current, [user.id]: result.eventos }))
      setUserAuditTotals((current) => ({ ...current, [user.id]: result.total }))
    } catch {
      setUserAudit((current) => ({ ...current, [user.id]: [] }))
      setUserAuditTotals((current) => ({ ...current, [user.id]: 0 }))
    } finally {
      setUserAuditLoading('')
    }
  }

  useEffect(() => {
    if (tab !== 'users') return undefined
    const controller = new AbortController()
    void Promise.all([
      listTechnicalAreas(controller.signal),
      listTechnicalRoles('', controller.signal),
      listAdminEntity('plantas', controller.signal),
      listAdminEntity('setores', controller.signal),
      listAdminEntity('linhas', controller.signal),
    ])
      .then(([nextAreas, nextRoles, plants, sectors, lines]) => {
        if (controller.signal.aborted) return
        setTechnicalAreas(nextAreas)
        setTechnicalRoles(nextRoles)
        setScopeCatalog({ plants: plants.rows, sectors: sectors.rows, lines: lines.rows })
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setTechnicalAreas([])
          setTechnicalRoles([])
          setScopeCatalog({ plants: [], sectors: [], lines: [] })
        }
      })
    return () => controller.abort()
  }, [tab])

  const selectedPermissions = permissionMatrix?.perfis.find(
    (profile) => profile.perfil === selectedPermissionProfile,
  )
  const savedSelectedPermissions = savedPermissionMatrix?.perfis.find(
    (profile) => profile.perfil === selectedPermissionProfile,
  )
  const selectedPermissionChanges = selectedPermissions?.capacidades.filter((capability) => (
    capability.permitido !== savedSelectedPermissions?.capacidades.find((saved) => saved.id === capability.id)?.permitido
  )) ?? []
  const hasUnsavedPermissionChanges = (permissionMatrix?.perfis ?? []).some((profile) => {
    const savedProfile = savedPermissionMatrix?.perfis.find((saved) => saved.perfil === profile.perfil)
    return profile.capacidades.some((capability) => (
      capability.permitido !== savedProfile?.capacidades.find((saved) => saved.id === capability.id)?.permitido
    ))
  })

  const filteredCapabilities = useMemo(() => {
    const term = permissionSearch.trim().toLocaleLowerCase('pt-BR')
    return (selectedPermissions?.capacidades ?? []).filter((capability) => {
      if (permissionStateFilter === 'on' && !capability.permitido) return false
      if (permissionStateFilter === 'off' && capability.permitido) return false
      if (!term) return true
      return `${capability.nome} ${capability.descricao} ${capability.id} ${capability.acoes.join(' ')}`
        .toLocaleLowerCase('pt-BR').includes(term)
    })
  }, [permissionSearch, permissionStateFilter, selectedPermissions])

  useEffect(() => {
    if (tab !== 'permissions' || !permissionMatrix || !permissionProfileRequest) return
    if (lastPermissionProfileRequestRef.current === permissionProfileRequest.requestId) return
    const requestedProfile = permissionMatrix.perfis.find((profile) => (
      profile.perfil === permissionProfileRequest.profile
    ))
    if (!requestedProfile) return
    lastPermissionProfileRequestRef.current = permissionProfileRequest.requestId
    setSelectedPermissionProfile(requestedProfile.perfil)
    setPermissionSearch(permissionProfileRequest.capabilityName ?? '')
    setPermissionStateFilter('all')
  }, [permissionMatrix, permissionProfileRequest, tab])

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

  async function resetUserPassword(user: AdminUser) {
    setActionUserId(user.id)
    setError('')
    setNotice('')
    const temporaryPassword = generateTemporaryPassword()
    try {
      await resetAdminUserPassword(user.id, temporaryPassword)
      const specialtyValues = parseUserAssignments(user.especialidades_json)
      const scopeValues = parseUserAssignments(user.escopo_ids_json).map((id) => {
        const sector = scopeCatalog.sectors.find((item) => item.id === id)
        if (sector) {
          const plant = scopeCatalog.plants.find((item) => item.id === String(sector.planta_id ?? ''))
          return [plant?.nome, sector.nome].filter(Boolean).join(' · ')
        }
        const line = scopeCatalog.lines.find((item) => item.id === id)
        if (line) {
          const parentSector = scopeCatalog.sectors.find((item) => item.id === String(line.setor_id ?? ''))
          const plant = scopeCatalog.plants.find((item) => item.id === String(parentSector?.planta_id ?? ''))
          return [plant?.nome, parentSector?.nome, line.nome].filter(Boolean).join(' · ')
        }
        return ''
      }).filter(Boolean)
      const receipt: AccountCredentialReceipt = {
        name: user.nome,
        email: user.email,
        registration: user.matricula,
        password: temporaryPassword,
        profile: PROFILE_LABELS[user.perfil as AdminUserProfile] ?? presentProfile(user.perfil),
        area: technicalAreas.find((area) => area.id === user.area_id)?.nome ?? '',
        role: technicalRoles.find((role) => role.id === user.cargo_id)?.nome ?? '',
        specialties: specialtyValues,
        scope: scopeValues,
        passwordReset: true,
      }
      await refresh()
      onOpenCredentialDelivery?.(user, receipt)
      onPasswordResetSuccess?.(user.nome)
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setError(cause instanceof Error ? cause.message : 'Não foi possível redefinir a senha.')
    } finally {
      setActionUserId('')
    }
  }

  async function applyUserStatusChanges(userIds: string[], nextStatus: AdminUserStatus) {
    const targets = users.filter((user) => userIds.includes(user.id) && user.id !== session.user.id && user.status !== nextStatus)
    if (!targets.length) return
    setSavingUserStatuses(true)
    setError('')
    setNotice('')
    const failures: string[] = []
    let savedCount = 0
    try {
      for (const user of targets) {
        try {
          await saveAdminUser({
            id: user.id,
            nome: user.nome,
            email: user.email,
            matricula: user.matricula,
            perfil: user.perfil,
            status: nextStatus,
            area_id: user.area_id ?? '',
            cargo_id: user.cargo_id ?? '',
            especialidades: parseUserAssignments(user.especialidades_json),
            escopo_ids: parseUserAssignments(user.escopo_ids_json),
          })
          savedCount += 1
        } catch (cause) {
          if (isGestorAuthenticationError(cause)) {
            onSessionExpired()
            break
          }
          failures.push(`${user.nome}: ${cause instanceof Error ? cause.message : 'falha ao salvar'}`)
        }
      }
      if (savedCount) await loadData()
      if (failures.length) {
        setError(`${savedCount} de ${targets.length} contas alteradas. ${failures.join(' · ')}`)
      } else if (savedCount) {
        setNotice(`${savedCount} conta(s) ${nextStatus === 'ATIVO' ? 'ativada(s)' : 'desativada(s)'}.`)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar as contas.')
    } finally {
      setSavingUserStatuses(false)
      setBulkStatusPreview(null)
    }
  }

  function beginUserStatusDrag(event: ReactPointerEvent<HTMLButtonElement>, user: AdminUser) {
    if (user.id === session.user.id || savingUserStatuses || actionUserId) return
    const desiredStatus: AdminUserStatus = user.status === 'ATIVO' ? 'INATIVO' : 'ATIVO'
    userStatusDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      desiredStatus,
      targetIds: new Set([user.id]),
      moved: false,
    }
    setStatusDragActive(true)
  }

  useEffect(() => {
    if (!statusDragActive) return undefined
    const onPointerMove = (event: PointerEvent) => {
      const drag = userStatusDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      if (!drag.moved && Math.abs(event.clientY - drag.startY) >= 7) drag.moved = true
      if (!drag.moved) return
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-user-status-id]')
      const targetId = target?.dataset.userStatusId
      const targetUser = targetId ? users.find((user) => user.id === targetId) : undefined
      if (!targetUser || targetUser.id === session.user.id || targetUser.status === drag.desiredStatus || drag.targetIds.has(targetUser.id)) return
      drag.targetIds.add(targetUser.id)
      setBulkStatusPreview({ status: drag.desiredStatus, ids: [...drag.targetIds] })
    }
    const finishPointer = (event: PointerEvent) => {
      const drag = userStatusDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      userStatusDragRef.current = null
      setStatusDragActive(false)
      if (!drag.moved) return
      suppressStatusClickRef.current = true
      const request = { status: drag.desiredStatus, ids: [...drag.targetIds] }
      setBulkStatusPreview(request)
      if (request.ids.length > 1) setBulkStatusConfirm(request)
      else void applyUserStatusChanges(request.ids, request.status)
    }
    const cancelPointer = (event: PointerEvent) => {
      if (userStatusDragRef.current?.pointerId !== event.pointerId) return
      userStatusDragRef.current = null
      setStatusDragActive(false)
      setBulkStatusPreview(null)
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', finishPointer)
    window.addEventListener('pointercancel', cancelPointer)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', finishPointer)
      window.removeEventListener('pointercancel', cancelPointer)
    }
  }, [statusDragActive, users, session.user.id])

  const loadOverviewData = useCallback(async (signal?: AbortSignal) => {
    const [monitoringResult, auditResult] = await Promise.allSettled([
      getAdminMonitoring(signal),
      listAdminAudit({ acao: 'ADMIN_PERMISSION_MATRIX_UPDATED', limite: 6 }, signal),
    ] as const)
    if (signal?.aborted) return

    if (monitoringResult.status === 'fulfilled') {
      setMonitoring(monitoringResult.value)
      setMonitoringError('')
    } else if (isGestorAuthenticationError(monitoringResult.reason)) {
      onSessionExpired()
      return
    } else {
      setMonitoringError('A verificação não respondeu. Tente novamente.')
    }

    if (auditResult.status === 'fulfilled') {
      setRecentAuditEvents(auditResult.value.eventos)
      setAuditError('')
    } else if (isGestorAuthenticationError(auditResult.reason)) {
      onSessionExpired()
    } else {
      setAuditError('Atividade recente indisponível.')
    }
  }, [onSessionExpired])

  async function refreshMonitoringNow() {
    setMonitoringRefreshing(true)
    try {
      await loadOverviewData()
    } finally {
      setMonitoringRefreshing(false)
    }
  }

  useAutoRefresh(
    () => refresh(),
    {
      enabled:
        ['overview', 'users', 'permissions'].includes(tab) &&
        !hasUnsavedPermissionChanges &&
        !actionUserId &&
        !savingUserStatuses,
      intervalMs: 20_000,
    },
  )

  useEffect(() => {
    if (tab !== 'overview') return undefined
    const controller = new AbortController()
    void loadOverviewData(controller.signal)
    const timer = window.setInterval(() => void loadOverviewData(controller.signal), 20_000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [loadOverviewData, tab])

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
      setSavedPermissionMatrix((current) => {
        if (!current) return current
        return {
          ...current,
          perfis: current.perfis.map((profile) => (
            profile.perfil === result.matriz.perfil ? result.matriz : profile
          )),
        }
      })
      setNotice(`Permissões do perfil ${selectedPermissionProfile} atualizadas e auditadas.`)
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

  async function createPermissionProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (profileDraftName.trim().length < 3 || savingProfile) return
    setSavingProfile(true)
    setError('')
    try {
      const result = await createAdminPermissionProfile(profileDraftName.trim())
      const matrix = await getAdminPermissionMatrix()
      setPermissionMatrix(matrix)
      setSavedPermissionMatrix(matrix)
      setSelectedPermissionProfile(result.perfil.perfil)
      setProfileDraftName('')
      setProfileCreateOpen(false)
      setNotice(`Perfil “${result.perfil.nome ?? result.perfil.perfil}” criado. As permissões começam desligadas; configure e salve as necessárias.`)
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setError(cause instanceof Error ? cause.message : 'Não foi possível criar o perfil de acesso.')
    } finally {
      setSavingProfile(false)
    }
  }

  async function retryDefaultPermissionProfiles() {
    if (provisioningDefaultProfiles) return
    defaultProfilesProvisionAttempted.current = true
    setProvisioningDefaultProfiles(true)
    setError('')
    try {
      const matrix = await provisionDefaultAdminPermissionProfiles()
      setPermissionMatrix(matrix)
      setSavedPermissionMatrix(matrix)
      const firstEditable = matrix.perfis.find((profile) => profile.roleType?.toLocaleUpperCase('pt-BR') !== 'ADMIN' && profile.perfil.toLocaleUpperCase('pt-BR') !== 'ADMIN' && profile.editavel)
      setSelectedPermissionProfile(firstEditable?.perfil ?? '')
      setNotice(firstEditable ? 'Perfis predefinidos adicionados.' : 'A API não retornou perfis operacionais. Verifique se o servidor foi atualizado.')
    } catch (cause) {
      defaultProfilesProvisionAttempted.current = false
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      const message = cause instanceof Error ? cause.message : ''
      setError(/404|rota não encontrada|route not found/i.test(message)
        ? 'A API ativa ainda não reconhece a preparação de perfis. Atualize e reinicie o servidor da empresa e tente novamente.'
        : message || 'Não foi possível preparar os perfis padrão.')
    } finally {
      setProvisioningDefaultProfiles(false)
    }
  }

  if (loading) {
    return <div className="dashboard-loading">Carregando Centro de Comando…</div>
  }

  return (
    <main className={embedded ? 'admin-workspace-module' : 'content admin-page'}>
      {!embedded ? (
        <>
          <section className="admin-mobile-block">
            <ShieldIcon />
            <h1>Centro de Comando VORQIX</h1>
            <p>O ambiente administrativo foi protegido para uso em computador. Acesse em uma tela com pelo menos 901 px de largura.</p>
          </section>
          <section className="page-heading">
            <div>
              <span className="eyebrow">TI E GOVERNANÇA</span>
              <h1>Centro de Comando VORQIX</h1>
              <p>Configuração versionada, identidades e capacidades com proteção de runtime e trilha de auditoria.</p>
            </div>
          </section>
        </>
      ) : null}

      {error ? <div className="dashboard-error" role="alert"><strong>Falha administrativa.</strong><span>{error}</span></div> : null}
      {notice ? <div className="dashboard-notice" role="status">{notice}</div> : null}

      {!embedded ? <section className="admin-tabs" role="tablist" aria-label="Centro de Comando">
        <button type="button" role="tab" aria-selected={tab === 'overview'} className={tab === 'overview' ? 'is-active' : ''} onClick={() => setTab('overview')}>
          <SettingsIcon /> Visão geral
        </button>
        <button type="button" role="tab" aria-selected={tab === 'configuration'} className={tab === 'configuration' ? 'is-active' : ''} onClick={() => setTab('configuration')}>
          <SettingsIcon /> Configurações avançadas
        </button>
        <button type="button" role="tab" aria-selected={tab === 'imports'} className={tab === 'imports' ? 'is-active' : ''} onClick={() => setTab('imports')}>
          <SettingsIcon /> Importação
        </button>
        <button type="button" role="tab" aria-selected={tab === 'users'} className={tab === 'users' ? 'is-active' : ''} onClick={() => setTab('users')}>
          <UsersIcon /> Usuários
        </button>
        <button type="button" role="tab" aria-selected={tab === 'permissions'} className={tab === 'permissions' ? 'is-active' : ''} onClick={() => setTab('permissions')}>
          <ShieldIcon /> Configurações de acesso
        </button>
      </section> : null}

      {tab === 'overview' ? (
        <section className="admin-command-overview" role="tabpanel">
          <section className="command-system-panel" aria-labelledby="command-system-title">
            <header className="command-system-header">
              <div>
                <h2 id="command-system-title">Integridade e desempenho</h2>
              <p>{[companyName || 'Empresa atual', commercialAccess?.plano.nome ? `Plano ${commercialAccess.plano.nome}` : 'Plano não identificado'].join(' · ')}</p>
              </div>
              <span className={`command-system-status${monitoring?.health.ok && !runtimeAlerts.some((item) => item.state === 'CRITICAL') && commercialAccess && permissionConflictCount === 0 && permissionMatrix ? ' is-ok' : commercialAccessError || permissionConflictCount || runtimeAlerts.length || monitoring?.health.ok === false ? ' is-warning' : ''}`} role="status">
                <i aria-hidden="true" />
                {monitoring?.health.ok === false ? 'Serviço ou armazenamento indisponível' : runtimeAlerts.some((item) => item.state === 'CRITICAL') ? `${runtimeAlerts.filter((item) => item.state === 'CRITICAL').length} capacidade(s) crítica(s)` : permissionConflictCount ? `${permissionConflictCount} capacidade(s) fora do plano` : commercialAccessError ? 'Plano indisponível' : !permissionMatrix ? 'Carregando permissões' : runtimeAlerts.length ? `${runtimeAlerts.length} alerta(s) automático(s)` : commercialAccess && monitoring?.health.ok ? 'Sistema operante' : 'Verificando integridade'}
              </span>
            </header>
            {commercialAccessError ? <div className="command-system-error" role="alert">Não foi possível comparar as permissões com os recursos do plano. {commercialAccessError}</div> : null}
            {monitoringError ? <div className="command-system-error" role="status">A telemetria não respondeu; a matriz de permissões continua disponível.</div> : null}
            <div className="command-system-metrics">
              <article>
                <span>Funcionamento do sistema</span>
                <strong>{monitoring?.health.ok ? 'Operante' : monitoring ? 'Indisponível' : 'Verificando'}</strong>
              </article>
              <article>
                <span>Conflitos encontrados</span>
                <strong>{commercialAccess ? permissionConflictCount : '—'}</strong>
              </article>
              <article>
                <span>Capacidades com alerta</span>
                <strong>{runtimeAlerts.length}</strong>
              </article>
              <article>
                <span>Chamadas da empresa · últimos 15 min</span>
                <strong>{runtimeCallCount}</strong>
              </article>
              <article>
                <span>Erros de serviço · 15 min</span>
                <strong>{runtimeServerErrors}</strong>
              </article>
            </div>
            <section className="command-diagnostic-backlog" aria-labelledby="command-diagnostic-backlog-title">
              <header>
                <strong id="command-diagnostic-backlog-title">Fila de diagnóstico</strong>
                <span>{diagnosticFindings.length} achado(s) · empresa atual</span>
              </header>
              {diagnosticFindings.length ? (
                <div>
                  {diagnosticFindings.map((finding) => (
                    <article className={finding.telemetry?.state === 'CRITICAL' || finding.planConflict ? 'is-critical' : 'is-warning'} key={finding.key}>
                      <div className="command-finding-badges">
                        {finding.telemetry ? <span className="command-finding-severity">{finding.telemetry.state === 'CRITICAL' ? 'Alerta crítico automático' : 'Alerta automático'}</span> : null}
                        {finding.planConflict ? <span className="command-finding-severity is-plan">Acesso fora do plano</span> : null}
                      </div>
                      <strong>{finding.moduleLabel} · {finding.capability}</strong>
                      <small>
                        {[
                          finding.planConflict ? 'A permissão está ativa, mas não está liberada pelo plano atual.' : '',
                          finding.telemetry ? `${finding.telemetry.calls} chamadas · p95 ${finding.telemetry.p95Ms} ms · ${finding.telemetry.serverErrors} falhas 5xx` : '',
                        ].filter(Boolean).join(' ')}
                      </small>
                      {finding.profiles.length ? (
                        <div className="command-profile-tags" aria-label="Perfis com a capacidade ativa">
                          {finding.profiles.map((profile) => (
                            <button key={profile.profile} type="button" onClick={() => reviewCapability(profile.profile, finding.capability)} title={`Abrir ${profile.label} na matriz de permissões`}>
                              {profile.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <div className="command-finding-actions">
                        {finding.profiles[0] ? <button type="button" onClick={() => reviewCapability(finding.profiles[0].profile, finding.capability)}>Investigar acesso</button> : null}
                        {finding.module ? <button type="button" onClick={() => openModule(finding.module as AdminModule)}>Abrir módulo</button> : null}
                      </div>
                    </article>
                  ))}
                </div>
              ) : <p>Nenhuma divergência de plano ou alerta automático para esta empresa.</p>}
            </section>
            <section className="command-system-modules" aria-labelledby="command-system-modules-title">
              <header>
                <strong id="command-system-modules-title" title="Indicadores calculados automaticamente com base nos perfis e na telemetria recente">Módulos e capacidades</strong>
              </header>
              {!permissionMatrix ? <p className="command-impact-empty">Carregando a matriz de capacidades…</p> : !capabilityImpacts.length ? (
                <p className="command-impact-empty">Nenhuma capacidade habilitada está vinculada a módulos conhecidos.</p>
              ) : (
                <div className="command-system-module-list" id="command-system-module-list">
                  {capabilityImpacts.map((impact) => {
                    const expanded = expandedImpactModule === impact.binding.module
                    const conflict = impact.available === false
                    const enabledProfiles = new Set(impact.enabled.flatMap((item) => item.profiles.map((profile) => profile.profile))).size
                    const moduleCapabilities = impact.enabled.map((item) => runtimeCapabilities.get(item.capabilityId)).filter((item) => item !== undefined)
                    const moduleAlertCount = moduleCapabilities.filter((item) => item.state === 'WARNING' || item.state === 'CRITICAL').length
                    const moduleRuntimeState = moduleCapabilities.some((item) => item.state === 'CRITICAL') ? 'CRITICAL' : moduleCapabilities.some((item) => item.state === 'WARNING') ? 'WARNING' : null
                    return (
                      <article key={impact.binding.module} className={conflict ? 'is-restricted' : moduleRuntimeState === 'CRITICAL' ? 'is-critical' : moduleRuntimeState === 'WARNING' ? 'is-warning' : impact.available === true ? 'is-available' : 'is-unverified'}>
                        <button className="command-impact-module" type="button" aria-expanded={expanded} onClick={() => setExpandedImpactModule(expanded ? '' : impact.binding.module)}>
                          <span className="command-impact-module__main">
                            <strong>{impact.binding.label}</strong>
                            <small>{impact.enabled.length} capacidade(s) · {enabledProfiles} perfil(is) · {moduleAlertCount} alerta(s)</small>
                          </span>
                          <span className="command-impact-module__state">{conflict ? 'Conflito de plano' : moduleRuntimeState === 'CRITICAL' ? 'Alerta de desempenho' : moduleRuntimeState === 'WARNING' ? 'Desempenho com alerta' : impact.available ? 'Operante' : 'Plano não verificado'}</span>
                          <i aria-hidden="true">{expanded ? '−' : '+'}</i>
                        </button>
                        {expanded ? (
                          <div className="command-impact-capabilities">
                            <div className="command-impact-diagnosis">
                              <span><strong>Acesso</strong><small>{impact.enabled.length} capacidades habilitadas em {enabledProfiles} perfis</small></span>
                              <span><strong>Plano</strong><small>{conflict ? `O recurso necessário para ${impact.binding.label} não está disponível` : impact.available ? 'Recurso correspondente disponível' : 'Disponibilidade do plano não confirmada'}</small></span>
                              <span><strong>Telemetria automática</strong><small>{moduleCapabilities.length ? `${moduleCapabilities.reduce((sum, item) => sum + item.calls, 0)} chamada(s) nos últimos 15 min · pior p95 ${Math.max(...moduleCapabilities.map((item) => item.p95Ms))} ms · ${moduleCapabilities.reduce((sum, item) => sum + item.serverErrors, 0)} erro(s) 5xx` : 'Sem chamadas nos últimos 15 min'}</small></span>
                            </div>
                            {impact.enabled.map((item) => (
                              (() => {
                                const runtime = runtimeCapabilities.get(item.capabilityId)
                                const telemetryIssue = runtime?.state === 'WARNING' || runtime?.state === 'CRITICAL'
                                return <div className={`command-impact-capability${runtime?.state === 'CRITICAL' ? ' is-critical' : telemetryIssue ? ' is-warning' : ''}`} key={item.capabilityId}>
                                <div className="command-impact-capability__identity">
                                  <strong>{item.capability}</strong>
                                  <span className="command-profile-tags" aria-label="Perfis com acesso ativo">
                                    {item.profiles.map((profile) => <button key={profile.profile} type="button" onClick={() => reviewCapability(profile.profile, item.capability)} title={`Editar permissão de ${profile.label}`}>{profile.label}</button>)}
                                  </span>
                                </div>
                                <span className="command-impact-capability__detail">{conflict ? 'Bloqueada pelo plano atual.' : item.description}{runtime ? ` · ${runtime.calls} chamadas · p95 ${runtime.p95Ms} ms · ${runtime.serverErrors} falhas 5xx` : ' · Sem chamadas recentes'}</span>
                                <div className="command-impact-capability__actions">
                                  {conflict || telemetryIssue ? <button type="button" onClick={() => item.profiles[0] && reviewCapability(item.profiles[0].profile, item.capability)}>Investigar</button> : <span className="command-impact-capability__state" title={runtime ? 'Há amostras recentes e nenhum alerta foi detectado.' : 'Nenhuma chamada foi observada nos últimos 15 minutos; isso não indica uma falha.'}>{runtime ? 'Sem alerta' : 'Sem chamadas'}</span>}
                                </div>
                                </div>
                              })()
                            ))}
                            <div className="command-impact-actions">
                              <button type="button" onClick={() => openModule(impact.binding.module)}>Abrir módulo</button>
                              <button type="button" disabled={monitoringRefreshing} onClick={() => void refreshMonitoringNow()}>{monitoringRefreshing ? 'Verificando…' : 'Verificar novamente'}</button>
                            </div>
                          </div>
                        ) : null}
                      </article>
                    )
                  })}
                </div>
              )}
            </section>
            <section className="command-system-audit" aria-labelledby="command-system-audit-title">
              <header><h3 id="command-system-audit-title">Últimas alterações de permissões</h3><button type="button" onClick={() => setTab('governance')}>Ver atividade completa</button></header>
              {auditError ? <p role="status">{auditError}</p> : recentAuditEvents.length ? (
                <div>
                  {recentAuditEvents.filter((event) => event.acao.toUpperCase().includes('PERMISSION')).slice(0, 6).map((event) => {
                    let changedCapabilities = 0
                    try {
                      const payload = event.depois_json ? JSON.parse(event.depois_json) as { permissoes?: Record<string, boolean> } : null
                      changedCapabilities = Object.keys(payload?.permissoes ?? {}).length
                    } catch {
                      changedCapabilities = 0
                    }
                    return (
                    <article key={event.id}>
                      <strong>{presentAuditAction(event.acao)}</strong>
                      <span>{formatDate(event.criado_em)}</span>
                      <small>
                        {users.find((user) => user.id === event.usuario_id)?.nome ?? 'Usuário autorizado'}
                        {' · Perfil alterado: '}{presentProfile(event.entidade_id || event.perfil)}
                        {changedCapabilities ? ` · Matriz com ${changedCapabilities} capacidade(s)` : ''}
                      </small>
                    </article>
                    )
                  })}
                  {!recentAuditEvents.some((event) => event.acao.toUpperCase().includes('PERMISSION')) ? <p>Nenhuma alteração de permissões recente.</p> : null}
                </div>
              ) : <p>Nenhuma alteração de permissões disponível.</p>}
            </section>
            <footer>
              <span>{recentAuditEvents[0]?.criado_em ? `Última matriz salva em ${formatDate(recentAuditEvents[0].criado_em)}` : 'Conferência baseada na matriz atual e no plano ativo'}</span>
              <div>
                <button type="button" disabled={monitoringRefreshing} onClick={() => void refreshMonitoringNow()}>
                  {monitoringRefreshing ? 'Atualizando…' : 'Atualizar'}
                </button>
              </div>
            </footer>
          </section>
        </section>
      ) : null}

      {tab === 'configuration' ? <ConfigurationEnginePanel onSessionExpired={onSessionExpired} /> : null}

      {tab === 'imports' ? <AdminImportCenter onSessionExpired={onSessionExpired} mode="hub" onOpenSection={onOpenImportSection} onOpenHistory={onOpenImportHistory} onDetachZone={onOpenImportZone} onRestoreZone={onRestoreImportZone} /> : null}
      {tab === 'imports-zone' ? <AdminImportCenter onSessionExpired={onSessionExpired} mode="import-zone" onOpenSection={onOpenImportSection} onOpenHistory={onOpenImportHistory} /> : null}
      {tab === 'exports-zone' ? <AdminImportCenter onSessionExpired={onSessionExpired} mode="export-zone" onOpenSection={onOpenImportSection} /> : null}
      {tab === 'imports-structure' ? <AdminImportCenter onSessionExpired={onSessionExpired} mode="prepare" category="Estrutura" reimportRequest={importReimportRequest} /> : null}
      {tab === 'imports-technical' ? <AdminImportCenter onSessionExpired={onSessionExpired} mode="prepare" category="Cadastro técnico" reimportRequest={importReimportRequest} /> : null}
      {tab === 'imports-stock' ? <AdminImportCenter onSessionExpired={onSessionExpired} mode="prepare" category="Almoxarifado" reimportRequest={importReimportRequest} /> : null}
      {tab === 'imports-master' ? <AdminImportCenter onSessionExpired={onSessionExpired} mode="master" /> : null}
      {tab === 'exports-structure' ? <AdminImportCenter onSessionExpired={onSessionExpired} mode="export" category="Estrutura" exportRequestId={importExportRequest?.requestId} /> : null}
      {tab === 'exports-technical' ? <AdminImportCenter onSessionExpired={onSessionExpired} mode="export" category="Cadastro técnico" exportRequestId={importExportRequest?.requestId} /> : null}
      {tab === 'exports-stock' ? <AdminImportCenter onSessionExpired={onSessionExpired} mode="export" category="Almoxarifado" exportRequestId={importExportRequest?.requestId} /> : null}
      {tab === 'exports-master' ? <AdminImportCenter onSessionExpired={onSessionExpired} mode="export-master" exportRequestId={importExportRequest?.requestId} /> : null}
      {tab === 'import-history' ? <AdminImportCenter onSessionExpired={onSessionExpired} mode="history" onOpenReimport={onOpenImportReimport} /> : null}

      {tab === 'structure' ? <AdminCatalogWorkspace scope="structure" onSessionExpired={onSessionExpired} onOpenImports={() => setTab('imports')} /> : null}

      {tab === 'assets' ? <AdminCatalogWorkspace scope="assets" onSessionExpired={onSessionExpired} onOpenImports={() => setTab('imports')} /> : null}

      {tab === 'inventory' ? <AdminCatalogWorkspace scope="inventory" onSessionExpired={onSessionExpired} onOpenImports={() => setTab('imports')} /> : null}

      {tab === 'plan-approvals' ? (
        <AdminCatalogWorkspace
          scope="maintenance"
          approvalOnly
          onSessionExpired={onSessionExpired}
          onOpenImports={() => undefined}
          showImports={false}
        />
      ) : null}

      {tab === 'checklists' ? (
        <AdminChecklistBuilder
          onSessionExpired={onSessionExpired}
          focusTarget={notificationTarget}
        />
      ) : null}

      {tab === 'workforce' || tab === 'workforce-areas' || tab === 'workforce-roles' ? (
        <AdminTechnicalStructure
          onSessionExpired={onSessionExpired}
          detachedPanel={tab === 'workforce-areas' ? 'areas' : tab === 'workforce-roles' ? 'roles' : detachedTechnicalPanel}
          detachedPanels={tab === 'workforce' ? detachedTechnicalPanels : []}
          onDetachPanel={tab === 'workforce' ? onDetachTechnicalPanel : undefined}
          selectedAreaId={selectedTechnicalAreaId}
          onSelectedAreaIdChange={onSelectedTechnicalAreaChange}
        />
      ) : null}

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

      {tab === 'support' ? <TenantSupportWorkspace session={session} /> : null}

      {tab === 'module-inspector' ? (
        <section className="command-module-inspector" role="tabpanel" aria-labelledby="command-module-inspector-title">
          {inspectedModuleData ? (
            <>
              <header className="command-module-inspector__header">
                <div>
                  <span className="eyebrow">COMPOSIÇÃO DO MÓDULO</span>
                  <h2 id="command-module-inspector-title">{inspectedModuleData.binding.label}</h2>
                </div>
                <div className="command-module-inspector__header-actions">
                  <span className={`command-module-inspector__availability${inspectedModuleData.available === false ? ' is-restricted' : ''}`}>
                    {inspectedModuleData.available === null ? 'Plano não verificado' : inspectedModuleData.available ? 'Disponível no plano' : 'Restrito no plano'}
                  </span>
                  <button type="button" onClick={() => onOpenOperationalModule?.(inspectedModule!)}>Abrir área de trabalho</button>
                </div>
              </header>
              <div className="command-module-inspector__summary" aria-label="Resumo do módulo">
                <span><strong>{inspectedModuleData.capabilities.length}</strong> capacidades</span>
                <span><strong>{new Set(inspectedModuleData.capabilities.flatMap((item) => item.profiles.filter((profile) => profile.enabled).map((profile) => profile.id))).size}</strong> perfis com acesso</span>
                <span><strong>{inspectedModuleData.capabilities.filter((item) => ['WARNING', 'CRITICAL'].includes(runtimeCapabilities.get(item.id)?.state ?? '')).length}</strong> alertas</span>
              </div>
              {inspectedModuleData.composition.length ? (
                <section className="command-module-inspector__composition">
                  <h3>Componentes</h3>
                  <ul>{inspectedModuleData.composition.map((component) => <li key={component}>{component}</li>)}</ul>
                </section>
              ) : null}
              <section className="command-module-inspector__capabilities">
                <header><h3>Capacidades</h3><span>{inspectedModuleData.capabilities.length} cadastradas</span></header>
                {inspectedModuleData.capabilities.length ? inspectedModuleData.capabilities.map((capability) => {
                  const enabledProfiles = capability.profiles.filter((profile) => profile.enabled)
                  const targetProfile = enabledProfiles[0] ?? capability.profiles[0]
                  const runtime = runtimeCapabilities.get(capability.id)
                  return (
                    <article key={capability.id}>
                      <div className="command-module-inspector__capability-info">
                        <strong>{capability.name}</strong>
                        <small>{describeCapability(capability.description)}</small>
                        <span className="command-module-inspector__meta">
                          {enabledProfiles.length ? `${enabledProfiles.length} perfil(is) habilitado(s)` : 'Sem perfis habilitados'}
                          {` · ${capability.protectedOperations} operação(ões) protegida(s)`}
                          {runtime ? ` · ${runtime.calls} chamadas · p95 ${runtime.p95Ms} ms` : ' · Sem chamadas na janela atual'}
                        </span>
                        {enabledProfiles.length ? (
                          <span className="command-module-inspector__profiles" aria-label="Perfis com acesso habilitado">
                            {enabledProfiles.map((profile) => <span key={profile.id}>{profile.label}</span>)}
                          </span>
                        ) : null}
                      </div>
                      {targetProfile ? <button type="button" onClick={() => reviewCapability(targetProfile.id, capability.name)}>Investigar acesso</button> : null}
                    </article>
                  )
                }) : <p>Nenhuma capacidade deste módulo está registrada na matriz atual.</p>}
              </section>
            </>
          ) : <p className="command-module-inspector__empty">Selecione um módulo no diagnóstico para consultar sua composição e capacidades.</p>}
        </section>
      ) : null}

      {tab === 'users' ? (
        <section className="admin-users" role="tabpanel">
          <nav className="admin-users-inline-tabs" aria-label="Gestão de pessoas">
            <button type="button" className={!userBulkImportOpen ? 'is-active' : ''} aria-current={!userBulkImportOpen ? 'page' : undefined} onClick={() => setUserBulkImportOpen(false)}>Contas</button>
            <button type="button" className={userBulkImportOpen ? 'is-active' : ''} aria-current={userBulkImportOpen ? 'page' : undefined} onClick={() => setUserBulkImportOpen(true)}>Importar equipe</button>
            <button type="button" className="admin-users-inline-tabs__module-link" onClick={() => onModuleChange?.('workforce')}>Equipes técnicas</button>
            <button type="button" className="admin-users-inline-tabs__module-link" onClick={() => onModuleChange?.('permissions')}>Perfis de acesso</button>
          </nav>
          {userBulkImportOpen ? <AdminUserBulkImportDialog
            profiles={permissionMatrix?.perfis ?? []}
            areas={technicalAreas}
            roles={technicalRoles}
            existingUsers={users}
            embedded
            onClose={() => setUserBulkImportOpen(false)}
            onImported={(created) => { void refresh(`${created} conta(s) criada(s) a partir da planilha.`) }}
          /> : <>
          <div className="admin-metric-grid admin-users-summary" aria-label="Filtrar contas por situação">
            <button type="button" className={!statusFilter && !alertsOnly ? 'is-selected' : ''} aria-pressed={!statusFilter && !alertsOnly} onClick={() => { setStatusFilter(''); setAlertsOnly(false) }}><span>Todos</span><strong>{metrics.total}</strong></button>
            <button type="button" className={statusFilter === 'ATIVO' ? 'is-selected' : ''} aria-pressed={statusFilter === 'ATIVO'} onClick={() => { setAlertsOnly(false); setStatusFilter('ATIVO') }}><span>Ativos</span><strong>{metrics.active}</strong></button>
            <button type="button" className={statusFilter === 'INATIVO' ? 'is-selected' : ''} aria-pressed={statusFilter === 'INATIVO'} onClick={() => { setAlertsOnly(false); setStatusFilter('INATIVO') }}><span>Inativos</span><strong>{metrics.inactive}</strong></button>
            <button type="button" className={`admin-users-summary__alerts${alertsOnly ? ' is-selected' : ''}${metrics.blocked ? ' is-warning' : ''}`} aria-pressed={alertsOnly} title="Contas bloqueadas ou com recuperação de acesso pendente" onClick={() => { setStatusFilter(''); setAlertsOnly(true) }}><span>Alertas</span><strong>{metrics.blocked}</strong></button>
          </div>

          <section className="admin-user-panel">
            <header className="admin-user-panel__header">
              <div><h2>Usuários</h2><span className="admin-user-result-count">{visibleUsers.length} de {metrics.total}</span></div>
              <div className="admin-user-panel__tools">
                <button className="admin-secondary-action admin-user-add" type="button" onClick={() => onOpenUserSettings?.(null, 'identity')}><PlusIcon /><span>Criar usuário</span></button>
              </div>
            </header>

            <div className="admin-filter-bar">
              <label className="search-field">
                <SearchIcon />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nome, matrícula ou e-mail" />
              </label>
            </div>

            <div className="admin-user-table">
              <div className="admin-user-table__head"><span>Usuário</span><span>Perfil e estado</span><span>Segurança e último acesso</span><span>Ações</span></div>
              {visibleUsers.length ? visibleUsers.map((user) => {
                const blocked = isUserBlocked(user)
                const busy = actionUserId === user.id
                const self = user.id === session.user.id
                const open = expandedUserId === user.id
                const displayedStatus = bulkStatusPreview?.ids.includes(user.id) ? bulkStatusPreview.status : user.status
                const technicalAreaName = user.area_nome || technicalAreas.find((area) => area.id === user.area_id)?.nome
                const technicalRoleName = user.cargo_nome || technicalRoles.find((role) => role.id === user.cargo_id)?.nome
                const scopeNames = (() => {
                  try {
                    const ids = JSON.parse(user.escopo_ids_json || '[]') as string[]
                    if (!Array.isArray(ids) || !ids.length) return []
                    return ids.map((id) => {
                      const sector = scopeCatalog.sectors.find((item) => item.id === id)
                      if (sector) {
                        const plant = scopeCatalog.plants.find((item) => item.id === String(sector.planta_id ?? ''))
                        return [plant?.nome, sector.nome].filter(Boolean).join(' · ')
                      }
                      const line = scopeCatalog.lines.find((item) => item.id === id)
                      if (line) {
                        const parentSector = scopeCatalog.sectors.find((item) => item.id === String(line.setor_id ?? ''))
                        const plant = scopeCatalog.plants.find((item) => item.id === String(parentSector?.planta_id ?? ''))
                        return [plant?.nome, parentSector?.nome, line.nome].filter(Boolean).join(' · ')
                      }
                      return ''
                    }).filter(Boolean)
                  } catch {
                    return []
                  }
                })()
                return (
                  <article className={`admin-user-record${open ? ' is-expanded' : ''}`} key={user.id}>
                    <div className="admin-user-row">
                      <button type="button" className="admin-user-open" aria-expanded={open} onClick={() => void toggleUserDetails(user)}>
                        <span className="admin-user-open__text">
                          <strong>{user.nome}{self ? ' · Você' : ''}</strong>
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`admin-user-status-control is-${displayedStatus.toLocaleLowerCase('pt-BR')}${bulkStatusPreview?.ids.includes(user.id) ? ' is-preview' : ''}`}
                        aria-pressed={displayedStatus === 'ATIVO'}
                        aria-label={`${user.status === 'ATIVO' ? 'Desativar' : 'Ativar'} ${user.nome}`}
                        title={self ? 'Seu próprio acesso não pode ser alterado aqui' : 'Clique para alterar. Arraste verticalmente para aplicar a outras contas.'}
                        data-user-status-id={user.id}
                        disabled={self || savingUserStatuses || Boolean(busy)}
                        onPointerDown={(event) => beginUserStatusDrag(event, user)}
                        onClick={() => {
                          if (suppressStatusClickRef.current) {
                            suppressStatusClickRef.current = false
                            return
                          }
                          void applyUserStatusChanges([user.id], user.status === 'ATIVO' ? 'INATIVO' : 'ATIVO')
                        }}
                      >{displayedStatus === 'ATIVO' ? 'ON' : 'OFF'}</button>
                    </div>
                    {open ? <div className="admin-user-details">
                      <div className="admin-user-detail-toolbar">
                        <div className="admin-user-detail-tabs" role="tablist" aria-label={`Detalhes de ${user.nome}`}>
                          {([
                            ['identity', 'Identidade'],
                            ['assignments', 'Atribuições'],
                            ['security', 'Segurança'],
                          ] as const).map(([tabId, label]) => (
                            <button
                              key={tabId}
                              id={`user-${user.id}-${tabId}-tab`}
                              type="button"
                              role="tab"
                              aria-selected={expandedUserDetailTab === tabId}
                              aria-controls={`user-${user.id}-details-panel`}
                              tabIndex={expandedUserDetailTab === tabId ? 0 : -1}
                              className={expandedUserDetailTab === tabId ? 'is-active' : ''}
                              onClick={() => setExpandedUserDetailTab(tabId)}
                              onKeyDown={(event) => {
                                const tabIds = ['identity', 'assignments', 'security'] as const
                                const currentIndex = tabIds.indexOf(tabId)
                                const nextIndex = event.key === 'ArrowRight'
                                  ? (currentIndex + 1) % tabIds.length
                                  : event.key === 'ArrowLeft'
                                    ? (currentIndex - 1 + tabIds.length) % tabIds.length
                                    : event.key === 'Home'
                                      ? 0
                                      : event.key === 'End'
                                        ? tabIds.length - 1
                                        : -1
                                if (nextIndex < 0) return
                                event.preventDefault()
                                const nextTab = tabIds[nextIndex]
                                setExpandedUserDetailTab(nextTab)
                                document.getElementById(`user-${user.id}-${nextTab}-tab`)?.focus()
                              }}
                            >{label}</button>
                          ))}
                        </div>
                        <div className="admin-user-detail-actions">
                          <button type="button" className="admin-icon-action" disabled={busy} onClick={() => onOpenUserSettings?.(user, 'identity')} aria-label={`Editar ${user.nome}`} title="Editar usuário"><SettingsIcon /></button>
                          {blocked ? <button type="button" className="admin-icon-action" disabled={busy} onClick={() => void unlockUser(user)} aria-label={`Desbloquear ${user.nome}`} title="Desbloquear"><ShieldIcon /></button> : null}
                          {!self ? <button type="button" className="admin-icon-action" disabled={busy} onClick={() => void resetUserPassword(user)} aria-label={`Redefinir senha de ${user.nome}`} title="Redefinir senha e preparar e-mail"><KeyIcon /></button> : null}
                          {!self && Number(user.sessoes_ativas ?? 0) > 0 ? <button type="button" className="admin-icon-action" disabled={busy} onClick={() => void revokeSessions(user)} aria-label={`Revogar sessões de ${user.nome}`} title="Revogar sessões"><StopIcon /></button> : null}
                        </div>
                      </div>
                      <div className="admin-user-detail-panel" id={`user-${user.id}-details-panel`} role="tabpanel" aria-labelledby={`user-${user.id}-${expandedUserDetailTab}-tab`}>
                        {expandedUserDetailTab === 'identity' ? <section>
                          <h3>Identidade</h3>
                          <dl>
                            <div><dt>E-mail</dt><dd>{user.email || '—'}</dd></div>
                            <div><dt>Matrícula</dt><dd>{user.matricula || '—'}</dd></div>
                            <div><dt>Cadastrado</dt><dd>{formatDate(user.criado_em)}</dd></div>
                          </dl>
                        </section> : null}
                        {expandedUserDetailTab === 'assignments' ? <section>
                          <h3>Perfil e atribuições</h3>
                          <dl>
                            <div><dt>Perfil</dt><dd>{(user.roleCodes ?? [user.perfil]).join(', ') || 'Sem perfil'}</dd></div>
                            <div><dt>Área / cargo</dt><dd>{[technicalAreaName, technicalRoleName].filter(Boolean).join(' · ') || 'Não definido'}</dd></div>
                            <div><dt>Especialidades</dt><dd>{(() => { try { const values = JSON.parse(user.especialidades_json || '[]'); return Array.isArray(values) && values.length ? values.join(', ') : 'Não definidas' } catch { return user.especialidades_json || 'Não definidas' } })()}</dd></div>
                            <div><dt>Escopo</dt><dd>{scopeNames.length ? scopeNames.join(', ') : user.escopo_ids_json ? (() => { try { const parsed = JSON.parse(user.escopo_ids_json); return Array.isArray(parsed) && parsed.length ? `${parsed.length} setor(es) ou linha(s)` : 'Não definido' } catch { return 'Atribuído' } })() : 'Não definido'}</dd></div>
                          </dl>
                          <div className="admin-user-config-links">
                            <button type="button" onClick={() => onOpenUserSettings?.(user, 'specialties')}>Especialidades</button>
                            <button type="button" onClick={() => onOpenUserSettings?.(user, 'scope')}>Escopo</button>
                            <button type="button" onClick={() => { setSelectedPermissionProfile(user.perfil); setTab('permissions') }}>Permissões do perfil</button>
                          </div>
                        </section> : null}
                        {expandedUserDetailTab === 'security' ? <section>
                          <h3>Segurança e atividade</h3>
                          <dl>
                            <div><dt>Último acesso</dt><dd>{formatDate(user.ultimo_login_em)}</dd></div>
                            <div><dt>Tentativas inválidas</dt><dd>{normalizeAttempts(user)}</dd></div>
                            <div><dt>Sessões ativas</dt><dd>{user.sessoes_ativas ?? 0}</dd></div>
                            <div><dt>Senha atualizada</dt><dd>{formatDate(user.senha_atualizada_em)}</dd></div>
                            <div><dt>Recuperação</dt><dd>{user.recuperacao_pendente ? `Pendente${user.recuperacao_referencia ? ` · ${user.recuperacao_referencia}` : ''}` : 'Nenhuma pendência'}</dd></div>
                          </dl>
                          <h4>Ações recentes</h4>
                          {userAuditLoading === user.id ? <small>Carregando auditoria…</small> : userAudit[user.id]?.length ? <>
                            <ul>{userAudit[user.id].slice(0, expandedAuditUserId === user.id ? 500 : 5).map((event) => <li key={event.id}><strong>{event.acao}</strong><span>{event.entidade} · {formatDate(event.criado_em)}</span></li>)}</ul>
                            {(userAuditTotals[user.id] ?? 0) > 5 ? <button className="admin-audit-expand" type="button" onClick={() => setExpandedAuditUserId(expandedAuditUserId === user.id ? '' : user.id)}>{expandedAuditUserId === user.id ? 'Mostrar recentes' : `Ver registros carregados (${Math.min(userAudit[user.id].length, 500)})`}</button> : null}
                          </> : <small>Sem eventos de auditoria disponíveis para este usuário.</small>}
                        </section> : null}
                      </div>
                    </div> : null}
                  </article>
                )
              }) : <div className="admin-empty-state">Nenhum usuário corresponde aos filtros.</div>}
            </div>
            {bulkStatusPreview?.ids.length && statusDragActive ? <p className="admin-user-bulk-preview" role="status">{bulkStatusPreview.ids.length} conta(s) selecionada(s) para {bulkStatusPreview.status === 'ATIVO' ? 'ativar' : 'desativar'}.</p> : null}
          </section>
          {bulkStatusConfirm ? (
            <div className="admin-desktop-overlay admin-user-bulk-overlay" role="presentation">
              <section className="admin-user-bulk-confirm" role="alertdialog" aria-modal="true" aria-labelledby="admin-user-bulk-title" aria-describedby="admin-user-bulk-description">
                <h2 id="admin-user-bulk-title">{bulkStatusConfirm.status === 'ATIVO' ? 'Ativar' : 'Desativar'} {bulkStatusConfirm.ids.length} contas?</h2>
                <p id="admin-user-bulk-description">A alteração será registrada individualmente. Contas protegidas pelas regras de acesso podem ser recusadas.</p>
                <footer>
                  <button type="button" className="secondary-button" onClick={() => { setBulkStatusConfirm(null); setBulkStatusPreview(null) }}>Voltar</button>
                  <button type="button" className="primary-button" disabled={savingUserStatuses} onClick={() => {
                    const request = bulkStatusConfirm
                    setBulkStatusConfirm(null)
                    void applyUserStatusChanges(request.ids, request.status)
                  }}>{savingUserStatuses ? 'Salvando…' : 'Confirmar alteração'}</button>
                </footer>
              </section>
            </div>
          ) : null}
          </>}
        </section>
      ) : null}

      {isUserSettingsModule ? (
        <section className="admin-user-settings" role="tabpanel" aria-label="Configuração da conta">
          {userSettingsUser !== undefined ? (
            <UserEditorDialog
              user={userSettingsUser}
              currentUserId={session.user.id}
              initialSection={userSettingsSection}
              credentialReceipt={userCredentialReceipt}
              embedded
              onClose={() => onCloseUserSettings?.()}
              onSaved={(message) => {
                void refresh(message)
                onUserSaved?.(message)
              }}
            />
          ) : <div className="admin-empty-state">Carregando a conta selecionada…</div>}
        </section>
      ) : null}

      {tab === 'permissions' ? (
        <section className="permission-panel" role="tabpanel">
          <aside className="permission-profiles">
            <div><span className="eyebrow">ACESSO</span><h2>Perfis</h2></div>
            <div className="permission-profile-list">
              {(permissionMatrix?.perfis.filter((item) => item.roleType?.toLocaleUpperCase('pt-BR') !== 'ADMIN' && item.perfil.toLocaleUpperCase('pt-BR') !== 'ADMIN') ?? []).map((item) => (
                <div key={item.perfil} className={`permission-profile-entry${selectedPermissionProfile === item.perfil ? ' is-active' : ''}`}>
                  <button type="button" className="permission-profile-card" aria-pressed={selectedPermissionProfile === item.perfil} onClick={() => { setSelectedPermissionProfile(item.perfil); setPermissionSearch(''); setPermissionStateFilter('all') }}><UsersIcon /><span><strong>{item.nome ?? PROFILE_LABELS[item.perfil as AdminUserProfile] ?? item.perfil}</strong><small>{item.capacidades.filter((capability) => capability.permitido).length} ligadas de {item.capacidades.length}</small></span>{!item.editavel ? <b>Somente leitura</b> : null}</button>
                </div>
              ))}
              {!provisioningDefaultProfiles && !(permissionMatrix?.perfis.some((item) => item.roleType?.toLocaleUpperCase('pt-BR') !== 'ADMIN' && item.perfil.toLocaleUpperCase('pt-BR') !== 'ADMIN')) ? (
                <div className="permission-profile-empty" role="status">
                  <p>Nenhum perfil operacional cadastrado.</p>
                  <button type="button" disabled={provisioningDefaultProfiles} onClick={() => void retryDefaultPermissionProfiles()}>
                    Preparar perfis padrão
                  </button>
                </div>
              ) : provisioningDefaultProfiles ? <p className="permission-profile-empty" role="status">Preparando perfis padrão…</p> : null}
              {profileCreateOpen ? <form className="permission-profile-inline-create" onSubmit={(event) => void createPermissionProfile(event)}>
                <input id="permission-profile-name" aria-label="Nome do perfil" autoFocus maxLength={100} value={profileDraftName} onChange={(event) => setProfileDraftName(event.target.value)} placeholder="Nome do perfil" />
                <button type="submit" aria-label="Confirmar perfil" title="Confirmar perfil" disabled={savingProfile || profileDraftName.trim().length < 3}>{savingProfile ? '…' : '✓'}</button>
                <button type="button" aria-label="Cancelar criação" title="Cancelar criação" disabled={savingProfile} onClick={() => { setProfileCreateOpen(false); setProfileDraftName(''); setError('') }}>×</button>
              </form> : <button type="button" className="permission-profile-add" aria-label="Adicionar perfil" title="Adicionar perfil" disabled={savingProfile} onClick={() => { setError(''); setNotice(''); setProfileDraftName(''); setProfileCreateOpen(true) }}>+</button>}
            </div>
          </aside>

          <section className="permission-capabilities">
            <header>
              <div>
                <span className="permission-selected-profile-label eyebrow">{selectedPermissions?.nome ?? PROFILE_LABELS[selectedPermissionProfile as AdminUserProfile] ?? selectedPermissionProfile}</span>
                <h2 title="Alterações ficam em rascunho até salvar">Permissões</h2>
              </div>
            </header>
            <div className="permission-capability-toolbar">
              <label className="search-field"><SearchIcon /><input value={permissionSearch} onChange={(event) => setPermissionSearch(event.target.value)} placeholder="Buscar capacidade, descrição ou ação" /></label>
              <div role="group" aria-label="Filtrar capacidades por estado">
                <button type="button" className={permissionStateFilter === 'all' ? 'is-active' : ''} onClick={() => setPermissionStateFilter('all')}>Todas</button>
                <button type="button" className={permissionStateFilter === 'on' ? 'is-active' : ''} onClick={() => setPermissionStateFilter('on')}>Ligadas</button>
                <button type="button" className={permissionStateFilter === 'off' ? 'is-active' : ''} onClick={() => setPermissionStateFilter('off')}>Desligadas</button>
              </div>
            </div>
            <div className="permission-capability-list">
              {!selectedPermissions ? <p className="permission-capability-empty">Selecione ou crie um perfil para configurar as permissões.</p> : null}
              {filteredCapabilities.map((capability) => {
                const savedValue = savedSelectedPermissions?.capacidades.find((saved) => saved.id === capability.id)?.permitido
                const disablingSavedAccess = capability.permitido === false && savedValue === true
                return (
                  <label className="permission-capability" key={capability.id}>
                    <span>
                      <strong>{capability.nome}</strong>
                      <small>{describeCapability(capability.descricao)}</small>
                      {disablingSavedAccess ? <small className="permission-capability-impact" role="status">Impacto ao salvar: {describePermissionImpact(selectedPermissionProfile, capability)}</small> : null}
                      <i>{capability.acoes.length} {capability.acoes.length === 1 ? 'operação protegida' : 'operações protegidas'}</i>
                    </span>
                    <span className={`permission-switch${capability.permitido ? ' is-on' : ' is-off'}`} title={capability.permitido ? 'Capacidade ligada' : 'Capacidade desligada'}>
                      <input
                        type="checkbox"
                        checked={capability.permitido}
                        disabled={!selectedPermissions?.editavel || savingPermissions}
                        aria-label={`${capability.nome}: ${capability.permitido ? 'ligada' : 'desligada'}`}
                        onChange={(event) => togglePermission(capability.id, event.target.checked)}
                      />
                      <strong>{capability.permitido ? 'ON' : 'OFF'}</strong><i aria-hidden="true" />
                    </span>
                  </label>
                )
              })}
              {!filteredCapabilities.length && selectedPermissions ? <div className="admin-empty-state">Nenhuma capacidade para este filtro.</div> : null}
            </div>
            <footer className="permission-actions-bar">
              <span className={`permission-draft-status${selectedPermissionChanges.length ? '' : ' is-saved'}`} role="status" aria-live="polite">
                {selectedPermissionChanges.length ? `${selectedPermissionChanges.length} alteração(ões) pendente(s)` : 'Sem alterações pendentes'}
              </span>
              <div>
                {selectedPermissionChanges.length ? <button type="button" disabled={savingPermissions} onClick={() => {
                  if (!permissionMatrix || !savedSelectedPermissions) return
                  setPermissionMatrix({
                    ...permissionMatrix,
                    perfis: permissionMatrix.perfis.map((profile) => (
                      profile.perfil === selectedPermissionProfile ? savedSelectedPermissions : profile
                    )),
                  })
                  setNotice('Rascunho descartado. As permissões salvas foram restauradas.')
                }}>Descartar</button> : null}
                <button className="primary-button" type="button" disabled={savingPermissions || !selectedPermissions?.editavel || !selectedPermissionChanges.length} onClick={() => void savePermissions()}>{savingPermissions ? 'Salvando…' : 'Salvar alterações'}</button>
              </div>
            </footer>
          </section>
        </section>
      ) : null}

    </main>
  )
}
