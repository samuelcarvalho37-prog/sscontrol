import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/^\uFEFF/, '')
const assert = (condition, message) => {
  if (!condition) throw new Error(`Contrato do motor inválido: ${message}`)
}

const config = read('backend/apps-script/00_Config.js')
const router = read('backend/apps-script/03_Http_Auth.js')
const engine = read('backend/apps-script/26_Motor_Configuracao.js')
const stops = read('backend/apps-script/20_Paradas_Equipamento.js')
const maintenance = read('backend/apps-script/21_Paradas_Manutencao.js')
const evidence = read('backend/apps-script/22_Horimetro_Evidencias.js')
const workflow = read('backend/apps-script/25_Workflow_Tecnico_KPI.js')
const adminApi = read('frontend-gestor/src/services/api/admin.ts')
const panel = read('frontend-gestor/src/components/ConfigurationEnginePanel.tsx')
const adminPage = read('frontend-gestor/src/pages/AdminPage.tsx')
const app = read('frontend-gestor/src/app/App.tsx')
const adminWorkspace = read('frontend-gestor/src/components/AdminWorkspace.tsx')

for (const sheet of ['configuracao_versoes', 'configuracao_rascunhos']) {
  assert(config.includes(`${sheet}: [`), `schema ausente: ${sheet}`)
}

const actions = [
  'cmms.configuracao_schema_upgrade',
  'admin.configuracao.estado',
  'admin.configuracao.rascunho.salvar',
  'admin.configuracao.validar',
  'admin.configuracao.publicar',
  'admin.configuracao.versoes',
  'admin.configuracao.rollback',
]

for (const action of actions) {
  assert(router.includes(`case "${action}"`), `rota ausente: ${action}`)
  assert(config.includes(`"${action}"`), `permissão ADMIN ausente: ${action}`)
}

for (const key of [
  'release.version',
  'auth.schema.version',
  'permissions.matrix.capabilities.v1',
  'configuration.runtime.snapshot.v1',
]) {
  assert(engine.includes(`"${key}"`), `chave estrutural sem proteção: ${key}`)
}

assert(engine.includes('LockService.getScriptLock()'), 'publicação sem lock de script')
assert(engine.includes('CONFIG_BASE_VERSION_CHANGED'), 'controle otimista de versão-base ausente')
assert(engine.includes('CONFIG_VERSION_INTEGRITY_FAILED'), 'rollback sem verificação de integridade')
assert(engine.includes('CONFIG_KEY_NOT_ALLOWED'), 'lista branca não rejeita chaves desconhecidas')
assert(engine.indexOf('append_("configuracao_versoes"') < engine.indexOf('chave:CONFIG_ENGINE_RUNTIME_KEY'), 'ponteiro ativo é gravado antes da versão imutável')
assert(stops.includes('configurationRuntimeValue_("parada.tolerancia_retorno_min"'), 'parada não consome snapshot')
assert(maintenance.includes('configurationRuntimeValue_("manutencao.modo_parada_padrao"'), 'modo de parada não consome snapshot')
assert(evidence.includes('configurationRuntimeValue_("evidencia.foto.max_bytes"'), 'evidência não consome snapshot')
assert(workflow.includes('configurationRuntimeValue_("workflow.tecnico.exige_segregacao_padrao"'), 'workflow não consome snapshot')
assert(workflow.includes('configurationRuntimeValue_("kpi.janela_padrao_dias"'), 'KPIs não consomem snapshot')

for (const action of actions.filter((action) => action.startsWith('admin.'))) {
  assert(adminApi.includes(`'${action}'`), `cliente administrativo não usa ${action}`)
}

assert(panel.includes('Núcleo protegido'), 'interface não comunica a proteção estrutural')
assert(panel.includes('Histórico imutável'), 'interface não expõe histórico versionado')
assert(panel.includes('Rollback gera uma nova versão'), 'interface não explica rollback imutável')
assert(adminPage.includes('Command Workspace'), 'workspace administrativo ausente')
assert(app.includes("if (isAdmin) {"), 'perfil ADMIN não possui desvio estrutural próprio')
assert(app.includes('<AdminWorkspace'), 'shell administrativo dedicado não é renderizado')
assert(app.indexOf('if (isAdmin) {') < app.indexOf('<div className="app-shell">'), 'shell do gestor é montado antes da separação do ADMIN')
assert(adminWorkspace.includes('admin-desktop-rail'), 'rail administrativo persistente ausente')
assert(adminWorkspace.includes('admin-app-window'), 'módulos administrativos não são abertos em janelas')
assert(adminWorkspace.includes('AdminPage') && adminWorkspace.includes('embedded'), 'módulos administrativos não estão embutidos no workspace')
assert(!adminWorkspace.includes('AppNavigation'), 'workspace administrativo reutiliza navegação móvel do gestor')
assert(!adminWorkspace.includes('Visão do gestor'), 'workspace administrativo mantém identidade visual do gestor')

console.log('CONTRATO DO MOTOR DE CONFIGURAÇÃO APROVADO')
console.log(`${actions.length} rotas administrativas e 2 tabelas versionadas conferidas`)
console.log('Lista branca, lock, versão-base, integridade, publicação e rollback conferidos')
