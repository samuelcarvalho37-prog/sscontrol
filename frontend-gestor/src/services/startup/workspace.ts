import type { GestorSession } from '../api/auth'
import {
  getAdminCommercialAccess,
  getAdminCompanyProfile,
  getAdminPermissionMatrix,
  getConfigurationEngineState,
  listAdminUsers,
  listAllTechnicalAreas,
  listAllTechnicalRoles,
} from '../api/admin'
import { getAdminTechnicalKpis } from '../api/analytics'
import { listAdminChecklistModels } from '../api/checklists'
import {
  getGestorAssetCatalog,
  getGestorChecklistModels,
  getGestorOverview,
  getGestorTechnicalContext,
  getGestorTechnicalDemands,
  getUnreadNotificationCount,
} from '../api/gestor'
import {
  getAdminMonitoring,
  listAdminBackups,
  listAdminDocuments,
} from '../api/governance'
import { getAdminImportCatalog } from '../api/imports'
import { listAdminInterventions } from '../api/interventions'
import { getSystemHealth, warmupGestor } from '../api/system'

export type WorkspaceStartupRole = 'ADMIN' | 'GESTOR'

export interface WorkspaceStartupProgress {
  percent: number
  title: string
  detail: string
  completedGroups: number
  totalGroups: number
}

export interface WorkspaceStartupResult {
  role: WorkspaceStartupRole
  release: string
  loadedTables: number
  verifiedModules: number
}

type ProgressReporter = (progress: WorkspaceStartupProgress) => void
type StartupTask = () => Promise<unknown>

function normalizeRole(session: GestorSession): WorkspaceStartupRole {
  return session.user.perfil.trim().toUpperCase() === 'ADMIN' ? 'ADMIN' : 'GESTOR'
}

async function runGroup(
  tasks: StartupTask[],
  progress: Omit<WorkspaceStartupProgress, 'completedGroups' | 'totalGroups'>,
  completedGroups: number,
  totalGroups: number,
  report: ProgressReporter,
): Promise<number> {
  report({
    ...progress,
    completedGroups,
    totalGroups,
  })
  await Promise.all(tasks.map((task) => task()))
  return tasks.length
}

async function prepareAdminWorkspace(
  signal: AbortSignal,
  report: ProgressReporter,
): Promise<number> {
  const totalGroups = 5
  let verifiedModules = 0

  verifiedModules += await runGroup(
    [
      () => getAdminCommercialAccess(signal),
      () => getAdminCompanyProfile(signal),
      () => listAdminUsers({}, signal),
      () => getAdminPermissionMatrix(signal),
    ],
    {
      percent: 42,
      title: 'Carregando governança e acessos',
      detail: 'Sincronizando empresa, usuários, perfis e permissões.',
    },
    2,
    totalGroups,
    report,
  )

  verifiedModules += await runGroup(
    [
      () => listAllTechnicalAreas(signal),
      () => listAllTechnicalRoles('', signal),
      () => listAdminChecklistModels(signal),
      () => listAdminInterventions(signal),
    ],
    {
      percent: 62,
      title: 'Preparando estrutura e fluxos',
      detail: 'Carregando áreas, cargos, checklists e intervenções.',
    },
    3,
    totalGroups,
    report,
  )

  verifiedModules += await runGroup(
    [
      () => getConfigurationEngineState(signal),
      () => getAdminImportCatalog(signal),
      () => getAdminTechnicalKpis({}, signal),
    ],
    {
      percent: 82,
      title: 'Validando configuração e indicadores',
      detail: 'Conferindo Motor, modelos de importação e métricas técnicas.',
    },
    4,
    totalGroups,
    report,
  )

  verifiedModules += await runGroup(
    [
      () => getAdminMonitoring(signal),
      () => listAdminDocuments({}, signal),
      () => listAdminBackups(signal),
    ],
    {
      percent: 96,
      title: 'Conferindo continuidade operacional',
      detail: 'Preparando monitoramento, documentos e pontos de recuperação.',
    },
    5,
    totalGroups,
    report,
  )

  return verifiedModules
}

async function prepareManagerWorkspace(
  signal: AbortSignal,
  report: ProgressReporter,
): Promise<number> {
  const totalGroups = 4
  let verifiedModules = 0

  verifiedModules += await runGroup(
    [
      () => getGestorTechnicalContext(signal),
      () => getGestorTechnicalDemands(signal),
    ],
    {
      percent: 50,
      title: 'Preparando o filtro técnico',
      detail: 'Carregando escopo, responsabilidades e demandas encaminhadas.',
    },
    2,
    totalGroups,
    report,
  )

  verifiedModules += await runGroup(
    [
      () => getGestorOverview(signal),
      () => getUnreadNotificationCount(signal),
    ],
    {
      percent: 74,
      title: 'Sincronizando a operação',
      detail: 'Conferindo validações, ocorrências, paradas e indicadores.',
    },
    3,
    totalGroups,
    report,
  )

  verifiedModules += await runGroup(
    [
      () => getGestorChecklistModels(signal),
      () => getGestorAssetCatalog(signal),
    ],
    {
      percent: 94,
      title: 'Preparando recursos técnicos',
      detail: 'Carregando modelos de checklist, ativos e componentes.',
    },
    4,
    totalGroups,
    report,
  )

  return verifiedModules
}

export async function prepareWorkspace(
  session: GestorSession,
  signal: AbortSignal,
  report: ProgressReporter,
): Promise<WorkspaceStartupResult> {
  const role = normalizeRole(session)
  const totalGroups = role === 'ADMIN' ? 5 : 4

  report({
    percent: 8,
    title: 'Verificando o ambiente',
    detail: 'Confirmando versão, conexão e sessão autenticada.',
    completedGroups: 0,
    totalGroups,
  })
  const health = await getSystemHealth(signal)

  report({
    percent: 22,
    title: 'Aquecendo o núcleo do sistema',
    detail: 'Preparando cadastros, vínculos e regras essenciais.',
    completedGroups: 1,
    totalGroups,
  })
  const warmup = await warmupGestor(session.token, signal)

  const verifiedModules = role === 'ADMIN'
    ? await prepareAdminWorkspace(signal, report)
    : await prepareManagerWorkspace(signal, report)

  report({
    percent: 100,
    title: 'Ambiente pronto',
    detail: role === 'ADMIN'
      ? 'Command Workspace carregado e validado.'
      : 'Painel de gestão carregado e validado.',
    completedGroups: totalGroups,
    totalGroups,
  })

  return {
    role,
    release: health.release_version ?? health.version,
    loadedTables: warmup.loaded_tables ?? Object.keys(warmup.loaded ?? {}).length,
    verifiedModules,
  }
}
