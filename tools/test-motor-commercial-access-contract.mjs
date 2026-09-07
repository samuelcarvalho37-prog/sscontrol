import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

function assert(condition, message) {
  if (!condition) {
    console.error(`FALHA: ${message}`)
    process.exit(1)
  }
}

const motor = read('backend/apps-script/30_Motor_Acesso_Comercial.js')
const internalAccess = read('backend/apps-script/31_Motor_Acesso_Interno.js')
const catalogEngine = read('backend/apps-script/32_Motor_Catalogo_Comercial.js')
const auth = read('backend/apps-script/03_Http_Auth.js')
const authCache = read('backend/apps-script/09_Warmup_AuthFast.js')
const appConfig = read('backend/apps-script/00_Config.js')
const configuration = read('backend/apps-script/26_Motor_Configuracao.js')
const adminApi = read('frontend-gestor/src/services/api/admin.ts')
const workspace = read('frontend-gestor/src/components/AdminWorkspace.tsx')
const app = read('frontend-gestor/src/app/App.tsx')
const maintenancePage = read('frontend-gestor/src/pages/MaintenanceAccessPage.tsx')
const platformWorkspace = read('frontend-gestor/src/components/PlatformMotorWorkspace.tsx')
const authApi = read('frontend-gestor/src/services/api/auth.ts')

for (const plan of ['INICIAL', 'BASICO', 'COMPLETO']) {
  assert(motor.includes(`${plan}: {`), `plano comercial ausente: ${plan}`)
}

for (const feature of [
  'CADASTROS',
  'ORDENS_SERVICO',
  'CHECKLISTS',
  'GESTAO_TECNICA',
  'INDICADORES',
  'DOCUMENTOS',
  'IMPORTACOES',
  'AUDITORIA',
  'CONTINUIDADE',
  'MOTOR_LIMITADO',
]) {
  assert(motor.includes(`${feature}: "${feature}"`), `recurso comercial ausente: ${feature}`)
}

assert(motor.includes('computeHmacSha256Signature'), 'assinatura HMAC da política comercial ausente')
assert(motor.includes('authSecureEquals_'), 'comparação segura da assinatura comercial ausente')
assert(motor.includes('PADRAO_SEGURO_DE_MIGRACAO'), 'migração compatível do canário atual ausente')
assert(motor.includes('motorBlockedSubscription_'), 'falha fechada da assinatura ausente')
assert(motor.includes('SUBSCRIPTION_FEATURE_REQUIRED'), 'bloqueio por recurso não contratado ausente')
assert(motor.includes('MOTOR_MAINTENANCE_REQUIRED'), 'bloqueio do motor integral ausente')
assert(motor.includes('upper_(auth && auth.perfil) === ROLE.SISTEMA'), 'motor integral não exige identidade interna')
const expectedInternalRoutes = [
  'platform.motor.catalogo',
  'platform.motor.catalogo.rascunho.salvar',
  'platform.motor.catalogo.validar',
  'platform.motor.catalogo.publicar',
  'platform.motor.catalogo.versoes',
  'platform.motor.catalogo.rollback',
]
assert(
  auth.match(/case "platform\.motor\.[^"]+"/g)?.length === expectedInternalRoutes.length,
  'quantidade de rotas internas do catálogo divergente',
)
for (const action of expectedInternalRoutes) {
  assert(auth.includes(`case "${action}"`), `rota interna ausente: ${action}`)
  assert(appConfig.includes(`"${action}"`), `permissão interna ausente: ${action}`)
}
assert(motor.includes('tenantId !== configuredTenantId'), 'assinatura não está vinculada ao cliente configurado')
assert(motor.includes('SUBSCRIPTION_ACTION_UNCLASSIFIED'), 'novas ações não falham de forma fechada')

