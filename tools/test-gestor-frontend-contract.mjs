import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const frontendApi = read('frontend-gestor/src/services/api/gestor.ts')
const nodeTransport = read('frontend-gestor/src/services/api/client.ts')
const backendRoutes = read('backend/apps-script/03_Http_Auth.js')
const backendPermissions = read('backend/apps-script/00_Config.js')
const gestorRelease = read('frontend-gestor/src/release.ts')
const packageJson = JSON.parse(read('frontend-gestor/package.json'))

const requiredActions = [
  'admin.listar',
  'cmms.kpis_base',
  'gestor.auditoria_execucao_checklist',
  'gestor.detalhe_acao',
  'gestor.detalhe_modelo_checklist',
  'gestor.listar_acoes',
  'gestor.listar_ocorrencias',
  'gestor.listar_paradas',
  'gestor.modelos_em_validacao',
  'gestor.validar_acao',
  'gestor.validar_modelo_checklist',
]

for (const action of requiredActions) {
  assert(frontendApi.includes(action), `Frontend não referencia ${action}.`)
  assert(
    nodeTransport.includes(`case "${action}"`) || nodeTransport.includes(`case '${action}'`),
    `Transporte Node não mapeia ${action}.`,
  )
  assert(backendRoutes.includes(`case "${action}"`), `Backend não roteia ${action}.`)
  assert(backendPermissions.includes(`"${action}"`), `Matriz de permissão não contém ${action}.`)
}

assert(packageJson.name === 'fab-control-gestor-web', 'Pacote do gestor com nome inesperado.')
assert(packageJson.version === '1.4.0', 'Versão do pacote do gestor deve ser 1.4.0.')
assert(
  gestorRelease.includes("API_COMPATIBLE_RELEASE = '1.4.0'"),
  'Contrato compatível da API deve permanecer explícito em 1.4.0.',
)

assert(
  frontendApi.includes('MOTOR_MAINTENANCE_REQUIRED') &&
    frontendApi.includes('TOKEN_SCOPE_INVALID'),
  'Frontend deve encerrar a sessao quando a janela interna for revogada.',
)

console.log('TESTE DO CONTRATO FRONTEND GESTOR APROVADO')
console.log(
  `${requiredActions.length} ações conferidas no frontend, transporte Node, fallback Apps Script e matriz de permissões`,
)
