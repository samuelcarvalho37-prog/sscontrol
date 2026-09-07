import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/^\uFEFF/, '')
const assert = (condition, message) => {
  if (!condition) throw new Error(`Contrato de importação inválido: ${message}`)
}

const config = read('backend/apps-script/00_Config.js')
const router = read('backend/apps-script/03_Http_Auth.js')
const engine = read('backend/apps-script/27_Admin_Importacao.js')
const api = read('frontend-gestor/src/services/api/imports.ts')
const parser = read('frontend-gestor/src/services/spreadsheet/adminWorkbook.ts')
const panel = read('frontend-gestor/src/components/AdminImportCenter.tsx')
const workspace = read('frontend-gestor/src/components/AdminWorkspace.tsx')

for (const sheet of ['importacao_lotes', 'importacao_registros']) {
  assert(config.includes(`${sheet}: [`), `schema ausente: ${sheet}`)
}

const actions = [
  'cmms.importacao_admin_schema_upgrade',
  'admin.importacao.modelos',
  'admin.importacao.validar',
  'admin.importacao.confirmar',
  'admin.importacao.lotes',
  'admin.importacao.detalhe',
  'admin.importacao.rollback',
]

for (const action of actions) {
  assert(router.includes(`case "${action}"`), `rota ausente: ${action}`)
  assert(config.includes(`"${action}"`), `permissão ADMIN ausente: ${action}`)
}

for (const model of ['plantas', 'setores', 'linhas', 'ativos', 'componentes', 'materiais', 'planos', 'plano_itens']) {
  assert(engine.includes(`${model}: {`), `modelo ausente: ${model}`)
}

assert(engine.includes('IMPORT_FORMULA_BLOCKED'), 'fórmulas não são bloqueadas no backend')
assert(engine.includes('ADMIN_IMPORT_MAX_ROWS'), 'limite de lote ausente')
assert(engine.includes('LockService.getScriptLock()'), 'confirmação sem lock de escrita')
assert(engine.includes('IMPORT_VALIDATION_CHANGED'), 'confirmação não verifica hash da pré-análise')
assert(engine.includes('IMPORT_ROLLBACK_DIVERGED'), 'rollback não protege alterações posteriores')
assert(engine.includes('IMPORT_ROLLBACK_REFERENCED'), 'rollback não protege vínculos posteriores')
assert(engine.includes('row.status = ST.INATIVO'), 'plano importado pode ativar diretamente')
assert(engine.includes('row.workflow_status = ST.RASCUNHO'), 'plano importado pode pular o Gestor')
assert(engine.includes('ADMIN_IMPORT_ROW_APPLIED'), 'auditoria por linha ausente')

for (const action of actions.filter((action) => action.startsWith('admin.'))) {
  assert(api.includes(`'${action}'`), `cliente não usa ${action}`)
}

assert(parser.includes("ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv']"), 'formatos exigidos não são aceitos')
assert(parser.includes('assertNoFormulas'), 'parser não bloqueia fórmulas')
assert(parser.includes('writeFileXLSX'), 'download de modelo .xlsx ausente')
assert(panel.includes('Executar pré-análise'), 'pré-análise não está exposta')
assert(panel.includes('Confirmar importação'), 'confirmação explícita não está exposta')
assert(panel.includes('Rollback'), 'rollback não está exposto')
assert(workspace.includes("id: 'imports'"), 'Central de Importação ausente no workspace')

console.log('CONTRATO DA CENTRAL DE IMPORTAÇÃO APROVADO')
console.log(`${actions.length} rotas, 8 modelos e 2 tabelas de rastreabilidade conferidos`)
console.log('Pré-análise, confirmação, bloqueio de fórmulas e rollback protegido conferidos')
