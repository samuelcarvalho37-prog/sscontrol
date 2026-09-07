import crypto from 'node:crypto'

const IDENTITY_PROPERTY = 'FAB_CONTROL_PLATFORM_IDENTITY_V1'
const IDENTITY_SECRET_PROPERTY = 'FAB_CONTROL_PLATFORM_IDENTITY_SIGNING_SECRET'
const MAINTENANCE_PROPERTY = 'FAB_CONTROL_MOTOR_MAINTENANCE_V1'
const MAINTENANCE_SECRET_PROPERTY = 'FAB_CONTROL_MOTOR_MAINTENANCE_SIGNING_SECRET'

function fail(message) {
  console.error(`ERRO: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (!current.startsWith('--')) fail(`argumento inválido: ${current}`)
    const key = current.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) fail(`valor ausente para --${key}`)
    parsed[key] = value
    index += 1
  }
  return parsed
}

function required(args, key) {
  const value = String(args[key] || '').trim()
  if (!value) fail(`informe --${key}`)
  return value
}

function hmac(value, secret) {
  return crypto.createHmac('sha256', secret).update(value, 'utf8').digest('base64url')
}

function asciiJson(value) {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

function envelope(data, secret) {
  const payload = asciiJson(data)
  return JSON.stringify({
    payload,
    signature: hmac(payload, secret),
  })
}

const args = parseArgs(process.argv.slice(2))
const tenantId = required(args, 'tenant')
const environment = required(args, 'environment').toUpperCase()
const operatorId = required(args, 'operator-id')
const operatorName = required(args, 'name')
const operatorEmail = required(args, 'email').toLowerCase()
const reason = required(args, 'reason')
const minutes = Number(args.minutes || 30)

if (!Number.isInteger(minutes) || minutes < 5 || minutes > 120) {
  fail('--minutes deve ser um inteiro entre 5 e 120')
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(operatorEmail)) {
  fail('--email inválido')
}
if (!/^[A-Za-z0-9._-]{3,80}$/.test(operatorId)) {
  fail('--operator-id deve possuir de 3 a 80 caracteres seguros')
}
if (!/^[A-Z][A-Z0-9_-]{2,30}$/.test(environment)) {
  fail('--environment inválido')
}

const generatedSecrets = args['generate-secrets'] === 'true'
const identitySecret = process.env[IDENTITY_SECRET_PROPERTY] ||
  (generatedSecrets ? crypto.randomBytes(48).toString('base64url') : '')
const maintenanceSecret = process.env[MAINTENANCE_SECRET_PROPERTY] ||
  (generatedSecrets ? crypto.randomBytes(48).toString('base64url') : '')

if (!identitySecret) {
  fail(`defina a variável ${IDENTITY_SECRET_PROPERTY} ou use --generate-secrets true`)
}
if (!maintenanceSecret) {
  fail(`defina a variável ${MAINTENANCE_SECRET_PROPERTY} ou use --generate-secrets true`)
}

const issuedAt = new Date()
const expiresAt = new Date(issuedAt.getTime() + minutes * 60000)
const windowId = `MW-${crypto.randomBytes(12).toString('hex').toUpperCase()}`
const accessCode = crypto.randomBytes(32).toString('base64url')
const challengeHash = hmac(
  `FAB_CONTROL_MAINTENANCE_CHALLENGE_V1:${accessCode}`,
  maintenanceSecret,
)

const identity = {
  schema_version: '1',
  usuario_id: operatorId,
  nome: operatorName,
  email: operatorEmail,
  status: 'ATIVO',
  tenant_id: tenantId,
  ambientes: [environment],
  emitido_em: issuedAt.toISOString(),
}

const maintenance = {
  schema_version: '1',
  ativa: true,
  janela_id: windowId,
  operador_id: operatorId,
  tenant_id: tenantId,
  ambiente: environment,
  motivo: reason,
  emitido_em: issuedAt.toISOString(),
  expira_em: expiresAt.toISOString(),
  desafio_hash: challengeHash,
}

const output = {
  aviso: 'Armazene os segredos somente nas Script Properties. O código temporário aparece uma única vez.',
  janela: {
    id: windowId,
    ambiente: environment,
    expira_em: expiresAt.toISOString(),
  },
  script_properties: {
    [IDENTITY_SECRET_PROPERTY]: identitySecret,
    [IDENTITY_PROPERTY]: envelope(identity, identitySecret),
    [MAINTENANCE_SECRET_PROPERTY]: maintenanceSecret,
    [MAINTENANCE_PROPERTY]: envelope(maintenance, maintenanceSecret),
  },
  codigo_temporario: accessCode,
}

console.log(JSON.stringify(output, null, 2))
