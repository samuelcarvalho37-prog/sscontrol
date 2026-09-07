import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { execFileSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/^\uFEFF/, '')
}

function assert(condition, message) {
  if (!condition) throw new Error(`Contrato administrativo inválido: ${message}`)
}

const router = read('backend/apps-script/03_Http_Auth.js')
const config = read('backend/apps-script/00_Config.js')
const admin = read('backend/apps-script/04_Admin.js')
const permissions = read('backend/apps-script/09_Warmup_AuthFast.js')
const login = read('frontend-gestor/src/pages/LoginPage.tsx')
const app = read('frontend-gestor/src/app/App.tsx')
const adminPage = read('frontend-gestor/src/pages/AdminPage.tsx')
const adminApi = read('frontend-gestor/src/services/api/admin.ts')

const requiredActions = [
  'admin.usuarios.listar',
  'admin.usuarios.salvar',
  'admin.usuarios.desbloquear',
  'admin.usuarios.redefinir_senha',
  'admin.usuarios.revogar_sessoes',
  'admin.permissoes.obter',
  'admin.permissoes.salvar',
]

const adminPermissions = config.slice(
  config.indexOf('  ADMIN: ['),
  config.indexOf('  GESTOR: ['),
)
const gestorPermissions = config.slice(
  config.indexOf('  GESTOR: ['),
  config.indexOf('  OPERADOR: ['),
)
const operatorPermissions = config.slice(config.indexOf('  OPERADOR: ['))

for (const action of requiredActions) {
  assert(router.includes(`case "${action}"`), `rota ausente: ${action}`)
  assert(router.includes(`"${action}"`), `inventário bootstrap ausente: ${action}`)
  assert(adminPermissions.includes(`"${action}"`), `permissão ADMIN ausente: ${action}`)
  assert(!gestorPermissions.includes(`"${action}"`), `GESTOR recebeu ação administrativa: ${action}`)
  assert(!operatorPermissions.includes(`"${action}"`), `OPERADOR recebeu ação administrativa: ${action}`)
  assert(adminApi.includes(`'${action}'`), `cliente frontend não chama ${action}`)
}

assert(admin.includes('delete safe.pin_hash'), 'sanitização de PIN ausente')
assert(admin.includes('delete safe.senha_hash'), 'sanitização de senha ausente')
assert(admin.includes('authCreatePasswordHash_(temporaryPassword)'), 'cadastro não usa hash moderno')
assert(admin.includes('primeiro_acesso:"SIM"'), 'primeiro acesso obrigatório ausente')
assert(admin.includes('LAST_ADMIN_REQUIRED'), 'proteção do último administrador ausente')
assert(admin.includes('SELF_PROFILE_CHANGE_BLOCKED'), 'proteção contra autoalteração de perfil ausente')
assert(admin.includes('adminRevokeUserSessions_'), 'revogação administrativa de sessões ausente')
assert(admin.includes('ADMIN_PERMISSIONS_UPDATED'), 'auditoria da matriz ausente')
assert(permissions.includes('adminPermissionDecision_'), 'matriz configurável não participa da autorização')
assert(!admin.includes('PIN_REQUIRED'), 'fluxo legado de criação por PIN continua ativo')

assert(login.includes('requestPasswordRecovery'), 'tela de recuperação de senha ausente')
assert(login.includes("view === 'recovery'"), 'estado visual de recuperação ausente')
assert(app.includes('if (isAdmin) {') && app.includes('<AdminWorkspace'), 'shell exclusivo por perfil ADMIN ausente')
assert(adminPage.includes('currentUserId={session.user.id}'), 'proteção visual da própria conta ausente')
assert(adminPage.includes('saveAdminPermissionProfile'), 'matriz não pode ser salva pela interface')

const context = vm.createContext({ console })
vm.runInContext(
  [
    config,
    read('backend/apps-script/01_Utils.js'),
    admin,
    'var TEST_CONFIG_ROW = null;',
    'function find_(name, key, value){ return name === "config" && value === ADMIN_PERMISSION_CONFIG_KEY ? TEST_CONFIG_ROW : null; }',
  ].join('\n'),
  context,
)

const sanitized = JSON.parse(vm.runInContext(
  'JSON.stringify(adminSanitizeEntityRow_("usuarios", {id:"USR-1",pin_hash:"pin",senha_hash:"senha",nome:"Teste",__rowIndex:2}))',
  context,
))
assert(!('pin_hash' in sanitized), 'PIN vazou na serialização')
assert(!('senha_hash' in sanitized), 'hash de senha vazou na serialização')
assert(!('__rowIndex' in sanitized), 'índice interno vazou na serialização')

assert(
  vm.runInContext('adminPermissionDecision_("GESTOR", "gestor.validar_acao")', context) === true,
  'permissão padrão do gestor foi removida',
)
vm.runInContext(
  'TEST_CONFIG_ROW = {valor:JSON.stringify({GESTOR:{VALIDAR_EXECUCOES:false}})}',
  context,
)
assert(
  vm.runInContext('adminPermissionDecision_("GESTOR", "gestor.validar_acao")', context) === false,
  'revogação configurada não foi aplicada',
)
assert(
  vm.runInContext('adminPermissionDecision_("ADMIN", "admin.usuarios.salvar")', context) === null,
  'perfil ADMIN foi submetido a override configurável',
)

const backendDirectory = path.join(root, 'backend', 'apps-script')
for (const filename of fs.readdirSync(backendDirectory).filter((name) => name.endsWith('.js'))) {
  execFileSync(process.execPath, ['--check', path.join(backendDirectory, filename)], {
    stdio: 'pipe',
  })
}

console.log(`${requiredActions.length} ações administrativas conferidas no roteador, permissões, backend e frontend`)
console.log('Sanitização de credenciais e matriz configurável validadas em runtime isolado')
