import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const root = path.resolve(import.meta.dirname, '..')
const adminSource = fs.readFileSync(path.join(root, 'backend/apps-script/04_Admin.js'), 'utf8').replace(/^\uFEFF/, '')
const start = adminSource.indexOf('const ADMIN_COMPANY_NAME_KEY')
const end = adminSource.indexOf('function adminSanitizeEntityRow_')

function assert(condition, message) {
  if (!condition) throw new Error(`Identidade da empresa inválida: ${message}`)
}

assert(start >= 0 && end > start, 'bloco de backend não encontrado')

const tables = { config: [], audit_log: [] }
const context = vm.createContext({
  console,
  ROLE: { ADMIN: 'ADMIN' },
  Utilities: {
    base64Decode(value) {
      return Array.from(Buffer.from(value, 'base64'), (byte) => (byte > 127 ? byte - 256 : byte))
    },
  },
})

vm.runInContext(`
  var TEST_LOCK_AVAILABLE = true;
  var TEST_NOW_SEQUENCE = 0;
  var LockService = { getScriptLock:function(){ return {
    tryLock:function(){ return TEST_LOCK_AVAILABLE; },
    releaseLock:function(){}
  }; } };
  function clean_(value){ return String(value == null ? '' : value).trim(); }
  function upper_(value){ return clean_(value).toUpperCase(); }
  function adminRequireIdentityAdmin_(auth){
    if(upper_(auth && auth.perfil) !== ROLE.ADMIN) err_('FORBIDDEN_ADMIN_REQUIRED', 'Perfil ADMIN obrigatório.', 403);
  }
  function now_(){ TEST_NOW_SEQUENCE += 1; return '2026-07-22T18:00:' + String(TEST_NOW_SEQUENCE).padStart(2, '0'); }
  function err_(code, message, status){ var error = new Error(message); error.code = code; error.status = status || 400; throw error; }
  function find_(name, key, value){ return (${JSON.stringify(tables)})[name].find(function(row){ return String(row[key]) === String(value); }) || null; }
`, context)

context.TEST_TABLES = tables
vm.runInContext(`
  find_ = function(name, key, value){ return TEST_TABLES[name].find(function(row){ return String(row[key]) === String(value); }) || null; };
  function upsert_(name, key, value){
    var old = find_(name, key, value[key]);
    if(old) Object.assign(old, value);
    else TEST_TABLES[name].push(Object.assign({}, value));
    return value;
  }
  function audit_(auth, action, entity, entityId, before, after, userAgent){
    TEST_TABLES.audit_log.push({auth:auth, action:action, entity:entity, entityId:entityId, before:before, after:after, userAgent:userAgent});
  }
`, context)

vm.runInContext(adminSource.slice(start, end), context)

const adminAuth = JSON.stringify({ usuario_id: 'USR-ADMIN-001', perfil: 'ADMIN' })
const defaultCompany = JSON.parse(vm.runInContext(`JSON.stringify(adminEmpresaObter_({}, ${adminAuth}))`, context))
assert(defaultCompany.nome === 'Empresa Demonstração', 'nome padrão não foi preservado')
assert(defaultCompany.logo_data_url === '', 'empresa padrão recebeu imagem indevida')

let forbidden = ''
try {
  vm.runInContext(`adminEmpresaObter_({}, {perfil:'GESTOR'})`, context)
} catch (cause) {
  forbidden = cause.code
}
assert(forbidden === 'FORBIDDEN_ADMIN_REQUIRED', 'perfil não administrativo acessou a configuração')

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const savePayload = JSON.stringify({ dados: { nome: '  Tozzi   Industrial  ', logo_data_url: png }, user_agent: 'Teste E2E' })
const saved = JSON.parse(vm.runInContext(`JSON.stringify(adminEmpresaSalvar_(${savePayload}, ${adminAuth}))`, context))
assert(saved.saved === true, 'backend não confirmou a gravação')
assert(saved.empresa.nome === 'Tozzi Industrial', 'nome não foi normalizado')
assert(saved.empresa.logo_data_url === png, 'imagem validada não foi preservada')
assert(tables.config.find((row) => row.chave === 'empresa.nome_exibicao')?.valor === 'Tozzi Industrial', 'nome não chegou à configuração central')
assert(tables.config.find((row) => row.chave === 'empresa.logo_data_url')?.valor === png, 'imagem não chegou à configuração central')
assert(tables.audit_log.length === 1, 'alteração não gerou exatamente um evento de auditoria')
assert(tables.audit_log[0].action === 'ADMIN_COMPANY_IDENTITY_UPDATED', 'evento de auditoria incorreto')
assert(!JSON.stringify(tables.audit_log[0]).includes('data:image/'), 'auditoria armazenou o conteúdo completo da imagem')

let invalidImage = ''
try {
  vm.runInContext(`adminEmpresaSalvar_({dados:{nome:'Empresa Válida',logo_data_url:'data:image/svg+xml;base64,PHN2Zz4='}}, ${adminAuth})`, context)
} catch (cause) {
  invalidImage = cause.code
}
assert(invalidImage === 'COMPANY_LOGO_INVALID', 'formato de imagem não permitido foi aceito')

vm.runInContext('TEST_LOCK_AVAILABLE = false', context)
let busy = ''
try {
  vm.runInContext(`adminEmpresaSalvar_({dados:{nome:'Empresa Válida',logo_data_url:''}}, ${adminAuth})`, context)
} catch (cause) {
  busy = cause.code
}
assert(busy === 'ADMIN_WRITE_BUSY', 'concorrência de gravação não foi bloqueada')

console.log('IDENTIDADE DA EMPRESA APROVADA')
console.log('Nome, imagem, autorização, concorrência e auditoria validados em runtime isolado')
