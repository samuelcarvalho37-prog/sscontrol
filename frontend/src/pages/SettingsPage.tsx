import { useEffect, useState } from 'react'
import { APP_RELEASE_VERSION } from '../release'
import { clearOperatorCache } from '../services/storage/operatorCache'

export interface SettingsPageProps {
  apiOnline: boolean
  apiVersion: string
  operatorName: string
  operatorRegistration: string
  operatorRole: string
  operatorDepartment: string
  operatorShift: string
  sessionStartedAt: string
  onConfigurationSaved: () => void
  onTestConnection: () => Promise<void>
  onLogout: () => void
}

type SyncResult = 'idle' | 'success' | 'error'
type CameraPermissionState = 'Permitida' | 'Bloqueada' | 'Perguntar ao usar' | 'Não identificada'

type DiagnosticSnapshot = {
  secureContext: boolean
  cameraApi: boolean
  qrDetector: boolean
  indexedDb: boolean
  cameraPermission: CameraPermissionState
  storageUsed: string
  storageQuota: string
  persistentStorage: string
  networkType: string
  executionMode: string
}

type NetworkInformationLike = {
  effectiveType?: string
  downlink?: number
  saveData?: boolean
}

const APP_VERSION = APP_RELEASE_VERSION

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(value)
}

function formatSessionStartedAt(value: string): string {
  if (!value) return 'Sessão atual'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'Sessão atual' : formatDateTime(parsed)
}

function getProfileInitials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'OP'
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('')
}

function getExecutionMode(): string {
  return window.matchMedia('(display-mode: standalone)').matches
    ? 'Aplicativo instalado'
    : 'Navegador'
}

function formatStorage(value?: number): string {
  if (!value || value <= 0) return 'Não identificado'
  const megabytes = value / (1024 * 1024)
  if (megabytes >= 1024) return `${(megabytes / 1024).toFixed(1)} GB`
  return `${megabytes.toFixed(megabytes >= 100 ? 0 : 1)} MB`
}

function getNetworkType(): string {
  const connection = (
    navigator as Navigator & {
      connection?: NetworkInformationLike
      mozConnection?: NetworkInformationLike
      webkitConnection?: NetworkInformationLike
    }
  ).connection ??
    (
      navigator as Navigator & {
        mozConnection?: NetworkInformationLike
      }
    ).mozConnection ??
    (
      navigator as Navigator & {
        webkitConnection?: NetworkInformationLike
      }
    ).webkitConnection

  if (!connection) return navigator.onLine ? 'Conectada' : 'Sem conexão'

  const parts = [
    connection.effectiveType ? connection.effectiveType.toUpperCase() : '',
    connection.downlink ? `${connection.downlink} Mb/s` : '',
    connection.saveData ? 'Economia de dados' : '',
  ].filter(Boolean)

  return parts.length ? parts.join(' · ') : navigator.onLine ? 'Conectada' : 'Sem conexão'
}

async function getCameraPermission(): Promise<CameraPermissionState> {
  if (!navigator.permissions?.query) return 'Não identificada'

  try {
    const result = await navigator.permissions.query({ name: 'camera' as PermissionName })
    if (result.state === 'granted') return 'Permitida'
    if (result.state === 'denied') return 'Bloqueada'
    return 'Perguntar ao usar'
  } catch {
    return 'Não identificada'
  }
}

async function collectDiagnostics(): Promise<DiagnosticSnapshot> {
  let storageUsed = 'Não identificado'
  let storageQuota = 'Não identificado'
  let persistentStorage = 'Não suportado'

  if (navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate()
      storageUsed = formatStorage(estimate.usage)
      storageQuota = formatStorage(estimate.quota)
    } catch {
      // Diagnóstico informativo; falha não afeta a operação.
    }
  }

  if (navigator.storage?.persisted) {
    try {
      persistentStorage = (await navigator.storage.persisted()) ? 'Ativo' : 'Não solicitado'
    } catch {
      persistentStorage = 'Não identificado'
    }
  }

  return {
    secureContext: window.isSecureContext,
    cameraApi: Boolean(navigator.mediaDevices?.getUserMedia),
    qrDetector: 'BarcodeDetector' in window,
    indexedDb: 'indexedDB' in window,
    cameraPermission: await getCameraPermission(),
    storageUsed,
    storageQuota,
    persistentStorage,
    networkType: getNetworkType(),
    executionMode: getExecutionMode(),
  }
}

