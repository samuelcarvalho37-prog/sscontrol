import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/^\uFEFF/, '')
const assert = (condition, message) => {
  if (!condition) throw new Error(`Cadastro manual E2E inválido: ${message}`)
}

let lockAcquisitions = 0
let lockReleases = 0
const context = vm.createContext({
  console,
  Utilities: {
    DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
    computeDigest(_algorithm, value) { return [...crypto.createHash('sha256').update(String(value), 'utf8').digest()] },
    formatDate(date) { return new Date(date).toISOString().slice(0, 19) },
    getUuid() { return '11111111-aaaa-bbbb-cccc-dddddddddddd' },
  },
  LockService: {
    getScriptLock() {
      return {
        tryLock() { lockAcquisitions += 1; return true },
        releaseLock() { lockReleases += 1 },
      }
    },
  },
})

vm.runInContext([
  read('backend/apps-script/00_Config.js'),
  read('backend/apps-script/01_Utils.js'),
  read('backend/apps-script/04_Admin.js'),
  `
    var TEST_DB = {
      plantas:[{id:'PLT-01',tag:'P01',nome:'Planta 01',status:'ATIVO',criado_em:'2026-01-01',atualizado_em:'2026-01-01',__rowIndex:2}],
      setores:[{id:'SET-01',planta_id:'PLT-01',tag:'S01',nome:'Setor 01',status:'ATIVO',criado_em:'2026-01-01',atualizado_em:'2026-01-01',__rowIndex:2}],
      linhas:[{id:'LIN-01',setor_id:'SET-01',tag:'L01',nome:'Linha 01',status:'ATIVO',criado_em:'2026-01-01',atualizado_em:'2026-01-01',__rowIndex:2}],
      ativos:[{id:'ATV-01',linha_id:'LIN-01',tag:'EQ-01',nome:'Equipamento 01',status:'OPERANDO',criado_em:'2026-01-01',atualizado_em:'2026-01-01',__rowIndex:2}],
      componentes:[{id:'CMP-01',ativo_id:'ATV-01',tag:'M01',nome:'Motor 01',status:'ATIVO',criado_em:'2026-01-01',atualizado_em:'2026-01-01',__rowIndex:2}],
      materiais:[], plano_itens:[], usuarios:[], sessoes:[], audit_log:[], ordens_servico:[], os_acoes:[], execucoes:[],
      planos_manutencao:[{id:'PLN-VALIDADO',ativo_id:'ATV-01',nome:'Plano validado',gatilho_tipo:'DIAS',gatilho_valor:30,status:'ATIVO',workflow_status:'VALIDADO',validado_gestao:'SIM',criado_em:'2026-01-01',atualizado_em:'2026-01-01',__rowIndex:2}]
    };
    function rows_(name){ return TEST_DB[name] || []; }
    function find_(name, key, value){ return rows_(name).find(function(row){ return String(row[key]) === String(value); }) || null; }
    function fit_(name, data){ var out = {}; SH[name].forEach(function(key){ out[key] = data[key] === undefined ? '' : data[key]; }); return out; }
    function append_(name, data){ if(!TEST_DB[name]) TEST_DB[name] = []; data.__rowIndex = TEST_DB[name].length + 2; TEST_DB[name].push(data); return data; }
    function update_(name, rowIndex, patch){ var row = rows_(name).find(function(item){ return item.__rowIndex === rowIndex; }); if(!row) throw new Error('Linha ausente: '+name+'#'+rowIndex); Object.assign(row, patch); }
    function deleteRow_(name, rowIndex){ var list = rows_(name); var index = list.findIndex(function(item){ return item.__rowIndex === rowIndex; }); if(index < 0) throw new Error('Linha ausente para exclusão: '+name+'#'+rowIndex); list.splice(index, 1); list.forEach(function(item, itemIndex){ item.__rowIndex = itemIndex + 2; }); }
    function audit_(auth, action, entity, entityId, before, after){ append_('audit_log', {id:'AUD-'+(rows_('audit_log').length+1),usuario_id:auth.usuario_id,perfil:auth.perfil,acao:action,entidade:entity,entidade_id:entityId,antes_json:JSON.stringify(before||{}),depois_json:JSON.stringify(after||{}),criado_em:now_()}); }
    function normalizaTipoChecklist_(value){ return upper_(value); }
    function normalizaOpcoesJson_(value){ return clean_(value); }
  `,
].join('\n'), context)

const admin = `{usuario_id:'USR-ADMIN',perfil:'ADMIN'}`
const evaluate = (source) => JSON.parse(vm.runInContext(`JSON.stringify(${source})`, context))

context.newPlan = {
  entidade: 'planos',
  dados: {
    ativo_id: 'ATV-01', componente_id: 'CMP-01', nome: 'Inspeção semanal', tipo: 'PREVENTIVA',
    criticidade: 'ALTA', gatilho_tipo: 'DIAS', gatilho_valor: 7, unidade: 'dias',
    status: 'ATIVO', workflow_status: 'VALIDADO', validado_gestao: 'SIM',
  },
  user_agent: 'teste-e2e',
}
const savedPlan = evaluate(`adminSalvarSeguro_(newPlan, ${admin})`)
assert(savedPlan.mode === 'insert', 'plano não foi criado')
assert(savedPlan.row.status === 'INATIVO', 'plano manual nasceu ativo')
assert(savedPlan.row.workflow_status === 'RASCUNHO', 'plano manual pulou a validação')
assert(savedPlan.row.validado_gestao === 'NAO', 'plano manual nasceu validado')