const authorizationCalls = auth.match(/motorAuthorizeAction_\(action,/g) || []
assert(authorizationCalls.length === 3, 'autorização comercial deve validar sessões em cache, persistida e interna')
assert(configuration.includes('acesso_comercial:typeof motorCommercialAccessContext_'), 'estado do motor não informa o escopo comercial seguro')
assert(auth.includes('case "admin.acesso.estado"'), 'endpoint seguro de consulta do plano ausente')
assert(adminApi.includes("'admin.acesso.estado'"), 'frontend não consulta o plano no servidor')
assert(workspace.includes('commercialAccess.status') && workspace.includes('grantedFeatures.has'), 'workspace não limita módulos pelos recursos contratados')

assert(
  internalAccess.includes('FAB_CONTROL_PLATFORM_IDENTITY_V1') &&
    internalAccess.includes('FAB_CONTROL_PLATFORM_IDENTITY_SIGNING_SECRET'),
  'identidade interna assinada não foi implementada',
)
assert(
  internalAccess.includes('FAB_CONTROL_MOTOR_MAINTENANCE_REDEEMED_V1') &&
    internalAccess.includes('MOTOR_INTERNAL_MAX_ATTEMPTS = 5'),
  'janela interna não protege uso único e tentativas',
)
assert(
  internalAccess.includes('PLATFORM_MAINTENANCE') &&
    internalAccess.includes('Math.min(') &&
    internalAccess.includes('MOTOR_INTERNAL_SESSION_MINUTES = 30'),
  'sessão interna não está limitada à janela e ao máximo de 30 minutos',
)
assert(
  auth.includes('motorInternalAuthorizeSession_(sess)') &&
    auth.includes('upper_(sess.escopo) !== "PLATFORM_MAINTENANCE"'),
  'sessão interna não é revalidada em cada requisição',
)
assert(
  authCache.includes('upper_(auth.perfil) === ROLE.SISTEMA') &&
    authCache.includes('upper_(hit.perfil) === ROLE.SISTEMA'),
  'sessão interna não foi excluída do cache operacional',
)
assert(auth.includes('case "auth.maintenance.exchange"'), 'troca da autorização temporária não possui rota')
assert(authApi.includes("'auth.maintenance.exchange'"), 'frontend não troca o código temporário no servidor')
assert(
  app.includes("get('maintenance') === '1'") &&
    app.includes('<MaintenanceAccessPage') &&
    app.includes('<PlatformMotorWorkspace'),
  'entrada interna não está isolada do login operacional',
)
assert(
  maintenancePage.includes('exchangeMaintenanceAccess') &&
    platformWorkspace.includes('getAdminCommercialAccess') &&
    platformWorkspace.includes('result.manutencao.aberta'),
  'workspace interno não valida a janela ativa no servidor',
)
assert(
  motor.includes('function motorPlatformCatalogState_') &&
    motor.includes('padrao:"NEGAR_ACAO_NAO_CLASSIFICADA"') &&
    platformWorkspace.includes('getPlatformMotorCatalog') &&
    platformWorkspace.includes('Recursos por assinatura'),
  'catálogo comercial interno está incompleto',
)
assert(
  catalogEngine.includes('MOTOR_CATALOG_MAX_PROPERTY_BYTES = 8500') &&
    catalogEngine.includes('MOTOR_CATALOG_MAX_HISTORY = 20') &&
    catalogEngine.includes('motorCatalogValidateSnapshot_') &&
    catalogEngine.includes('motorCatalogPublishUnderLock_') &&
    catalogEngine.includes('MOTOR_CATALOG_BASE_VERSION_CHANGED') &&
    catalogEngine.includes('motorCommercialCatalogRollback_'),
  'editor versionado do catálogo comercial está incompleto',
)
assert(
  catalogEngine.includes('motorCatalogRestoreProperty_') &&
    catalogEngine.includes('MOTOR_CATALOG_PUBLICATION_AUTHORIZED') &&
    catalogEngine.includes('MOTOR_COMPLETE_FEATURE_REQUIRED'),
  'publicação comercial não possui restauração, auditoria e invariantes',
)
assert(
  platformWorkspace.includes('savePlatformMotorCatalogDraft') &&
    platformWorkspace.includes('validatePlatformMotorCatalog') &&
    platformWorkspace.includes('publishPlatformMotorCatalog') &&
    platformWorkspace.includes('rollbackPlatformMotorCatalog') &&
    platformWorkspace.includes('Confirmar publicação') &&
    platformWorkspace.includes('Motivo da restauração'),
  'workspace interno não implementa o ciclo versionado do catálogo comercial',
)
assert(
  platformWorkspace.includes('REQUIRED_FEATURES') &&
    platformWorkspace.includes("planCode === 'COMPLETO'") &&
    platformWorkspace.includes('type="checkbox"'),
  'editor comercial não protege a base obrigatória e a hierarquia de planos',
)

const publicActions = new Set([
  'sistema.health',
  'sistema.bootstrap',
  'auth.login',
  'auth.first_access.complete',
  'auth.recovery.request',
  'auth.maintenance.exchange',
  'auth.logout',
])
const routeActions = [...auth.matchAll(/case "([^"]+)"/g)].map((match) => match[1])
const internalActions = new Set(routeActions.filter((action) => action.startsWith('platform.motor.')))
const featurePrefixes = [...motor.matchAll(/\{prefixo:"([^"]+)", recurso:/g)].map((match) => match[1])
const coreStart = motor.indexOf('const MOTOR_CORE_ACTIONS = [')
const coreEnd = motor.indexOf('];', coreStart)
const coreActions = new Set([...motor.slice(coreStart, coreEnd).matchAll(/"([^"]+)"/g)].map((match) => match[1]))
for (const action of routeActions) {
  if (publicActions.has(action)) continue
  if (internalActions.has(action)) continue
  const classified = coreActions.has(action) || featurePrefixes.some((prefix) => action.startsWith(prefix))
  assert(classified, `ação autenticada sem classificação comercial: ${action}`)
}

const bootstrapStart = auth.indexOf('function sistemaBootstrap_')
const bootstrapEnd = auth.indexOf('function ensureAuthSchema_', bootstrapStart)
assert(bootstrapStart >= 0 && bootstrapEnd > bootstrapStart, 'bloco de bootstrap não localizado')
assert(
  !auth.slice(bootstrapStart, bootstrapEnd).includes('"auth.maintenance.exchange"'),
  'bootstrap público não deve anunciar a entrada interna',
)
assert(
  !auth.slice(bootstrapStart, bootstrapEnd).includes('"platform.motor.catalogo"'),
  'bootstrap público não deve anunciar o catálogo interno',
)
for (const action of expectedInternalRoutes) {
  assert(
    !auth.slice(bootstrapStart, bootstrapEnd).includes(`"${action}"`),
    `bootstrap público anunciou a operação interna: ${action}`,
  )
}

console.log('CONTRATO DO ACESSO COMERCIAL AO MOTOR APROVADO')
console.log(`${routeActions.length - publicActions.size} ações autenticadas, planos, assinatura e manutenção conferidos`)
