import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import '../styles/admin-command-center.css'
import type { GestorSession } from '../services/api/auth'
import type { AdminImportRetryRequest } from '../types/imports'
import {
  getAdminCommercialAccess,
  getAdminCompanyProfile,
  getAdminPermissionMatrix,
  listAdminTechnicalDemands,
  saveAdminCompanyProfile,
} from '../services/api/admin'
import { getUnreadNotificationCount, isGestorAuthenticationError } from '../services/api/gestor'
import type {
  AdminCommercialAccess,
  AdminCommercialFeatureCode,
  AdminCompanyProfile,
  AdminNotificationTarget,
  AdminPermissionProfile,
  AdminUser,
} from '../types/admin'
import type { GestorNotification } from '../types/gestor'
import { AdminPage, type AdminModule, type AdminWorkspaceModuleStatus } from '../pages/AdminPage'
import type { AccountCredentialReceipt } from './UserEditorDialog'
import { AdminCompanyDialog } from './AdminCompanyDialog'
import { NotificationCenter } from './NotificationCenter'
import {
  AssetIcon,
  AuditIcon,
  BellIcon,
  ChartIcon,
  ChecklistIcon,
  DashboardIcon,
  DatabaseIcon,
  DocumentIcon,
  FactoryIcon,
  KeyIcon,
  PackageIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  UploadIcon,
  UserDirectoryIcon,
  UsersIcon,
  WindowsIcon,
  WrenchIcon,
} from './Icons'

interface AdminWorkspaceProps {
  session: GestorSession
  activeModule: AdminModule
  loggingOut: boolean
  onModuleChange: (module: AdminModule) => void
  onSessionExpired: () => void
  onLogout: () => void
}

interface WorkspaceModule {
  id: AdminModule
  code: string
  label: string
  description: string
  searchTerms?: string
  Icon: typeof DashboardIcon
  feature?: AdminCommercialFeatureCode
}

interface WorkspaceWindow {
  module: AdminModule
  groupId: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  minimized: boolean
  maximized: boolean
  layoutHidden: boolean
  tiled: boolean
  snapTarget: WindowSnapTarget | null
  restoreBounds: WindowBounds | null
}

interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

interface WindowLink {
  first: AdminModule
  second: AdminModule
  axis: 'vertical' | 'horizontal'
}

interface UserSettingsContext {
  user: AdminUser | null
  section: 'identity' | 'specialties' | 'scope'
  stage: 'form' | 'email'
  credentialReceipt?: AccountCredentialReceipt
}

interface WorkspaceToast {
  id: number
  message: string
}

interface DragState {
  module: AdminModule
  kind: 'move' | 'resize'
  edges: string
  offsetX: number
  offsetY: number
  startClientX: number
  startClientY: number
  startX: number
  startY: number
  startWidth: number
  startHeight: number
  activated: boolean
  geometrySynced: boolean
  restoreWidth: number
  restoreHeight: number
}

type WindowLayout = 'smart' | 'focus' | 'columns' | 'rows' | 'grid' | 'cascade' | 'free'
type WindowSnapTarget = 'maximize' | 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

const MODULES: WorkspaceModule[] = [
  { id: 'overview', code: 'VG', label: 'Integridade do sistema', description: 'Saúde e alertas automáticos', searchTerms: 'visão geral diagnóstico desempenho latência módulo operação sistema ambiente telemetria', Icon: DashboardIcon },
  { id: 'structure', code: 'EF', label: 'Estrutura fabril', description: 'Plantas, setores e linhas', searchTerms: 'empresa fábrica unidade setor linha planta', Icon: FactoryIcon, feature: 'CADASTROS' },
  { id: 'assets', code: 'AT', label: 'Cadastro técnico', description: 'Ativos e componentes', searchTerms: 'equipamento máquina tag componente ativo patrimônio', Icon: AssetIcon, feature: 'CADASTROS' },
  { id: 'checklists', code: 'CK', label: 'Checklists', description: 'Construtor e roteamento', Icon: ChecklistIcon, feature: 'CHECKLISTS' },
  { id: 'inventory', code: 'MP', label: 'Materiais e peças', description: 'Estoque técnico', Icon: PackageIcon, feature: 'CADASTROS' },
  { id: 'workforce', code: 'EQ', label: 'Equipes técnicas', description: 'Áreas, cargos e assinatura', searchTerms: 'área técnica PCM produção técnico especialidade função equipe assinatura', Icon: UsersIcon, feature: 'GESTAO_TECNICA' },
  { id: 'operations', code: 'OS', label: 'Programação, intervenções e OS', description: 'Planejar, validar e liberar', searchTerms: 'ordem de serviço manutenção preventiva corretiva parada planejamento gestor PCM', Icon: WrenchIcon, feature: 'GESTAO_TECNICA' },
  { id: 'plan-approvals', code: 'HP', label: 'Homologação de planos', description: 'Consultar e publicar planos em rascunho', Icon: ChecklistIcon, feature: 'GESTAO_TECNICA' },
  { id: 'analytics', code: 'BI', label: 'Indicadores', description: 'Confiabilidade, tempos e SLA', Icon: ChartIcon, feature: 'INDICADORES' },
  { id: 'documents', code: 'DT', label: 'Documentos', description: 'Arquivos e revisões', Icon: DocumentIcon, feature: 'DOCUMENTOS' },
  { id: 'imports', code: 'ID', label: 'Importação e exportação', description: 'Enviar ou baixar cadastros', searchTerms: 'planilha excel csv json xml carga importar exportar dados', Icon: UploadIcon, feature: 'IMPORTACOES' },
  { id: 'imports-structure', code: 'IS', label: 'Importar estrutura', description: 'Plantas, setores e linhas', Icon: UploadIcon, feature: 'IMPORTACOES' },
  { id: 'imports-technical', code: 'IA', label: 'Importar ativos', description: 'Equipamentos e componentes', Icon: UploadIcon, feature: 'IMPORTACOES' },
  { id: 'imports-stock', code: 'IE', label: 'Importação de almoxarifado', description: 'Materiais e fontes de valor', Icon: UploadIcon, feature: 'IMPORTACOES' },
  { id: 'imports-master', code: 'IM', label: 'Importar planilha mestre', description: 'Vários cadastros em um arquivo', Icon: UploadIcon, feature: 'IMPORTACOES' },
  { id: 'imports-zone', code: 'IZ', label: 'Importação de dados', description: 'Estrutura, ativos e almoxarifado', Icon: UploadIcon, feature: 'IMPORTACOES' },
  { id: 'exports-structure', code: 'ES', label: 'Exportar estrutura', description: 'Plantas, setores e linhas atuais', Icon: UploadIcon, feature: 'IMPORTACOES' },
  { id: 'exports-technical', code: 'EA', label: 'Exportar ativos', description: 'Equipamentos e componentes atuais', Icon: UploadIcon, feature: 'IMPORTACOES' },
  { id: 'exports-stock', code: 'EE', label: 'Exportar almoxarifado', description: 'Materiais atuais', Icon: UploadIcon, feature: 'IMPORTACOES' },
  { id: 'exports-master', code: 'EM', label: 'Exportar planilha mestre', description: 'Cadastros atuais em um arquivo', Icon: UploadIcon, feature: 'IMPORTACOES' },
  { id: 'exports-zone', code: 'EZ', label: 'Exportação de dados', description: 'Estrutura, ativos e almoxarifado', Icon: UploadIcon, feature: 'IMPORTACOES' },
  { id: 'import-history', code: 'IR', label: 'Lotes de importação', description: 'Histórico, resultados e reversões', Icon: UploadIcon, feature: 'IMPORTACOES' },
  { id: 'configuration', code: 'MC', label: 'Configurações avançadas', description: 'Regras, versões e publicação', searchTerms: 'motor configuração operação evidência workflow indicador metas salvar validar publicar reverter versão', Icon: SettingsIcon, feature: 'MOTOR_LIMITADO' },
  { id: 'users', code: 'US', label: 'Gestão de pessoas', description: 'Contas, equipes e perfis de acesso', searchTerms: 'usuário pessoa conta login senha sessão revogar acesso segurança cadastro área cargo equipe perfil', Icon: UserDirectoryIcon, feature: 'CADASTROS' },
  { id: 'permissions', code: 'PE', label: 'Configurações de acesso', description: 'Permissões por perfil', searchTerms: 'permissão perfil gestor técnico operador planejador produção qualidade segurança ligar desligar autorização papel role', Icon: KeyIcon, feature: 'CADASTROS' },
  { id: 'governance', code: 'AU', label: 'Auditoria', description: 'Histórico de alterações e responsáveis', searchTerms: 'log evento histórico alteração quem fez quando antes depois', Icon: AuditIcon, feature: 'AUDITORIA' },
  { id: 'backup', code: 'BK', label: 'Criar uma cópia', description: 'Restaurar uma versão anterior', Icon: DatabaseIcon, feature: 'CONTINUIDADE' },
  { id: 'support', code: 'SP', label: 'Suporte VORQIX', description: 'Chamados técnicos da empresa', searchTerms: 'suporte chamado ajuda plataforma erro desempenho acesso', Icon: AuditIcon },
  { id: 'module-inspector', code: 'MI', label: 'Composição de módulo', description: 'Componentes, capacidades e perfis', Icon: DashboardIcon },
]

const NAVIGATION_GROUPS: Array<{
  id: string
  label: string
  modules: readonly AdminModule[]
}> = [
  {
    id: 'overview',
    label: 'DIAGNÓSTICO',
    modules: ['overview'],
  },
  {
    id: 'people',
    label: 'PESSOAS E ACESSO',
    modules: ['users', 'workforce', 'permissions'],
  },
  {
    id: 'data',
    label: 'CADASTROS E DADOS',
    modules: ['structure', 'assets', 'inventory', 'imports', 'import-history', 'backup'],
  },
  {
    id: 'operation',
    label: 'OPERAÇÃO',
    modules: ['checklists', 'operations', 'plan-approvals', 'analytics'],
  },
  {
    id: 'system',
    label: 'SISTEMA E SUPORTE',
    modules: ['documents', 'governance', 'configuration', 'support'],
  },
]
const ADMIN_MAINTENANCE_MODULES = new Set<AdminModule>([
  'structure', 'assets', 'checklists', 'maintenance', 'inventory', 'operations',
])
const COMPANY_PROFILE_CACHE_KEY = 'fab_control_admin_company_profile_v1'
const DEFAULT_COMPANY_PROFILE: AdminCompanyProfile = {
  nome: 'Empresa Demonstração',
  logo_data_url: '',
}

function readCachedCompanyProfile(): AdminCompanyProfile {
  if (typeof window === 'undefined') return DEFAULT_COMPANY_PROFILE
  try {
    const cached = JSON.parse(window.localStorage.getItem(COMPANY_PROFILE_CACHE_KEY) ?? '{}') as Partial<AdminCompanyProfile>
    const name = typeof cached.nome === 'string' ? cached.nome.trim() : ''
    const logo = typeof cached.logo_data_url === 'string' && cached.logo_data_url.startsWith('data:image/')
      ? cached.logo_data_url
      : ''
    return name ? { nome: name, logo_data_url: logo, atualizado_em: cached.atualizado_em } : DEFAULT_COMPANY_PROFILE
  } catch {
    return DEFAULT_COMPANY_PROFILE
  }
}

function cacheCompanyProfile(profile: AdminCompanyProfile) {
  try {
    window.localStorage.setItem(COMPANY_PROFILE_CACHE_KEY, JSON.stringify(profile))
  } catch {
    // A identidade continua disponível na sessão mesmo sem armazenamento local.
  }
}

function getModule(module: AdminModule): WorkspaceModule {
  const registered = MODULES.find((item) => item.id === module)
  if (registered) return registered
  if (module === 'workforce-areas' || module === 'workforce-roles') {
    const areas = module === 'workforce-areas'
    return {
      id: module,
      code: areas ? 'AR' : 'CG',
      label: areas ? 'Áreas' : 'Cargos',
      description: areas ? 'Áreas técnicas da empresa' : 'Cargos da área selecionada',
      Icon: UsersIcon,
      feature: 'GESTAO_TECNICA',
    }
  }
  if (module.startsWith('user-settings:')) {
    return { id: module, code: 'US', label: 'Configuração de usuário', description: 'Identidade, especialidades e escopo', Icon: UserDirectoryIcon }
  }
  return MODULES[0]
}

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase()
}

