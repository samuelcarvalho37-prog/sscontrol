import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const root = path.resolve(import.meta.dirname, '..')
const source = fs.readFileSync(path.join(root, 'backend/apps-script/30_Motor_Acesso_Comercial.js'), 'utf8')
const properties = {}
const audits = []
let environment = 'HOMOLOGACAO'

function clean(value) {
  return value == null ? '' : String(value).trim()
}

const context = vm.createContext({
  console,
  Date,
  JSON,
  Object,
  Array,
  String,
  Number,
  Math,
  ROLE: { ADMIN: 'ADMIN', SISTEMA: 'SISTEMA' },
  PROP_APP_ENVIRONMENT: 'FAB_CONTROL_APP_ENVIRONMENT',
  clean_: clean,
  upper_: (value) => clean(value).toUpperCase(),
  authSecureEquals_: (left, right) => clean(left) === clean(right),
  audit_: (...args) => audits.push(args),
  err_: (code, message, status) => {
    const error = new Error(message)
    error.code = code
    error.status = status
    throw error
  },
  find_: (sheet, key, value) => {
    if (sheet === 'config' && key === 'chave' && value === 'app.environment') return { valor: environment }
    return null
  },
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty(key) {
          return Object.prototype.hasOwnProperty.call(properties, key) ? properties[key] : null
        },
      }
    },
  },
  Utilities: {
    computeHmacSha256Signature(value, secret) {
      return [...crypto.createHmac('sha256', String(secret)).update(String(value), 'utf8').digest()]
    },
    base64EncodeWebSafe(bytes) {
      return Buffer.from(bytes).toString('base64url')
    },
  },
})

vm.runInContext(source, context)

function resetCaches() {
  vm.runInContext('MOTOR_SUBSCRIPTION_CACHE = null; MOTOR_MAINTENANCE_CACHE = null;', context)
}

function clearProperties() {
  for (const key of Object.keys(properties)) delete properties[key]
  resetCaches()
}

function signProperty(propertyName, secretName, data) {
  const secret = `secret-${secretName}`
  const payload = JSON.stringify(data)
  properties[secretName] = secret
  context.__payload = payload
  context.__secret = secret
  const signature = vm.runInContext('motorHmac_(__payload, __secret)', context)
  properties[propertyName] = JSON.stringify({ payload, signature })
  resetCaches()
}

