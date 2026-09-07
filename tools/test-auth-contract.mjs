import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n')
}

function assert(condition, message) {
  if (!condition) {
    console.error('ERRO: ' + message)
    process.exit(1)
  }
}

const config = read('backend/apps-script/00_Config.js')
const utils = read('backend/apps-script/01_Utils.js')
const db = read('backend/apps-script/02_Db.js')
const http = read('backend/apps-script/03_Http_Auth.js')
const login = read('frontend/src/pages/LoginPage.tsx')
const app = read('frontend/src/app/App.tsx')
const session = read('frontend/src/services/auth/session.ts')
const authApi = read('frontend/src/services/api/auth.ts')
const apiConfig = read('frontend/src/services/api/config.ts')
const settings = read('frontend/src/pages/SettingsPage.tsx')

for (const field of ["matricula","senha_hash","primeiro_acesso","tentativas_login","bloqueado_ate","ultimo_login_em","senha_atualizada_em","recuperacao_referencia","recuperacao_solicitada_em"]) {
  assert(config.includes('"' + field + '"'), 'campo de usuário ausente: ' + field)
}
for (const field of ["escopo","expira_ms","revogado_em","motivo_revogacao"]) {
  assert(config.includes('"' + field + '"'), 'campo de sessão ausente: ' + field)
}

const bootstrapStart = http.indexOf('function sistemaBootstrap_()')
const bootstrapEnd = http.indexOf('function ensureAuthSchema_', bootstrapStart)
assert(bootstrapStart >= 0 && bootstrapEnd > bootstrapStart, 'função sistema.bootstrap não localizada')
const bootstrapSource = http.slice(bootstrapStart, bootstrapEnd)

for (const action of [
  'auth.login',
  'auth.first_access.complete',
  'auth.recovery.request',
  'auth.logout',
]) {
  assert(config.includes('"' + action + '"'), 'ação pública ausente: ' + action)
  assert(http.includes('case "' + action + '"'), 'rota ausente: ' + action)
  assert(bootstrapSource.includes('"' + action + '"'), 'endpoint ausente no bootstrap: ' + action)
}

assert(utils.includes('authCreatePasswordHash_'), 'hash forte não implementado')
assert(utils.includes('authPasswordPepper_'), 'pepper não implementado')
assert(utils.includes('AUTH_PASSWORD_ITERATIONS'), 'iterações não centralizadas')
assert(db.includes('primeiro_acesso:"SIM"'), 'seed não exige primeiro acesso')
assert(http.includes('ACCOUNT_LOCKED'), 'bloqueio temporário ausente')
assert(config.includes('AUTH_RECOVERY_COOLDOWN_MINUTES: 10'), 'cooldown de recuperação ausente')
assert(http.includes('"auth.schema.version"'), 'marcador idempotente do schema auth ausente')
assert(http.includes('lastRequestMs'), 'controle de repetição da recuperação ausente')
assert(http.includes('authRecoveryReference_'), 'referência não enumerável de recuperação ausente')
assert(http.includes('"FAB-RECOVERY-V1:"'), 'domínio criptográfico da recuperação ausente')
assert(http.includes('remainingDelay = 200'), 'tempo mínimo da recuperação ausente')
assert(!http.includes('request_id:clean_(user.recuperacao_referencia)'), 'resposta de recuperação ainda varia pela existência da conta')
assert(http.includes('"FIRST_ACCESS"'), 'escopo de primeiro acesso ausente')
assert(http.includes('TOKEN_SCOPE_INVALID'), 'sessão de primeiro acesso não está isolada')

assert(authApi.includes("'auth.login'"), 'frontend não chama auth.login')
assert(authApi.includes("'auth.first_access.complete'"), 'frontend não conclui primeiro acesso')
assert(authApi.includes("'auth.recovery.request'"), 'frontend não registra recuperação')
assert(authApi.includes("'auth.logout'"), 'frontend não revoga sessão')

assert(!login.includes('scenario.includes'), 'simulação de login ainda ativa')
assert(login.includes('connectionErrorMessage'), 'mensagem de incompatibilidade não está preservada')
assert(login.includes("setStartupLabel('Atualização necessária')"), 'startup não identifica incompatibilidade')
assert(login.includes("await wait(520)\n          if (active) setView('connection-error')\n          return"), 'gate de incompatibilidade não bloqueia o login')
const versionMismatchStart = login.indexOf("setStartupLabel('Atualização necessária')")
const versionMismatchEnd = login.indexOf("        if (!active) return", versionMismatchStart)
assert(versionMismatchStart >= 0 && versionMismatchEnd > versionMismatchStart, 'bloco de incompatibilidade não localizado')
assert(!login.slice(versionMismatchStart, versionMismatchEnd).includes('markStartupCompleted'), 'incompatibilidade pode ser ignorada após recarregar')
assert(login.includes("setView('connection-error')"), 'gate de versão não bloqueia a tela de login')
assert(login.split('showConnectionError(cause)').length - 1 === 3, 'falhas de conexão não foram mapeadas nos três fluxos auth')
assert(!login.includes('onPreviewAuthenticated'), 'prop de preview ainda ativa')
assert(!app.includes('authPreview'), 'estado de preview ainda ativo no App')
assert(app.includes("void refresh({ forceHealth: true })\n  }, [refresh, configurationRevision, operatorSession?.token])"), 'refresh não depende da sessão autenticada')
assert(app.includes("useEffect(() => {\n  if (!operatorSession) return\n\n  const stored ="), 'restauração operacional ocorre sem autenticação')
assert(app.includes("}, [configurationRevision, loadActionDetail, operatorSession?.token])"), 'restauração não reage à sessão autenticada')
assert(app.includes("setConnectionState('checking')"), 'estado de conexão não reinicia após login')
assert(!session.includes('savePreviewSession'), 'sessão preview ainda ativa')
assert(session.includes('window.sessionStorage'), 'sessão não usa sessionStorage')
assert(apiConfig.includes("let inMemoryOperatorToken = ''"), 'fallback de token em memória ausente')
assert(apiConfig.includes('inMemoryOperatorToken ||'), 'leitura não usa o fallback de token em memória')
assert(!session.includes('window.localStorage'), 'sessão auth não pode usar localStorage')
assert(!settings.includes("'8.5.0'"), 'versão hardcoded ainda ativa')
assert(settings.includes('APP_RELEASE_VERSION'), 'Settings não usa a release única')

console.log('TESTE ESTÁTICO DO CONTRATO AUTH APROVADO')
console.log('Login real, primeiro acesso, recuperação, bloqueio e logout detectados')
console.log('Sessão restrita ao sessionStorage')