function initialDiagnostics(): DiagnosticSnapshot {
  return {
    secureContext: window.isSecureContext,
    cameraApi: Boolean(navigator.mediaDevices?.getUserMedia),
    qrDetector: 'BarcodeDetector' in window,
    indexedDb: 'indexedDB' in window,
    cameraPermission: 'Não identificada',
    storageUsed: 'Calculando…',
    storageQuota: 'Calculando…',
    persistentStorage: 'Calculando…',
    networkType: getNetworkType(),
    executionMode: getExecutionMode(),
  }
}

export function SettingsPage({
  apiOnline,
  apiVersion,
  operatorName,
  operatorRegistration,
  operatorRole,
  operatorDepartment,
  operatorShift,
  sessionStartedAt,
  onTestConnection,
  onLogout,
}: SettingsPageProps) {
  const [testing, setTesting] = useState(false)
  const [diagnosing, setDiagnosing] = useState(false)
  const [clearingCache, setClearingCache] = useState(false)
  const [lastChecked, setLastChecked] = useState('')
  const [lastDiagnostic, setLastDiagnostic] = useState('')
  const [deviceOnline, setDeviceOnline] = useState(navigator.onLine)
  const [syncResult, setSyncResult] = useState<SyncResult>('idle')
  const [cacheMessage, setCacheMessage] = useState('')
  const [diagnostics, setDiagnostics] = useState<DiagnosticSnapshot>(initialDiagnostics)

  useEffect(() => {
    const markOnline = () => setDeviceOnline(true)
    const markOffline = () => setDeviceOnline(false)

    window.addEventListener('online', markOnline)
    window.addEventListener('offline', markOffline)
    void refreshDiagnostics(false)

    return () => {
      window.removeEventListener('online', markOnline)
      window.removeEventListener('offline', markOffline)
    }
  }, [])

  async function refreshDiagnostics(showTimestamp = true) {
    setDiagnosing(true)
    try {
      setDiagnostics(await collectDiagnostics())
      if (showTimestamp) setLastDiagnostic(formatDateTime(new Date()))
    } finally {
      setDiagnosing(false)
    }
  }

  async function testSynchronization() {
    setTesting(true)
    setSyncResult('idle')
    try {
      await onTestConnection()
      setSyncResult('success')
    } catch {
      setSyncResult('error')
    } finally {
      setLastChecked(formatDateTime(new Date()))
      setTesting(false)
      void refreshDiagnostics(false)
    }
  }

  async function clearTemporaryData() {
    const confirmed = window.confirm(
      'Limpar o cache operacional deste dispositivo? A configuração interna e as credenciais não serão removidas.',
    )
    if (!confirmed) return

    setClearingCache(true)
    setCacheMessage('')
    try {
      await clearOperatorCache()
      setCacheMessage('Cache operacional limpo. Os dados serão carregados novamente na próxima consulta.')
      await refreshDiagnostics(false)
    } catch {
      setCacheMessage('Não foi possível limpar completamente o cache operacional.')
    } finally {
      setClearingCache(false)
    }
  }

  function requestLogout() {
    const confirmed = window.confirm(
      'Sair da conta deste operador? A interface será reiniciada e voltará para a identificação.',
    )
    if (confirmed) onLogout()
  }

  const synchronizationOnline = apiOnline && deviceOnline

  return (
    <section className="screen settings-page">
      <header className="screen-heading">
        <span>Configurações</span>
        <h1>Aplicativo do operador</h1>
        <p>
          Conta, versão, sincronização e diagnóstico. Credenciais técnicas não são exibidas nesta tela.
        </p>
      </header>

      <div className="settings-dashboard">
        <article className="settings-panel">
          <div className="settings-panel__heading">
            <div>
              <span className="settings-kicker">Conta</span>
              <h2>Meu perfil</h2>
            </div>
            <span className="status-chip status-chip--online">Sessão ativa</span>
          </div>

          <div className="settings-profile">
            <span className="settings-profile__avatar" aria-hidden="true">
              {getProfileInitials(operatorName)}
            </span>
            <div>
              <strong>{operatorName}</strong>
              <p>{operatorRole} · {operatorShift}</p>
            </div>
          </div>

          <div className="settings-details">
            <div className="settings-detail-row">
              <span>Matrícula</span>
              <strong>{operatorRegistration}</strong>
            </div>
            <div className="settings-detail-row">
              <span>Cargo ou ocupação</span>
              <strong>{operatorRole}</strong>
            </div>
            <div className="settings-detail-row">
              <span>Setor</span>
              <strong>{operatorDepartment}</strong>
            </div>
            <div className="settings-detail-row">
              <span>Turno atual</span>
              <strong>{operatorShift}</strong>
            </div>
            <div className="settings-detail-row">
              <span>Sessão iniciada</span>
              <strong>{formatSessionStartedAt(sessionStartedAt)}</strong>
            </div>
            <div className="settings-detail-row">
              <span>Autenticação</span>
              <strong>Homologação local</strong>
            </div>
          </div>

          <p className="settings-pending-note">
            Nome, cargo, setor e turno serão preenchidos pela API após a autenticação real.
          </p>

          <div className="settings-account-actions">
            <button
              type="button"
              className="settings-logout-button"
              onClick={requestLogout}
            >
              Sair da conta
            </button>
          </div>
        </article>

        <article className="settings-panel">
          <div className="settings-panel__heading">
            <div>
              <span className="settings-kicker">Aplicativo</span>
              <h2>FAB Control Operador</h2>
            </div>
            <span className="status-chip status-chip--online">8.5</span>
          </div>

          <div className="settings-details">
            <div className="settings-detail-row">
              <span>Versão da interface</span>
              <strong>{APP_VERSION}</strong>
            </div>
            <div className="settings-detail-row">
              <span>Canal</span>
              <strong>Desenvolvimento e homologação</strong>
            </div>
            <div className="settings-detail-row">
              <span>Execução</span>
              <strong>{diagnostics.executionMode}</strong>
            </div>
          </div>
        </article>

        <article className="settings-panel settings-panel--wide">
          <div className="settings-panel__heading">
            <div>
              <span className="settings-kicker">Sincronização</span>
              <h2>Conexão operacional</h2>
            </div>
            <span className={synchronizationOnline ? 'status-chip status-chip--online' : 'status-chip'}>
              {synchronizationOnline ? 'Online' : 'Offline'}
            </span>
          </div>

          <div className="settings-details settings-details--columns">
            <div className="settings-detail-row">
              <span>Servidor</span>
              <strong>{apiOnline ? 'Disponível' : 'Indisponível'}</strong>
            </div>
            <div className="settings-detail-row">
              <span>Versão da API</span>
              <strong>{apiVersion || 'Ainda não identificada'}</strong>
            </div>
            <div className="settings-detail-row">
              <span>Rede do dispositivo</span>
              <strong>{deviceOnline ? diagnostics.networkType : 'Sem conexão'}</strong>
            </div>
            <div className="settings-detail-row">
              <span>Última verificação</span>
              <strong>{lastChecked || 'Ainda não executada'}</strong>
            </div>
          </div>

          <button
            type="button"
            className="settings-sync-button"
            onClick={() => void testSynchronization()}
            disabled={testing}
          >
            {testing ? 'Verificando sincronização…' : 'Verificar sincronização'}
          </button>

          {syncResult !== 'idle' && (
            <p
              className={
                syncResult === 'success'
                  ? 'settings-sync-result settings-sync-result--success'
                  : 'settings-sync-result settings-sync-result--error'
              }
              role="status"
            >
              {syncResult === 'success'
                ? 'Sincronização verificada com sucesso.'
                : 'Não foi possível confirmar a sincronização.'}
            </p>
          )}
        </article>

        <article className="settings-panel settings-panel--wide">
          <div className="settings-panel__heading">
            <div>
              <span className="settings-kicker">Diagnóstico</span>
              <h2>Recursos do dispositivo</h2>
            </div>
            <span className="status-chip">Local</span>
          </div>

          <div className="settings-diagnostic-grid">
            <div className="settings-diagnostic-item">
              <span>Contexto seguro</span>
              <strong>{diagnostics.secureContext ? 'Disponível' : 'Indisponível em HTTP'}</strong>
              <small>{diagnostics.secureContext ? 'HTTPS ativo.' : 'A câmera pode ser bloqueada pelo navegador.'}</small>
            </div>
            <div className="settings-diagnostic-item">
              <span>API da câmera</span>
              <strong>{diagnostics.cameraApi ? 'Disponível' : 'Indisponível'}</strong>
              <small>Permissão: {diagnostics.cameraPermission}</small>
            </div>
            <div className="settings-diagnostic-item">
              <span>Leitor QR nativo</span>
              <strong>{diagnostics.qrDetector ? 'Compatível' : 'Não suportado'}</strong>
              <small>BarcodeDetector do navegador.</small>
            </div>
            <div className="settings-diagnostic-item">
              <span>Cache IndexedDB</span>
              <strong>{diagnostics.indexedDb ? 'Disponível' : 'Indisponível'}</strong>
              <small>Suporte à consulta offline.</small>
            </div>
            <div className="settings-diagnostic-item">
              <span>Armazenamento usado</span>
              <strong>{diagnostics.storageUsed}</strong>
              <small>Limite estimado: {diagnostics.storageQuota}</small>
            </div>
            <div className="settings-diagnostic-item">
              <span>Armazenamento persistente</span>
              <strong>{diagnostics.persistentStorage}</strong>
              <small>Proteção contra limpeza automática do navegador.</small>
            </div>
          </div>

          <div className="settings-diagnostic-actions">
            <button
              type="button"
              className="settings-sync-button"
              onClick={() => void refreshDiagnostics()}
              disabled={diagnosing}
            >
              {diagnosing ? 'Executando diagnóstico…' : 'Executar diagnóstico'}
            </button>
            <button
              type="button"
              className="secondary-button settings-cache-button"
              onClick={() => void clearTemporaryData()}
              disabled={clearingCache}
            >
              {clearingCache ? 'Limpando cache…' : 'Limpar dados temporários'}
            </button>
          </div>

          <p className="settings-diagnostic-time">
            Último diagnóstico: {lastDiagnostic || 'Executado automaticamente ao abrir a tela'}
          </p>

          {cacheMessage && (
            <p className="settings-cache-result" role="status">{cacheMessage}</p>
          )}
        </article>

        <article className="settings-panel settings-panel--wide">
          <div className="settings-panel__heading">
            <div>
              <span className="settings-kicker">Segurança</span>
              <h2>Configuração protegida</h2>
            </div>
            <span className="status-chip">Protegido</span>
          </div>

          <div className="settings-details settings-details--columns">
            <div className="settings-detail-row">
              <span>Dados sensíveis</span>
              <strong>Ocultos da interface</strong>
            </div>
            <div className="settings-detail-row">
              <span>Configuração técnica</span>
              <strong>Gerenciada internamente</strong>
            </div>
            <div className="settings-detail-row">
              <span>Cache operacional</span>
              <strong>Separado das credenciais</strong>
            </div>
            <div className="settings-detail-row">
              <span>Alteração pelo operador</span>
              <strong>Bloqueada</strong>
            </div>
          </div>

          <div className="settings-security-note">
            <strong>Credenciais protegidas</strong>
            <p>
              Endereço do serviço, token e demais credenciais não podem ser visualizados ou alterados pelo operador.
            </p>
          </div>
        </article>
      </div>
    </section>
  )
}