function createWindow(module: AdminModule, index: number, zIndex: number, availableWidth: number, availableHeight: number, groupId = `pane-${module}`): WorkspaceWindow {
  const width = Math.max(1, availableWidth)
  const height = Math.max(1, availableHeight)
  const compact = width < 720 || height < 460
  const windowWidth = Math.min(width, compact ? width : Math.min(960, Math.max(420, width - 48)))
  const windowHeight = Math.min(height, compact ? height : Math.min(700, Math.max(320, height - 48)))
  const offset = Math.min(index, 5) * 22
  return {
    module,
    groupId,
    x: compact ? 0 : Math.min(18 + offset, Math.max(0, width - windowWidth)),
    y: compact ? 0 : Math.min(18 + offset, Math.max(0, height - windowHeight)),
    width: windowWidth,
    height: windowHeight,
    zIndex,
    minimized: false,
    maximized: compact,
    layoutHidden: false,
    tiled: compact,
    snapTarget: null,
    restoreBounds: null,
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function findPanePlacement(
  anchor: WindowBounds,
  visibleWindows: WorkspaceWindow[],
  layerWidth: number,
  layerHeight: number,
  anchorGroupId: string,
): { anchor: WindowBounds; panel: WindowBounds } {
  const gap = 8
  const minWidth = 300
  const minHeight = 240
  const occupied = visibleWindows.filter((item) => item.groupId !== anchorGroupId)
  const overlaps = (candidate: WindowBounds) => occupied.some((item) => (
    candidate.x < item.x + item.width && candidate.x + candidate.width > item.x
    && candidate.y < item.y + item.height && candidate.y + candidate.height > item.y
  ))
  const rightX = anchor.x + anchor.width + gap
  const rightWidth = layerWidth - rightX
  const rightCandidate = { x: rightX, y: anchor.y, width: rightWidth, height: anchor.height }
  if (rightWidth >= minWidth && !overlaps(rightCandidate)) return { anchor, panel: rightCandidate }

  const bottomY = anchor.y + anchor.height + gap
  const bottomHeight = layerHeight - bottomY
  const bottomCandidate = { x: anchor.x, y: bottomY, width: anchor.width, height: bottomHeight }
  if (bottomHeight >= minHeight && !overlaps(bottomCandidate)) return { anchor, panel: bottomCandidate }

  if (anchor.width >= minWidth * 2 + gap) {
    const firstWidth = Math.floor((anchor.width - gap) / 2)
    return {
      anchor: { ...anchor, width: firstWidth },
      panel: { x: anchor.x + firstWidth + gap, y: anchor.y, width: anchor.width - firstWidth - gap, height: anchor.height },
    }
  }

  if (anchor.height >= minHeight * 2 + gap) {
    const firstHeight = Math.floor((anchor.height - gap) / 2)
    return {
      anchor: { ...anchor, height: firstHeight },
      panel: { x: anchor.x, y: anchor.y + firstHeight + gap, width: anchor.width, height: anchor.height - firstHeight - gap },
    }
  }

  const width = Math.min(anchor.width, Math.max(minWidth, Math.floor(layerWidth * 0.42)))
  const height = Math.min(anchor.height, Math.max(minHeight, Math.floor(layerHeight * 0.72)))
  return {
    anchor,
    panel: {
      x: clamp(anchor.x + gap + 24, 0, Math.max(0, layerWidth - width)),
      y: clamp(anchor.y + gap + 24, 0, Math.max(0, layerHeight - height)),
      width,
      height,
    },
  }
}

function detectResizeEdges(clientX: number, clientY: number, bounds: DOMRect): string {
  const horizontal = 12
  const vertical = 12
  let edges = ''
  if (clientX - bounds.left <= horizontal) edges += 'w'
  else if (bounds.right - clientX <= horizontal) edges += 'e'
  if (clientY - bounds.top <= vertical) edges += 'n'
  else if (bounds.bottom - clientY <= vertical) edges += 's'
  return edges
}

function detectSnapTarget(x: number, y: number, width: number, height: number): WindowSnapTarget | null {
  const edge = 34
  const corner = 54
  if (y <= edge && x <= corner) return 'top-left'
  if (y <= edge && x >= width - corner) return 'top-right'
  if (y >= height - edge && x <= corner) return 'bottom-left'
  if (y >= height - edge && x >= width - corner) return 'bottom-right'
  if (y <= edge) return 'maximize'
  if (y <= edge * 1.5) return 'top'
  if (y >= height - edge * 1.5) return 'bottom'
  if (x <= edge) return 'left'
  if (x >= width - edge) return 'right'
  return null
}

function snapWindow(
  item: WorkspaceWindow,
  target: WindowSnapTarget,
  width: number,
  height: number,
  zIndex: number,
): WorkspaceWindow {
  const restoreBounds = item.restoreBounds ?? {
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
  }
  if (target === 'maximize') {
    return {
      ...item,
      zIndex,
      maximized: true,
      layoutHidden: false,
      tiled: true,
      snapTarget: target,
      restoreBounds,
    }
  }
  const divider = 1
  const halfWidth = (width - divider) / 2
  const halfHeight = (height - divider) / 2
  const left = target === 'left' || target.endsWith('left')
  const top = target === 'left' || target === 'right' || target === 'top' || target.startsWith('top')
  const isHalf = target === 'left' || target === 'right'
  const isVerticalHalf = target === 'top' || target === 'bottom'
  return {
    ...item,
    x: isVerticalHalf ? 0 : left ? 0 : halfWidth + divider,
    y: isVerticalHalf ? (target === 'top' ? 0 : halfHeight + divider) : top ? 0 : halfHeight + divider,
    width: isVerticalHalf ? width : halfWidth,
    height: isVerticalHalf ? halfHeight : isHalf ? height : halfHeight,
    zIndex,
    maximized: false,
    layoutHidden: false,
    tiled: true,
    snapTarget: target,
    restoreBounds,
  }
}

function magnetizeWindowPosition(
  item: Pick<WorkspaceWindow, 'module' | 'x' | 'y' | 'width' | 'height'>,
  peers: WorkspaceWindow[],
  areaWidth: number,
  areaHeight: number,
): { x: number; y: number } {
  const tolerance = 36
  const gap = 0
  let x = clamp(item.x, 0, Math.max(0, areaWidth - item.width))
  let y = clamp(item.y, 0, Math.max(0, areaHeight - item.height))
  const xCandidates = [
    { value: 0, distance: Math.abs(x) },
    { value: Math.max(0, areaWidth - item.width), distance: Math.abs(areaWidth - item.width - x) },
  ]
  const yCandidates = [
    { value: 0, distance: Math.abs(y) },
    { value: Math.max(0, areaHeight - item.height), distance: Math.abs(areaHeight - item.height - y) },
  ]

  for (const peer of peers) {
    if (peer.module === item.module || peer.minimized || peer.layoutHidden || peer.maximized) continue
    const overlapsVertically = y < peer.y + peer.height && y + item.height > peer.y
    const overlapsHorizontally = x < peer.x + peer.width && x + item.width > peer.x
    if (overlapsVertically) {
      xCandidates.push(
        { value: peer.x - item.width - gap, distance: Math.abs(x - (peer.x - item.width - gap)) },
        { value: peer.x + peer.width + gap, distance: Math.abs(x - (peer.x + peer.width + gap)) },
      )
    }
    if (overlapsHorizontally) {
      yCandidates.push(
        { value: peer.y - item.height - gap, distance: Math.abs(y - (peer.y - item.height - gap)) },
        { value: peer.y + peer.height + gap, distance: Math.abs(y - (peer.y + peer.height + gap)) },
      )
    }
  }

  const nearestX = xCandidates.filter((candidate) => candidate.value >= 0 && candidate.value + item.width <= areaWidth)
    .sort((left, right) => left.distance - right.distance)[0]
  const nearestY = yCandidates.filter((candidate) => candidate.value >= 0 && candidate.value + item.height <= areaHeight)
    .sort((left, right) => left.distance - right.distance)[0]
  if (nearestX && nearestX.distance <= tolerance) x = nearestX.value
  if (nearestY && nearestY.distance <= tolerance) y = nearestY.value
  return { x, y }
}

function magnetizeResizedWindow(
  item: Pick<WorkspaceWindow, 'module' | 'x' | 'y' | 'width' | 'height'>,
  edges: string,
  peers: WorkspaceWindow[],
  areaWidth: number,
  areaHeight: number,
): Pick<WorkspaceWindow, 'x' | 'y' | 'width' | 'height'> {
  const tolerance = 40
  const gap = 0
  const minimumWidth = Math.min(320, areaWidth)
  const minimumHeight = Math.min(230, areaHeight)
  let { x, y, width, height } = item

  if (edges.includes('e')) {
    const fixedLeft = x
    const currentRight = x + width
    const candidates = [areaWidth]
    for (const peer of peers) {
      if (peer.module === item.module || peer.minimized || peer.layoutHidden || peer.maximized) continue
      if (y < peer.y + peer.height && y + height > peer.y) {
        candidates.push(peer.x - gap, peer.x + peer.width + gap)
      }
    }
    const target = candidates
      .filter((value) => value - fixedLeft >= minimumWidth && value <= areaWidth)
      .sort((left, right) => Math.abs(left - currentRight) - Math.abs(right - currentRight))[0]
    if (target !== undefined && Math.abs(target - currentRight) <= tolerance) width = target - fixedLeft
  }

  if (edges.includes('w')) {
    const fixedRight = x + width
    const currentLeft = x
    const candidates = [0]
    for (const peer of peers) {
      if (peer.module === item.module || peer.minimized || peer.layoutHidden || peer.maximized) continue
      if (y < peer.y + peer.height && y + height > peer.y) {
        candidates.push(peer.x - gap - width, peer.x + peer.width + gap)
      }
    }
    const target = candidates
      .filter((value) => value >= 0 && fixedRight - value >= minimumWidth)
      .sort((left, right) => Math.abs(left - currentLeft) - Math.abs(right - currentLeft))[0]
    if (target !== undefined && Math.abs(target - currentLeft) <= tolerance) {
      x = target
      width = fixedRight - target
    }
  }

  if (edges.includes('s')) {
    const fixedTop = y
    const currentBottom = y + height
    const candidates = [areaHeight]
    for (const peer of peers) {
      if (peer.module === item.module || peer.minimized || peer.layoutHidden || peer.maximized) continue
      if (x < peer.x + peer.width && x + width > peer.x) {
        candidates.push(peer.y - gap, peer.y + peer.height + gap)
      }
    }
    const target = candidates
      .filter((value) => value - fixedTop >= minimumHeight && value <= areaHeight)
      .sort((left, right) => Math.abs(left - currentBottom) - Math.abs(right - currentBottom))[0]
    if (target !== undefined && Math.abs(target - currentBottom) <= tolerance) height = target - fixedTop
  }

  if (edges.includes('n')) {
    const fixedBottom = y + height
    const currentTop = y
    const candidates = [0]
    for (const peer of peers) {
      if (peer.module === item.module || peer.minimized || peer.layoutHidden || peer.maximized) continue
      if (x < peer.x + peer.width && x + width > peer.x) {
        candidates.push(peer.y - gap - height, peer.y + peer.height + gap)
      }
    }
    const target = candidates
      .filter((value) => value >= 0 && fixedBottom - value >= minimumHeight)
      .sort((left, right) => Math.abs(left - currentTop) - Math.abs(right - currentTop))[0]
    if (target !== undefined && Math.abs(target - currentTop) <= tolerance) {
      y = target
      height = fixedBottom - target
    }
  }

  return { x, y, width, height }
}

function findAdjacentWindowLinks(item: WorkspaceWindow, windows: WorkspaceWindow[]): WindowLink[] {
  if (item.minimized || item.layoutHidden || item.maximized) return []
  const tolerance = 32
  const minimumSharedEdge = 24
  const candidates: Array<{ link: WindowLink; distance: number }> = []
  for (const peer of windows) {
    if (peer.module === item.module || peer.minimized || peer.layoutHidden || peer.maximized) continue
    const verticalOverlap = Math.min(item.y + item.height, peer.y + peer.height) - Math.max(item.y, peer.y)
    const horizontalOverlap = Math.min(item.x + item.width, peer.x + peer.width) - Math.max(item.x, peer.x)
    const itemRightDistance = Math.abs(item.x + item.width - peer.x)
    const peerRightDistance = Math.abs(peer.x + peer.width - item.x)
    const itemBottomDistance = Math.abs(item.y + item.height - peer.y)
    const peerBottomDistance = Math.abs(peer.y + peer.height - item.y)
    if (verticalOverlap >= minimumSharedEdge && itemRightDistance <= tolerance) {
      candidates.push({ link: { first: item.module, second: peer.module, axis: 'vertical' }, distance: itemRightDistance })
    }
    if (verticalOverlap >= minimumSharedEdge && peerRightDistance <= tolerance) {
      candidates.push({ link: { first: peer.module, second: item.module, axis: 'vertical' }, distance: peerRightDistance })
    }
    if (horizontalOverlap >= minimumSharedEdge && itemBottomDistance <= tolerance) {
      candidates.push({ link: { first: item.module, second: peer.module, axis: 'horizontal' }, distance: itemBottomDistance })
    }
    if (horizontalOverlap >= minimumSharedEdge && peerBottomDistance <= tolerance) {
      candidates.push({ link: { first: peer.module, second: item.module, axis: 'horizontal' }, distance: peerBottomDistance })
    }
  }
  const unique = new Map<string, { link: WindowLink; distance: number }>()
  for (const candidate of candidates) {
    const key = `${candidate.link.axis}:${candidate.link.first}:${candidate.link.second}`
    const current = unique.get(key)
    if (!current || candidate.distance < current.distance) unique.set(key, candidate)
  }
  return [...unique.values()].sort((left, right) => left.distance - right.distance).map(({ link }) => link)
}

function getWindowLinkGroup(module: AdminModule, links: WindowLink[]): Set<AdminModule> {
  const group = new Set<AdminModule>([module])
  let expanded = true
  while (expanded) {
    expanded = false
    for (const link of links) {
      if (group.has(link.first) && !group.has(link.second)) {
        group.add(link.second)
        expanded = true
      }
      if (group.has(link.second) && !group.has(link.first)) {
        group.add(link.first)
        expanded = true
      }
    }
  }
  return group
}

function sameWindowLink(left: WindowLink, right: WindowLink): boolean {
  return left.first === right.first && left.second === right.second && left.axis === right.axis
}

function windowLinkMatchesResize(link: WindowLink, module: AdminModule, edges: string): boolean {
  return link.axis === 'vertical'
    ? (link.first === module && edges.includes('e')) || (link.second === module && edges.includes('w'))
    : (link.first === module && edges.includes('s')) || (link.second === module && edges.includes('n'))
}

function getWindowLinkMarker(link: WindowLink, windows: WorkspaceWindow[]): { x: number; y: number; zIndex: number } | null {
  const first = windows.find((item) => item.module === link.first)
  const second = windows.find((item) => item.module === link.second)
  if (!first || !second || first.minimized || second.minimized || first.layoutHidden || second.layoutHidden || first.maximized || second.maximized) return null
  const pairZIndex = Math.max(first.zIndex, second.zIndex)
  const candidates: Array<{ x: number; y: number }> = []
  if (link.axis === 'vertical') {
    const overlap = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y)
    if (Math.abs(first.x + first.width - second.x) > 34 || overlap < 24) return null
    const center = Math.max(first.y, second.y) + overlap / 2
    const safeStart = Math.max(first.y, second.y) + 14
    const safeEnd = Math.min(first.y + first.height, second.y + second.height) - 14
    const x = (first.x + first.width + second.x) / 2
    for (const fraction of [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9]) {
      candidates.push({ x, y: Math.max(safeStart, Math.min(safeEnd, center + (fraction - 0.5) * overlap)) })
    }
  } else {
    const overlap = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x)
    if (Math.abs(first.y + first.height - second.y) > 34 || overlap < 24) return null
    const center = Math.max(first.x, second.x) + overlap / 2
    const safeStart = Math.max(first.x, second.x) + 14
    const safeEnd = Math.min(first.x + first.width, second.x + second.width) - 14
    const y = (first.y + first.height + second.y) / 2
    for (const fraction of [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9]) {
      candidates.push({ x: Math.max(safeStart, Math.min(safeEnd, center + (fraction - 0.5) * overlap)), y })
    }
  }
  const availablePoint = candidates.find(({ x, y }) => !windows.some((windowItem) => {
    if (windowItem.module === first.module || windowItem.module === second.module
      || windowItem.minimized || windowItem.layoutHidden || windowItem.zIndex <= pairZIndex) return false
    return x >= windowItem.x - 12 && x <= windowItem.x + windowItem.width + 12
      && y >= windowItem.y - 12 && y <= windowItem.y + windowItem.height + 12
  }))
  return availablePoint ? { ...availablePoint, zIndex: pairZIndex + 0.25 } : null
}

function PanelLinkIcon({ locked }: { locked: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {locked ? (
        <>
          <rect x="3" y="7" width="10" height="7" rx="1.5" />
          <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
        </>
      ) : (
        <>
          <path d="M6.2 5.2 5 4a2.1 2.1 0 0 0-3 3l2.4 2.4a2.1 2.1 0 0 0 3 0l1.2-1.2" />
          <path d="M9.8 10.8 11 12a2.1 2.1 0 0 0 3-3l-2.4-2.4a2.1 2.1 0 0 0-3 0L7.4 7.8" />
        </>
      )}
    </svg>
  )
}

function resizeLinkedWindows(
  item: Pick<WorkspaceWindow, 'module' | 'x' | 'y' | 'width' | 'height'>,
  edges: string,
  link: WindowLink,
  windows: WorkspaceWindow[],
  areaWidth: number,
  areaHeight: number,
): Map<AdminModule, WindowBounds> | null {
  const first = windows.find((windowItem) => windowItem.module === link.first)
  const second = windows.find((windowItem) => windowItem.module === link.second)
  if (!first || !second) return null
  const updates = new Map<AdminModule, WindowBounds>()
  const firstBounds: WindowBounds = { x: first.x, y: first.y, width: first.width, height: first.height }
  const secondBounds: WindowBounds = { x: second.x, y: second.y, width: second.width, height: second.height }
  const activeBounds: WindowBounds = { x: item.x, y: item.y, width: item.width, height: item.height }
  let updated = false

  if (link.axis === 'vertical') {
    const movesDivider = (item.module === first.module && edges.includes('e'))
      || (item.module === second.module && edges.includes('w'))
    if (movesDivider) {
      const left = first.x
      const right = second.x + second.width
      const minimumWidth = Math.min(320, areaWidth / 2, (right - left) / 2)
      const desiredDivider = item.module === first.module ? item.x + item.width : item.x
      const divider = clamp(desiredDivider, left + minimumWidth, right - minimumWidth)
      firstBounds.width = divider - left
      secondBounds.x = divider
      secondBounds.width = right - divider
      if (item.module === first.module) {
        firstBounds.y = activeBounds.y
        firstBounds.height = activeBounds.height
      } else {
        secondBounds.y = activeBounds.y
        secondBounds.height = activeBounds.height
      }
      updates.set(first.module, firstBounds)
      updates.set(second.module, secondBounds)
      updated = true
    }
  }

  if (link.axis === 'horizontal') {
    const movesDivider = (item.module === first.module && edges.includes('s'))
      || (item.module === second.module && edges.includes('n'))
    if (movesDivider) {
      const top = first.y
      const bottom = second.y + second.height
      const minimumHeight = Math.min(230, areaHeight / 2, (bottom - top) / 2)
      const desiredDivider = item.module === first.module ? item.y + item.height : item.y
      const divider = clamp(desiredDivider, top + minimumHeight, bottom - minimumHeight)
      firstBounds.height = divider - top
      secondBounds.y = divider
      secondBounds.height = bottom - divider
      if (item.module === first.module) {
        firstBounds.x = activeBounds.x
        firstBounds.width = activeBounds.width
      } else {
        secondBounds.x = activeBounds.x
        secondBounds.width = activeBounds.width
      }
      updates.set(first.module, firstBounds)
      updates.set(second.module, secondBounds)
      updated = true
    }
  }

  return updated ? updates : null
}

