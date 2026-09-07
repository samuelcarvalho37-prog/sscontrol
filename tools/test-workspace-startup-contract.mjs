import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function assert(condition, message) {
  if (!condition) {
    console.error(`FALHA: ${message}`)
    process.exit(1)
  }
}

const login = read('frontend-gestor/src/pages/LoginPage.tsx')
const app = read('frontend-gestor/src/app/App.tsx')
const gate = read('frontend-gestor/src/components/WorkspaceStartupGate.tsx')
const startup = read('frontend-gestor/src/services/startup/workspace.ts')
const session = read('frontend-gestor/src/services/auth/session.ts')
const warmup = read('backend/apps-script/09_Warmup_AuthFast.js')
const styles = read('frontend-gestor/src/styles/global.css')

assert(login.includes("type LoginView = 'startup'"), 'entrada do gestor não possui pré-carregamento visual')
assert(login.includes('getSystemHealth(controller.signal)'), 'entrada não verifica a API antes do login')
assert(login.includes('isCompatibleRelease(receivedVersion)'), 'entrada não bloqueia versões incompatíveis')
assert(login.includes('markLoginBootstrapCompleted()'), 'pré-carregamento de entrada não é persistido')
assert(login.includes('auth-startup__progress'), 'progresso visual de entrada ausente')

assert(app.includes('<WorkspaceStartupGate'), 'gate autenticado não foi integrado ao aplicativo')
assert(app.indexOf('if (!workspaceReady)') < app.indexOf('if (isAdmin)'), 'admin é liberado antes do gate')
assert(app.includes('setWorkspaceReady(false)'), 'nova autenticação não reinicia a preparação')
assert(gate.includes("await import('../services/startup/workspace')"), 'preparação pesada não usa carregamento sob demanda')
assert(gate.includes('onSessionExpired()'), 'gate não encerra sessão inválida')
assert(gate.includes('Tentar novamente'), 'gate não permite recuperar falha transitória')

for (const requiredCall of [
  'warmupGestor',
  'getAdminCommercialAccess',
  'getAdminCompanyProfile',
  'listAdminUsers',
  'getAdminPermissionMatrix',
  'listAllTechnicalAreas',
  'listAllTechnicalRoles',
  'listAdminChecklistModels',
  'listAdminInterventions',
  'getConfigurationEngineState',
  'getAdminImportCatalog',
  'getAdminTechnicalKpis',
  'getAdminMonitoring',
  'listAdminDocuments',
  'listAdminBackups',
  'getGestorTechnicalContext',
  'getGestorTechnicalDemands',
  'getGestorOverview',
  'getUnreadNotificationCount',
  'getGestorChecklistModels',
  'getGestorAssetCatalog',
]) {
  assert(startup.includes(requiredCall), `recurso essencial ausente do pré-carregamento: ${requiredCall}`)
}

assert(session.includes("const STARTUP_COMPLETED_VALUE = '2'"), 'versão do gate inicial não foi renovada')
assert(session.includes("const LOGIN_BOOTSTRAP_COMPLETED_VALUE = '2'"), 'versão da entrada visual não foi renovada')
assert(session.includes('LOGIN_BOOTSTRAP_COMPLETED_KEY'), 'estado visual de entrada não está isolado do warmup autenticado')
assert(warmup.includes('tables = Object.keys(SH).filter'), 'administrador não aquece o catálogo estrutural')
assert(warmup.includes('"demandas_tecnicas"'), 'gestor não aquece o fluxo técnico')
assert(warmup.includes('deferredAdminTables'), 'tabelas sensíveis não foram postergadas')
assert(styles.includes('.workspace-startup-card'), 'interface do gate autenticado ausente')
assert(styles.includes('@media (max-width: 620px)'), 'gate não possui adaptação móvel')

console.log('CONTRATO DO PRÉ-CARREGAMENTO GESTOR/ADMIN APROVADO')
console.log('Entrada, sessão, módulos essenciais, recuperação e responsividade conferidos')