function expectDenied(action, expectedCode = 'SUBSCRIPTION_FEATURE_REQUIRED') {
  let denied = null
  try {
    context.motorAuthorizeAction_(action, { usuario_id: 'USR-ADMIN', perfil: 'ADMIN' })
  } catch (error) {
    denied = error
  }
  if (!denied || denied.code !== expectedCode) {
    throw new Error(`Ação ${action} deveria falhar com ${expectedCode}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

clearProperties()
environment = ''
properties.FAB_CONTROL_APP_ENVIRONMENT = 'HOMOLOGACAO'
assert(context.motorEnvironment_() === 'HOMOLOGACAO', 'motor deve usar o ambiente protegido quando a planilha não declarar o valor')
environment = 'PRODUCAO'
assert(context.motorEnvironment_() === 'PRODUCAO', 'ambiente declarado na planilha deve ter precedência sobre a propriedade')
environment = 'HOMOLOGACAO'
delete properties.FAB_CONTROL_APP_ENVIRONMENT
assert(context.motorAuthorizeAction_('admin.documentos.listar', { perfil: 'ADMIN' }) === true, 'migração deve preservar o plano completo atual')
properties.FAB_CONTROL_SPREADSHEET_ID = 'TENANT-01'

signProperty('FAB_CONTROL_SUBSCRIPTION_V1', 'FAB_CONTROL_SUBSCRIPTION_SIGNING_SECRET', {
  tenant_id: 'TENANT-01',
  plano: 'INICIAL',
  status: 'ATIVA',
})
assert(context.motorAuthorizeAction_('admin.listar', { perfil: 'ADMIN' }) === true, 'plano Inicial deve permitir cadastros')
assert(context.motorAuthorizeAction_('operador.minhas_acoes', { perfil: 'OPERADOR' }) === true, 'plano Inicial deve permitir ordens de serviço')
expectDenied('admin.documentos.listar')
expectDenied('cmms.kpis_tecnicos')

signProperty('FAB_CONTROL_SUBSCRIPTION_V1', 'FAB_CONTROL_SUBSCRIPTION_SIGNING_SECRET', {
  tenant_id: 'TENANT-01',
  plano: 'BASICO',
  status: 'ATIVA',
})
assert(context.motorAuthorizeAction_('gestor.validar_modelo_checklist', { perfil: 'GESTOR' }) === true, 'plano Básico deve permitir checklists')
assert(context.motorAuthorizeAction_('cmms.kpis_tecnicos', { perfil: 'GESTOR' }) === true, 'plano Básico deve permitir indicadores')
expectDenied('admin.importacao.modelos')

signProperty('FAB_CONTROL_SUBSCRIPTION_V1', 'FAB_CONTROL_SUBSCRIPTION_SIGNING_SECRET', {
  tenant_id: 'TENANT-01',
  plano: 'COMPLETO',
  status: 'ATIVA',
})
assert(context.motorAuthorizeAction_('admin.importacao.modelos', { perfil: 'ADMIN' }) === true, 'plano Completo deve permitir importações')
assert(context.motorAuthorizeAction_('admin.backups.listar', { perfil: 'ADMIN' }) === true, 'plano Completo deve permitir continuidade')

signProperty('FAB_CONTROL_SUBSCRIPTION_V1', 'FAB_CONTROL_SUBSCRIPTION_SIGNING_SECRET', {
  tenant_id: 'OUTRO-TENANT',
  plano: 'COMPLETO',
  status: 'ATIVA',
})
expectDenied('admin.importacao.modelos')

properties.FAB_CONTROL_SUBSCRIPTION_V1 = JSON.stringify({ payload: '{}', signature: 'adulterada' })
resetCaches()
expectDenied('admin.listar')

signProperty('FAB_CONTROL_SUBSCRIPTION_V1', 'FAB_CONTROL_SUBSCRIPTION_SIGNING_SECRET', {
  tenant_id: 'TENANT-01',
  plano: 'COMPLETO',
  status: 'ATIVA',
  valido_ate: '2020-01-01T00:00:00.000Z',
})
expectDenied('admin.documentos.listar')

signProperty('FAB_CONTROL_SUBSCRIPTION_V1', 'FAB_CONTROL_SUBSCRIPTION_SIGNING_SECRET', {
  tenant_id: 'TENANT-01',
  plano: 'COMPLETO',
  status: 'ATIVA',
  valido_ate: 'data-inválida',
})
expectDenied('admin.documentos.listar')

signProperty('FAB_CONTROL_MOTOR_MAINTENANCE_V1', 'FAB_CONTROL_MOTOR_MAINTENANCE_SIGNING_SECRET', {
  ativa: true,
  tenant_id: 'TENANT-01',
  ambiente: 'HOMOLOGACAO',
  expira_em: '2099-01-01T00:00:00.000Z',
  motivo: 'Evolução controlada do motor',
})
assert(context.motorMaintenanceState_().aberta === true, 'janela assinada de homologação deveria abrir')
assert(context.motorRequireMaintenanceAccess_({ perfil: 'SISTEMA' }) === true, 'identidade interna deveria acessar a janela aberta')

let adminDenied = null
try {
  context.motorRequireMaintenanceAccess_({ perfil: 'ADMIN' })
} catch (error) {
  adminDenied = error
}
assert(adminDenied?.code === 'MOTOR_MAINTENANCE_REQUIRED', 'administrador do cliente não pode obter acesso integral')

signProperty('FAB_CONTROL_MOTOR_MAINTENANCE_V1', 'FAB_CONTROL_MOTOR_MAINTENANCE_SIGNING_SECRET', {
  ativa: true,
  tenant_id: 'OUTRO-TENANT',
  ambiente: 'HOMOLOGACAO',
  expira_em: '2099-01-01T00:00:00.000Z',
  motivo: 'Tentativa em cliente incorreto',
})
assert(context.motorMaintenanceState_().aberta === false, 'janela de outro cliente não pode abrir')

let unclassified = null
try {
  context.motorAuthorizeAction_('admin.rota_futura_sem_plano', { perfil: 'ADMIN' })
} catch (error) {
  unclassified = error
}
assert(unclassified?.code === 'SUBSCRIPTION_ACTION_UNCLASSIFIED', 'rota futura sem classificação deve falhar fechada')

environment = 'PRODUCAO'
resetCaches()
assert(context.motorMaintenanceState_().aberta === false, 'janela de outro ambiente não pode abrir em produção')
assert(audits.length >= 4, 'negações comerciais precisam ser auditadas')

console.log('E2E DO ACESSO COMERCIAL AO MOTOR APROVADO')
console.log('Compatibilidade, planos, falha fechada e manutenção temporária conferidos')
