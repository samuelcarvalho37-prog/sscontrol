import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { APP_RELEASE_VERSION } from '../release'
import type { GestorSession } from '../services/api/auth'
import {
  getAdminCommercialAccess,
  getAdminCompanyProfile,
  listAdminTechnicalDemands,
  saveAdminCompanyProfile,
} from '../services/api/admin'
import { getUnreadNotificationCount, isGestorAuthenticationError } from '../services/api/gestor'
import type {
  AdminCommercialAccess,
  AdminCommercialFeatureCode,
  AdminCompanyProfile,
  AdminNotificationTarget,
} from '../types/admin'
import type { GestorNotification } from '../types/gestor'
import { AdminPage, type AdminModule } from '../pages/AdminPage'
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
  Icon: typeof DashboardIcon
  feature?: AdminCommercialFeatureCode
}

interface WorkspaceWindow {
  module: AdminModule
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

interface DragState {
  module: AdminModule
  offsetX: number
  offsetY: number
  startClientX: number
  startClientY: number
  activated: boolean
  geometrySynced: boolean
  restoreWidth: number
  restoreHeight: number
}

type WindowLayout = 'smart' | 'focus' | 'columns' | 'rows' | 'grid' | 'cascade'
type WindowSnapTarget = 'maximize' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

const MODULES: WorkspaceModule[] = [
  { id: 'overview', code: 'VG', label: 'Visão geral', description: 'Centro de comando', Icon: DashboardIcon },
  { id: 'structure', code: 'EF', label: 'Estrutura fabril', description: 'Plantas, setores e linhas', Icon: FactoryIcon, feature: 'CADASTROS' },
  { id: 'assets', code: 'AT', label: 'Cadastro técnico', description: 'Ativos e componentes', Icon: AssetIcon, feature: 'CADASTROS' },
  { id: 'checklists', code: 'CK', label: 'Checklists', description: 'Construtor e roteamento', Icon: ChecklistIcon, feature: 'CHECKLISTS' },
  { id: 'inventory', code: 'MP', label: 'Materiais e peças', description: 'Estoque técnico', Icon: PackageIcon, feature: 'CADASTROS' },
  { id: 'workforce', code: 'EQ', label: 'Equipes técnicas', description: 'Áreas, cargos e assinatura', Icon: UsersIcon, feature: 'GESTAO_TECNICA' },
  { id: 'operations', code: 'OS', label: 'Programação, intervenções e OS', description: 'Planejar, validar e liberar', Icon: WrenchIcon, feature: 'GESTAO_TECNICA' },
  { id: 'analytics', code: 'BI', label: 'Indicadores', description: 'Confiabilidade, tempos e SLA', Icon: ChartIcon, feature: 'INDICADORES' },
  { id: 'documents', code: 'DT', label: 'Documentos', description: 'Arquivos e revisões', Icon: DocumentIcon, feature: 'DOCUMENTOS' },
  { id: 'imports', code: 'IM', label: 'Importar planilhas', description: 'Modelos e implantação', Icon: UploadIcon, feature: 'IMPORTACOES' },
  { id: 'configuration', code: 'MC', label: 'Motor', description: 'Configurações operacionais', Icon: SettingsIcon, feature: 'MOTOR_LIMITADO' },
  { id: 'users', code: 'US', label: 'Usuários', description: 'Identidades e acessos', Icon: UserDirectoryIcon, feature: 'CADASTROS' },
  { id: 'permissions', code: 'PE', label: 'Permissões', description: 'Matriz de capacidades', Icon: KeyIcon, feature: 'CADASTROS' },
  { id: 'governance', code: 'AU', label: 'Auditoria', description: 'Integridade e trilha', Icon: AuditIcon, feature: 'AUDITORIA' },
  { id: 'backup', code: 'BK', label: 'Continuidade', description: 'Backup e restauração', Icon: DatabaseIcon, feature: 'CONTINUIDADE' },
]

const QUICK_ACCESS_MODULES: AdminModule[] = ['overview', 'checklists', 'operations', 'configuration']
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

const MODULE_HEADINGS: Record<AdminModule, { eyebrow: string; title: string; subtitle: string }> = {
  overview: {
    eyebrow: 'CENTRO DE COMANDO',
    title: 'Visão geral administrativa',
    subtitle: 'Abra módulos em paralelo e acompanhe a operação sem perder o contexto.',
  },
  structure: {
    eyebrow: 'ESTRUTURA ORGANIZACIONAL',
    title: 'Plantas, setores e linhas',
    subtitle: 'Cadastros assistidos com vínculos encadeados e validação no servidor.',
  },
  assets: {
    eyebrow: 'CADASTRO TÉCNICO',
    title: 'Equipamentos e componentes',
    subtitle: 'TAGs, criticidade, localização e componentes com seleções guiadas.',
  },
  checklists: {
    eyebrow: 'AUTORIA E GOVERNANÇA',
    title: 'Construtor de checklist',
    subtitle: 'Crie rotinas técnicas, assinaturas e destinos antes da liberação ao Gestor.',
  },
  maintenance: {
    eyebrow: 'PROGRAMAÇÃO',
    title: 'Planos de manutenção',
    subtitle: 'Programe preventivas, periodicidade, ativo, responsável e próxima execução.',
  },
  inventory: {
    eyebrow: 'ALMOXARIFADO TÉCNICO',
    title: 'Materiais e peças',
    subtitle: 'Controle itens, unidades, saldo mínimo, custo e aplicação por ativo.',
  },
  workforce: {
    eyebrow: 'ESTRUTURA TÉCNICA',
    title: 'Áreas, cargos e responsáveis',
    subtitle: 'Defina equipes, especialidades, filtros técnicos e poder de assinatura.',
  },
  operations: {
    eyebrow: 'PLANEJAMENTO OPERACIONAL',
    title: 'Programação, intervenções e ordens de serviço',
    subtitle: 'Organize planos, demandas planejadas e não planejadas, encaminhe e acompanhe a execução.',
  },
  analytics: {
    eyebrow: 'INTELIGÊNCIA OPERACIONAL',
    title: 'Indicadores e relatórios',
    subtitle: 'Disponibilidade, falhas, MTTR, MTBF, atendimentos, lead time e SLA.',
  },
  documents: {
    eyebrow: 'GESTÃO DOCUMENTAL',
    title: 'Documentos técnicos',
    subtitle: 'Manuais, diagramas, laudos e certificados com revisão e validade.',
  },
  governance: {
    eyebrow: 'AUDITORIA E OBSERVABILIDADE',
    title: 'Integridade e trilha administrativa',
    subtitle: 'Monitore a base e investigue alterações com dados sensíveis protegidos.',
  },
  backup: {
    eyebrow: 'CONTINUIDADE OPERACIONAL',
    title: 'Backup e recuperação',
    subtitle: 'Crie pontos integrais e restaure dados operacionais com dupla confirmação.',
  },
  imports: {
    eyebrow: 'GOVERNANÇA DE DADOS',
    title: 'Central de importação',
    subtitle: 'Suba modelos, valide vínculos e confirme lotes com rollback auditável.',
  },
  configuration: {
    eyebrow: 'NÚCLEO PROTEGIDO',
    title: 'Motor de configuração',
    subtitle: 'Prepare, valide, publique e restaure versões sem editar o runtime ativo.',
  },
  users: {
    eyebrow: 'IDENTIDADES',
    title: 'Diretório de usuários',
    subtitle: 'Administre acessos, área, cargo, sessões e recuperação de credenciais.',
  },
  permissions: {
    eyebrow: 'CONTROLE DE ACESSO',
    title: 'Matriz de capacidades',
    subtitle: 'Defina permissões por perfil sem comprometer as barreiras protegidas.',
  },
}

function getModule(module: AdminModule): WorkspaceModule {
  return MODULES.find((item) => item.id === module) ?? MODULES[0]
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

function createWindow(module: AdminModule, index: number, zIndex: number): WorkspaceWindow {
  const availableWidth = Math.max(760, window.innerWidth - 50)
  const availableHeight = Math.max(520, window.innerHeight - 73)
  const offset = Math.min(index, 5) * 26
  return {
    module,
    x: 18 + offset,
    y: 18 + offset,
    width: Math.min(1180, availableWidth - 42),
    height: Math.min(760, availableHeight - 42),
    zIndex,
    minimized: false,
    maximized: true,
    layoutHidden: false,
    tiled: true,
    snapTarget: null,
    restoreBounds: null,
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function detectSnapTarget(x: number, y: number, width: number, height: number): WindowSnapTarget | null {
  const edge = 34
  const corner = 54
  if (y <= edge && x <= corner) return 'top-left'
  if (y <= edge && x >= width - corner) return 'top-right'
  if (y >= height - edge && x <= corner) return 'bottom-left'
  if (y >= height - edge && x >= width - corner) return 'bottom-right'
  if (y <= edge) return 'maximize'
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
  const top = target === 'left' || target === 'right' || target.startsWith('top')
  const isHalf = target === 'left' || target === 'right'
  return {
    ...item,
    x: left ? 0 : halfWidth + divider,
    y: top ? 0 : halfHeight + divider,
    width: halfWidth,
    height: isHalf ? height : halfHeight,
    zIndex,
    maximized: false,
    layoutHidden: false,
    tiled: true,
    snapTarget: target,
    restoreBounds,
  }
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
  const windowsRef = useRef<WorkspaceWindow[]>([])
  const dragRef = useRef<DragState | null>(null)
  const snapTargetRef = useRef<WindowSnapTarget | null>(null)
  const paletteInputRef = useRef<HTMLInputElement | null>(null)
  const [windows, setWindows] = useState<WorkspaceWindow[]>([])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [windowManagerOpen, setWindowManagerOpen] = useState(false)
  const [layoutQuickOpen, setLayoutQuickOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [companyOpen, setCompanyOpen] = useState(false)
  const [companyProfile, setCompanyProfile] = useState<AdminCompanyProfile>(readCachedCompanyProfile)
  const [companyLoadError, setCompanyLoadError] = useState('')
  const [commercialAccess, setCommercialAccess] = useState<AdminCommercialAccess | null>(null)
  const [commercialAccessError, setCommercialAccessError] = useState('')
  const [commercialAccessNotice, setCommercialAccessNotice] = useState('')
  const [notificationCount, setNotificationCount] = useState<number | null>(null)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const [notificationTarget, setNotificationTarget] = useState<AdminNotificationTarget | null>(null)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [dragging, setDragging] = useState(false)
  const [snapTarget, setSnapTarget] = useState<WindowSnapTarget | null>(null)
  const [windowLayout, setWindowLayout] = useState<WindowLayout>('smart')
  const [autoArrange, setAutoArrange] = useState(false)
  const [cacheBaseMb, setCacheBaseMb] = useState(10)
  const [cacheMessage, setCacheMessage] = useState('Uso normal. Nenhuma ação necessária.')
  windowsRef.current = windows

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

  const isModuleAvailable = useCallback((moduleId: AdminModule) => {
    const module = getModule(moduleId)
    if (!commercialAccess || !module.feature) return true
    return commercialAccess.status === 'ATIVA' && grantedFeatures.has(module.feature)
  }, [commercialAccess, grantedFeatures])

  const filteredModules = useMemo(() => {
    const term = paletteQuery.trim().toLocaleLowerCase('pt-BR')
    if (!term) return MODULES
    return MODULES.filter((module) => (
      `${module.code} ${module.label} ${module.description}`.toLocaleLowerCase('pt-BR').includes(term)
    ))
  }, [paletteQuery])

  const openModule = useCallback((module: AdminModule, notify = true) => {
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
      if (existing) {
        return current.map((item) => (
          item.module === requestedModule
            ? { ...item, minimized: false, layoutHidden: false, zIndex: nextZIndex }
            : item
        ))
      }
      return [...current, createWindow(requestedModule, current.length, nextZIndex)]
    })
    setPaletteOpen(false)
    setWindowManagerOpen(false)
    setLayoutQuickOpen(false)
    setProfileOpen(false)
    setCompanyOpen(false)
    setCommercialAccessNotice('')
    if (notify) onModuleChange(requestedModule)
  }, [commercialAccess?.plano.nome, isModuleAvailable, onModuleChange])

  useEffect(() => {
    if (!commercialAccess) return
    if (activeModule === 'maintenance') {
      onModuleChange('operations')
      return
    }
    setWindows((current) => current.filter((item) => isModuleAvailable(item.module)))
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
        setLayoutQuickOpen(false)
        setHelpOpen(false)
        setProfileOpen(false)
        setCompanyOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

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
      if (!drag.activated) {
        const distance = Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY)
        if (distance < 5) return
        drag.activated = true
        setDragging(true)
      }
      const syncGeometry = !drag.geometrySynced
      drag.geometrySynced = true
      const bounds = layer.getBoundingClientRect()
      const pointerX = event.clientX - bounds.left
      const pointerY = event.clientY - bounds.top
      const nextSnapTarget = detectSnapTarget(pointerX, pointerY, bounds.width, bounds.height)
      if (nextSnapTarget !== snapTargetRef.current) {
        snapTargetRef.current = nextSnapTarget
        setSnapTarget(nextSnapTarget)
      }
      setWindows((current) => current.map((item) => {
        if (item.module !== drag.module) return item
        const activeItem = syncGeometry
          ? {
              ...item,
              width: drag.restoreWidth,
              height: drag.restoreHeight,
              maximized: false,
              tiled: false,
              snapTarget: null,
              restoreBounds: null,
            }
          : item
        const maximumX = Math.max(0, bounds.width - activeItem.width)
        const maximumY = Math.max(0, bounds.height - 34)
        return {
          ...activeItem,
          x: clamp(pointerX - drag.offsetX, 0, maximumX),
          y: clamp(pointerY - drag.offsetY, 0, maximumY),
        }
      }))
    }

    function handlePointerUp() {
      const drag = dragRef.current
      const layer = windowLayerRef.current
      const target = snapTargetRef.current
      if (drag?.activated && layer && target) {
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

  function focusWindow(module: AdminModule) {
    const nextZIndex = ++zIndexRef.current
    setWindows((current) => current.map((item) => (
      item.module === module ? { ...item, minimized: false, layoutHidden: false, zIndex: nextZIndex } : item
    )))
    onModuleChange(module)
  }

  function beginDrag(event: ReactPointerEvent<HTMLDivElement>, item: WorkspaceWindow) {
    if ((event.target as HTMLElement).closest('button')) return
    const layer = windowLayerRef.current
    const windowElement = event.currentTarget.closest<HTMLElement>('.admin-app-window')
    if (!layer || !windowElement) return
    const bounds = layer.getBoundingClientRect()
    const windowBounds = windowElement.getBoundingClientRect()
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
      offsetX: restoresOnDrag ? restoredWidth * horizontalRatio : pointerX - item.x,
      offsetY: restoresOnDrag ? Math.min(17, event.clientY - windowBounds.top) : pointerY - item.y,
      startClientX: event.clientX,
      startClientY: event.clientY,
      activated: false,
      geometrySynced: false,
      restoreWidth: restoredWidth,
      restoreHeight: restoredHeight,
    }
    event.preventDefault()
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
    setWindows((current) => current.map((item) => (
      item.module === module ? { ...item, minimized: true, layoutHidden: false } : item
    )))
  }

  function closeWindow(module: AdminModule) {
    setWindows((current) => current.filter((item) => item.module !== module))
  }

  const arrangeWindows = useCallback((layout: WindowLayout) => {
    const layer = windowLayerRef.current
    if (!layer) return
    const bounds = layer.getBoundingClientRect()
    const freeGap = 10
    const divider = 1

    setWindows((current) => current.map((item) => {
      const available = current.filter((windowItem) => !windowItem.minimized)
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

      if (layout === 'cascade') {
        return {
          ...item,
          maximized: false,
          layoutHidden: false,
          tiled: false,
          snapTarget: null,
          restoreBounds: null,
          x: freeGap + index * 28,
          y: freeGap + index * 28,
          width: Math.max(320, Math.min(1040, bounds.width - 90)),
          height: Math.max(230, Math.min(700, bounds.height - 90)),
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
      const width = Math.max(320, (bounds.width - divider * (columns - 1)) / columns)
      const height = Math.max(230, (bounds.height - divider * (rows - 1)) / rows)
      return {
        ...item,
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
    setWindowManagerOpen(false)
    setLayoutQuickOpen(false)
  }, [])

  useEffect(() => {
    if (!autoArrange || windows.length < 2) return
    arrangeWindows(windowLayout)
  }, [arrangeWindows, autoArrange, windowLayout, windows.length])

  const visibleWindowCount = windows.filter((item) => !item.minimized && !item.layoutHidden).length
  const memoryMb = cacheBaseMb + windows.length * 7
  const memoryPercent = Math.min(96, Math.max(7, Math.round(memoryMb / 1.15)))
  const layoutLabels: Record<WindowLayout, string> = {
    smart: 'automático',
    focus: 'foco',
    columns: '2 colunas',
    rows: '2 linhas',
    grid: 'grade',
    cascade: 'cascata',
  }

  function optimizeCache() {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith('fab_control_workspace_cache_'))
      .forEach((key) => window.localStorage.removeItem(key))
    setCacheBaseMb(8)
    setCacheMessage('Cache temporário limpo. A sessão e os dados do sistema foram preservados.')
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

  return (
    <div className={`admin-desktop-shell${dragging ? ' is-dragging' : ''}`}>
      <section className="admin-command-mobile-block">
        <ShieldIcon />
        <h1>Command Workspace</h1>
        <p>O ambiente administrativo é exclusivo para computador. Use uma tela com pelo menos 901 px de largura.</p>
        <button type="button" disabled={loggingOut} onClick={onLogout}>{loggingOut ? 'Saindo…' : 'Sair'}</button>
      </section>

      <header className="admin-desktop-topbar">
        <div className="admin-desktop-brand">
          {companyProfile.logo_data_url
            ? <img src={companyProfile.logo_data_url} alt="" />
            : <span aria-hidden="true">TOZ</span>}
          <strong title={companyProfile.nome}>{companyProfile.nome}</strong>
        </div>

        <button className="admin-desktop-command" type="button" onClick={() => setPaletteOpen(true)}>
          <span>Pesquisar módulos e comandos — Ctrl + K</span>
        </button>

        <div className="admin-desktop-top-actions">
          <button type="button" title="Gerenciador de janelas" aria-label="Gerenciador de janelas" onClick={() => { setLayoutQuickOpen(false); setWindowManagerOpen((current) => !current) }}><WindowsIcon /></button>
          <button
            className="admin-notification-button"
            type="button"
            title={notificationCount ? `${notificationCount} aviso(s) não lido(s)` : 'Nenhum aviso não lido'}
            aria-label={notificationCount ? `Avisos operacionais: ${notificationCount} não lido(s)` : 'Avisos operacionais: nenhum não lido'}
            aria-haspopup="dialog"
            aria-expanded={notificationOpen}
            onClick={() => setNotificationOpen(true)}
          >
            <BellIcon />
            {notificationCount ? <span>{notificationCount > 99 ? '99+' : notificationCount}</span> : null}
          </button>
          <button type="button" title="Ajuda do Workspace" aria-label="Ajuda do Workspace" onClick={() => setHelpOpen(true)}>?</button>
          <button
            className="admin-desktop-avatar"
            type="button"
            aria-label="Abrir menu do perfil"
            aria-expanded={profileOpen}
            onClick={() => setProfileOpen((current) => !current)}
          >
            {getInitials(session.user.nome)}
          </button>
          {profileOpen ? (
            <aside className="admin-profile-menu" aria-label="Menu do perfil">
              <header><span>{getInitials(session.user.nome)}</span><div><strong>{session.user.nome}</strong><small>{companyProfile.nome}</small></div></header>
              <button type="button" aria-disabled={!isModuleAvailable('configuration')} onClick={() => openModule('configuration')}>Personalizar sistema</button>
              <button type="button" aria-disabled={!isModuleAvailable('configuration')} onClick={() => openModule('configuration')}>Parâmetros técnicos</button>
              <button type="button" aria-disabled={!isModuleAvailable('users')} onClick={() => openModule('users')}>Meu perfil</button>
              <button type="button" disabled={loggingOut} onClick={onLogout}>{loggingOut ? 'Saindo…' : 'Sair'}</button>
            </aside>
          ) : null}
        </div>
      </header>

      <div className="admin-desktop-content">
        <nav className="admin-desktop-rail" aria-label="Aplicativos administrativos">
          {MODULES.map(({ id, label, Icon }) => {
            const windowItem = windows.find((item) => item.module === id)
            const focused = windowItem && windowItem.zIndex === Math.max(0, ...windows.map((item) => item.zIndex))
            const available = isModuleAvailable(id)
            return (
              <button
                key={id}
                type="button"
                className={`${focused && !windowItem?.minimized ? 'is-active' : ''}${available ? '' : ' is-locked'}`}
                data-tip={available ? label : `${label} · não incluído no plano`}
                aria-label={available ? label : `${label}: não incluído no plano`}
                aria-disabled={!available}
                onClick={() => openModule(id)}
              >
                <Icon />
                {windowItem?.minimized ? <i aria-hidden="true" /> : null}
                {!available ? <b aria-hidden="true">×</b> : null}
              </button>
            )
          })}
        </nav>

        <div className="admin-desktop-workspace" ref={workspaceRef}>
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
                  <span className="admin-welcome-eyebrow">FAB CONTROL · ADMINISTRAÇÃO INDUSTRIAL</span>
                  <h1>Command Workspace</h1>
                  <p>Centralize configurações, governança, cadastros e decisões técnicas em um único ambiente operacional.</p>
                  <div className="admin-welcome-actions">
                    <button type="button" onClick={() => openModule('overview')}>Abrir visão geral</button>
                    <button type="button" onClick={() => setPaletteOpen(true)}><SearchIcon />Pesquisar módulos</button>
                  </div>
                  <small className="admin-welcome-help"><b>?</b> Em caso de dúvida, acesse a Central de Ajuda no cabeçalho.</small>
                </div>
                <aside className="admin-welcome-capabilities" aria-label="Recursos do ambiente">
                  <header>
                    <span>{commercialAccess ? `Plano ${commercialAccess.plano.nome}` : commercialAccessError ? 'Plano indisponível' : 'Verificando plano'}</span>
                    <i aria-hidden="true" />
                  </header>
                  <article><ShieldIcon /><span><strong>Governança e acesso</strong><small>Perfis, permissões e rastreabilidade.</small></span></article>
                  <article><SettingsIcon /><span><strong>Estrutura e regras</strong><small>Cadastros, fluxos e configuração.</small></span></article>
                  <article><ChartIcon /><span><strong>Operação e indicadores</strong><small>Intervenções, confiabilidade, tempos e SLA.</small></span></article>
                </aside>
              </div>
            </section>
          ) : null}

          <div className="admin-desktop-window-layer" ref={windowLayerRef}>
            {snapTarget ? <div className={`admin-window-snap-preview is-${snapTarget}`} aria-hidden="true" /> : null}
            {windows.map((item) => {
              const module = getModule(item.module)
              const heading = MODULE_HEADINGS[item.module]
              return (
                <section
                  key={item.module}
                  className={`admin-app-window${item.maximized ? ' is-maximized' : ''}${item.tiled ? ' is-tiled' : ''}${item.minimized ? ' is-minimized' : ''}${item.layoutHidden ? ' is-layout-hidden' : ''}`}
                  style={{
                    left: item.x,
                    top: item.y,
                    width: item.width,
                    height: item.height,
                    zIndex: item.zIndex,
                  }}
                  aria-label={module.label}
                  onPointerDown={() => focusWindow(item.module)}
                >
                  <div
                    className="admin-app-window__bar"
                    onPointerDown={(event) => beginDrag(event, item)}
                    onDoubleClick={() => toggleMaximize(item.module)}
                  >
                    <span className="admin-app-window__code">{module.code}</span>
                    <strong>{module.label}</strong>
                    <span className="admin-app-window__state">Conectado</span>
                    <div className="admin-app-window__controls" onPointerDown={(event) => event.stopPropagation()}>
                      <button type="button" aria-label={`Minimizar ${module.label}`} title="Minimizar" onClick={() => minimizeWindow(item.module)}>—</button>
                      <button type="button" aria-label={`${item.maximized ? 'Restaurar' : 'Maximizar'} ${module.label}`} title={item.maximized ? 'Restaurar' : 'Maximizar'} onClick={() => toggleMaximize(item.module)}>{item.maximized ? '❐' : '□'}</button>
                      <button className="is-close" type="button" aria-label={`Fechar ${module.label}`} title="Fechar" onClick={() => closeWindow(item.module)}>×</button>
                    </div>
                  </div>
                  <div className="admin-app-window__body">
                    <header className="admin-window-module-heading">
                      <div><span>{heading.eyebrow}</span><h1>{heading.title}</h1><p>{heading.subtitle}</p></div>
                      <span className="admin-window-release">v{APP_RELEASE_VERSION}</span>
                    </header>
                    <AdminPage
                      session={session}
                      onSessionExpired={onSessionExpired}
                      activeModule={item.module}
                      embedded
                      notificationTarget={notificationTarget}
                      onModuleChange={(nextModule) => openModule(nextModule)}
                    />
                  </div>
                </section>
              )
            })}
          </div>

          <footer className="admin-desktop-statusbar">
            <button type="button" onClick={() => { setLayoutQuickOpen(false); setWindowManagerOpen((current) => !current) }}>
              {windows.length} {windows.length === 1 ? 'janela' : 'janelas'}
            </button>
            <div className="admin-status-layout-picker">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={layoutQuickOpen}
                onClick={() => { setWindowManagerOpen(false); setLayoutQuickOpen((current) => !current) }}
              >
                Modo: {layoutLabels[windowLayout]} <span aria-hidden="true">⌃</span>
              </button>
              {layoutQuickOpen ? (
                <div className="admin-status-layout-menu" role="menu" aria-label="Alterar organização das janelas">
                  <button className={windowLayout === 'smart' ? 'is-active' : ''} type="button" role="menuitem" onClick={() => arrangeWindows('smart')}>Auto</button>
                  <button className={windowLayout === 'focus' ? 'is-active' : ''} type="button" role="menuitem" onClick={() => arrangeWindows('focus')}>Foco</button>
                  <button className={windowLayout === 'columns' ? 'is-active' : ''} type="button" role="menuitem" onClick={() => arrangeWindows('columns')}>2 colunas</button>
                  <button className={windowLayout === 'rows' ? 'is-active' : ''} type="button" role="menuitem" onClick={() => arrangeWindows('rows')}>2 linhas</button>
                  <button className={windowLayout === 'grid' ? 'is-active' : ''} type="button" role="menuitem" onClick={() => arrangeWindows('grid')}>Grade</button>
                  <button className={windowLayout === 'cascade' ? 'is-active' : ''} type="button" role="menuitem" onClick={() => arrangeWindows('cascade')}>Cascata</button>
                </div>
              ) : null}
            </div>
            <div className="admin-status-quick-access" aria-label="Acesso rápido">
              <span>Rápido</span>
              {QUICK_ACCESS_MODULES.filter(isModuleAvailable).map((moduleId) => {
                const module = getModule(moduleId)
                const open = windows.some((item) => item.module === moduleId && !item.minimized)
                return (
                  <button
                    key={moduleId}
                    className={open ? 'is-open' : ''}
                    type="button"
                    title={module.label}
                    aria-label={`Abrir ${module.label}`}
                    onClick={() => openModule(moduleId)}
                  >
                    {module.code}
                  </button>
                )
              })}
            </div>
            <span
              className={`admin-status-plan${commercialAccess?.status === 'BLOQUEADA' || commercialAccessError ? ' is-alert' : ''}`}
              title={commercialAccessError || (commercialAccess ? `${commercialAccess.recursos.length} recurso(s) habilitado(s)` : 'Consultando assinatura')}
            >
              {commercialAccess ? `Plano ${commercialAccess.plano.nome}` : commercialAccessError ? 'Plano indisponível' : 'Verificando plano'}
            </span>
            <button
              className="admin-status-company"
              type="button"
              title="Configurar empresa"
              aria-haspopup="dialog"
              onClick={() => {
                setPaletteOpen(false)
                setWindowManagerOpen(false)
                setLayoutQuickOpen(false)
                setProfileOpen(false)
                setCompanyOpen(true)
              }}
            >
              Empresa: {companyProfile.nome}
            </button>
            <div className="admin-desktop-statusbar__right">
              <button type="button" onClick={optimizeCache}>Otimizar cache</button>
              <span>Workspace: {memoryMb} MB</span>
              <span className="admin-memory-track" aria-label={`Uso estimado do Workspace: ${memoryMb} MB`}><i style={{ width: `${memoryPercent}%` }} /></span>
            </div>
          </footer>
        </div>
      </div>

      {paletteOpen ? (
        <div className="admin-desktop-overlay" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setPaletteOpen(false)
        }}>
          <section className="admin-command-palette" role="dialog" aria-modal="true" aria-label="Pesquisar comandos">
            <label><SearchIcon /><input ref={paletteInputRef} value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} placeholder="Digite o módulo ou ação…" /></label>
            <div>
              {filteredModules.map((module) => (
                <button
                  key={module.id}
                  className={isModuleAvailable(module.id) ? '' : 'is-locked'}
                  type="button"
                  aria-disabled={!isModuleAvailable(module.id)}
                  onClick={() => openModule(module.id)}
                >
                  <span>{module.code}</span>
                  <span><strong>{module.label}</strong><small>{module.description}</small></span>
                  {isModuleAvailable(module.id) ? <kbd>Enter</kbd> : <em>Plano superior</em>}
                </button>
              ))}
              {!filteredModules.length ? <p>Nenhum módulo encontrado.</p> : null}
            </div>
          </section>
        </div>
      ) : null}

      {windowManagerOpen ? (
        <aside className="admin-window-manager" aria-label="Gerenciador de janelas">
          <header><strong>Gerenciador de janelas</strong><button type="button" aria-label="Fechar" onClick={() => setWindowManagerOpen(false)}>×</button></header>
          <section>
            <span>ORGANIZAÇÃO</span>
            <div className="admin-window-manager__layouts">
              <button className={windowLayout === 'smart' ? 'is-active' : ''} type="button" onClick={() => arrangeWindows('smart')}>Auto</button>
              <button className={windowLayout === 'focus' ? 'is-active' : ''} type="button" onClick={() => arrangeWindows('focus')}>Foco</button>
              <button className={windowLayout === 'columns' ? 'is-active' : ''} type="button" onClick={() => arrangeWindows('columns')}>2 colunas</button>
              <button className={windowLayout === 'rows' ? 'is-active' : ''} type="button" onClick={() => arrangeWindows('rows')}>2 linhas</button>
              <button className={windowLayout === 'grid' ? 'is-active' : ''} type="button" onClick={() => arrangeWindows('grid')}>Grade</button>
              <button className={windowLayout === 'cascade' ? 'is-active' : ''} type="button" onClick={() => arrangeWindows('cascade')}>Cascata</button>
            </div>
            <label className="admin-window-manager__auto"><span><strong>Organizar ao abrir</strong><small>Novas janelas entram no layout atual.</small></span><input type="checkbox" checked={autoArrange} onChange={(event) => setAutoArrange(event.target.checked)} /><i aria-hidden="true" /></label>
          </section>
          <section>
            <span>JANELAS ABERTAS</span>
            <div className="admin-window-manager__list">
              {windows.map((item) => {
                const module = getModule(item.module)
                return (
                  <article key={item.module}>
                    <b>{module.code}</b>
                    <button type="button" onClick={() => focusWindow(item.module)}><strong>{module.label}</strong><small>{item.minimized ? 'Minimizada' : item.maximized ? 'Maximizada' : 'Em janela'}</small></button>
                    <button type="button" aria-label={`Fechar ${module.label}`} onClick={() => closeWindow(item.module)}>×</button>
                  </article>
                )
              })}
              {!windows.length ? <p>Nenhuma janela aberta.</p> : null}
            </div>
          </section>
          <section>
            <span>DESEMPENHO DO WORKSPACE</span>
            <div className="admin-window-manager__performance">
              <header><small>Uso estimado</small><strong>{memoryMb} MB</strong></header>
              <div><i style={{ width: `${memoryPercent}%` }} /></div>
              <p>{cacheMessage}</p>
              <button type="button" onClick={optimizeCache}>Limpar cache temporário</button>
            </div>
          </section>
        </aside>
      ) : null}

      {helpOpen ? (
        <div className="admin-desktop-overlay" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setHelpOpen(false)
        }}>
          <section className="admin-workspace-help" role="dialog" aria-modal="true" aria-label="Ajuda do Workspace">
            <header>
              <div><span aria-hidden="true">?</span><div><small>CENTRAL DE AJUDA</small><strong>Command Workspace</strong></div></div>
              <button type="button" aria-label="Fechar" onClick={() => setHelpOpen(false)}>×</button>
            </header>
            <div className="admin-workspace-help__content">
              <p>Encontre rapidamente módulos, organize sua área de trabalho e mantenha as operações mais usadas ao alcance.</p>
              <div className="admin-workspace-help__grid">
                <article><span><SearchIcon /></span><div><strong>Navegação e pesquisa</strong><small>Use a barra lateral ou pressione <kbd>Ctrl K</kbd> para localizar qualquer módulo e comando.</small></div></article>
                <article><span><WindowsIcon /></span><div><strong>Janelas e encaixe</strong><small>Arraste pelo título. Encoste nas bordas para maximizar, dividir a tela ou formar quadrantes.</small></div></article>
                <article><span><SettingsIcon /></span><div><strong>Organização do espaço</strong><small>Clique em <b>Modo</b> na barra inferior para escolher foco, colunas, linhas, grade ou cascata.</small></div></article>
                <article><span><DashboardIcon /></span><div><strong>Acesso rápido</strong><small>Os atalhos inferiores abrem ou trazem para frente Visão geral, Checklists, Intervenções e Motor.</small></div></article>
              </div>
            </div>
            <footer><span>O gerenciador completo continua disponível pelo ícone de janelas no cabeçalho.</span><button type="button" onClick={() => setHelpOpen(false)}>Entendi</button></footer>
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

      <NotificationCenter
        open={notificationOpen}
        audience="admin"
        onClose={() => setNotificationOpen(false)}
        onOpenNotification={handleOpenNotification}
        onUnreadChange={setNotificationCount}
        onSessionExpired={onSessionExpired}
      />
    </div>
  )
}
