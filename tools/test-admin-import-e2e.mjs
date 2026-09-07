import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/^\uFEFF/, '')
const assert = (condition, message) => {
  if (!condition) throw new Error(`Importação E2E inválida: ${message}`)
}

let uuidSequence = 0
const context = vm.createContext({
  console,
  Utilities: {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest(_algorithm, value) {
      return [...crypto.createHash('sha256').update(String(value), 'utf8').digest()]
    },
    formatDate(date) {
      return new Date(date).toISOString().slice(0, 19)
    },
    getUuid() {
      uuidSequence += 1
      return `${String(uuidSequence).padStart(8, '0')}-aaaa-bbbb-cccc-dddddddddddd`
    },
  },
  LockService: {
    getScriptLock() {
      return { tryLock() { return true }, releaseLock() {} }
    },
  },
})

vm.runInContext([
  read('backend/apps-script/00_Config.js'),
  read('backend/apps-script/01_Utils.js'),
  read('backend/apps-script/04_Admin.js'),
  read('backend/apps-script/27_Admin_Importacao.js'),
  `
    var TEST_DB = {
      plantas:[{id:'PLT-A',tag:'A',nome:'Planta A',status:'ATIVO',criado_em:'2026-01-01',atualizado_em:'2026-01-01',__rowIndex:2}],
      setores:[{id:'SET-A-MAN',planta_id:'PLT-A',tag:'MAN',nome:'Manutenção',status:'ATIVO',criado_em:'2026-01-01',atualizado_em:'2026-01-01',__rowIndex:2}],
      linhas:[{id:'LIN-A-MAN-L01',setor_id:'SET-A-MAN',tag:'L01',nome:'Linha 01',status:'ATIVO',criado_em:'2026-01-01',atualizado_em:'2026-01-01',__rowIndex:2}],
      ativos:[{id:'ATV-EQ-001',linha_id:'LIN-A-MAN-L01',tag:'EQ-001',qr_payload:'EQ-001',nome:'Equipamento antigo',tipo:'Prensa',criticidade:'ALTA',status:'OPERANDO',saude_pct:100,horimetro_atual:0,criado_em:'2026-01-01',atualizado_em:'2026-01-01',__rowIndex:2}],
      componentes:[], materiais:[], planos_manutencao:[], plano_itens:[], ordens_servico:[], os_acoes:[], checklist_execucao:[], materiais_uso:[],
      importacao_lotes:[], importacao_registros:[], audit_log:[]
    };
    function getSpreadsheet_(){ return {}; }
    function ensureSheet_(){}
    function rows_(name){ return TEST_DB[name] || []; }
    function find_(name, key, value){ return rows_(name).find(function(row){ return String(row[key]) === String(value); }) || null; }
    function fit_(name, data){ var out = {}; SH[name].forEach(function(key){ out[key] = data[key] === undefined ? '' : data[key]; }); return out; }
    function append_(name, data){ if(!TEST_DB[name]) TEST_DB[name] = []; data.__rowIndex = TEST_DB[name].length + 2; TEST_DB[name].push(data); return data; }
    function update_(name, rowIndex, patch){ var row = rows_(name).find(function(item){ return item.__rowIndex === rowIndex; }); if(!row) throw new Error('Linha ausente: '+name+'#'+rowIndex); Object.assign(row, patch); }
    function deleteRow_(name, rowIndex){ TEST_DB[name] = rows_(name).filter(function(item){ return item.__rowIndex !== rowIndex; }); TEST_DB[name].forEach(function(item,index){ item.__rowIndex = index + 2; }); }
    function audit_(auth, action, entity, entityId, before, after){ append_('audit_log', {id:'AUD-'+(rows_('audit_log').length+1),usuario_id:auth.usuario_id,perfil:auth.perfil,acao:action,entidade:entity,entidade_id:entityId,antes_json:JSON.stringify(before||{}),depois_json:JSON.stringify(after||{}),criado_em:now_()}); }
    function authSecureEquals_(left,right){ return String(left) === String(right); }
    function normalizaTipoChecklist_(value){ return upper_(value); }
    function normalizaOpcoesJson_(value){ return clean_(value); }
  `,
].join('\n'), context)

const admin = `{usuario_id:'USR-ADMIN',perfil:'ADMIN'}`
const evaluate = (source) => JSON.parse(vm.runInContext(`JSON.stringify(${source})`, context))

const catalog = evaluate(`adminImportacaoModelos_({}, ${admin})`)
assert(catalog.modelos.length === 8, 'catálogo não expôs os 8 modelos')

context.invalidReferencePayload = {
  tipo: 'componentes',
  arquivo_nome: 'componentes.xlsx',
  aba_nome: 'Componentes',
  cabecalhos: ['ativo_id', 'tag', 'nome'],
  linhas: [{ __linha: 2, ativo_id: 'ATV-INEXISTENTE', tag: 'CMP-01', nome: 'Motor' }],
}
const invalidReference = evaluate(`adminImportacaoValidar_(invalidReferencePayload, ${admin})`)
assert(invalidReference.status === 'COM_ERROS', 'referência inexistente não bloqueou o lote')
assert(invalidReference.registros[0].erros[0].codigo === 'IMPORT_REFERENCE_INVALID', 'erro de referência não foi identificado')

