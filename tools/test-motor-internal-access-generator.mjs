import crypto from 'node:crypto'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const identitySecret = 'identity-secret-for-generator-contract'
const maintenanceSecret = 'maintenance-secret-for-generator-contract'
const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools/generate-motor-internal-access.mjs'),
    '--tenant',
    'TENANT-HOMOLOGACAO',
    '--environment',
    'HOMOLOGACAO',
    '--operator-id',
    'NMCS-PLATFORM-01',
    '--name',
    'Plataforma Manutenção',
    '--email',
    'platform@fabcontrol.internal',
    '--reason',
    'Homologação técnica do catálogo',
    '--minutes',
    '30',
  ],
  {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      FAB_CONTROL_PLATFORM_IDENTITY_SIGNING_SECRET: identitySecret,
      FAB_CONTROL_MOTOR_MAINTENANCE_SIGNING_SECRET: maintenanceSecret,
    },
  },
)

if (result.status !== 0) {
  throw new Error(result.stderr || 'gerador de acesso interno falhou')
}

const output = JSON.parse(result.stdout)
const properties = output.script_properties

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function verifyEnvelope(propertyName, secret) {
  const raw = String(properties[propertyName] || '')
  const envelope = JSON.parse(raw)
  const expected = crypto
    .createHmac('sha256', secret)
    .update(envelope.payload, 'utf8')
    .digest('base64url')

  assert(envelope.signature === expected, `${propertyName} possui assinatura divergente`)
  assert(
    [...envelope.payload].every((character) => character.charCodeAt(0) <= 0x7e),
    `${propertyName} contém caracteres que podem ser normalizados durante o transporte`,
  )
  return JSON.parse(envelope.payload)
}

const identity = verifyEnvelope(
  'FAB_CONTROL_PLATFORM_IDENTITY_V1',
  identitySecret,
)
const maintenance = verifyEnvelope(
  'FAB_CONTROL_MOTOR_MAINTENANCE_V1',
  maintenanceSecret,
)

assert(identity.nome === 'Plataforma Manutenção', 'nome acentuado não foi preservado')
assert(
  maintenance.motivo === 'Homologação técnica do catálogo',
  'motivo acentuado não foi preservado',
)
assert(
  typeof output.codigo_temporario === 'string' && output.codigo_temporario.length >= 32,
  'código temporário não foi gerado',
)

console.log('GERADOR DO ACESSO INTERNO APROVADO')
console.log('Envelopes ASCII, acentuação, HMAC e código de uso único conferidos')
