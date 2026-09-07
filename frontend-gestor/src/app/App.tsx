import { useCallback, useEffect, useState } from 'react'
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
  const [adminModule, setAdminModule] = useState<AdminModule>('overview')
  const [validationCount, setValidationCount] = useState(0)
  const [notificationCount, setNotificationCount] = useState(0)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [workspaceReady, setWorkspaceReady] = useState(hasCompletedStartup)
  const [technicalContext, setTechnicalContext] =
    useState<GestorTechnicalContext | null>(null)
  const isAdmin = session?.user.perfil.trim().toUpperCase() === 'ADMIN'
  const isSystem = session?.user.perfil.trim().toUpperCase() === 'SISTEMA'
  const compactDevice = useAdaptiveDevice()

  const expireSession = useCallback(() => {
    markExpiredGestorSession()
    setSession(null)
    setSection('home')
    setNotificationOpen(false)
    setNotificationCount(0)
    setWorkspaceReady(false)
  }, [])

  useEffect(() => {
    if (!session || isAdmin || isSystem || !workspaceReady) return
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
    if (!session || isAdmin || isSystem || !workspaceReady) return
    const controller = new AbortController()
    void getGestorTechnicalContext(controller.signal)
      .then((context) => {
        setTechnicalContext(context)
        if (!context.pode_validar) setSection('validations')
      })
      .catch((cause) => {
        if (controller.signal.aborted) return
        if (isGestorAuthenticationError(cause)) expireSession()
      })
    return () => controller.abort()
  }, [expireSession, isAdmin, isSystem, session, workspaceReady])

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
    setSection('validations')
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  function handleOpenNotification(notification: GestorNotification) {
    const entityType = String(notification.entidade_tipo ?? '').trim().toUpperCase()
    const entityId = String(notification.entidade_id ?? '').trim()
    if (!entityId) {
      throw new Error('Esta notificação não possui um registro de destino válido.')
    }
    if (entityType === 'OCORRENCIAS_OPERACIONAIS') {
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
      <div className="app-shell app-shell--manager">
        <header className="topbar">
        <div className="topbar__identity topbar__identity--manager">
          <div>
            <strong>Fab Control</strong>
            <span>
              {technicalContext?.pode_validar
                ? `Validação técnica · ${technicalContext.identidade.area_nome || 'Qualidade e segurança'}`
                : `${technicalContext?.identidade.cargo_nome || 'Acompanhamento técnico'} · ${technicalContext?.identidade.area_nome || 'Área técnica'}`}
            </span>
          </div>
        </div>

        <div className="topbar__actions">
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
          {section === 'home' ? (
            <GestorDecisionWorkspace
              initialView={decisionView}
              focus={decisionFocus}
              onQueueCountChange={setValidationCount}
              onOpenAnalytics={(assetId) => handleOpenAnalytics(assetId)}
              onSessionExpired={expireSession}
            />
          ) : null}
          {section === 'validations' ? (
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
          ) : null}
          {section === 'scan' ? (
            <GestorQrWorkspace
              onOpenAsset={(assetId) => handleOpenAnalytics(assetId)}
              onSessionExpired={expireSession}
            />
          ) : null}
          {section === 'more' ? (
            <MorePage session={session} />
          ) : null}
        </div>

        <AppNavigation
          active={section}
          validationCount={validationCount}
          showAdmin={false}
          canValidate={technicalContext?.pode_validar ?? false}
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
