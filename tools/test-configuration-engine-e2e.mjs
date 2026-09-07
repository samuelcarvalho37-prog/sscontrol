import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/^\uFEFF/, '')
const assert = (condition, message) => {
  if (!condition) throw new Error(`Motor E2E inválido: ${message}`)
}

let sequence = 0
let lockAvailable = true
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
      sequence += 1
      return `${String(sequence).padStart(8, '0')}-aaaa-bbbb-cccc-dddddddddddd`
    },
  },
  LockService: {
    getScriptLock() {
      return {
        tryLock() { return lockAvailable },
        releaseLock() {},
      }
    },
  },
})

vm.runInContext([
  read('backend/apps-script/00_Config.js'),
  read('backend/apps-script/01_Utils.js'),
  read('backend/apps-script/26_Motor_Configuracao.js'),
  `
    var TEST_DB = {
      config: [
        {chave:'parada.tolerancia_retorno_min',valor:'17',descricao:'legado',atualizado_em:'2026-01-01T00:00:00',__rowIndex:2},
        {chave:'evidencia.foto.max_bytes',valor:'3000000',descricao:'legado',atualizado_em:'2026-01-01T00:00:00',__rowIndex:3}
      ],
      configuracao_versoes: [], configuracao_rascunhos: [], audit_log: []
    };
    function configurationEnsureSchema_(){}
    function getSpreadsheet_(){ return {}; }
    function ensureSheet_(){}
    function rows_(name){ return TEST_DB[name] || []; }
    function find_(name, key, value){ return rows_(name).find(function(row){ return String(row[key]) === String(value); }) || null; }
    function fit_(name, data){ var out = {}; SH[name].forEach(function(key){ out[key] = data[key] === undefined ? '' : data[key]; }); return out; }
    function append_(name, data){ if(!TEST_DB[name]) TEST_DB[name] = []; data.__rowIndex = TEST_DB[name].length + 2; TEST_DB[name].push(data); return data; }
    function update_(name, rowIndex, patch){ var row = rows_(name).find(function(item){ return item.__rowIndex === rowIndex; }); if(!row) throw new Error('Linha ausente: '+name+'#'+rowIndex); Object.assign(row, patch); }
    function upsert_(name, key, data){ var old = find_(name, key, data[key]); if(old){ update_(name, old.__rowIndex, data); return old; } return append_(name, data); }
    function invalidateRuntimeCache_(){ CONFIG_ENGINE_RUNTIME_CACHE = null; }
    function audit_(auth, action, entity, entityId, before, after, userAgent){ append_('audit_log', {usuario_id:auth.usuario_id,acao:action,entidade:entity,entidade_id:entityId,antes_json:JSON.stringify(before||{}),depois_json:JSON.stringify(after||{}),user_agent:userAgent,criado_em:now_()}); }
  `,
].join('\n'), context)

const admin = `{usuario_id:'USR-ADMIN',perfil:'ADMIN'}`
const evaluate = (source) => JSON.parse(vm.runInContext(`JSON.stringify(${source})`, context))

const initial = evaluate(`configurationState_({}, ${admin})`)
assert(initial.ativa.id === '', 'ambiente legado não deveria inventar uma versão ativa')
assert(initial.ativa.configuracao['parada.tolerancia_retorno_min'] === 17, 'fallback não preservou tolerância legada')
assert(initial.ativa.configuracao['evidencia.foto.max_bytes'] === 3000000, 'fallback não preservou limite legado')

const proposed = { ...initial.ativa.configuracao, 'parada.tolerancia_retorno_min': 25, 'kpi.meta.oee_pct': 80 }
context.proposed = proposed
const draftOne = evaluate(`configurationSaveDraft_({configuracao:proposed,base_versao_id:'',user_agent:'e2e'}, ${admin})`)
assert(draftOne.rascunho.validacao.valido === true, 'rascunho válido foi rejeitado')
assert(evaluate(`configurationRuntimeValue_('parada.tolerancia_retorno_min',10)`) === 17, 'rascunho alterou o runtime antes da publicação')

context.invalidUnknown = { ...proposed, 'schema.version': '9.9.9' }
const unknown = evaluate(`configurationValidate_( {configuracao:invalidUnknown}, ${admin})`)
assert(unknown.valido === false && unknown.erros.some((item) => item.codigo === 'CONFIG_KEY_NOT_ALLOWED'), 'chave protegida não foi rejeitada')