export function AdminWorkspace({
  session,
  activeModule,
  loggingOut,
  onModuleChange,
  onSessionExpired,
  onLogout,
}: AdminWorkspaceProps) {
  const zIndexRef = useRef(2)
  const lastActiveModuleRef = useRef(activeModule)
  const workspaceRef = useRef<HTMLDivElement | null>(null)
  const windowLayerRef = useRef<HTMLDivElement | null>(null)
  const windowManagerRef = useRef<HTMLElement | null>(null)
  const windowsRef = useRef<WorkspaceWindow[]>([])
  const windowLinksRef = useRef<WindowLink[]>([])
  const draggedTabRef = useRef<AdminModule | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const snapTargetRef = useRef<WindowSnapTarget | null>(null)
  const paletteInputRef = useRef<HTMLInputElement | null>(null)
  const linkMarkerHideTimerRef = useRef<number | null>(null)
  const sidebarResizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const [windows, setWindows] = useState<WorkspaceWindow[]>([])
  const [windowLinks, setWindowLinks] = useState<WindowLink[]>([])
  const [hoveredWindowEdge, setHoveredWindowEdge] = useState<{ module: AdminModule; edge: string } | null>(null)
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null)
  const [dragOverTab, setDragOverTab] = useState<AdminModule | null>(null)
  const [navigationHidden, setNavigationHidden] = useState(() => {
    try {
      return window.localStorage.getItem('vorqix_command_center_navigation_hidden') !== 'false'
    } catch {
      return false
    }
  })
  const [navigationWidth, setNavigationWidth] = useState(() => {
    try {
      const savedWidth = Number(window.localStorage.getItem('vorqix_command_center_navigation_width'))
      return Number.isFinite(savedWidth) && savedWidth > 0 ? clamp(savedWidth, 190, 420) : 258
    } catch {
      return 258
    }
  })
  const navigationWidthRef = useRef(navigationWidth)
  navigationWidthRef.current = navigationWidth
  const [navigationWidthLocked, setNavigationWidthLocked] = useState(() => {
    try {
      return window.localStorage.getItem('vorqix_command_center_navigation_width_locked') === 'true'
    } catch {
      return false
    }
  })
  const [navigationResizing, setNavigationResizing] = useState(false)
  const [detachedTechnicalPanels, setDetachedTechnicalPanels] = useState<Set<'areas' | 'roles'>>(() => new Set())
  const [selectedTechnicalAreaId, setSelectedTechnicalAreaId] = useState('')
  const [workspaceTabContext, setWorkspaceTabContext] = useState<{ module: AdminModule; x: number; y: number; dropX: number; dropY: number } | null>(null)
  const [paletteProfiles, setPaletteProfiles] = useState<AdminPermissionProfile[]>([])
  const [paletteProfilesError, setPaletteProfilesError] = useState('')
  const [permissionProfileRequest, setPermissionProfileRequest] = useState<{ profile: string; capabilityName?: string; requestId: number } | null>(null)
  const permissionProfileRequestIdRef = useRef(0)
  const [importReimportRequest, setImportReimportRequest] = useState<(AdminImportRetryRequest & { requestId: number; file: File }) | null>(null)
  const importReimportRequestIdRef = useRef(0)
  const [importExportRequest, setImportExportRequest] = useState<{ operation: 'import' | 'export'; section: 'structure' | 'technical' | 'stock' | 'master'; requestId: number } | null>(null)
  const importExportRequestIdRef = useRef(0)
  const userSettingsSequenceRef = useRef(0)
  const [userSettingsByModule, setUserSettingsByModule] = useState<Record<string, UserSettingsContext>>({})
  const [userDataRevision, setUserDataRevision] = useState(0)
  const [discardUserModule, setDiscardUserModule] = useState<AdminModule | null>(null)
  const completedUserSettingsRef = useRef(new Set<string>())
  const [moduleInspectorTarget, setModuleInspectorTarget] = useState<AdminModule>('checklists')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [windowManagerOpen, setWindowManagerOpen] = useState(false)
  const [layoutMoreOpen, setLayoutMoreOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [navigationContextOpen, setNavigationContextOpen] = useState(false)
  const [companyOpen, setCompanyOpen] = useState(false)
  const [companyProfile, setCompanyProfile] = useState<AdminCompanyProfile>(readCachedCompanyProfile)
  const [companyLoadError, setCompanyLoadError] = useState('')
  const [commercialAccess, setCommercialAccess] = useState<AdminCommercialAccess | null>(null)
  const [commercialAccessError, setCommercialAccessError] = useState('')
  const [commercialAccessNotice, setCommercialAccessNotice] = useState('')
  const [workspaceToasts, setWorkspaceToasts] = useState<WorkspaceToast[]>([])
  const toastSequenceRef = useRef(0)
  const toastTimersRef = useRef(new Map<number, number>())
  const [notificationCount, setNotificationCount] = useState<number | null>(null)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const [notificationTarget, setNotificationTarget] = useState<AdminNotificationTarget | null>(null)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [dragging, setDragging] = useState(false)
  const [snapTarget, setSnapTarget] = useState<WindowSnapTarget | null>(null)
  const [windowLayout, setWindowLayout] = useState<WindowLayout>('free')
  const windowLayoutRef = useRef<WindowLayout>(windowLayout)
  windowLayoutRef.current = windowLayout
  const [autoArrange, setAutoArrange] = useState(false)
  const [cacheBaseMb, setCacheBaseMb] = useState(10)
  const [cacheMessage, setCacheMessage] = useState('Uso normal. Nenhuma ação necessária.')
  windowsRef.current = windows
  windowLinksRef.current = windowLinks

  function revealWindowEdgeLink(module: AdminModule, edge: string) {
    if (linkMarkerHideTimerRef.current !== null) {
      window.clearTimeout(linkMarkerHideTimerRef.current)
      linkMarkerHideTimerRef.current = null
    }
    setHoveredWindowEdge({ module, edge })
  }

  function scheduleWindowEdgeLinkHide() {
    if (linkMarkerHideTimerRef.current !== null) window.clearTimeout(linkMarkerHideTimerRef.current)
    linkMarkerHideTimerRef.current = window.setTimeout(() => {
      setHoveredWindowEdge(null)
      linkMarkerHideTimerRef.current = null
    }, 220)
  }

  function persistNavigationWidth(width: number) {
    const nextWidth = clamp(width, 190, 420)
    navigationWidthRef.current = nextWidth
    setNavigationWidth(nextWidth)
    try {
      window.localStorage.setItem('vorqix_command_center_navigation_width', String(nextWidth))
    } catch {
      // A largura atual continua válida durante esta sessão.
    }
  }

  function beginNavigationResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (navigationWidthLocked || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    sidebarResizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: navigationWidthRef.current,
    }
    setNavigationResizing(true)
  }

  function moveNavigationResize(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = sidebarResizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    const nextWidth = clamp(resize.startWidth + event.clientX - resize.startX, 190, 420)
    navigationWidthRef.current = nextWidth
    setNavigationWidth(nextWidth)
  }

  function finishNavigationResize(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = sidebarResizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    sidebarResizeRef.current = null
    setNavigationResizing(false)
    persistNavigationWidth(navigationWidthRef.current)
  }

  useEffect(() => {
    try {
      window.localStorage.setItem('vorqix_command_center_navigation_hidden', String(navigationHidden))
    } catch {
      // A preferência continua ativa na sessão atual mesmo sem armazenamento local.
    }
  }, [navigationHidden])

  useEffect(() => {
    try {
      window.localStorage.setItem('vorqix_command_center_navigation_width_locked', String(navigationWidthLocked))
    } catch {
      // A trava continua ativa durante esta sessão.
    }
  }, [navigationWidthLocked])

  useEffect(() => {
    if (!workspaceTabContext) return undefined
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setWorkspaceTabContext(null)
    }
    window.addEventListener('keydown', dismiss)
    return () => window.removeEventListener('keydown', dismiss)
  }, [workspaceTabContext])

  useEffect(() => () => {
    if (linkMarkerHideTimerRef.current !== null) window.clearTimeout(linkMarkerHideTimerRef.current)
  }, [])

  const pushWorkspaceToast = useCallback((message: string) => {
    const normalizedMessage = message.trim()
    if (!normalizedMessage) return
    const id = ++toastSequenceRef.current
    setWorkspaceToasts((current) => [...current.slice(-2), { id, message: normalizedMessage }])
    const timer = window.setTimeout(() => {
      setWorkspaceToasts((current) => current.filter((toast) => toast.id !== id))
      toastTimersRef.current.delete(id)
    }, 6000)
    toastTimersRef.current.set(id, timer)
  }, [])

  useEffect(() => {
    const layer = windowLayerRef.current
    if (!layer) return undefined
    const seenMessages = new WeakMap<Element, string>()
    const publishNotice = (element: Element) => {
      const copy = element.cloneNode(true) as HTMLElement
      copy.querySelectorAll('button, a').forEach((control) => control.remove())
      const message = (copy.innerText || copy.textContent || '').replace(/\s+/g, ' ').trim()
      if (!message || seenMessages.get(element) === message) return
      seenMessages.set(element, message)
      pushWorkspaceToast(message)
    }
    const scan = (node: Node) => {
      if (!(node instanceof Element)) return
      if (node.matches('.dashboard-notice, .feedback--success')) publishNotice(node)
      node.querySelectorAll('.dashboard-notice, .feedback--success').forEach(publishNotice)
    }
    scan(layer)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') mutation.addedNodes.forEach(scan)
        else if (mutation.target instanceof Element) {
          const notice = mutation.target.closest('.dashboard-notice, .feedback--success')
          if (notice) publishNotice(notice)
        } else if (mutation.target.parentElement) {
          const notice = mutation.target.parentElement.closest('.dashboard-notice, .feedback--success')
          if (notice) publishNotice(notice)
        }
      }
    })
    observer.observe(layer, { subtree: true, childList: true, characterData: true })
    return () => observer.disconnect()
  }, [pushWorkspaceToast])

  useEffect(() => () => {
    toastTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    toastTimersRef.current.clear()
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    const refreshNotifications = () => {
      void getUnreadNotificationCount(controller.signal)
        .then(setNotificationCount)
        .catch((cause) => {
          if (cause instanceof DOMException && cause.name === 'AbortError') return
          setNotificationCount(0)
          if (isGestorAuthenticationError(cause)) onSessionExpired()
        })
    }

    refreshNotifications()
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshNotifications()
    }
    const timer = window.setInterval(refreshNotifications, 12_000)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshNotifications)
    window.addEventListener('online', refreshNotifications)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshNotifications)
      window.removeEventListener('online', refreshNotifications)
    }
  }, [onSessionExpired])

  useEffect(() => {
    const controller = new AbortController()
    void getAdminCommercialAccess(controller.signal)
      .then((access) => {
        setCommercialAccess(access)
        setCommercialAccessError('')
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        if (isGestorAuthenticationError(cause)) {
          onSessionExpired()
          return
        }
        setCommercialAccessError(cause instanceof Error ? cause.message : 'Não foi possível consultar o plano atual.')
      })
    return () => controller.abort()
  }, [onSessionExpired])

  const grantedFeatures = useMemo(
    () => new Set(commercialAccess?.recursos.map((resource) => resource.codigo) ?? []),
    [commercialAccess],
  )

  const visibleModules = useMemo(
    () => MODULES.filter((module) => (
      !ADMIN_MAINTENANCE_MODULES.has(module.id)
      && module.id !== 'module-inspector'
      && (module.id !== 'plan-approvals' || session.user.capacidades?.includes('maintenance.plans.publish') === true)
    )),
    [session.user.capacidades],
  )

  const visibleNavigationGroups = useMemo(
    () => NAVIGATION_GROUPS.map((group) => ({
      ...group,
      modules: visibleModules.filter((module) => group.modules.includes(module.id)),
    })).filter((group) => group.modules.length > 0),
    [visibleModules],
  )

  const isModuleAvailable = useCallback((moduleId: AdminModule) => {
    const accessModuleId = moduleId === 'workforce-areas' || moduleId === 'workforce-roles' ? 'workforce' : moduleId
    const module = getModule(accessModuleId)
    if (ADMIN_MAINTENANCE_MODULES.has(accessModuleId)) return false
    if (accessModuleId === 'plan-approvals' && !session.user.capacidades?.includes('maintenance.plans.publish')) return false
    if (!commercialAccess || !module.feature) return true
    return commercialAccess.status === 'ATIVA' && grantedFeatures.has(module.feature)
  }, [commercialAccess, grantedFeatures, session.user.capacidades])

  const systemModuleStatuses = useMemo<AdminWorkspaceModuleStatus[]>(() => MODULES
    .filter((module) => !ADMIN_MAINTENANCE_MODULES.has(module.id) && module.id !== 'module-inspector' && !module.id.startsWith('imports-') && !module.id.startsWith('exports-'))
    .map((module) => ({
      module: module.id,
      label: module.label,
      feature: module.feature,
      available: isModuleAvailable(module.id),
      open: windows.some((windowItem) => windowItem.module === module.id),
    })), [isModuleAvailable, windows])

  const normalizedPaletteQuery = useMemo(() => paletteQuery
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR'), [paletteQuery])

  const filteredNavigationGroups = useMemo(() => visibleNavigationGroups.map((group) => {
    const normalizedGroup = group.label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR')
    const groupMatches = normalizedPaletteQuery !== '' && normalizedGroup.includes(normalizedPaletteQuery)
    return {
      ...group,
      modules: group.modules.filter((module) => {
        if (!normalizedPaletteQuery || groupMatches) return true
        const normalizedModule = `${module.code} ${module.label} ${module.description} ${module.searchTerms ?? ''}`
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLocaleLowerCase('pt-BR')
        return normalizedModule.includes(normalizedPaletteQuery)
      }),
    }
  }).filter((group) => group.modules.length > 0), [normalizedPaletteQuery, visibleNavigationGroups])

  const filteredPaletteProfiles = useMemo(() => {
    if (!normalizedPaletteQuery) return []
    return paletteProfiles.filter((profile) => (
      profile.editavel && profile.roleType?.toLocaleUpperCase('pt-BR') !== 'ADMIN'
      && `${profile.nome ?? ''} ${profile.perfil} ${profile.roleType ?? ''}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('pt-BR')
        .includes(normalizedPaletteQuery)
    ))
  }, [normalizedPaletteQuery, paletteProfiles])

  const openModule = useCallback((module: AdminModule, notify = true, openInNewPane = false) => {
    const requestedModule = module === 'maintenance' ? 'operations' : module
    if (!isModuleAvailable(requestedModule)) {
      const selected = getModule(requestedModule)
      setCommercialAccessNotice(`${selected.label} não está incluído no plano ${commercialAccess?.plano.nome ?? 'atual'}.`)
      setPaletteOpen(false)
      return
    }
    const nextZIndex = ++zIndexRef.current
    setWindows((current) => {
      const existing = current.find((item) => item.module === requestedModule)
      const activePane = [...current]
        .filter((item) => !item.minimized && !item.layoutHidden)
        .sort((left, right) => right.zIndex - left.zIndex)[0]
      if (existing && openInNewPane && activePane && existing.groupId === activePane.groupId && existing.module !== activePane.module) {
        const layer = windowLayerRef.current?.getBoundingClientRect()
        const placement = findPanePlacement(
          { x: activePane.x, y: activePane.y, width: activePane.width, height: activePane.height },
          current.filter((item) => !item.minimized && !item.layoutHidden),
          layer?.width ?? Math.max(320, window.innerWidth - 300),
          layer?.height ?? Math.max(230, window.innerHeight - 110),
          activePane.groupId,
        )
        const nextZIndex = ++zIndexRef.current
        return current.map((item) => {
          if (item.module === requestedModule) {
            return {
              ...item,
              groupId: `pane-${requestedModule}`,
              x: placement.panel.x,
              y: placement.panel.y,
              width: placement.panel.width,
              height: placement.panel.height,
              minimized: false,
              maximized: false,
              layoutHidden: false,
              tiled: true,
              snapTarget: null,
              restoreBounds: null,
              zIndex: nextZIndex,
            }
          }
          if (item.groupId === activePane.groupId) {
            return { ...item, ...placement.anchor }
          }
          return item
        })
      }
      if (existing) {
        const currentPane = current.find((item) => item.groupId === existing.groupId && !item.minimized && !item.layoutHidden)
        const bounds = currentPane ?? existing
        return current.map((item) => item.groupId === existing.groupId
          ? {
              ...item,
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
              minimized: false,
              layoutHidden: item.module !== requestedModule,
              zIndex: nextZIndex,
            }
          : item)
      }
      const bounds = windowLayerRef.current?.getBoundingClientRect()
      const availableWidth = bounds?.width ?? Math.max(320, window.innerWidth - 300)
      const availableHeight = bounds?.height ?? Math.max(230, window.innerHeight - 110)
      const placement = openInNewPane && activePane
        ? findPanePlacement(
            { x: activePane.x, y: activePane.y, width: activePane.width, height: activePane.height },
            current.filter((item) => !item.minimized && !item.layoutHidden),
            availableWidth,
            availableHeight,
            activePane.groupId,
          )
        : null
      const next = createWindow(requestedModule, current.length, nextZIndex, availableWidth, availableHeight, openInNewPane ? undefined : activePane?.groupId)
      if (activePane) {
        if (placement) {
          next.x = placement.panel.x
          next.y = placement.panel.y
          next.width = placement.panel.width
          next.height = placement.panel.height
          next.tiled = true
          next.maximized = false
          next.restoreBounds = null
          next.snapTarget = null
        } else {
          next.x = activePane.x
          next.y = activePane.y
          next.width = activePane.width
          next.height = activePane.height
          next.maximized = activePane.maximized
          next.tiled = activePane.tiled
          next.snapTarget = activePane.snapTarget
          next.restoreBounds = activePane.restoreBounds
        }
      }
      return [
        ...current.map((item) => {
          if (!activePane || item.groupId !== activePane.groupId) return item
          if (openInNewPane) return placement ? { ...item, ...placement.anchor } : item
          return { ...item, layoutHidden: true }
        }),
        next,
      ]
    })
    setPaletteOpen(false)
    setPaletteQuery('')
    setWindowManagerOpen(false)
    setLayoutMoreOpen(false)
    setProfileOpen(false)
    setCompanyOpen(false)
    setCommercialAccessNotice('')
    if (notify) onModuleChange(requestedModule)
  }, [commercialAccess?.plano.nome, isModuleAvailable, onModuleChange])

  function detachTechnicalPanel(panel: 'areas' | 'roles') {
    setDetachedTechnicalPanels((current) => new Set(current).add(panel))
    openModule(panel === 'areas' ? 'workforce-areas' : 'workforce-roles', true, true)
  }

  const openUserSettings = useCallback((user: AdminUser | null, section: UserSettingsContext['section']) => {
    const module = user
      ? `user-settings:${user.id}` as AdminModule
      : `user-settings:new-${++userSettingsSequenceRef.current}` as AdminModule
    setUserSettingsByModule((current) => ({ ...current, [module]: { user, section, stage: 'form' } }))
    openModule(module, true, true)
  }, [openModule])

  const openCredentialDelivery = useCallback((user: AdminUser, receipt: AccountCredentialReceipt) => {
    const module = `user-settings:delivery-${user.id}-${++userSettingsSequenceRef.current}` as AdminModule
    setUserSettingsByModule((current) => ({
      ...current,
      [module]: { user, section: 'identity', stage: 'email', credentialReceipt: receipt },
    }))
    openModule(module, true, true)
  }, [openModule])

  const notifyPasswordResetSuccess = useCallback((userName: string) => {
    pushWorkspaceToast(`Senha redefinida com sucesso para ${userName}. Envie a senha temporária ao usuário.`)
  }, [pushWorkspaceToast])

  useEffect(() => {
    if (!paletteOpen) return undefined
    const controller = new AbortController()
    setPaletteProfilesError('')
    void getAdminPermissionMatrix(controller.signal)
      .then((matrix) => setPaletteProfiles(matrix.perfis))
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        if (isGestorAuthenticationError(cause)) {
          onSessionExpired()
          return
        }
        setPaletteProfilesError(cause instanceof Error ? cause.message : 'Não foi possível carregar perfis e capacidades.')
      })
    return () => controller.abort()
  }, [onSessionExpired, paletteOpen])

  useEffect(() => {
    if (!commercialAccess) return
    if (activeModule === 'maintenance') {
      onModuleChange('operations')
      return
    }
    setWindows((current) => current.filter((item) => isModuleAvailable(item.module)))
    setWindowLinks((current) => current.filter((link) => isModuleAvailable(link.first) && isModuleAvailable(link.second)))
    if (!isModuleAvailable(activeModule)) onModuleChange('overview')
  }, [activeModule, commercialAccess, isModuleAvailable, onModuleChange])

  useEffect(() => {
    const controller = new AbortController()
    getAdminCompanyProfile(controller.signal)
      .then((profile) => {
        setCompanyProfile(profile)
        cacheCompanyProfile(profile)
        setCompanyLoadError('')
      })
      .catch((cause) => {
        if (controller.signal.aborted) return
        if (isGestorAuthenticationError(cause)) {
          onSessionExpired()
          return
        }
        setCompanyLoadError(cause instanceof Error ? cause.message : 'Não foi possível sincronizar a empresa.')
      })
    return () => controller.abort()
  }, [onSessionExpired])

  useEffect(() => {
    if (lastActiveModuleRef.current === activeModule) return
    lastActiveModuleRef.current = activeModule
    if (!windowsRef.current.some((item) => item.module === activeModule)) {
      openModule(activeModule, false)
    }
  }, [activeModule, openModule])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase('pt-BR') === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
      }
      if (event.key === 'Escape') {
        setPaletteOpen(false)
        setWindowManagerOpen(false)
        setLayoutMoreOpen(false)
        setHelpOpen(false)
        setProfileOpen(false)
        setCompanyOpen(false)
        setNavigationContextOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (!windowManagerOpen) return undefined
    function handleOutsidePointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Element)) return
      if (windowManagerRef.current?.contains(target) || target.closest('[data-window-manager-trigger]')) return
      setWindowManagerOpen(false)
      setLayoutMoreOpen(false)
    }
    document.addEventListener('pointerdown', handleOutsidePointerDown, true)
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown, true)
  }, [windowManagerOpen])

  useEffect(() => {
    if (!paletteOpen) return
    const timeout = window.setTimeout(() => paletteInputRef.current?.focus(), 20)
    return () => window.clearTimeout(timeout)
  }, [paletteOpen])

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const drag = dragRef.current
      const layer = windowLayerRef.current
      if (!drag || !layer) return
      const bounds = layer.getBoundingClientRect()
      if (drag.kind === 'resize') {
        const deltaX = event.clientX - drag.startClientX
        const deltaY = event.clientY - drag.startClientY
        const activeLinks = windowLinksRef.current.filter((link) => link.first === drag.module || link.second === drag.module)
        const resizeLink = activeLinks.find((link) => windowLinkMatchesResize(link, drag.module, drag.edges))
        const linkedFirst = resizeLink ? windowsRef.current.find((item) => item.module === resizeLink.first) : undefined
        const linkedSecond = resizeLink ? windowsRef.current.find((item) => item.module === resizeLink.second) : undefined
        const linkedWidth = linkedFirst && linkedSecond
          ? linkedSecond.x + linkedSecond.width - linkedFirst.x
          : bounds.width
        const linkedHeight = linkedFirst && linkedSecond
          ? linkedSecond.y + linkedSecond.height - linkedFirst.y
          : bounds.height
        const minimumWidth = resizeLink?.axis === 'vertical'
          ? Math.min(320, linkedWidth / 2, bounds.width / 2)
          : Math.min(320, bounds.width)
        const minimumHeight = resizeLink?.axis === 'horizontal'
          ? Math.min(230, linkedHeight / 2, bounds.height / 2)
          : Math.min(230, bounds.height)
        setWindows((current) => {
          const activeItem = current.find((item) => item.module === drag.module)
          if (!activeItem) return current
          let x = drag.startX
          let y = drag.startY
          let width = drag.startWidth
          let height = drag.startHeight
          if (drag.edges.includes('e')) width = clamp(drag.startWidth + deltaX, minimumWidth, bounds.width - drag.startX)
          if (drag.edges.includes('s')) height = clamp(drag.startHeight + deltaY, minimumHeight, bounds.height - drag.startY)
          if (drag.edges.includes('w')) {
            width = clamp(drag.startWidth - deltaX, minimumWidth, drag.startX + drag.startWidth)
            x = drag.startX + drag.startWidth - width
          }
          if (drag.edges.includes('n')) {
            height = clamp(drag.startHeight - deltaY, minimumHeight, drag.startY + drag.startHeight)
            y = drag.startY + drag.startHeight - height
          }
          const resized = { ...activeItem, x, y, width, height }
          const matchingLinks = windowLayoutRef.current === 'free'
            ? activeLinks.filter((link) => windowLinkMatchesResize(link, drag.module, drag.edges))
            : []
          const linkedUpdates = new Map<AdminModule, WindowBounds>()
          let linkedItem = resized
          for (const link of matchingLinks) {
            const linkedCurrent = current.map((windowItem) => {
              const update = linkedUpdates.get(windowItem.module)
              return update ? { ...windowItem, ...update } : windowItem
            })
            const update = resizeLinkedWindows(linkedItem, drag.edges, link, linkedCurrent, bounds.width, bounds.height)
            update?.forEach((value, linkedModule) => linkedUpdates.set(linkedModule, value))
            const activeUpdate = update?.get(drag.module)
            if (activeUpdate) linkedItem = { ...linkedItem, ...activeUpdate }
          }
          if (linkedUpdates.size) {
            return current.map((item) => {
              const linkedBounds = linkedUpdates.get(item.module)
              return linkedBounds
                ? { ...item, ...linkedBounds, tiled: false, maximized: false, snapTarget: null, restoreBounds: null }
                : item
            })
          }
          const linkedModules = new Set(activeLinks.flatMap((link) => [link.first, link.second]))
          const magnetPeers = linkedModules.size
            ? current.filter((item) => !linkedModules.has(item.module) || item.module === drag.module)
            : current
          const position = windowLayoutRef.current === 'free'
            ? magnetizeResizedWindow(resized, drag.edges, magnetPeers, bounds.width, bounds.height)
            : { x, y }
          return current.map((item) => item.module === drag.module
            ? { ...item, ...position, tiled: false, maximized: false, snapTarget: null, restoreBounds: null }
            : item)
        })
        return
      }
      if (!drag.activated) {
        const distance = Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY)
        if (distance < 5) return
        drag.activated = true
        setDragging(true)
        windowLayoutRef.current = 'free'
        setWindowLayout('free')
        setAutoArrange(false)
      }
      const syncGeometry = !drag.geometrySynced
      drag.geometrySynced = true
      const pointerX = event.clientX - bounds.left
      const pointerY = event.clientY - bounds.top
      const activeLayout = windowLayoutRef.current
      const nextSnapTarget = activeLayout === 'free'
        ? null
        : detectSnapTarget(pointerX, pointerY, bounds.width, bounds.height)
      if (nextSnapTarget !== snapTargetRef.current) {
        snapTargetRef.current = nextSnapTarget
        setSnapTarget(nextSnapTarget)
      }
      setWindows((current) => {
        const linkedGroup = getWindowLinkGroup(drag.module, windowLinksRef.current)
        const baseItems = current.map((windowItem) => {
          if (!syncGeometry || !linkedGroup.has(windowItem.module) || (!windowItem.maximized && !windowItem.snapTarget)) return windowItem
          const restored = windowItem.restoreBounds ?? windowItem
          return {
            ...windowItem,
            x: restored.x,
            y: restored.y,
            width: restored.width,
            height: restored.height,
            maximized: false,
            tiled: false,
            snapTarget: null,
            restoreBounds: null,
          }
        })
        const item = baseItems.find((windowItem) => windowItem.module === drag.module)
        if (!item) return current
        const activeItem = syncGeometry
          ? {
              ...item,
              x: item.restoreBounds?.x ?? item.x,
              y: item.restoreBounds?.y ?? item.y,
              width: drag.restoreWidth,
              height: drag.restoreHeight,
              maximized: false,
              tiled: false,
              snapTarget: null,
              restoreBounds: null,
            }
          : item
        const groupItems = baseItems.filter((windowItem) => linkedGroup.has(windowItem.module))
        const minX = Math.min(...groupItems.map((windowItem) => windowItem.x))
        const minY = Math.min(...groupItems.map((windowItem) => windowItem.y))
        const maxRight = Math.max(...groupItems.map((windowItem) => windowItem.x + windowItem.width))
        const maxBottom = Math.max(...groupItems.map((windowItem) => windowItem.y + windowItem.height))
        const nextX = clamp(pointerX - drag.offsetX, 0, Math.max(0, bounds.width - activeItem.width))
        const nextY = clamp(pointerY - drag.offsetY, 0, Math.max(0, bounds.height - Math.min(64, activeItem.height)))
        const groupPeers = baseItems.filter((windowItem) => !linkedGroup.has(windowItem.module))
        const position = activeLayout === 'free'
          ? magnetizeWindowPosition({ ...activeItem, x: nextX, y: nextY }, groupPeers, bounds.width, bounds.height)
          : { x: nextX, y: nextY }
        const deltaX = clamp(position.x - activeItem.x, -minX, Math.max(-minX, bounds.width - maxRight))
        const deltaY = clamp(position.y - activeItem.y, -minY, Math.max(-minY, bounds.height - maxBottom))
        return baseItems.map((windowItem) => {
          if (!linkedGroup.has(windowItem.module)) return windowItem
          const movingItem = windowItem.module === drag.module ? activeItem : windowItem
          return { ...movingItem, x: movingItem.x + deltaX, y: movingItem.y + deltaY }
        })
      })
    }

    function handlePointerUp() {
      const drag = dragRef.current
      const layer = windowLayerRef.current
      const target = snapTargetRef.current
      if (drag?.kind === 'move' && drag.activated && layer && target) {
        const bounds = layer.getBoundingClientRect()
        const nextZIndex = ++zIndexRef.current
        setWindows((current) => current.map((item) => (
          item.module === drag.module
            ? snapWindow(item, target, bounds.width, bounds.height, nextZIndex)
            : item
        )))
      }
      dragRef.current = null
      snapTargetRef.current = null
      setSnapTarget(null)
      setDragging(false)
    }

    function handlePointerCancel() {
      dragRef.current = null
      snapTargetRef.current = null
      setSnapTarget(null)
      setDragging(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }, [])

  function raiseWindow(module: AdminModule) {
    const linkedGroup = getWindowLinkGroup(module, windowLinksRef.current)
    const selected = windowsRef.current.find((item) => item.module === module)
    const linkedGroupIds = new Set([...linkedGroup].map((linkedModule) => windowsRef.current.find((item) => item.module === linkedModule)?.groupId).filter(Boolean))
    setWindows((current) => current.map((item) => (
      item.groupId === selected?.groupId || linkedGroupIds.has(item.groupId)
        ? { ...item, minimized: false, zIndex: ++zIndexRef.current }
        : item
    )))
  }

  function focusWindow(module: AdminModule) {
    const selected = windowsRef.current.find((item) => item.module === module)
    const activePane = selected && windowsRef.current.find((item) => item.groupId === selected.groupId && !item.minimized && !item.layoutHidden)
    if (selected) {
      setWindows((current) => current.map((item) => item.groupId === selected.groupId
        ? {
            ...item,
            x: activePane?.x ?? selected.x,
            y: activePane?.y ?? selected.y,
            width: activePane?.width ?? selected.width,
            height: activePane?.height ?? selected.height,
            maximized: activePane?.maximized ?? selected.maximized,
            tiled: activePane?.tiled ?? selected.tiled,
            snapTarget: activePane?.snapTarget ?? selected.snapTarget,
            restoreBounds: activePane?.restoreBounds ?? selected.restoreBounds,
            minimized: false,
            layoutHidden: item.module !== module,
          }
        : item))
      if (activePane && activePane.module !== module) {
        setWindowLinks((current) => current.map((link) => ({
          ...link,
          first: link.first === activePane.module ? module : link.first,
          second: link.second === activePane.module ? module : link.second,
        })))
      }
    }
    raiseWindow(module)
    onModuleChange(module)
  }

  function beginDrag(event: ReactPointerEvent<HTMLElement>, item: WorkspaceWindow) {
    if ((event.target as HTMLElement).closest('.admin-app-window__chrome-controls, .admin-workspace-editor-tab')) return
    const layer = windowLayerRef.current
    const windowElement = event.currentTarget.closest<HTMLElement>('.admin-app-window')
    if (!layer || !windowElement) return
    const windowBounds = windowElement.getBoundingClientRect()
    const resizeEdges = !item.maximized ? detectResizeEdges(event.clientX, event.clientY, windowBounds) : ''
    if (resizeEdges) {
      beginResize(event, item, resizeEdges)
      return
    }
    const bounds = layer.getBoundingClientRect()
    const pointerX = event.clientX - bounds.left
    const pointerY = event.clientY - bounds.top
    const restoreBounds = item.restoreBounds ?? item
    const restoresOnDrag = item.maximized || Boolean(item.snapTarget)
    const restoredWidth = restoresOnDrag
      ? Math.min(Math.max(680, restoreBounds.width), Math.max(320, bounds.width - 24))
      : windowBounds.width
    const restoredHeight = restoresOnDrag
      ? Math.min(Math.max(460, restoreBounds.height), Math.max(230, bounds.height - 24))
      : windowBounds.height
    const horizontalRatio = restoresOnDrag
      ? clamp((event.clientX - windowBounds.left) / Math.max(1, windowBounds.width), 0.12, 0.88)
      : 0
    dragRef.current = {
      module: item.module,
      kind: 'move',
      edges: '',
      offsetX: restoresOnDrag ? restoredWidth * horizontalRatio : pointerX - item.x,
      offsetY: restoresOnDrag ? Math.min(17, event.clientY - windowBounds.top) : pointerY - item.y,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: item.x,
      startY: item.y,
      startWidth: windowBounds.width,
      startHeight: windowBounds.height,
      activated: false,
      geometrySynced: false,
      restoreWidth: restoredWidth,
      restoreHeight: restoredHeight,
    }
    if (!item.maximized) event.preventDefault()
  }

  function beginResize(event: ReactPointerEvent<HTMLElement>, item: WorkspaceWindow, edges: string) {
    const layer = windowLayerRef.current
    const windowElement = event.currentTarget.closest<HTMLElement>('.admin-app-window')
    if (!layer || !windowElement) return
    const layerBounds = layer.getBoundingClientRect()
    const windowBounds = windowElement.getBoundingClientRect()
    dragRef.current = {
      module: item.module,
      kind: 'resize',
      edges,
      offsetX: 0,
      offsetY: 0,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: windowBounds.left - layerBounds.left,
      startY: windowBounds.top - layerBounds.top,
      startWidth: windowBounds.width,
      startHeight: windowBounds.height,
      activated: true,
      geometrySynced: true,
      restoreWidth: windowBounds.width,
      restoreHeight: windowBounds.height,
    }
    snapTargetRef.current = null
    setSnapTarget(null)
    windowLayoutRef.current = 'free'
    setWindowLayout('free')
    setAutoArrange(false)
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }

  function resizeWindowByKeyboard(module: AdminModule, edges: string, deltaX: number, deltaY: number) {
    const layer = windowLayerRef.current
    if (!layer) return
    const bounds = layer.getBoundingClientRect()
    const activeLink = windowLinksRef.current.find((link) => link.first === module || link.second === module)
    const linkedFirst = activeLink ? windowsRef.current.find((item) => item.module === activeLink.first) : undefined
    const linkedSecond = activeLink ? windowsRef.current.find((item) => item.module === activeLink.second) : undefined
    const linkedWidth = linkedFirst && linkedSecond ? linkedSecond.x + linkedSecond.width - linkedFirst.x : bounds.width
    const linkedHeight = linkedFirst && linkedSecond ? linkedSecond.y + linkedSecond.height - linkedFirst.y : bounds.height
    const minimumWidth = activeLink?.axis === 'vertical'
      ? Math.min(320, linkedWidth / 2, bounds.width / 2)
      : Math.min(320, bounds.width)
    const minimumHeight = activeLink?.axis === 'horizontal'
      ? Math.min(230, linkedHeight / 2, bounds.height / 2)
      : Math.min(230, bounds.height)
    setWindows((current) => {
      const target = current.find((item) => item.module === module)
      if (!target) return current
      let { x, y, width, height } = target
      if (edges.includes('e')) width = clamp(width + deltaX, minimumWidth, bounds.width - x)
      if (edges.includes('s')) height = clamp(height + deltaY, minimumHeight, bounds.height - y)
      if (edges.includes('w')) {
        const nextWidth = clamp(width - deltaX, minimumWidth, x + width)
        x += width - nextWidth
        width = nextWidth
      }
      if (edges.includes('n')) {
        const nextHeight = clamp(height - deltaY, minimumHeight, y + height)
        y += height - nextHeight
        height = nextHeight
      }
      const resized = { ...target, x, y, width, height }
      const linkedResize = activeLink
        ? resizeLinkedWindows(resized, edges, activeLink, current, bounds.width, bounds.height)
        : null
      if (linkedResize) {
        return current.map((item) => {
          const linkedBounds = linkedResize.get(item.module)
          return linkedBounds
            ? { ...item, ...linkedBounds, tiled: false, maximized: false, snapTarget: null, restoreBounds: null }
            : item
        })
      }
      return current.map((item) => item.module === module
        ? { ...item, x, y, width, height, tiled: false, maximized: false, snapTarget: null, restoreBounds: null }
        : item)
    })
  }

  function toggleMaximize(module: AdminModule) {
    const nextZIndex = ++zIndexRef.current
    setWindows((current) => current.map((item) => {
      if (item.module !== module) return item
      if (item.maximized) {
        const restored = item.restoreBounds ?? item
        return {
          ...item,
          x: restored.x,
          y: restored.y,
          width: restored.width,
          height: restored.height,
          minimized: false,
          maximized: false,
          layoutHidden: false,
          tiled: false,
          snapTarget: null,
          restoreBounds: null,
          zIndex: nextZIndex,
        }
      }
      return {
        ...item,
        minimized: false,
        maximized: true,
        layoutHidden: false,
        tiled: true,
        snapTarget: 'maximize',
        restoreBounds: item.restoreBounds ?? {
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
        },
        zIndex: nextZIndex,
      }
    }))
    onModuleChange(module)
  }

  function minimizeWindow(module: AdminModule) {
    const selected = windowsRef.current.find((item) => item.module === module)
    setWindows((current) => current.map((item) => item.groupId === selected?.groupId
      ? { ...item, minimized: true, layoutHidden: false }
      : item))
  }

  function needsUserDiscardConfirmation(module: AdminModule): boolean {
    if (!module.startsWith('user-settings:new-') || completedUserSettingsRef.current.has(module)) return false
    setDiscardUserModule(module)
    return true
  }

  function closeTab(module: AdminModule, discardConfirmed = false) {
    if (!discardConfirmed && needsUserDiscardConfirmation(module)) return
    const closing = windowsRef.current.find((item) => item.module === module)
    if (!closing) return
    if (module === 'workforce-areas' || module === 'workforce-roles') {
      setDetachedTechnicalPanels((current) => {
        const next = new Set(current)
        next.delete(module === 'workforce-areas' ? 'areas' : 'roles')
        return next
      })
    }
    if (module.startsWith('user-settings:')) {
      completedUserSettingsRef.current.delete(module)
      setUserSettingsByModule((current) => {
        const next = { ...current }
        delete next[module]
        return next
      })
    }
    const wasActive = !closing.layoutHidden
    const replacement = windowsRef.current
      .filter((item) => item.groupId === closing.groupId && item.module !== module)
      .sort((left, right) => right.zIndex - left.zIndex)[0]
    setWindows((current) => {
      const remaining = current.filter((item) => item.module !== module)
      if (!wasActive || !replacement) return remaining
      return remaining.map((item) => item.groupId === closing.groupId
        ? {
            ...item,
            x: closing.x,
            y: closing.y,
            width: closing.width,
            height: closing.height,
            minimized: false,
            layoutHidden: item.module !== replacement.module,
            zIndex: item.module === replacement.module ? ++zIndexRef.current : item.zIndex,
          }
        : item)
    })
    setWindowLinks((current) => current.flatMap((link) => {
      if (link.first !== module && link.second !== module) return [link]
      if (!replacement) return []
      const updated = {
        ...link,
        first: link.first === module ? replacement.module : link.first,
        second: link.second === module ? replacement.module : link.second,
      }
      return updated.first === updated.second ? [] : [updated]
    }))
    if (wasActive) {
      const nextActiveModule = replacement?.module ?? windowsRef.current
        .filter((item) => item.groupId !== closing.groupId && !item.minimized && !item.layoutHidden)
        .sort((left, right) => right.zIndex - left.zIndex)[0]?.module
      if (nextActiveModule) onModuleChange(nextActiveModule)
    }
  }

  function closeWindow(module: AdminModule, discardConfirmed = false) {
    if (!discardConfirmed && needsUserDiscardConfirmation(module)) return
    const selected = windowsRef.current.find((item) => item.module === module)
    if (!selected) return
    const closedModules = new Set(windowsRef.current.filter((item) => item.groupId === selected.groupId).map((item) => item.module))
    if (closedModules.has('workforce-areas') || closedModules.has('workforce-roles')) {
      setDetachedTechnicalPanels((current) => {
        const next = new Set(current)
        if (closedModules.has('workforce-areas')) next.delete('areas')
        if (closedModules.has('workforce-roles')) next.delete('roles')
        return next
      })
    }
    if ([...closedModules].some((item) => item.startsWith('user-settings:'))) {
      closedModules.forEach((item) => completedUserSettingsRef.current.delete(item))
      setUserSettingsByModule((current) => Object.fromEntries(
        Object.entries(current).filter(([key]) => !closedModules.has(key as AdminModule)),
      ))
    }
    setWindows((current) => current.filter((item) => item.groupId !== selected.groupId))
    setWindowLinks((current) => current.filter((link) => !closedModules.has(link.first) && !closedModules.has(link.second)))
    const nextActiveModule = windowsRef.current
      .filter((item) => item.groupId !== selected.groupId && !item.minimized && !item.layoutHidden)
      .sort((left, right) => right.zIndex - left.zIndex)[0]?.module
    if (nextActiveModule) onModuleChange(nextActiveModule)
  }

  function reorderTab(draggedModule: AdminModule, targetModule: AdminModule) {
    if (draggedModule === targetModule) return
    const dragged = windowsRef.current.find((item) => item.module === draggedModule)
    const target = windowsRef.current.find((item) => item.module === targetModule)
    if (!dragged || !target || dragged.groupId !== target.groupId) return
    setWindows((current) => {
      const groupTabs = current.filter((item) => item.groupId === dragged.groupId)
      const fromIndex = groupTabs.findIndex((item) => item.module === draggedModule)
      const toIndex = groupTabs.findIndex((item) => item.module === targetModule)
      if (fromIndex < 0 || toIndex < 0) return current
      const nextTabs = [...groupTabs]
      const [movingTab] = nextTabs.splice(fromIndex, 1)
      nextTabs.splice(toIndex, 0, movingTab)
      let nextTabIndex = 0
      return current.map((item) => item.groupId === dragged.groupId ? nextTabs[nextTabIndex++] : item)
    })
  }

  function moveTabToPane(module: AdminModule, targetGroupId: string | null, clientX: number, clientY: number) {
    const source = windowsRef.current.find((item) => item.module === module)
    if (!source) return
    const target = targetGroupId
      ? windowsRef.current.find((item) => item.groupId === targetGroupId && !item.minimized && !item.layoutHidden)
      : undefined
    if (target?.groupId === source.groupId) return

    const sourceActive = windowsRef.current.find((item) => item.groupId === source.groupId && !item.minimized && !item.layoutHidden)
    const sourceReplacement = windowsRef.current
      .filter((item) => item.groupId === source.groupId && item.module !== module)
      .sort((left, right) => right.zIndex - left.zIndex)[0]
    const layer = windowLayerRef.current?.getBoundingClientRect()
    if (!layer) return

    const destinationGroupId = target?.groupId ?? `pane:${module}:${Date.now()}:${++zIndexRef.current}`
    const destinationBounds = target
      ? { x: target.x, y: target.y, width: target.width, height: target.height }
      : {
          x: clamp(clientX - layer.left - Math.min(30, source.width / 2), 0, Math.max(0, layer.width - Math.min(source.width, layer.width))),
          y: clamp(clientY - layer.top - 14, 0, Math.max(0, layer.height - Math.min(source.height, layer.height))),
          width: Math.min(source.width, layer.width),
          height: Math.min(source.height, layer.height),
        }
    const nextZIndex = ++zIndexRef.current

    setWindows((current) => current.map((item) => {
      if (item.module === module) {
        return {
          ...item,
          ...destinationBounds,
          groupId: destinationGroupId,
          minimized: false,
          maximized: false,
          layoutHidden: false,
          tiled: Boolean(target),
          snapTarget: null,
          restoreBounds: null,
          zIndex: nextZIndex,
        }
      }
      if (target && item.groupId === destinationGroupId) {
        return { ...item, ...destinationBounds, layoutHidden: true, minimized: false, zIndex: nextZIndex }
      }
      if (item.groupId === source.groupId && item.module === sourceReplacement?.module && sourceActive?.module === module) {
        return { ...item, minimized: false, layoutHidden: false, zIndex: nextZIndex - 1 }
      }
      return item
    }))
    setWindowLinks((current) => current.flatMap((link) => {
      const remapped = { ...link }
      if (link.first === module) {
        if (!sourceReplacement) return []
        remapped.first = sourceReplacement.module
      }
      if (link.second === module) {
        if (!sourceReplacement) return []
        remapped.second = sourceReplacement.module
      }
      if (target && link.first === target.module) remapped.first = module
      if (target && link.second === target.module) remapped.second = module
      return remapped.first === remapped.second ? [] : [remapped]
    }))
    onModuleChange(module)
  }

  function toggleWindowLink(link: WindowLink) {
    const existing = windowLinksRef.current.find((candidate) => sameWindowLink(candidate, link))
    if (existing) {
      setWindowLinks((current) => current.filter((candidate) => !sameWindowLink(candidate, existing)))
      return
    }
    setWindows((current) => {
      const first = current.find((windowItem) => windowItem.module === link.first)
      const second = current.find((windowItem) => windowItem.module === link.second)
      if (!first || !second) return current
      if (link.axis === 'vertical') {
        const outerLeft = first.x
        const outerRight = second.x + second.width
        const minimumWidth = Math.min(320, (outerRight - outerLeft) / 2)
        const divider = clamp((first.x + first.width + second.x) / 2, outerLeft + minimumWidth, outerRight - minimumWidth)
        return current.map((windowItem) => {
          if (windowItem.module === first.module) return { ...windowItem, width: divider - outerLeft }
          if (windowItem.module === second.module) return { ...windowItem, x: divider, width: outerRight - divider }
          return windowItem
        })
      }
      const outerTop = first.y
      const outerBottom = second.y + second.height
      const minimumHeight = Math.min(230, (outerBottom - outerTop) / 2)
      const divider = clamp((first.y + first.height + second.y) / 2, outerTop + minimumHeight, outerBottom - minimumHeight)
      return current.map((windowItem) => {
        if (windowItem.module === first.module) return { ...windowItem, height: divider - outerTop }
        if (windowItem.module === second.module) return { ...windowItem, y: divider, height: outerBottom - divider }
        return windowItem
      })
    })
    setWindowLinks((current) => current.some((candidate) => sameWindowLink(candidate, link)) ? current : [...current, link])
  }

  const arrangeWindows = useCallback((layout: WindowLayout) => {
    if (windowLinksRef.current.length) return
    const layer = windowLayerRef.current
    if (!layer) return
    const bounds = layer.getBoundingClientRect()
    const freeGap = 10
    const divider = 1

    setWindows((current) => current.map((item) => {
      const available = current.filter((windowItem) => !windowItem.minimized && (layout !== 'free' || !windowItem.layoutHidden))
      const focused = [...available].sort((left, right) => right.zIndex - left.zIndex)[0]
      const arranged = layout === 'focus' && focused ? [focused] : available
      const index = arranged.findIndex((visibleItem) => visibleItem.module === item.module)
      if (layout === 'focus' && !item.minimized && item.module !== focused?.module) {
        return { ...item, layoutHidden: true }
      }
      if (index < 0) return item

      if (layout === 'focus') {
        return {
          ...item,
          maximized: true,
          layoutHidden: false,
          tiled: true,
          snapTarget: 'maximize',
          restoreBounds: item.restoreBounds ?? {
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
          },
          zIndex: ++zIndexRef.current,
        }
      }

      if (layout === 'free') {
        const wasArranged = item.tiled || item.maximized
        if (!wasArranged) {
          return {
            ...item,
            layoutHidden: false,
            x: clamp(item.x, 0, Math.max(0, bounds.width - item.width)),
            y: clamp(item.y, 0, Math.max(0, bounds.height - item.height)),
          }
        }
        const width = Math.min(bounds.width, Math.max(Math.min(420, bounds.width), Math.min(900, bounds.width * 0.78)))
        const height = Math.min(bounds.height, Math.max(Math.min(320, bounds.height), Math.min(650, bounds.height * 0.8)))
        const x = clamp((bounds.width - width) / 2 + index * 24, 0, Math.max(0, bounds.width - width))
        const y = clamp((bounds.height - height) / 2 + index * 24, 0, Math.max(0, bounds.height - height))
        return {
          ...item,
          groupId: `pane-${item.module}`,
          x,
          y,
          width,
          height,
          maximized: false,
          layoutHidden: false,
          tiled: false,
          snapTarget: null,
          restoreBounds: null,
          zIndex: ++zIndexRef.current,
        }
      }

      if (layout === 'cascade') {
        const windowWidth = Math.min(bounds.width, Math.max(320, Math.min(1040, bounds.width - 90)))
        const windowHeight = Math.min(bounds.height, Math.max(230, Math.min(700, bounds.height - 90)))
        return {
          ...item,
          groupId: `pane-${item.module}`,
          maximized: false,
          layoutHidden: false,
          tiled: false,
          snapTarget: null,
          restoreBounds: null,
          x: Math.min(freeGap + index * 28, Math.max(0, bounds.width - windowWidth)),
          y: Math.min(freeGap + index * 28, Math.max(0, bounds.height - windowHeight)),
          width: windowWidth,
          height: windowHeight,
          zIndex: ++zIndexRef.current,
        }
      }

      const count = arranged.length
      const columns = layout === 'columns'
        ? Math.min(2, count)
        : layout === 'rows'
          ? Math.ceil(count / Math.min(2, count))
          : layout === 'grid'
            ? Math.ceil(Math.sqrt(count))
            : count === 1
              ? 1
              : count === 2
                ? 2
                : Math.ceil(Math.sqrt(count))
      const rows = Math.ceil(count / columns)
      const column = index % columns
      const row = Math.floor(index / columns)
      const width = Math.max(1, (bounds.width - divider * (columns - 1)) / columns)
      const height = Math.max(1, (bounds.height - divider * (rows - 1)) / rows)
      return {
        ...item,
        groupId: `pane-${item.module}`,
        maximized: layout === 'smart' && count === 1,
        layoutHidden: false,
        tiled: true,
        snapTarget: null,
        restoreBounds: null,
        x: column * (width + divider),
        y: row * (height + divider),
        width,
        height,
        zIndex: ++zIndexRef.current,
      }
    }))
    setWindowLayout(layout)
    windowLayoutRef.current = layout
    setAutoArrange(layout === 'smart')
    setLayoutMoreOpen(false)
  }, [])

  useEffect(() => {
    if (!autoArrange || windows.length < 2) return
    arrangeWindows(windowLayout)
  }, [arrangeWindows, autoArrange, windowLayout, windows.length])

  useEffect(() => {
    const layer = windowLayerRef.current
    if (!layer) return undefined
    let previous = layer.getBoundingClientRect()
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const nextWidth = entry.contentRect.width
      const nextHeight = entry.contentRect.height
      if (!nextWidth || !nextHeight) return
      const widthChanged = Math.abs(nextWidth - previous.width) > 1
      const heightChanged = Math.abs(nextHeight - previous.height) > 1
      if (!widthChanged && !heightChanged) return
      const previousWidth = previous.width
      const previousHeight = previous.height
      previous = { ...previous, width: nextWidth, height: nextHeight }
      if (autoArrange && windowLayout !== 'free') {
        arrangeWindows(windowLayout)
        return
      }
      const widthRatio = nextWidth / Math.max(1, previousWidth)
      const heightRatio = nextHeight / Math.max(1, previousHeight)
      setWindows((current) => current.map((item) => {
        if (item.maximized || item.minimized || item.layoutHidden) return item
        const nextWindowWidth = item.tiled
          ? Math.min(nextWidth, Math.max(1, item.width * widthRatio))
          : Math.min(nextWidth, item.width)
        const nextWindowHeight = item.tiled
          ? Math.min(nextHeight, Math.max(1, item.height * heightRatio))
          : Math.min(nextHeight, item.height)
        return {
          ...item,
          x: clamp(item.x * widthRatio, 0, Math.max(0, nextWidth - nextWindowWidth)),
          y: clamp(item.y * heightRatio, 0, Math.max(0, nextHeight - nextWindowHeight)),
          width: nextWindowWidth,
          height: nextWindowHeight,
        }
      }))
    })
    observer.observe(layer)
    return () => observer.disconnect()
  }, [arrangeWindows, autoArrange, windowLayout])

  const visibleWindowCount = windows.filter((item) => !item.minimized && !item.layoutHidden).length
  const memoryMb = cacheBaseMb + windows.length * 7
  const memoryPercent = Math.min(96, Math.max(7, Math.round(memoryMb / 1.15)))
  const linkMarkers = new Map<string, { link: WindowLink; locked: boolean; point: { x: number; y: number; zIndex: number } }>()
  for (const link of windowLinks) {
    const point = getWindowLinkMarker(link, windows)
    if (point) linkMarkers.set(`${link.axis}:${link.first}:${link.second}`, { link, locked: true, point })
  }
  for (const item of windows) {
    for (const link of findAdjacentWindowLinks(item, windows)) {
      const key = `${link.axis}:${link.first}:${link.second}`
      if (linkMarkers.has(key)) continue
      const point = getWindowLinkMarker(link, windows)
      if (point) linkMarkers.set(key, { link, locked: false, point })
    }
  }
  const visibleLinkMarkers = hoveredWindowEdge
    ? [...linkMarkers.values()].filter(({ link }) => {
      if (link.axis === 'vertical') {
        return (link.first === hoveredWindowEdge.module && hoveredWindowEdge.edge === 'e')
          || (link.second === hoveredWindowEdge.module && hoveredWindowEdge.edge === 'w')
      }
      return (link.first === hoveredWindowEdge.module && hoveredWindowEdge.edge === 's')
        || (link.second === hoveredWindowEdge.module && hoveredWindowEdge.edge === 'n')
    })
    : []
  const linkMarkerTopZIndex = Math.max(0, ...windows.map((item) => item.zIndex)) + 100

  function optimizeCache() {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith('fab_control_workspace_cache_'))
      .forEach((key) => window.localStorage.removeItem(key))
    setCacheBaseMb(8)
    setCacheMessage('Cache local limpo.')
  }

  async function handleSaveCompany(profile: Pick<AdminCompanyProfile, 'nome' | 'logo_data_url'>) {
    try {
      const result = await saveAdminCompanyProfile(profile)
      setCompanyProfile(result.empresa)
      cacheCompanyProfile(result.empresa)
      setCompanyLoadError('')
      setCompanyOpen(false)
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) onSessionExpired()
      throw cause
    }
  }

  async function handleOpenNotification(notification: GestorNotification) {
    const notificationType = String(notification.tipo ?? '').trim().toUpperCase()
    let entityType = String(notification.entidade_tipo ?? '').trim().toUpperCase()
    let entityId = String(notification.entidade_id ?? '').trim()

    if (entityType === 'DEMANDAS_TECNICAS' && entityId) {
      const demand = (await listAdminTechnicalDemands())
        .find((item) => String(item.id) === entityId)
      if (!demand) {
        throw new Error('A demanda vinculada a esta notificação não foi encontrada no histórico técnico.')
      }
      entityType = String(demand.entidade_tipo ?? '').trim().toUpperCase()
      entityId = String(demand.entidade_id ?? '').trim()
    }

    if (!entityId) {
      throw new Error('Esta notificação não possui um registro de destino válido.')
    }

    setNotificationTarget({
      notificationType,
      entityType,
      entityId,
      nonce: Date.now(),
    })

    if (
      notificationType === 'SOLICITACAO_CHECKLIST' &&
      entityType === 'ANALISES_TECNICAS'
    ) {
      openModule('checklists')
      return
    }

    if (
      notificationType === 'SOLICITACAO_INTERVENCAO' ||
      notificationType === 'ANALISE_TECNICA' ||
      entityType === 'ANALISES_TECNICAS'
    ) {
      openModule('operations')
      return
    }

    if (
      entityType === 'PLANOS_MANUTENCAO' ||
      entityType === 'CHECKLIST_MODELO' ||
      entityType === 'PLANO_CHECKLIST'
    ) {
      openModule('checklists')
      return
    }

    if (
      entityType === 'ORDEM_SERVICO_RASCUNHO' ||
      entityType === 'ORDENS_SERVICO' ||
      entityType === 'OS_ACOES' ||
      entityType === 'OCORRENCIAS_OPERACIONAIS'
    ) {
      openModule('operations')
      return
    }

    if (entityType === 'ATIVOS' || entityType === 'COMPONENTES') {
      openModule('assets')
      return
    }

    throw new Error(`O destino ${entityType || 'desconhecido'} ainda não possui uma tela vinculada.`)
  }

  const renderNavigationModule = (module: WorkspaceModule) => {
    const { id, label, description, Icon } = module
    const windowItem = windows.find((item) => item.module === id)
    const focused = windowItem && windowItem.zIndex === Math.max(0, ...windows.map((item) => item.zIndex))
    const available = isModuleAvailable(id)
    return (
      <div className="admin-command-center-nav-entry" key={id}>
        <button
          type="button"
          className={`${focused && !windowItem?.minimized ? 'is-active' : ''}${available ? '' : ' is-locked'}`}
          data-tip={available ? label : `${label} · não incluído no plano`}
          title={`${label} — ${description}${available ? '' : ' · Não incluído no plano'}`}
          aria-label={available ? label : `${label}: não incluído no plano`}
          aria-disabled={!available}
          aria-current={focused && !windowItem?.minimized ? 'page' : undefined}
          onClick={() => openModule(id)}
        >
          <Icon />
          <span className="admin-command-center-nav-item__copy"><strong>{label}</strong></span>
          {windowItem?.minimized ? <i aria-hidden="true" /> : null}
        </button>
      </div>
    )
  }

  const contextWindow = workspaceTabContext
    ? windows.find((item) => item.module === workspaceTabContext.module)
    : undefined
  const contextGroupSize = contextWindow
    ? windows.filter((item) => item.groupId === contextWindow.groupId).length
    : 0

  return (
    <div
      className={`admin-desktop-shell admin-command-center-shell${dragging ? ' is-dragging' : ''}${navigationHidden ? ' is-navigation-hidden' : ''}${navigationResizing ? ' is-navigation-resizing' : ''}`}
      style={{ '--admin-rail': `${navigationWidth}px` } as CSSProperties}
    >
      <section className="admin-command-mobile-block">
        <ShieldIcon />
        <h1>Centro de Comando VORQIX</h1>
        <p>Amplie a janela para pelo menos 901 px para acessar o Centro de Comando.</p>
        <button type="button" disabled={loggingOut} onClick={onLogout}>{loggingOut ? 'Saindo…' : 'Sair'}</button>
      </section>

      <header className="admin-desktop-topbar">
        <button
          className="admin-desktop-brand admin-desktop-brand-toggle"
          type="button"
          title={navigationHidden ? 'Mostrar navegação' : 'Ocultar navegação'}
          aria-label="VORQIX — alternar barra lateral"
          aria-expanded={!navigationHidden}
          onClick={() => setNavigationHidden((current) => !current)}
          onContextMenu={(event) => {
            event.preventDefault()
            setNavigationContextOpen((current) => !current)
          }}
        >
          <img src="/vorqix-logo.png" alt="VORQIX — Unidade Industrial" />
        </button>
        {navigationContextOpen ? (
          <div className="admin-navigation-context-menu" role="menu" aria-label="Barra lateral">
            <button type="button" role="menuitem" onClick={() => { setNavigationHidden((current) => !current); setNavigationContextOpen(false) }}>
              {navigationHidden ? 'Mostrar barra lateral' : 'Ocultar barra lateral'}
            </button>
          </div>
        ) : null}

        <button className="admin-desktop-command" type="button" onClick={() => setPaletteOpen(true)}>
          <span>Buscar funções, módulos e perfis — Ctrl + K</span>
        </button>

        <div className="admin-desktop-top-actions">
          <button data-window-manager-trigger type="button" title="Gerenciador de janelas" aria-label="Gerenciador de janelas" onClick={() => setWindowManagerOpen((current) => !current)}><WindowsIcon /></button>
          <button
            className="admin-notification-button"
            type="button"
            title={notificationCount ? `${notificationCount} notificação(ões) operacional(is) não lida(s)` : 'Central de alertas e atividade'}
            aria-label={notificationCount ? `Central de alertas: ${notificationCount} notificação(ões) operacional(is) não lida(s)` : 'Abrir central de alertas e atividade'}
            aria-haspopup="dialog"
            aria-expanded={notificationOpen}
            onClick={() => setNotificationOpen(true)}
          >
            <BellIcon />
            {notificationCount ? <span>{notificationCount > 99 ? '99+' : notificationCount}</span> : null}
          </button>
          <button type="button" title="Central de ajuda" aria-label="Central de ajuda" onClick={() => setHelpOpen(true)}>?</button>
          <button
            className="admin-desktop-avatar"
            type="button"
            aria-label="Abrir menu do perfil"
            aria-expanded={profileOpen}
            onClick={() => setProfileOpen((current) => !current)}
          >
            TI
          </button>
          {profileOpen ? (
            <aside className="admin-profile-menu" aria-label="Menu do perfil">
              <header><span>TI</span><div><strong>Equipe de TI</strong><small>{companyProfile.nome}</small></div></header>
              <button type="button" aria-disabled={!isModuleAvailable('configuration')} title="Preparar, validar e publicar configurações versionadas" onClick={() => openModule('configuration')}>Configurações avançadas</button>
              <button type="button" aria-disabled={!isModuleAvailable('users')} title="O painel não oferece edição do perfil pessoal" onClick={() => openModule('users')}>Usuários e acessos</button>
              <button type="button" disabled={loggingOut} onClick={onLogout}>{loggingOut ? 'Saindo…' : 'Sair'}</button>
            </aside>
          ) : null}
        </div>
      </header>

      <div className="admin-desktop-content">
        <nav className="admin-desktop-rail" aria-label="Navegação do Centro de Comando">
          {visibleNavigationGroups.map((group) => (
            <section className="admin-command-center-nav-group" key={group.id} aria-labelledby={`admin-nav-group-${group.id}`}>
              <header>
                <strong id={`admin-nav-group-${group.id}`}>{group.label}</strong>
              </header>
              <div className="admin-command-center-nav-items">
          {group.modules.map((module) => renderNavigationModule(module))}
              </div>
            </section>
          ))}
        </nav>

        {workspaceTabContext ? (
          <>
            <button className="admin-workspace-group-menu-dismiss" type="button" aria-label="Fechar opções do grupo" onClick={() => setWorkspaceTabContext(null)} />
            <aside className="admin-workspace-group-menu" style={{ left: workspaceTabContext.x, top: workspaceTabContext.y }} aria-label={`Opções do grupo ${getModule(workspaceTabContext.module).label}`}>
              <strong>{getModule(workspaceTabContext.module).label}</strong>
              {contextGroupSize > 1 ? (
                <button type="button" onClick={() => {
                  moveTabToPane(workspaceTabContext.module, null, workspaceTabContext.dropX, workspaceTabContext.dropY)
                  setWorkspaceTabContext(null)
                }}>Desprender grupo em painel próprio</button>
              ) : <small>Este módulo já está em um painel próprio.</small>}
            </aside>
          </>
        ) : null}

        {!navigationHidden ? (
          <div className={`admin-sidebar-resizer${navigationWidthLocked ? ' is-locked' : ''}`}>
            <div
              className="admin-sidebar-resizer__drag"
              role="separator"
              aria-label="Redimensionar barra lateral"
              aria-orientation="vertical"
              aria-valuemin={190}
              aria-valuemax={420}
              aria-valuenow={Math.round(navigationWidth)}
              aria-valuetext={`${Math.round(navigationWidth)} pixels`}
              tabIndex={navigationWidthLocked ? -1 : 0}
              onPointerDown={beginNavigationResize}
              onPointerMove={moveNavigationResize}
              onPointerUp={finishNavigationResize}
              onPointerCancel={finishNavigationResize}
              onLostPointerCapture={finishNavigationResize}
              onKeyDown={(event) => {
                if (navigationWidthLocked) return
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault()
                  persistNavigationWidth(navigationWidthRef.current + (event.key === 'ArrowRight' ? 16 : -16))
                }
              }}
            />
            <button
              className="admin-sidebar-resizer__lock"
              type="button"
              aria-label={navigationWidthLocked ? 'Destravar largura da barra lateral' : 'Travar largura da barra lateral'}
              aria-pressed={navigationWidthLocked}
              title={navigationWidthLocked ? 'Destravar largura da barra lateral' : 'Travar largura da barra lateral'}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setNavigationWidthLocked((locked) => !locked)}
            >
              <PanelLinkIcon locked={navigationWidthLocked} />
            </button>
          </div>
        ) : null}

        <div
          className="admin-desktop-workspace"
          ref={workspaceRef}
          onDragOver={(event) => {
            if (!draggedTabRef.current) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
          }}
          onDrop={(event) => {
            const target = event.target as HTMLElement
            if (target.closest('.admin-app-window')) return
            const draggedModule = draggedTabRef.current ?? event.dataTransfer.getData('text/plain') as AdminModule
            if (!draggedModule) return
            event.preventDefault()
            event.stopPropagation()
            draggedTabRef.current = null
            setDragOverGroup(null)
            setDragOverTab(null)
            moveTabToPane(draggedModule, null, event.clientX, event.clientY)
          }}
        >
          {commercialAccessNotice ? (
            <div className="admin-commercial-notice" role="status">
              <ShieldIcon />
              <span>{commercialAccessNotice}</span>
              <button type="button" aria-label="Fechar aviso do plano" onClick={() => setCommercialAccessNotice('')}>×</button>
            </div>
          ) : null}
          {!visibleWindowCount ? (
            <section className="admin-desktop-welcome">
              <div className="admin-welcome-card">
                <div className="admin-welcome-copy">
                  <img className="vorqix-logo" src="/vorqix-logo.png" alt="VORQIX — Unidade Industrial" />
                  <h1>Centro de Comando VORQIX</h1>
                  <p>Usuários, permissões e configurações do ambiente.</p>
                  <div className="admin-welcome-actions">
                    <button type="button" onClick={() => openModule('overview')}>Integridade do sistema</button>
                    <button type="button" onClick={() => setPaletteOpen(true)}><SearchIcon />Buscar módulos</button>
                  </div>
                  <small className="admin-welcome-help"><b>⌘</b> <kbd>Ctrl</kbd> + <kbd>K</kbd></small>
                </div>
                <aside className="admin-welcome-capabilities admin-command-center-context" aria-label="Contexto do ambiente atual">
                  <header>
                    <span>CONTEXTO ATUAL</span>
                    <i className={commercialAccess?.status === 'BLOQUEADA' || commercialAccessError ? 'is-alert' : ''} aria-hidden="true" />
                  </header>
                  <article><FactoryIcon /><span><strong>Empresa</strong><small>{companyProfile.nome}</small></span></article>
                  <article><ShieldIcon /><span><strong>Plano</strong><small>{commercialAccess ? commercialAccess.plano.nome : commercialAccessError ? 'Indisponível' : 'Consultando…'}</small></span></article>
                  <article><SettingsIcon /><span><strong>Estado do acesso</strong><small>{commercialAccess ? (commercialAccess.status === 'ATIVA' ? 'Ativo' : 'Bloqueado') : commercialAccessError ? 'Não foi possível consultar' : 'Verificando'}</small></span></article>
                  {commercialAccess ? <small className="admin-command-center-resource-count">{commercialAccess.recursos.length} recurso(s) no plano atual</small> : null}
                </aside>
              </div>
            </section>
          ) : null}

          <div
            className="admin-desktop-window-layer"
            ref={windowLayerRef}
          >
            {snapTarget ? <div className={`admin-window-snap-preview is-${snapTarget}`} aria-hidden="true"><span>{snapTarget === 'maximize' ? 'Maximizar' : snapTarget === 'left' ? 'Metade esquerda' : snapTarget === 'right' ? 'Metade direita' : snapTarget === 'top' ? 'Metade superior' : snapTarget === 'bottom' ? 'Metade inferior' : 'Quadrante'}</span></div> : null}
            {windows.map((item) => {
              const userSettingsContext = userSettingsByModule[item.module]
              const baseModule = getModule(item.module)
              const module = userSettingsContext
                ? { ...baseModule, label: userSettingsContext.stage === 'email' ? 'Preparar e-mail' : userSettingsContext.user ? 'Editar' : 'Novo usuário' }
                : baseModule
              const isFocusedWindow = item.zIndex === Math.max(0, ...windows.map((windowItem) => windowItem.zIndex))
              const groupTabs = windows.filter((windowItem) => windowItem.groupId === item.groupId)
              const linkedEdges = new Set(windowLinks.flatMap((link) => {
                if (link.axis === 'vertical') {
                  return link.first === item.module ? ['right'] : link.second === item.module ? ['left'] : []
                }
                return link.first === item.module ? ['bottom'] : link.second === item.module ? ['top'] : []
              }))
              return (
                <section
                  key={item.module}
                  className={`admin-app-window${item.maximized ? ' is-maximized' : ''}${item.tiled ? ' is-tiled' : ''}${item.minimized ? ' is-minimized' : ''}${item.layoutHidden ? ' is-layout-hidden' : ''}${dragOverGroup === item.groupId ? ' is-tab-drop-target' : ''}`}
                  style={{
                    left: item.x,
                    top: item.y,
                    width: item.width,
                    height: item.height,
                    zIndex: item.zIndex,
                  }}
                  aria-label={module.label}
                  onPointerDownCapture={(event) => {
                    if (event.button !== 0) return
                    raiseWindow(item.module)
                  }}
                  onDragOver={(event) => {
                    const draggedModule = draggedTabRef.current
                    const source = draggedModule ? windowsRef.current.find((windowItem) => windowItem.module === draggedModule) : null
                    if (!draggedModule || source?.groupId === item.groupId) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    setDragOverGroup(item.groupId)
                  }}
                  onDragLeave={(event) => {
                    if (event.currentTarget === event.target) setDragOverGroup(null)
                  }}
                  onDrop={(event) => {
                    const draggedModule = draggedTabRef.current ?? event.dataTransfer.getData('text/plain') as AdminModule
                    if (!draggedModule) return
                    event.preventDefault()
                    event.stopPropagation()
                    setDragOverGroup(null)
                    setDragOverTab(null)
                    draggedTabRef.current = null
                    moveTabToPane(draggedModule, item.groupId, event.clientX, event.clientY)
                  }}
                  onPointerDown={(event) => {
                    const target = event.target as HTMLElement
                    if (target.closest('.admin-window-resize-handle')) return
                    if (item.maximized) {
                      beginDrag(event, item)
                      return
                    }
                    if (target.closest('button, input, select, textarea, a')) {
                      focusWindow(item.module)
                      return
                    }
                    const edges = detectResizeEdges(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
                    if (edges) {
                      beginResize(event, item, edges)
                      return
                    }
                    if (target.closest('.admin-window-module-heading')) {
                      beginDrag(event, item)
                      return
                    }
                    focusWindow(item.module)
                  }}
                  onDoubleClick={(event) => {
                    const target = event.target as HTMLElement
                    if (target.closest('.admin-app-window__chrome-controls, input, select, textarea, a')) return
                    if (detectResizeEdges(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())) {
                      event.preventDefault()
                      toggleMaximize(item.module)
                    }
                  }}
                >
                  <div
                    className="admin-workspace-editor-tabs"
                    onPointerDown={(event) => beginDrag(event, item)}
                    onDoubleClick={() => toggleMaximize(item.module)}
                  >
                    {groupTabs.map((tab) => {
                      const tabBaseModule = getModule(tab.module)
                      const tabContext = userSettingsByModule[tab.module]
                      const tabModule = tabContext
                        ? { ...tabBaseModule, label: tabContext.stage === 'email' ? 'Preparar e-mail' : tabContext.user ? 'Editar' : 'Novo usuário' }
                        : tabBaseModule
                      const isActiveTab = tab.module === item.module && !item.layoutHidden
                      return (
                        <div className={`admin-workspace-editor-tab-item${dragOverTab === tab.module ? ' is-drop-target' : ''}`} key={tab.module}>
                          <button
                            className={`admin-workspace-editor-tab${isActiveTab ? ' is-active' : ''}`}
                            type="button"
                            draggable
                            aria-current={isActiveTab ? 'page' : undefined}
                            title={`${tabModule.label} · arraste para outro painel`}
                            onClick={() => focusWindow(tab.module)}
                            onPointerDown={(event) => event.stopPropagation()}
                            onContextMenu={(event) => {
                              event.preventDefault()
                              setWorkspaceTabContext({
                                module: tab.module,
                                x: Math.max(8, Math.min(event.clientX, window.innerWidth - 220)),
                                y: Math.max(8, Math.min(event.clientY, window.innerHeight - 88)),
                                dropX: event.clientX,
                                dropY: event.clientY,
                              })
                            }}
                            onDragStart={(event) => {
                              draggedTabRef.current = tab.module
                              event.dataTransfer.effectAllowed = 'move'
                              event.dataTransfer.setData('text/plain', tab.module)
                              setDragOverGroup(null)
                              setDragOverTab(null)
                            }}
                            onDragEnd={() => {
                              draggedTabRef.current = null
                              setDragOverGroup(null)
                              setDragOverTab(null)
                            }}
                            onDragOver={(event) => {
                              if (!draggedTabRef.current || draggedTabRef.current === tab.module) return
                              event.preventDefault()
                              event.dataTransfer.dropEffect = 'move'
                              setDragOverTab(tab.module)
                            }}
                            onDrop={(event) => {
                              const draggedModule = draggedTabRef.current ?? event.dataTransfer.getData('text/plain') as AdminModule
                              if (!draggedModule) return
                              event.preventDefault()
                              event.stopPropagation()
                              const source = windowsRef.current.find((windowItem) => windowItem.module === draggedModule)
                              if (source?.groupId === tab.groupId) reorderTab(draggedModule, tab.module)
                              else moveTabToPane(draggedModule, tab.groupId, event.clientX, event.clientY)
                              draggedTabRef.current = null
                              setDragOverGroup(null)
                              setDragOverTab(null)
                            }}
                          >
                            <span>{tabModule.label}</span>
                          </button>
                          <button
                            className="admin-workspace-editor-tab-close"
                            type="button"
                            aria-label={`Fechar aba ${tabModule.label}`}
                            title={`Fechar aba ${tabModule.label}`}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={() => closeTab(tab.module)}
                          >×</button>
                        </div>
                      )
                    })}
                    <div className="admin-app-window__chrome-controls" onPointerDown={(event) => event.stopPropagation()}>
                      <button type="button" aria-label={`Minimizar ${module.label}`} title="Minimizar" onClick={() => minimizeWindow(item.module)}>—</button>
                      <button type="button" aria-label={`${item.maximized ? 'Restaurar' : 'Maximizar'} ${module.label}`} title={item.maximized ? 'Restaurar' : 'Maximizar'} onClick={() => toggleMaximize(item.module)}>{item.maximized ? '❐' : '□'}</button>
                      <button className="is-close" type="button" aria-label={`Fechar painel ${module.label}`} title="Fechar painel" onClick={() => closeWindow(item.module)}>×</button>
                    </div>
                  </div>
                  <div className="admin-window-resize-handles" aria-label={`Redimensionar ${module.label}`}>
                      {[
                        ['n', 'top', 'Redimensionar pela borda superior'],
                        ['s', 'bottom', 'Redimensionar pela borda inferior'],
                        ['e', 'right', 'Redimensionar pela borda direita'],
                        ['w', 'left', 'Redimensionar pela borda esquerda'],
                        ['ne', 'top-right', 'Redimensionar pelo canto superior direito'],
                        ['nw', 'top-left', 'Redimensionar pelo canto superior esquerdo'],
                        ['se', 'bottom-right', 'Redimensionar pelo canto inferior direito'],
                        ['sw', 'bottom-left', 'Redimensionar pelo canto inferior esquerdo'],
                      ].map(([edges, position, label]) => (
                        <button
                          key={position}
                          type="button"
                          className={`admin-window-resize-handle is-${position}${linkedEdges.has(position) ? ' is-linked-edge' : ''}`}
                          aria-label={linkedEdges.has(position) ? `Divisória travada: ${label}` : label}
                          title={linkedEdges.has(position) ? `Arrastar divisória travada · ${label}` : label}
                          onPointerEnter={() => {
                            if (['n', 's', 'e', 'w'].includes(edges)) revealWindowEdgeLink(item.module, edges)
                          }}
                          onPointerLeave={() => {
                            if (['n', 's', 'e', 'w'].includes(edges)) scheduleWindowEdgeLinkHide()
                          }}
                          onFocus={() => {
                            if (['n', 's', 'e', 'w'].includes(edges)) revealWindowEdgeLink(item.module, edges)
                          }}
                          onBlur={() => {
                            if (['n', 's', 'e', 'w'].includes(edges)) scheduleWindowEdgeLinkHide()
                          }}
                          onPointerDown={(event) => {
                            if (item.maximized) beginDrag(event, item)
                            else beginResize(event, item, edges)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'ArrowRight' && (edges.includes('e') || edges.includes('w'))) {
                              event.preventDefault()
                              resizeWindowByKeyboard(item.module, edges, 16, 0)
                            }
                            if (event.key === 'ArrowLeft' && (edges.includes('e') || edges.includes('w'))) {
                              event.preventDefault()
                              resizeWindowByKeyboard(item.module, edges, -16, 0)
                            }
                            if (event.key === 'ArrowDown' && (edges.includes('n') || edges.includes('s'))) {
                              event.preventDefault()
                              resizeWindowByKeyboard(item.module, edges, 0, 16)
                            }
                            if (event.key === 'ArrowUp' && (edges.includes('n') || edges.includes('s'))) {
                              event.preventDefault()
                              resizeWindowByKeyboard(item.module, edges, 0, -16)
                            }
                          }}
                        />
                      ))}
                  </div>
                  <div className="admin-app-window__body">
                    <AdminPage
                      session={session}
                      onSessionExpired={onSessionExpired}
                      activeModule={item.module}
                      embedded
                      detachedTechnicalPanels={[...detachedTechnicalPanels]}
                      onDetachTechnicalPanel={detachTechnicalPanel}
                      selectedTechnicalAreaId={selectedTechnicalAreaId}
                      onSelectedTechnicalAreaChange={setSelectedTechnicalAreaId}
                      notificationTarget={notificationTarget}
                      permissionProfileRequest={permissionProfileRequest}
                      inspectedModule={moduleInspectorTarget}
                      onModuleChange={(nextModule) => openModule(nextModule)}
                      onOpenImportHistory={() => openModule('import-history', true, true)}
                      onOpenImportSection={(section, operation) => {
                        const targets: Record<'import' | 'export', Record<'structure' | 'technical' | 'stock' | 'master', AdminModule>> = {
                          import: { structure: 'imports-structure', technical: 'imports-technical', stock: 'imports-stock', master: 'imports-master' },
                          export: { structure: 'exports-structure', technical: 'exports-technical', stock: 'exports-stock', master: 'exports-master' },
                        }
                        setImportExportRequest({ operation, section, requestId: ++importExportRequestIdRef.current })
                        openModule(targets[operation][section], true, true)
                      }}
                      onOpenImportZone={(operation) => openModule(operation === 'import' ? 'imports-zone' : 'exports-zone', true, true)}
                      onRestoreImportZone={(operation) => closeTab(operation === 'import' ? 'imports-zone' : 'exports-zone')}
                      importExportRequest={importExportRequest}
                      importReimportRequest={importReimportRequest}
                      onOpenImportReimport={(request, file) => {
                        const target: Record<string, AdminModule> = {
                          plantas: 'imports-structure',
                          setores: 'imports-structure',
                          linhas: 'imports-structure',
                          ativos: 'imports-technical',
                          componentes: 'imports-technical',
                          materiais: 'imports-stock',
                          fontes_valores: 'imports-stock',
                        }
                        const module = target[request.type]
                        if (!module) return
                        setImportReimportRequest({ ...request, file, requestId: ++importReimportRequestIdRef.current })
                        openModule(module, true, true)
                      }}
                      onInspectModule={(targetModule) => {
                        setModuleInspectorTarget(targetModule)
                        openModule('module-inspector', true, true)
                      }}
                      onOpenOperationalModule={(targetModule) => openModule(targetModule, true, true)}
                      onReviewCapability={(profile, capabilityName) => {
                        setPermissionProfileRequest({ profile, capabilityName, requestId: ++permissionProfileRequestIdRef.current })
                        openModule('permissions')
                      }}
                      moduleStatuses={systemModuleStatuses}
                      commercialAccess={commercialAccess}
                      commercialAccessError={commercialAccessError}
                      companyName={companyProfile.nome}
                      userSettingsUser={userSettingsContext ? userSettingsContext.user : undefined}
                      userCredentialReceipt={userSettingsContext?.credentialReceipt}
                      userSettingsSection={userSettingsContext?.section}
                      onOpenUserSettings={openUserSettings}
                      onOpenCredentialDelivery={openCredentialDelivery}
                      onPasswordResetSuccess={notifyPasswordResetSuccess}
                      onCloseUserSettings={() => {
                        closeTab(item.module)
                      }}
                      onUserSaved={() => {
                        setUserDataRevision((current) => current + 1)
                        if (!userSettingsContext?.user) {
                          completedUserSettingsRef.current.add(item.module)
                          setUserSettingsByModule((current) => ({
                            ...current,
                            [item.module]: { ...userSettingsContext, stage: 'email' },
                          }))
                        }
                      }}
                      userDataRevision={userDataRevision}
                    />
                  </div>
                </section>
              )
            })}
            {visibleLinkMarkers.map(({ link, locked, point }) => (
              <button
                key={`${link.axis}:${link.first}:${link.second}`}
                className={`admin-window-link-marker is-${link.axis}${locked ? ' is-locked' : ''}`}
                style={{
                  left: point.x,
                  top: point.y,
                  zIndex: linkMarkerTopZIndex,
                }}
                type="button"
                aria-pressed={locked}
                aria-label={`${locked ? 'Destravar' : 'Travar'} divisória entre ${getModule(link.first).label} e ${getModule(link.second).label}`}
                title={`${locked ? 'Destravar' : 'Travar'} divisória`}
                onPointerEnter={() => {
                  if (linkMarkerHideTimerRef.current !== null) {
                    window.clearTimeout(linkMarkerHideTimerRef.current)
                    linkMarkerHideTimerRef.current = null
                  }
                }}
                onPointerLeave={scheduleWindowEdgeLinkHide}
                onFocus={() => {
                  if (linkMarkerHideTimerRef.current !== null) {
                    window.clearTimeout(linkMarkerHideTimerRef.current)
                    linkMarkerHideTimerRef.current = null
                  }
                }}
                onBlur={scheduleWindowEdgeLinkHide}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => toggleWindowLink(link)}
              >
                <PanelLinkIcon locked={locked} />
              </button>
            ))}
          </div>

          <footer className="admin-desktop-statusbar">
            <span className="admin-status-window-count">
              {visibleWindowCount} {visibleWindowCount === 1 ? 'painel' : 'painéis'}
            </span>
            <label className="admin-status-layout-indicator" title={windowLinks.length ? 'Desvincule os divisores entre painéis para trocar o modo' : 'Altere a organização dos painéis'}>
              <span>Modo:</span>
              <select
                aria-label="Modo de organização das janelas"
                value={windowLayout}
                disabled={windowLinks.length > 0}
                onChange={(event) => arrangeWindows(event.target.value as WindowLayout)}
              >
                <option value="free">Livre</option>
                <option value="smart">Automático</option>
                <option value="focus">Foco</option>
                <option value="columns">Lado a lado</option>
                <option value="rows">Empilhado</option>
                <option value="grid">Grade</option>
                <option value="cascade">Cascata</option>
              </select>
            </label>
            <span
              className={`admin-status-plan${commercialAccess?.status === 'BLOQUEADA' || commercialAccessError ? ' is-alert' : ''}`}
              title={commercialAccessError || (commercialAccess ? `${commercialAccess.recursos.length} recurso(s) habilitado(s)` : 'Consultando assinatura')}
            >
              {commercialAccess ? `Plano ${commercialAccess.plano.nome}` : commercialAccessError ? 'Plano indisponível' : 'Verificando plano'}
            </span>
            <span className="admin-status-company" title="Empresa vinculada à sessão atual">Empresa: {companyProfile.nome}</span>
            <div className="admin-desktop-statusbar__right">
              <span>Memória estimada: {memoryMb} MB</span>
              <span className="admin-memory-track" aria-label={`Uso estimado: ${memoryMb} MB`}><i style={{ width: `${memoryPercent}%` }} /></span>
            </div>
          </footer>
        </div>
      </div>

      {paletteOpen ? (
        <div className="admin-desktop-overlay" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setPaletteOpen(false)
        }}>
          <section className="admin-command-palette admin-command-palette--categorized" role="dialog" aria-modal="true" aria-label="Busca global">
            <label><SearchIcon /><input ref={paletteInputRef} value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} placeholder="Buscar função, módulo, perfil ou configuração…" /><kbd>ESC</kbd></label>
            <div className="admin-command-palette__results">
              <div className="admin-command-palette__summary">
                <strong>{normalizedPaletteQuery ? `${filteredPaletteProfiles.length + filteredNavigationGroups.reduce((count, group) => count + group.modules.length, 0)} resultado(s)` : 'BUSCA GLOBAL'}</strong>
                <span>Módulos, perfis e funções disponíveis nesta sessão.</span>
              </div>
              {filteredPaletteProfiles.length ? (
                <section className="admin-command-palette__profile-results" aria-labelledby="command-palette-profiles">
                  <header><h2 id="command-palette-profiles">Perfis</h2></header>
                  {filteredPaletteProfiles.map((profile) => (
                    <button
                      key={profile.perfil}
                      type="button"
                      onClick={() => {
                        setPermissionProfileRequest({ profile: profile.perfil, requestId: ++permissionProfileRequestIdRef.current })
                        openModule('permissions')
                      }}
                    >
                      <span>PE</span>
                      <span><strong>{profile.nome ?? profile.perfil}</strong><small>{profile.capacidades.filter((capability) => capability.permitido).length} capacidades ativas</small></span>
                      <kbd>Enter</kbd>
                    </button>
                  ))}
                </section>
              ) : null}
              {paletteProfilesError ? <p className="admin-command-palette__error" role="status">A busca por perfil está indisponível. Você ainda pode navegar pelos módulos.</p> : null}
              {filteredNavigationGroups.map((group) => (
                <section className="admin-command-palette__group" key={group.id} aria-labelledby={`command-palette-group-${group.id}`}>
                  <header><h2 id={`command-palette-group-${group.id}`}>{group.label}</h2></header>
                  {group.modules.map((module) => (
                    <div className="admin-command-palette__module-result" key={module.id}>
                      <button
                        className={isModuleAvailable(module.id) ? '' : 'is-locked'}
                        type="button"
                        aria-disabled={!isModuleAvailable(module.id)}
                        title={isModuleAvailable(module.id) ? module.description : `${module.label} não está incluído no plano atual`}
                        onClick={() => openModule(module.id)}
                      >
                        <span>{module.code}</span>
                        <span><strong>{module.label}</strong><small>{module.description}</small></span>
                        {isModuleAvailable(module.id) ? <kbd>Abrir aba</kbd> : <em>Plano superior</em>}
                      </button>
                      <button
                        className="admin-command-palette__open-panel"
                        type="button"
                        disabled={!isModuleAvailable(module.id)}
                        title={`Abrir ${module.label} em outro painel`}
                        aria-label={`Abrir ${module.label} em outro painel`}
                        onClick={() => openModule(module.id, true, true)}
                      >
                        + Painel
                      </button>
                    </div>
                  ))}
                </section>
              ))}
              {!filteredPaletteProfiles.length && !filteredNavigationGroups.length && !paletteProfilesError ? (
                <p className="admin-command-palette__empty">Nenhum perfil ou módulo corresponde à busca. Tente outro nome de área, módulo ou perfil.</p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {windowManagerOpen ? (
        <aside ref={windowManagerRef} className="admin-window-manager" aria-label="Espaço de trabalho">
          <header><strong>Espaço de trabalho</strong><button type="button" aria-label="Fechar" onClick={() => setWindowManagerOpen(false)}>×</button></header>
          <section>
            <span>DISPOSIÇÃO</span>
            {windowLinks.length ? (
              <p className="admin-window-manager__lock-notice">
                {windowLinks.length} divisória(s) travada(s).
                <button type="button" onClick={() => setWindowLinks([])}>Destravar todas</button>
              </p>
            ) : null}
            <div className="admin-window-manager__layouts">
              <button disabled={windowLinks.length > 0} className={windowLayout === 'smart' ? 'is-active' : ''} type="button" onClick={() => arrangeWindows('smart')}>Auto</button>
              <button disabled={windowLinks.length > 0} className={windowLayout === 'focus' ? 'is-active' : ''} type="button" onClick={() => arrangeWindows('focus')}>Foco</button>
              <button disabled={windowLinks.length > 0} className={windowLayout === 'columns' ? 'is-active' : ''} type="button" onClick={() => arrangeWindows('columns')}>Lado a lado</button>
              <button disabled={windowLinks.length > 0} className={windowLayout === 'rows' ? 'is-active' : ''} type="button" onClick={() => arrangeWindows('rows')}>Empilhado</button>
              <button disabled={windowLinks.length > 0} className={windowLayout === 'free' ? 'is-active' : ''} type="button" onClick={() => arrangeWindows('free')}>Livre</button>
            </div>
            <button className="admin-window-manager__more" disabled={windowLinks.length > 0} type="button" aria-expanded={layoutMoreOpen} onClick={() => setLayoutMoreOpen((current) => !current)}>{layoutMoreOpen ? 'Menos opções' : 'Mais opções'}</button>
            {layoutMoreOpen ? (
              <div className="admin-window-manager__layouts admin-window-manager__layouts--secondary">
                <button disabled={windowLinks.length > 0} className={windowLayout === 'grid' ? 'is-active' : ''} type="button" onClick={() => arrangeWindows('grid')}>Grade</button>
                <button disabled={windowLinks.length > 0} className={windowLayout === 'cascade' ? 'is-active' : ''} type="button" onClick={() => arrangeWindows('cascade')}>Cascata</button>
              </div>
            ) : null}
            <label className="admin-window-manager__auto"><span><strong>Organizar ao abrir</strong></span><input type="checkbox" checked={autoArrange} onChange={(event) => setAutoArrange(event.target.checked)} /><i aria-hidden="true" /></label>
          </section>
          <section>
            <span>Painéis <b>{visibleWindowCount}</b></span>
            <div className="admin-window-manager__list">
              {windows.map((item) => {
                const baseModule = getModule(item.module)
                const userContext = userSettingsByModule[item.module]
                const module = userContext
                  ? { ...baseModule, label: userContext.stage === 'email' ? 'Preparar e-mail' : userContext.user ? 'Editar' : 'Novo usuário' }
                  : baseModule
                const activeGroupTab = windows.find((windowItem) => windowItem.groupId === item.groupId && !windowItem.minimized && !windowItem.layoutHidden)
                const link = windowLinks.find((candidate) => candidate.first === item.module || candidate.second === item.module)
                const linkedModule = link ? getModule(link.first === item.module ? link.second : link.first) : null
                const isFocusedWindow = item.zIndex === Math.max(0, ...windows.map((windowItem) => windowItem.zIndex))
                return (
                  <article className={isFocusedWindow ? 'is-active' : ''} key={item.module}>
                    <button className="admin-window-manager__panel" type="button" onClick={() => focusWindow(item.module)}>
                      <strong>{module.label}</strong>
                      <small>{item.minimized ? 'Minimizado' : item.layoutHidden ? `Aba em ${getModule(activeGroupTab?.module ?? item.module).label}` : item.maximized ? 'Expandido' : linkedModule ? `Vinculado a ${linkedModule.label}` : 'Painel ativo'}</small>
                    </button>
                    <button className="admin-window-manager__close-panel" type="button" aria-label={`Fechar aba ${module.label}`} onClick={() => closeTab(item.module)}>×</button>
                  </article>
                )
              })}
              {!windows.length ? <p>Nenhum painel aberto.</p> : null}
            </div>
          </section>
          <section>
            <div className="admin-window-manager__performance">
              <header><small>Desempenho</small><strong>{memoryMb} MB</strong></header>
              <div><i style={{ width: `${memoryPercent}%` }} /></div>
              <button type="button" title="Limpar cache do espaço de trabalho" onClick={optimizeCache}>Otimizar espaço</button>
              {cacheMessage === 'Cache local limpo.' ? <small role="status">Cache otimizado</small> : null}
            </div>
          </section>
        </aside>
      ) : null}

      {helpOpen ? (
        <div className="admin-desktop-overlay" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setHelpOpen(false)
        }}>
          <section className="admin-workspace-help" role="dialog" aria-modal="true" aria-label="Central de ajuda">
            <header>
              <div><span aria-hidden="true">?</span><div><small>AJUDA</small><strong>Centro de Comando</strong></div></div>
              <button type="button" aria-label="Fechar" onClick={() => setHelpOpen(false)}>×</button>
            </header>
            <div className="admin-workspace-help__content">
              <p>Navegação e leitura dos indicadores técnicos.</p>
              <div className="admin-workspace-help__grid">
                <article><span><SearchIcon /></span><div><strong>Navegação</strong><small>Clique na marca VORQIX para mostrar ou ocultar a lateral. Use <kbd>Ctrl K</kbd> para buscar módulos e perfis.</small></div></article>
                <article><span><WindowsIcon /></span><div><strong>Janelas</strong><small>Arraste pelo título para mover. Use o modo Livre para redimensionar e posicionar cada janela; os modos agrupados alinham os painéis.</small></div></article>
                <article><span><SettingsIcon /></span><div><strong>Organização</strong><small>Escolha Livre, Foco, colunas, linhas, grade ou cascata no gerenciador de janelas.</small></div></article>
                <article><span><DashboardIcon /></span><div><strong>Configurações</strong><small>Abra o menu do perfil para acessar configurações avançadas, seu perfil e sair.</small></div></article>
              </div>
              <section className="admin-workspace-help__glossary" aria-labelledby="admin-help-glossary-title">
                <h3 id="admin-help-glossary-title">Indicadores de integridade</h3>
                <dl>
                  <div><dt>p95</dt><dd>Tempo abaixo do qual 95% das chamadas observadas foram concluídas. O painel usa o maior p95 entre capacidades do módulo.</dd></div>
                  <div><dt>Erro de serviço</dt><dd>Resposta HTTP 5xx. Acesso negado (403) é contado separadamente e não é tratado como falha do módulo.</dd></div>
                  <div><dt>Conflito de plano</dt><dd>Uma capacidade está ligada no perfil, mas o recurso correspondente não consta como disponível no plano atual.</dd></div>
                  <div><dt>Janela de telemetria</dt><dd>Chamadas autorizadas observadas nos últimos 15 minutos. As amostras ficam na memória do processo e são zeradas ao reiniciar a API.</dd></div>
                  <div><dt>Sem amostras</dt><dd>A capacidade não recebeu chamadas observáveis na janela. Isso não confirma nem indica falha.</dd></div>
                </dl>
              </section>
            </div>
            <footer><span>As alterações de permissões permanecem em rascunho até salvar.</span><button type="button" onClick={() => setHelpOpen(false)}>Entendi</button></footer>
          </section>
        </div>
      ) : null}

      {companyOpen ? (
        <AdminCompanyDialog
          company={companyProfile}
          initialError={companyLoadError}
          onClose={() => setCompanyOpen(false)}
          onSave={handleSaveCompany}
        />
      ) : null}

      {discardUserModule ? (
        <div className="admin-desktop-overlay admin-user-discard-overlay" role="presentation">
          <section className="admin-user-discard-confirm" role="alertdialog" aria-modal="true" aria-labelledby="admin-user-discard-title" aria-describedby="admin-user-discard-description">
            <h2 id="admin-user-discard-title">Descartar novo usuário?</h2>
            <p id="admin-user-discard-description">Os dados preenchidos ainda não foram salvos.</p>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setDiscardUserModule(null)}>Continuar criando</button>
              <button type="button" className="primary-button" onClick={() => {
                const module = discardUserModule
                setDiscardUserModule(null)
                closeTab(module, true)
              }}>Descartar</button>
            </footer>
          </section>
        </div>
      ) : null}

      <NotificationCenter
        open={notificationOpen}
        audience="admin"
        onClose={() => setNotificationOpen(false)}
        onOpenNotification={handleOpenNotification}
        onUnreadChange={setNotificationCount}
        onSessionExpired={onSessionExpired}
      />
      {workspaceToasts.length ? (
        <div className="admin-toast-stack" aria-label="Notificações recentes">
          {workspaceToasts.map((toast) => (
            <div className="admin-workspace-toast" role="status" aria-live="polite" key={toast.id}>
              <span className="admin-workspace-toast__mark" aria-hidden="true">✓</span>
              <p>{toast.message}</p>
              <button type="button" onClick={() => {
                const timer = toastTimersRef.current.get(toast.id)
                if (timer !== undefined) window.clearTimeout(timer)
                toastTimersRef.current.delete(toast.id)
                setWorkspaceToasts((current) => current.filter((item) => item.id !== toast.id))
              }} aria-label="Fechar aviso">×</button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
