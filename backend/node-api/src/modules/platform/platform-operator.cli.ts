import { createCipheriv, createHash, randomBytes } from 'node:crypto';

import { Pool } from 'pg';

import { loadEnvironment } from '../../config/environment.js';
import { PasswordService } from '../auth/password.service.js';

function encodeBase32(bytes: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let encoded = '';
  for (let offset = 0; offset < bits.length; offset += 5) {
    const chunk = bits.slice(offset, offset + 5).padEnd(5, '0');
    encoded += alphabet[Number.parseInt(chunk, 2)] ?? '';
  }
  return encoded;
}

function encryptTotpSecret(secret: string, pepper: string): string {
  const key = createHash('sha256').update(pepper, 'utf8').digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
}

const environment = loadEnvironment();
const login = process.env.PLATFORM_OPERATOR_LOGIN?.trim().toLowerCase() ?? '';
const displayName = process.env.PLATFORM_OPERATOR_NAME?.trim() ?? '';
const password = process.env.PLATFORM_OPERATOR_PASSWORD ?? '';
const connectionString = environment.database.migrationUrl;

if (!connectionString)
  throw new Error('Configure MIGRATION_DATABASE_URL para provisionar a identidade da plataforma.');
if (!/^[^\s@]{3,120}$/u.test(login))
  throw new Error('PLATFORM_OPERATOR_LOGIN deve conter de 3 a 120 caracteres sem espaços.');
if (displayName.length < 2 || displayName.length > 120)
  throw new Error('PLATFORM_OPERATOR_NAME deve conter de 2 a 120 caracteres.');
if (!password) throw new Error('Defina PLATFORM_OPERATOR_PASSWORD no ambiente do processo.');

const passwordHash = await new PasswordService(environment.auth.passwordPepper).hash(password);
const totpSecret = encodeBase32(randomBytes(20));
const encryptedSecret = encryptTotpSecret(totpSecret, environment.auth.passwordPepper);
const pool = new Pool({
  application_name: `vorqix-platform-operator/${environment.release.api}`,
  connectionString,
  max: 1,
  ssl:
    environment.database.sslMode === 'verify-full'
      ? {
          rejectUnauthorized: true,
          ...(environment.database.sslCa ? { ca: environment.database.sslCa } : {}),
        }
      : false,
});

try {
  const result = await pool.query<{ id: string }>(
    'SELECT platform.bootstrap_platform_operator($1,$2,$3,$4) AS id',
    [login, displayName, passwordHash, encryptedSecret],
  );
  const operatorId = result.rows[0]?.id;
  if (!operatorId) throw new Error('A identidade inicial não foi criada.');
  const label = encodeURIComponent(`VORQIX Plataforma:${login}`);
  const issuer = encodeURIComponent('VORQIX Plataforma');
  const provisioningUri = `otpauth://totp/${label}?secret=${totpSecret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  process.stdout.write(
    `${JSON.stringify({
      status: 'created',
      operator_id: operatorId,
      login,
      mfa_setup_uri: provisioningUri,
      warning: 'Cadastre o segundo fator agora. O segredo não pode ser recuperado depois.',
    })}\n`,
  );
} finally {
  await pool.end();
}