context.formulaPayload = {
  tipo: 'materiais',
  arquivo_nome: 'materiais.xlsx',
  aba_nome: 'Materiais',
  cabecalhos: ['sku', 'nome'],
  linhas: [{ __linha: 2, sku: 'MAT-01', nome: '=IMPORTXML("https://invalid")' }],
}
const formula = evaluate(`adminImportacaoValidar_(formulaPayload, ${admin})`)
assert(formula.status === 'COM_ERROS', 'fórmula não bloqueou o lote')
assert(formula.registros[0].erros[0].codigo === 'IMPORT_FORMULA_BLOCKED', 'fórmula não gerou erro específico')

context.planPayload = {
  tipo: 'planos',
  arquivo_nome: 'planos.xlsx',
  aba_nome: 'Planos',
  cabecalhos: ['ativo_id', 'nome', 'gatilho_tipo', 'gatilho_valor', 'status'],
  linhas: [{ __linha: 2, ativo_id: 'EQ-001', nome: 'Inspeção mensal', gatilho_tipo: 'DIAS', gatilho_valor: 30, status: 'ATIVO' }],
}
const planDraft = evaluate(`adminImportacaoValidar_(planPayload, ${admin})`)
assert(planDraft.status === 'VALIDADO', 'plano válido não passou na pré-análise')
assert(planDraft.registros[0].normalizado.status === 'INATIVO', 'plano importado permaneceu ativo')
assert(planDraft.registros[0].normalizado.workflow_status === 'RASCUNHO', 'plano importado pulou o workflow')
context.planBatchId = planDraft.id
context.planHash = planDraft.validacao_hash
const confirmedPlan = evaluate(`adminImportacaoConfirmar_({lote_id:planBatchId,validacao_hash:planHash}, ${admin})`)
assert(confirmedPlan.status === 'CONCLUIDO', 'plano não foi confirmado')
const storedPlan = evaluate(`rows_('planos_manutencao')[0]`)
assert(storedPlan.status === 'INATIVO' && storedPlan.workflow_status === 'RASCUNHO', 'confirmação violou a validação do Gestor')

context.assetPayload = {
  tipo: 'ativos',
  arquivo_nome: 'ativos.xlsx',
  aba_nome: 'Ativos',
  cabecalhos: ['linha_id', 'tag', 'nome', 'criticidade'],
  linhas: [{ __linha: 2, linha_id: 'L01', tag: 'EQ-001', nome: 'Equipamento atualizado', criticidade: 'CRITICA' }],
}
const assetDraft = evaluate(`adminImportacaoValidar_(assetPayload, ${admin})`)
context.assetBatchId = assetDraft.id
context.assetHash = assetDraft.validacao_hash
const confirmedAsset = evaluate(`adminImportacaoConfirmar_({lote_id:assetBatchId,validacao_hash:assetHash}, ${admin})`)
assert(confirmedAsset.resultado.atualizados === 1, 'atualização não foi classificada')
assert(evaluate(`find_('ativos','id','ATV-EQ-001').nome`) === 'Equipamento atualizado', 'ativo não foi atualizado')
const rolledBack = evaluate(`adminImportacaoRollback_({lote_id:assetBatchId,motivo:'Correção de teste E2E'}, ${admin})`)
assert(rolledBack.status === 'REVERTIDO', 'rollback não concluiu')
assert(evaluate(`find_('ativos','id','ATV-EQ-001').nome`) === 'Equipamento antigo', 'rollback não restaurou o valor anterior')

context.newMaterialPayload = {
  tipo: 'materiais',
  arquivo_nome: 'materiais.xlsx',
  aba_nome: 'Materiais',
  cabecalhos: ['sku', 'nome'],
  linhas: [{ __linha: 2, sku: 'ROL-6205', nome: 'Rolamento 6205' }],
}
const materialDraft = evaluate(`adminImportacaoValidar_(newMaterialPayload, ${admin})`)
context.materialBatchId = materialDraft.id
context.materialHash = materialDraft.validacao_hash
evaluate(`adminImportacaoConfirmar_({lote_id:materialBatchId,validacao_hash:materialHash}, ${admin})`)
vm.runInContext(`find_('materiais','id','MAT-ROL-6205').nome = 'Alterado depois da importação'`, context)
const divergenceBlocked = vm.runInContext(`try { adminImportacaoRollback_({lote_id:materialBatchId,motivo:'Teste de divergência'}, ${admin}); false } catch(error) { error.code === 'IMPORT_ROLLBACK_DIVERGED' }`, context)
assert(divergenceBlocked, 'rollback sobrescreveu alteração posterior')

assert(evaluate(`rows_('audit_log').length`) >= 7, 'auditoria insuficiente')

console.log('CENTRAL DE IMPORTAÇÃO E2E EM MEMÓRIA APROVADA')
console.log('Referências, fórmulas, plano em rascunho, confirmação, atualização e rollback conferidos')
console.log('Divergência posterior protegida contra sobrescrita')