context.invalidRange = { ...proposed, 'evidencia.foto.max_bytes': 99999999 }
const outOfRange = evaluate(`configurationValidate_({configuracao:invalidRange}, ${admin})`)
assert(outOfRange.valido === false && outOfRange.erros.some((item) => item.codigo === 'CONFIG_RANGE_INVALID'), 'limite inválido não foi rejeitado')

const publishedOne = evaluate(`configurationPublish_({rascunho_id:'${draftOne.rascunho.id}',user_agent:'e2e'}, ${admin})`)
assert(publishedOne.ativa.numero === 1, 'primeira publicação não gerou versão 1')
assert(evaluate(`configurationRuntimeValue_('parada.tolerancia_retorno_min',10)`) === 25, 'publicação não ativou o snapshot')

context.proposedTwo = { ...proposed, 'parada.tolerancia_retorno_min': 40 }
const draftTwo = evaluate(`configurationSaveDraft_({configuracao:proposedTwo,base_versao_id:'${publishedOne.ativa.id}',user_agent:'e2e'}, ${admin})`)
const publishedTwo = evaluate(`configurationPublish_({rascunho_id:'${draftTwo.rascunho.id}',user_agent:'e2e'}, ${admin})`)
assert(publishedTwo.ativa.numero === 2, 'segunda publicação não incrementou a versão')
assert(evaluate(`configurationRuntimeValue_('parada.tolerancia_retorno_min',10)`) === 40, 'segunda versão não foi ativada')

const rolledBack = evaluate(`configurationRollback_({versao_id:'${publishedOne.ativa.id}',base_versao_id:'${publishedTwo.ativa.id}',motivo:'Retorno controlado para teste',user_agent:'e2e'}, ${admin})`)
assert(rolledBack.ativa.numero === 3, 'rollback não criou uma nova versão imutável')
assert(evaluate(`configurationRuntimeValue_('parada.tolerancia_retorno_min',10)`) === 25, 'rollback não restaurou o valor histórico')
assert(evaluate(`rows_('configuracao_versoes').filter(function(item){ return item.origem === 'ROLLBACK'; }).length`) === 1, 'origem do rollback não foi persistida')

context.stale = { ...proposed, 'parada.tolerancia_retorno_min': 55 }
const staleDraft = evaluate(`configurationSaveDraft_({configuracao:stale,base_versao_id:'${publishedTwo.ativa.id}',user_agent:'e2e'}, ${admin})`)
const staleRejected = vm.runInContext(`try { configurationPublish_({rascunho_id:'${staleDraft.rascunho.id}'}, ${admin}); false } catch(error) { error.code === 'CONFIG_BASE_VERSION_CHANGED' && error.status === 409 }`, context)
assert(staleRejected, 'publicação baseada em versão obsoleta não foi bloqueada')

vm.runInContext(`find_('configuracao_versoes','id','${publishedOne.ativa.id}').configuracao_json = '{"violado":true}'`, context)
const tamperRejected = vm.runInContext(`try { configurationRollback_({versao_id:'${publishedOne.ativa.id}',base_versao_id:'${rolledBack.ativa.id}',motivo:'Teste de integridade violada'}, ${admin}); false } catch(error) { error.code === 'CONFIG_VERSION_INTEGRITY_FAILED' && error.status === 409 }`, context)
assert(tamperRejected, 'versão histórica adulterada foi aceita no rollback')

lockAvailable = false
context.locked = { ...proposed, 'parada.tolerancia_retorno_min': 60 }
const lockDraft = evaluate(`configurationSaveDraft_({configuracao:locked,base_versao_id:'${rolledBack.ativa.id}',user_agent:'e2e'}, ${admin})`)
const lockRejected = vm.runInContext(`try { configurationPublish_({rascunho_id:'${lockDraft.rascunho.id}'}, ${admin}); false } catch(error) { error.code === 'CONFIG_PUBLICATION_BUSY' && error.status === 409 }`, context)
assert(lockRejected, 'publicação concorrente não foi bloqueada')

assert(evaluate(`rows_('configuracao_versoes').length`) === 3, 'falhas alteraram o histórico imutável')
assert(evaluate(`rows_('audit_log').length`) >= 6, 'trilha de auditoria insuficiente')

console.log('MOTOR DE CONFIGURAÇÃO E2E EM MEMÓRIA APROVADO')
console.log('Legado → rascunho isolado → publicação v1 → publicação v2 → rollback v3')
console.log('Lista branca, faixa, concorrência, versão obsoleta e adulteração bloqueadas')
