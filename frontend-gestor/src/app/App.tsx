import { adaptPcmAppearance } from '../components/pcmAppearance'
import type { CSSProperties } from 'react'
import '../styles/pcm-workspace-shell.css'
import { useCallback, useEffect, useState } from 'react'
import { OccurrenceWizard } from '../../../frontend/src/components/OccurrenceWizard'
import { getApiUrl, usesNodeApi } from '../services/api/config'
import { PcmDashboard } from '../components/PcmDashboard'
import { PcmMaintenanceWorkspace } from '../components/PcmMaintenanceWorkspace'
import { TechnicianDashboard } from '../components/TechnicianDashboard'
import {
  AppNavigation,
  type GestorSection,
} from '../components/AppNavigation'
import { AdminWorkspace } from '../components/AdminWorkspace'
import { PlatformConsole } from '../components/PlatformConsole'
import { BellIcon } from '../components/Icons'
import { NotificationCenter } from '../components/NotificationCenter'
import { notificationNavigation, validationDemandFromSearch } from '../components/notificationPolicy'
import { PlatformMotorWorkspace } from '../components/PlatformMotorWorkspace'
import { WorkspaceStartupGate } from '../components/WorkspaceStartupGate'
import { useAdaptiveDevice } from '../hooks/useAdaptiveDevice'
import type { AdminModule } from '../pages/AdminPage'
import { GestorAnalyticsWorkspace } from '../pages/GestorAnalyticsWorkspace'
import {
  GestorDecisionWorkspace,
  type GestorDecisionFocus,
} from '../pages/GestorDecisionWorkspace'
import { LoginPage } from '../pages/LoginPage'
import { MaintenanceAccessPage } from '../pages/MaintenanceAccessPage'
import { MorePage } from '../pages/MorePage'
import { GestorQrWorkspace } from '../pages/GestorQrWorkspace'
import {
  revokeGestorSession,
  type GestorSession,
} from '../services/api/auth'
import {
  getGestorTechnicalContext,
  getUnreadNotificationCount,
  isGestorAuthenticationError,
} from '../services/api/gestor'
import {
  clearGestorSession,
  hasCompletedStartup,
  markExpiredGestorSession,
  markStartupCompleted,
  readGestorSession,
  saveGestorSession,
} from '../services/auth/session'
import type {
  GestorNotification,
  GestorTechnicalContext,
  GestorWorkView,
} from '../types/gestor'

const PROFILE_TAB_TITLES: Record<string, string> = {
  ADMIN: 'TI',
  SISTEMA: 'Administração',
  GESTOR: 'PCM',
  PCM: 'PCM',
  TECNICO: 'Técnico',
  PRODUCAO: 'Produção',
  QUALIDADE: 'Qualidade',
  SEGURANCA: 'Segurança',
  OPERADOR: 'Operação',
}

const PROFILE_EXPERIENCE: Record<string, { eyebrow: string; title: string; description: string; primary: string }> = {
  PCM: {
    eyebrow: 'PLANEJAMENTO E CONTROLE',
    title: 'Central de decisões',
    description: 'Priorize ordens, acompanhe riscos e mantenha a programação sob controle.',
    primary: 'Abrir fila de decisões',
  },
  GESTOR: {
    eyebrow: 'PLANEJAMENTO E CONTROLE',
    title: 'Central de decisões',
    description: 'Priorize ordens, acompanhe riscos e mantenha a programação sob controle.',
    primary: 'Abrir fila de decisões',
  },
  PRODUCAO: {
    eyebrow: 'OPERAÇÃO INDUSTRIAL',
    title: 'Acompanhamento da produção',
    description: 'Visualize impactos na linha, sinalize ocorrências e acompanhe a retomada operacional.',
    primary: 'Acompanhar operação',
  },
  QUALIDADE: {
    eyebrow: 'GARANTIA DA QUALIDADE',
    title: 'Validações e conformidade',
    description: 'Analise solicitações pendentes e registre decisões com rastreabilidade.',
    primary: 'Abrir validações',
  },
  SEGURANCA: {
    eyebrow: 'SEGURANÇA OPERACIONAL',
    title: 'Controle de liberações',
    description: 'Acompanhe riscos e execute as validações necessárias antes do retorno à operação.',
    primary: 'Abrir validações',
  },
}

function profileTabTitle(profile?: string) {
  const normalizedProfile = profile?.trim().toUpperCase() ?? ''
  return PROFILE_TAB_TITLES[normalizedProfile] ?? 'Gestão Industrial'
}