context.invalidAsset = { entidade: 'ativos', dados: { linha_id: 'LIN-INEXISTENTE', tag: 'EQ-02', nome: 'Equipamento 02' } }
const invalidReferenceBlocked = vm.runInContext(`try { adminSalvarSeguro_(invalidAsset, ${admin}); false } catch(error) { error.code === 'ENTITY_REFERENCE_INVALID' }`, context)
assert(invalidReferenceBlocked, 'referência inexistente não foi bloqueada')

context.invalidComponentPlan = { entidade: 'planos', dados: { ativo_id: 'ATV-OUTRO', componente_id: 'CMP-01', nome: 'Plano inválido', gatilho_tipo: 'DIAS', gatilho_valor: 10 } }
const componentMismatchBlocked = vm.runInContext(`try { adminSalvarSeguro_(invalidComponentPlan, ${admin}); false } catch(error) { error.code === 'ENTITY_REFERENCE_INVALID' }`, context)
assert(componentMismatchBlocked, 'componente de outro ativo não foi bloqueado')

context.validatedEdit = { entidade: 'planos', dados: { id: 'PLN-VALIDADO', ativo_id: 'ATV-01', nome: 'Alteração indevida', gatilho_tipo: 'DIAS', gatilho_valor: 20 } }
const validatedEditBlocked = vm.runInContext(`try { adminSalvarSeguro_(validatedEdit, ${admin}); false } catch(error) { error.code === 'ENTITY_PROTECTED_PLAN' }`, context)
assert(validatedEditBlocked, 'plano validado aceitou edição direta')

context.material = { entidade: 'materiais', dados: { sku: 'ROL-6205', nome: 'Rolamento 6205', unidade: 'un', status: 'ATIVO' } }
const forbidden = vm.runInContext(`try { adminSalvarSeguro_(material, {usuario_id:'USR-GESTOR',perfil:'GESTOR'}); false } catch(error) { error.code === 'FORBIDDEN_ADMIN_REQUIRED' }`, context)
assert(forbidden, 'perfil Gestor alterou cadastro administrativo')
const savedMaterial = evaluate(`adminSalvarSeguro_(material, ${admin})`)
assert(savedMaterial.row.sku === 'ROL-6205', 'material válido não foi salvo')

context.componentStatus = { entidade: 'componentes', id: 'CMP-01', acao: 'ALTERAR_STATUS', status: 'INATIVO', user_agent: 'teste-e2e' }
const deactivatedComponent = evaluate(`adminEntityAction_(componentStatus, ${admin})`)
assert(deactivatedComponent.row.status === 'INATIVO', 'componente não foi desativado')
context.componentStatus.status = 'ATIVO'
const reactivatedComponent = evaluate(`adminEntityAction_(componentStatus, ${admin})`)
assert(reactivatedComponent.row.status === 'ATIVO', 'componente não foi reativado')

vm.runInContext(`TEST_DB.ordens_servico.push({id:'OS-ABERTA',componente_id:'CMP-01',ativo_id:'ATV-01',status:'ABERTA',__rowIndex:2})`, context)
context.componentStatus.status = 'INATIVO'
const deactivationWithOpenOrderBlocked = vm.runInContext(`try { adminEntityAction_(componentStatus, ${admin}); false } catch(error) { error.code === 'ENTITY_HAS_OPEN_OPERATIONS' }`, context)
assert(deactivationWithOpenOrderBlocked, 'componente com OS aberta foi desativado')
vm.runInContext(`TEST_DB.ordens_servico = []`, context)

context.deleteMaterial = { entidade: 'materiais', id: savedMaterial.row.id, acao: 'EXCLUIR', user_agent: 'teste-e2e' }
const deletedMaterial = evaluate(`adminEntityAction_(deleteMaterial, ${admin})`)
assert(deletedMaterial.deleted === true && evaluate(`rows_('materiais').length`) === 0, 'material sem vínculo não foi excluído')

context.deleteDraftPlan = { entidade: 'planos', id: savedPlan.row.id, acao: 'EXCLUIR', user_agent: 'teste-e2e' }
const deletedDraftPlan = evaluate(`adminEntityAction_(deleteDraftPlan, ${admin})`)
assert(deletedDraftPlan.deleted === true, 'plano em rascunho sem vínculo não foi excluído')

context.deleteReferencedAsset = { entidade: 'ativos', id: 'ATV-01', acao: 'EXCLUIR', user_agent: 'teste-e2e' }
const referencedAssetBlocked = vm.runInContext(`try { adminEntityAction_(deleteReferencedAsset, ${admin}); false } catch(error) { error.code === 'ENTITY_IN_USE' }`, context)
assert(referencedAssetBlocked, 'ativo referenciado foi excluído')

context.deleteValidatedPlan = { entidade: 'planos', id: 'PLN-VALIDADO', acao: 'EXCLUIR', user_agent: 'teste-e2e' }
const validatedDeleteBlocked = vm.runInContext(`try { adminEntityAction_(deleteValidatedPlan, ${admin}); false } catch(error) { error.code === 'ENTITY_PROTECTED_PLAN' }`, context)
assert(validatedDeleteBlocked, 'plano validado foi excluído')

assert(evaluate(`rows_('audit_log').length`) === 6, 'ações confirmadas não foram auditadas')
assert(lockAcquisitions === 9 && lockReleases === 9, 'lock não envolveu exatamente as ações administrativas')

console.log('CADASTRO MANUAL E2E EM MEMÓRIA APROVADO')
console.log('Dropdowns e ações são reforçados por referências validadas no backend')
console.log('Status, exclusão protegida, planos imutáveis, concorrência e auditoria foram validados')
