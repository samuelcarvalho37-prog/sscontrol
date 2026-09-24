import { useCallback, useEffect, useState } from 'react'
import { OccurrenceWizard } from '../../../frontend/src/components/OccurrenceWizard'
import { getApiUrl, usesNodeApi } from '../services/api/config'
import { PcmDashboard } from '../components/PcmDashboard'
import { TechnicianDashboard } from '../components/TechnicianDashboard'
import {
  AppNavigation,
  type GestorSection,
} from '../components/AppNavigation'
import { AdminWorkspace } from '../components/AdminWorkspace'
import { BellIcon } from '../components/Icons'
import { NotificationCenter } from '../components/NotificationCenter'
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
  ADMIN: 'Administração',
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

export function App() {
  const [session, setSession] = useState<GestorSession | null>(readGestorSession)
  const [maintenanceEntry, setMaintenanceEntry] = useState(
    () => new URLSearchParams(window.location.search).get('maintenance') === '1',
  )
  const [section, setSection] = useState<GestorSection>('home')
  const [decisionView, setDecisionView] = useState<GestorWorkView>('demands')
  const [decisionFocus, setDecisionFocus] = useState<GestorDecisionFocus | null>(null)
  const [analyticsFocusAsset, setAnalyticsFocusAsset] = useState('')
  const [analyticsFocusOccurrence, setAnalyticsFocusOccurrence] = useState('')
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
  const canReportOccurrence = session?.user.capacidades?.includes('maintenance.occurrences.report') ?? false
  const canReadAnalytics = session?.user.capacidades === undefined || session.user.capacidades.includes('analytics.technical.read')
  const isSystem = session?.user.perfil.trim().toUpperCase() === 'SISTEMA'
  const isTechnician = session?.user.perfil.trim().toUpperCase() === 'TECNICO'
  const normalizedProfile = session?.user.perfil.trim().toUpperCase() ?? ''
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
    if (!session || isAdmin || isSystem || !workspaceReady || !canReadWork) return
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
  }, [expireSession, isAdmin, isSystem, isTechnician, session, workspaceReady, canReadWork, canReadAnalytics])

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
    setDecisionFocus(null)
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
    if (
      entityType === 'OCORRENCIAS_OPERACIONAIS' ||
      entityType === 'OPERATIONAL_OCCURRENCE'
    ) {
      handleOpenAnalytics('', entityId)
      return
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
      <div className={`app-shell app-shell--manager profile-shell--${normalizedProfile.toLowerCase() || 'default'}`}>
        <header className="topbar">
        <div className="topbar__identity topbar__identity--manager">
          <div>
            <img className="vorqix-logo vorqix-logo--compact" src="/vorqix-logo.png" alt="VORQIX — Unidade Industrial" />
            <span>
              {technicalContext?.pode_validar
                ? `Validação técnica · ${technicalContext.identidade.area_nome || 'Qualidade e segurança'}`
                : `${technicalContext?.identidade.cargo_nome || 'Acompanhamento técnico'} · ${technicalContext?.identidade.area_nome || 'Área técnica'}`}
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
            <span>{session.user.perfil}</span>
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
                {canReadAnalytics ? (
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
          {section === 'home' && isTechnician ? <TechnicianDashboard onSessionExpired={expireSession} /> : null}
          {section === 'home' && canReadWork && !isTechnician ? (
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
            {usesNodeApi() && <div className="pcm-view-switch">
              <button type="button" onClick={() => setDetailedAnalytics(false)} aria-pressed={!detailedAnalytics}>Dashboard do PCM</button>
              <button type="button" onClick={() => setDetailedAnalytics(true)} aria-pressed={detailedAnalytics}>Histórico e análise detalhada</button>
            </div>}
            {usesNodeApi() && !detailedAnalytics ? <PcmDashboard onSessionExpired={expireSession} /> :
            <GestorAnalyticsWorkspace
              focusAssetId={analyticsFocusAsset}
              focusOccurrenceId={analyticsFocusOccurrence}
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
          {section === 'scan' ? (
            <GestorQrWorkspace
              onOpenAsset={(assetId) => handleOpenAnalytics(assetId)}
              onSessionExpired={expireSession}
            />
          ) : null}
          {section === 'more' || (section === 'home' && !canReadWork && !canReportOccurrence) || (section === 'validations' && !canReadAnalytics) ? (
            <MorePage session={session} />
          ) : null}
        </div>

        <AppNavigation
          active={section}
          validationCount={validationCount}
          showAdmin={false}
          canValidate={technicalContext?.pode_validar ?? false}
          isTechnician={isTechnician}
          canReadAnalytics={canReadAnalytics}
          compactDevice={compactDevice}
          onNavigate={handleNavigate}
        />

        <NotificationCenter
          open={notificationOpen}
          audience="manager"
          onClose={() => setNotificationOpen(false)}
          onOpenNotification={handleOpenNotification}
          onUnreadChange={setNotificationCount}
          onSessionExpired={expireSession}
        />
      </div>
    </div>
  )
}