function TenantApp() {
  const [session, setSession] = useState<GestorSession | null>(readGestorSession)
  const [maintenanceEntry, setMaintenanceEntry] = useState(
    () => new URLSearchParams(window.location.search).get('maintenance') === '1',
  )
  const [section, setSection] = useState<GestorSection>('home')
  const [decisionView, setDecisionView] = useState<GestorWorkView>('demands')
  const [decisionFocus, setDecisionFocus] = useState<GestorDecisionFocus | null>(() => {
    const demandId = validationDemandFromSearch(window.location.search)
    return demandId ? { kind: 'demand', id: demandId } : null
  })
  const [analyticsFocusAsset, setAnalyticsFocusAsset] = useState('')
  const [analyticsFocusOccurrence, setAnalyticsFocusOccurrence] = useState('')
  const [partShortageFocusId, setPartShortageFocusId] = useState('')
  const [technicianActionFocus, setTechnicianActionFocus] = useState<{ actionId?: string; workOrderId?: string } | null>(null)
  const [detailedAnalytics, setDetailedAnalytics] = useState(false)
  const [adminModule, setAdminModule] = useState<AdminModule>('overview')
  const [validationCount, setValidationCount] = useState(0)
  const [notificationCount, setNotificationCount] = useState(0)

  const [notificationOpen, setNotificationOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [workspaceReady, setWorkspaceReady] = useState(hasCompletedStartup)
  const [technicalContext, setTechnicalContext] =
    useState<GestorTechnicalContext | null>(null)
  const isAdmin = session?.user.capacidades !== undefined
    ? session.user.capacidades.includes('admin.identity.read')
    : session?.user.perfil.trim().toUpperCase() === 'ADMIN'
  const canReadWork = session?.user.capacidades === undefined || session.user.capacidades.includes('maintenance.work-orders.read')
  const canReviewWork = session?.user.capacidades?.includes('maintenance.work-orders.review') ?? false
  const canAccessDecisionWorkspace = canReadWork || canReviewWork
  const canReportOccurrence = session?.user.capacidades?.includes('maintenance.occurrences.report') ?? false
  const canReadAnalytics = session?.user.capacidades === undefined || session.user.capacidades.includes('analytics.technical.read')
  const isSystem = session?.user.perfil.trim().toUpperCase() === 'SISTEMA'
  const isTechnician = session?.user.perfil.trim().toUpperCase() === 'TECNICO'
  const normalizedProfile = session?.user.perfil.trim().toUpperCase() ?? ''
  const canViewPcmDashboard = ['PCM', 'GESTOR'].includes(normalizedProfile) && canReadAnalytics
  useEffect(() => {
    if (canViewPcmDashboard) setSection(current => current === 'home' ? 'validations' : current)
  }, [canViewPcmDashboard])
  const [pcmSurface, setPcmSurface] = useState<{ cardBackground?: string; contentColor?: string; titleColor?: string; cardEffect?: string }>(() => { try { const saved = JSON.parse(localStorage.getItem('vorqix.pcm.workspace-style.v1') ?? '{}'); return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {} } catch { return {} } })
  const [pcmTheme, setPcmTheme] = useState<'light' | 'dark' | 'ice'>(() => {
    try { const saved = window.localStorage.getItem('vorqix.pcm.dashboard-theme.v1'); return saved === 'dark' || saved === 'ice' ? saved : 'light' } catch { return 'light' }
  })
  useEffect(() => {
    if (!canViewPcmDashboard) return
    const update = (event: Event) => {
      const value = (event as CustomEvent).detail
      if (value === 'light' || value === 'dark' || value === 'ice') setPcmTheme(value)
    }
    const updateStyle = (event: Event) => { const style = (event as CustomEvent).detail; if (style && typeof style === 'object') setPcmSurface(style) }
    window.addEventListener('vorqix:pcm-style', updateStyle)
    window.addEventListener('vorqix:pcm-theme', update)
    document.documentElement.dataset.pcmDashboardTheme = pcmTheme
    return () => { window.removeEventListener('vorqix:pcm-theme', update); window.removeEventListener('vorqix:pcm-style', updateStyle); delete document.documentElement.dataset.pcmDashboardTheme }
  }, [canViewPcmDashboard, pcmTheme])

  const pcmSurfaceAppearance = adaptPcmAppearance({ ...pcmSurface, themeAdaptive: true }, pcmTheme)
  const canManageMaintenance = ['PCM', 'GESTOR'].includes(normalizedProfile)
    && Boolean(session?.user.capacidades?.includes('maintenance.plans.manage'))
  const profileExperience = PROFILE_EXPERIENCE[normalizedProfile]
  const compactDevice = useAdaptiveDevice()

  useEffect(() => {
    document.title = session
      ? `VORQIX ${profileTabTitle(session.user.perfil)}`
      : 'VORQIX — Unidade Industrial'
  }, [session])

  const expireSession = useCallback(() => {
    markExpiredGestorSession()
    setSession(null)
    setSection('home')
    setNotificationOpen(false)
    setNotificationCount(0)
    setWorkspaceReady(false)
  }, [])

  useEffect(() => {
    if (!session || isAdmin || isSystem || !workspaceReady || (session.user.capacidades !== undefined && !session.user.capacidades.includes('workflow.notifications.read'))) return
    const controller = new AbortController()

    async function refreshNotifications() {
      try {
        const count = await getUnreadNotificationCount(controller.signal)
        setNotificationCount(count)
      } catch (cause) {
        if (controller.signal.aborted) return
        if (isGestorAuthenticationError(cause)) expireSession()
      }
    }

    void refreshNotifications()
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshNotifications()
    }
    const timer = window.setInterval(() => void refreshNotifications(), 12_000)
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
  }, [expireSession, isAdmin, isSystem, session, workspaceReady])

  useEffect(() => {
    if (!session || isAdmin || isSystem || !workspaceReady || !canAccessDecisionWorkspace) return
    const controller = new AbortController()
    void getGestorTechnicalContext(controller.signal)
      .then((context) => {
        setTechnicalContext(context)
        if (!context.pode_validar && !isTechnician) setSection(canReadAnalytics ? 'validations' : 'more')
      })
      .catch((cause) => {
        if (controller.signal.aborted) return
        if (isGestorAuthenticationError(cause)) expireSession()
      })
    return () => controller.abort()
  }, [expireSession, isAdmin, isSystem, isTechnician, session, workspaceReady, canAccessDecisionWorkspace, canReadAnalytics])

  useEffect(() => {
    if (!session) return

    const remaining = session.expiresAt - Date.now()
    if (remaining <= 0) {
      expireSession()
      return
    }

    const timer = window.setTimeout(expireSession, remaining)
    return () => window.clearTimeout(timer)
  }, [expireSession, session])

  function leaveMaintenanceEntry() {
    const url = new URL(window.location.href)
    url.searchParams.delete('maintenance')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    setMaintenanceEntry(false)
  }

  function handleAuthenticated(nextSession: GestorSession) {
    saveGestorSession(nextSession)
    setSession(nextSession)
    setSection('home')
    setAdminModule('overview')
    setDecisionView('demands')
    const validationDemandId = validationDemandFromSearch(window.location.search)
    setDecisionFocus(validationDemandId ? { kind: 'demand', id: validationDemandId } : null)
    setAnalyticsFocusAsset('')
    setAnalyticsFocusOccurrence('')
    setNotificationCount(0)
    setTechnicalContext(null)
    setWorkspaceReady(false)
  }

  const completeWorkspaceStartup = useCallback(() => {
    markStartupCompleted()
    setWorkspaceReady(true)
  }, [])

  function handleNavigate(nextSection: GestorSection) {
    if (nextSection === 'home') setDecisionFocus(null)
    setSection(nextSection)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  function handleOpenDecision(
    view: GestorWorkView = 'demands',
    focus: GestorDecisionFocus | null = null,
  ) {
    setDecisionView(view)
    setDecisionFocus(focus)
    setSection('home')
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  function preserveValidationDemandInUrl(demandId: string) {
    const url = new URL(window.location.href)
    url.searchParams.set('validationDemand', demandId)
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }

  function handleOpenAnalytics(assetId = '', occurrenceId = '') {
    setAnalyticsFocusAsset(assetId)
    setAnalyticsFocusOccurrence(occurrenceId)
    setDetailedAnalytics(true)
    setSection('validations')
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  function handleOpenNotification(notification: GestorNotification) {
    const entityType = String(notification.entidade_tipo ?? '').trim().toUpperCase()
    const entityId = String(notification.entidade_id ?? '').trim()
    if (!entityId) {
      throw new Error('Esta notificação não possui um registro de destino válido.')
    }
    const destination = notificationNavigation(notification, normalizedProfile)
    if (destination?.kind === 'work-order-action') {
      setTechnicianActionFocus({ actionId: destination.id })
      setSection('home')
      window.scrollTo({ top: 0, behavior: 'auto' })
      return
    }
    if (destination?.kind === 'technician-action') {
      setTechnicianActionFocus({ actionId: destination.actionId, workOrderId: destination.workOrderId })
      setSection('home')
      window.scrollTo({ top: 0, behavior: 'auto' })
      return
    }
    if (destination?.kind === 'technical-demand') {
      preserveValidationDemandInUrl(destination.id)
      handleOpenDecision('demands', { kind: 'demand', id: destination.id })
      return
    }
    if (destination?.kind === 'part-shortage') {
      setPartShortageFocusId(destination.id)
      setDetailedAnalytics(false)
      setSection('validations')
      return
    }
    if (destination?.kind === 'occurrence') {
      handleOpenAnalytics('', destination.id)
      return
    }
    if (
      entityType === 'OCORRENCIAS_OPERACIONAIS' ||
      entityType === 'OPERATIONAL_OCCURRENCE'
    ) {
      if (isTechnician) {
        throw new Error('Esta ocorrência ainda não está vinculada a uma OS disponível na sua fila. Atualize a Central do Técnico ou peça ao PCM para verificar o vínculo.')
      }
      throw new Error('Ocorrências operacionais são tratadas pelo PCM e não geram validação desta área.')
    }
    if (isTechnician && ['ANALISES_TECNICAS', 'TECHNICAL_ANALYSIS'].includes(entityType)) {
      throw new Error('Esta análise técnica não contém vínculo com uma OS da sua fila. Abra a OS em Ordens ou solicite ao PCM que confira a associação.')
    }
    if (entityType === 'ATIVOS') {
      handleOpenAnalytics(entityId)
      return
    }
    if (entityType === 'DEMANDAS_TECNICAS') {
      handleOpenDecision('demands', { kind: 'demand', id: entityId })
      return
    }
    if (entityType === 'OS_ACOES') {
      handleOpenDecision('actions', { kind: 'action', id: entityId })
      return
    }
    if (
      entityType === 'WORK_ORDER' ||
      entityType === 'ORDEM_SERVICO' ||
      entityType === 'MAINTENANCE_WORK_ORDER'
    ) {
      handleOpenDecision('demands', { kind: 'workOrder', id: entityId })
      return
    }
    if (
      entityType === 'PLANOS_MANUTENCAO' ||
      entityType === 'CHECKLIST_MODELO' ||
      entityType === 'PLANO_CHECKLIST'
    ) {
      handleOpenDecision('models', { kind: 'model', id: entityId })
      return
    }
    throw new Error(`O destino ${entityType || 'desconhecido'} não está disponível neste perfil.`)
  }

  async function handleLogout() {
    if (!session || loggingOut) return

    const systemSession = session.user.perfil.trim().toUpperCase() === 'SISTEMA'
    setLoggingOut(true)
    try {
      await revokeGestorSession(session.token)
    } catch {
      // O encerramento local continua mesmo sem resposta da API.
    } finally {
      clearGestorSession()
      setSession(null)
      setSection('home')
      setNotificationOpen(false)
      setNotificationCount(0)
      setTechnicalContext(null)
      setWorkspaceReady(false)
      if (systemSession) leaveMaintenanceEntry()
      setLoggingOut(false)
    }
  }

  if (!session) {
    if (maintenanceEntry) {
      return (
        <MaintenanceAccessPage
          onAuthenticated={handleAuthenticated}
          onReturn={leaveMaintenanceEntry}
        />
      )
    }
    return <LoginPage onAuthenticated={handleAuthenticated} />
  }

  if (isSystem) {
    return (
      <PlatformMotorWorkspace
        session={session}
        loggingOut={loggingOut}
        onSessionExpired={expireSession}
        onLogout={() => void handleLogout()}
      />
    )
  }

  if (!workspaceReady) {
    return (
      <WorkspaceStartupGate
        session={session}
        onReady={completeWorkspaceStartup}
        onSessionExpired={expireSession}
        onLogout={() => void handleLogout()}
      />
    )
  }

  if (isAdmin) {
    return (
      <AdminWorkspace
        session={session}
        activeModule={adminModule}
        loggingOut={loggingOut}
        onModuleChange={setAdminModule}
        onSessionExpired={expireSession}
        onLogout={() => void handleLogout()}
      />
    )
  }

  return (
    <div className="manager-app-stage">
      <div style={canViewPcmDashboard ? { '--pcm-shared-panel': pcmSurfaceAppearance.cardBackground === 'transparent' ? undefined : pcmSurfaceAppearance.cardBackground, '--pcm-shared-ink': pcmSurfaceAppearance.contentColor } as CSSProperties : undefined} data-pcm-surface-effect={canViewPcmDashboard ? pcmSurface.cardEffect : undefined} data-pcm-workspace={canViewPcmDashboard || undefined} data-pcm-theme={canViewPcmDashboard ? pcmTheme : undefined} className={`app-shell app-shell--manager profile-shell--${normalizedProfile.toLowerCase() || 'default'}`}>
        <header className="topbar">
        <div className="topbar__identity topbar__identity--manager">
          <div>
            <img className="vorqix-logo vorqix-logo--compact" src="/vorqix-logo.png" alt="VORQIX — Unidade Industrial" />
            <span>
              {technicalContext?.pode_validar
                ? `Validação técnica · ${technicalContext.identidade.area_nome || 'Qualidade e segurança'}`
                : (() => {
                    const role = technicalContext?.identidade.cargo_nome || 'Acompanhamento técnico'
                    const area = technicalContext?.identidade.area_nome || 'Área técnica'
                    return role.toLocaleLowerCase('pt-BR').includes(area.toLocaleLowerCase('pt-BR'))
                      ? role
                      : `${role} · ${area}`
                  })()}
            </span>
          </div>
        </div>

        <div className={`topbar__actions${isTechnician ? ' topbar__actions--technician' : ''}`}>
          <span className="connection-chip">
            <i aria-hidden="true" />
            Online
          </span>

          <div className="user-badge">
            <strong>{session.user.nome}</strong>
            {!['PCM', 'GESTOR'].includes(normalizedProfile) ? <span>{session.user.perfil}</span> : null}
          </div>

          <button
            className="manager-notification-trigger"
            type="button"
            onClick={() => setNotificationOpen(true)}
            aria-label={
              notificationCount
                ? `Abrir ${notificationCount} notificações não lidas`
                : 'Abrir notificações'
            }
          >
            <BellIcon />
            {notificationCount > 0 ? (
              <span>{notificationCount > 99 ? '99+' : notificationCount}</span>
            ) : null}
          </button>

          <button
            className="logout-button"
            type="button"
            disabled={loggingOut}
            onClick={() => void handleLogout()}
          >
            {loggingOut ? 'Saindo…' : 'Sair'}
          </button>
        </div>
        {canViewPcmDashboard ? <>
          <nav className="pcm-header-navigation" aria-label="Áreas do PCM"><button type="button" aria-current={section === 'validations' ? 'page' : undefined} onClick={() => { setDetailedAnalytics(false); handleNavigate('validations') }}>Lousa do PCM</button>{canManageMaintenance ? <button type="button" aria-current={section === 'maintenance' ? 'page' : undefined} onClick={() => handleNavigate('maintenance')}>Manutenção</button> : null}<button type="button" aria-current={section === 'more' ? 'page' : undefined} onClick={() => handleNavigate('more')}>Conta</button></nav>
          <div id="pcm-alerts-slot" className="pcm-header-alerts-slot" />
          <div id="pcm-toolbar-slot" className="pcm-header-toolbar-slot" />
        </> : null}
        </header>

        <div className="app-content">
          {section === 'home' && !isTechnician && profileExperience ? (
            <section className="profile-experience-hero" aria-label={`Resumo de ${profileTabTitle(normalizedProfile)}`}>
              <div>
                <span>{profileExperience.eyebrow}</span>
                <h1>{profileExperience.title}</h1>
                <p>{profileExperience.description}</p>
              </div>
              <div className="profile-experience-hero__actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => {
                    const workspace = document.querySelector('.manager-decision-workspace')
                    if (workspace) {
                      workspace.scrollIntoView({ behavior: 'smooth', block: 'start' })
                      return
                    }
                    handleNavigate(canReadAnalytics ? 'validations' : 'home')
                  }}
                >
                  {profileExperience.primary}
                </button>
                {canViewPcmDashboard ? (
                  <button className="secondary-button" type="button" onClick={() => handleNavigate('validations')}>
                    Ver indicadores
                  </button>
                ) : null}
                {compactDevice ? (
                  <button className="profile-experience-hero__scan" type="button" onClick={() => handleNavigate('scan')}>
                    Ler QR
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}
          {section === 'home' && canReportOccurrence && !canReadWork && <OccurrenceWizard apiUrl={getApiUrl()} token={session.token} />}
          {section === 'home' && isTechnician ? <TechnicianDashboard onSessionExpired={expireSession} notificationFocus={technicianActionFocus} onNotificationFocusHandled={() => setTechnicianActionFocus(null)} /> : null}
          {section === 'home' && canAccessDecisionWorkspace && !isTechnician ? (
            <GestorDecisionWorkspace
              capabilities={session.user.capacidades}
              initialView={decisionView}
              focus={decisionFocus}
              onQueueCountChange={setValidationCount}
              onOpenAnalytics={(assetId) => handleOpenAnalytics(assetId)}
              onSessionExpired={expireSession}
            />
          ) : null}
          {section === 'validations' && canReadAnalytics ? (
            <>
            {usesNodeApi() && canViewPcmDashboard && detailedAnalytics ? <nav className="pcm-view-switch pcm-view-switch--return" aria-label="Área do PCM">
              <button type="button" aria-pressed="false" onClick={() => setDetailedAnalytics(false)}>Voltar ao painel do PCM</button>
            </nav> : null}
            {usesNodeApi() && !detailedAnalytics && canViewPcmDashboard ? <PcmDashboard onSessionExpired={expireSession} partShortageFocusId={partShortageFocusId} onOpenHistory={() => setDetailedAnalytics(true)} /> :
            <GestorAnalyticsWorkspace
              focusAssetId={analyticsFocusAsset}
              focusOccurrenceId={analyticsFocusOccurrence}
              onClearFocusOccurrence={() => setAnalyticsFocusOccurrence('')}
              technicalContext={technicalContext}
              onOpenNotifications={() => setNotificationOpen(true)}
              onOpenDecision={(kind, id) => {
                if (kind === 'occurrence') {
                  handleOpenAnalytics('', id)
                  return
                }
                const view: GestorWorkView =
                  kind === 'action'
                    ? 'actions'
                    : kind === 'model'
                      ? 'models'
                      : 'demands'
                handleOpenDecision(view, { kind, id })
              }}
              onSessionExpired={expireSession}
            />
            }
            </>
          ) : null}
          {section === 'maintenance' && canManageMaintenance ? (
            <PcmMaintenanceWorkspace onSessionExpired={expireSession} />
          ) : null}
          {section === 'scan' ? (
            <GestorQrWorkspace
              onOpenAsset={(assetId) => handleOpenAnalytics(assetId)}
              onSessionExpired={expireSession}
            />
          ) : null}
          {section === 'more' || (section === 'home' && !canAccessDecisionWorkspace && !canReportOccurrence) || (section === 'validations' && !canReadAnalytics) ? (
            <MorePage session={session} />
          ) : null}
        </div>

        {!canViewPcmDashboard ? <AppNavigation
          active={section}
          validationCount={validationCount}
          showAdmin={false}
          canValidate={technicalContext?.pode_validar ?? false}
          canReportOccurrence={canReportOccurrence}
          isTechnician={isTechnician}
          canReadAnalytics={canReadAnalytics}
          canManageMaintenance={canManageMaintenance}
          compactDevice={compactDevice}
          onNavigate={handleNavigate}
        /> : null}

        <NotificationCenter
          open={notificationOpen}
          audience="manager"
          profile={session.user.perfil}
          onClose={() => setNotificationOpen(false)}
          onOpenNotification={handleOpenNotification}
          onUnreadChange={setNotificationCount}
          onSessionExpired={expireSession}
        />
      </div>
    </div>
  )
}

export function App() {
  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem('vorqix.pcm.dashboard-theme.v1')
      if (savedTheme === 'light' || savedTheme === 'ice' || savedTheme === 'dark') {
        document.documentElement.dataset.pcmDashboardTheme = savedTheme
      }
    } catch {
      // O tema segue o padrão claro quando o armazenamento estiver indisponível.
    }
  }, [])

  const isPlatformRoute = window.location.pathname === '/plataforma'
    || window.location.pathname.startsWith('/plataforma/')
  return isPlatformRoute ? <PlatformConsole /> : <TenantApp />
}
