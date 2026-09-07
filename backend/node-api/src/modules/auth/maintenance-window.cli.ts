import { randomBytes, randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { loadEnvironment } from '../../config/environment.js';
import { normalizeError } from '../../core/errors/app-error.js';
import { hashMaintenanceCode } from './maintenance-code.js';

interface Arguments {
  readonly operator: string;
  readonly reason: string;
  readonly minutes: number;
}

function parseArguments(values: readonly string[]): Arguments {
  const parsed = new Map<string, string>();
  for (const value of values) {
    const match = /^--([a-z-]+)=(.+)$/u.exec(value);
    if (!match?.[1] || !match[2]) throw new Error(`Argumento inválido: ${value}`);
    parsed.set(match[1], match[2].trim());
  }
  const operator = parsed.get('operator')?.toUpperCase();
  const reason = parsed.get('reason');
  const minutes = Number(parsed.get('minutes') ?? '30');
  if (!operator) throw new Error('Informe --operator=MATRICULA.');
  if (!reason || reason.length < 10 || reason.length > 500) {
    throw new Error('Informe --reason com 10 a 500 caracteres.');
  }
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 120) {
    throw new Error('--minutes deve ser um inteiro entre 5 e 120.');
  }
  return { operator, reason, minutes };
}

const environment = loadEnvironment();
const args = parseArguments(process.argv.slice(2));
const pool = new Pool({
  application_name: `fab-control-maintenance-window/${environment.release.api}`,
  connectionString: environment.database.url,
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [environment.defaultTenantId]);
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM platform.maintenance_windows
       WHERE tenant_id=$1 AND status='OPEN' LIMIT 1 FOR UPDATE`,
      [environment.defaultTenantId],
    );
    if (existing.rowCount) {
      throw new Error('Já existe uma janela de manutenção aberta para este ambiente.');
    }
    const operator = await client.query<{ id: string; name: string }>(
      `SELECT user_account.id,user_account.name
       FROM iam.users user_account
       WHERE user_account.tenant_id=$1
         AND upper(user_account.employee_number)=upper($2)
         AND user_account.status='ACTIVE'
         AND user_account.first_access_required=false
         AND user_account.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM iam.user_roles user_role
           JOIN iam.roles role ON role.tenant_id=user_role.tenant_id AND role.id=user_role.role_id
           WHERE user_role.tenant_id=user_account.tenant_id
             AND user_role.user_id=user_account.id
             AND role.role_type='ADMIN' AND role.status='ACTIVE'
             AND user_role.valid_from <= clock_timestamp()
             AND (user_role.valid_until IS NULL OR user_role.valid_until > clock_timestamp())
         )
       LIMIT 1`,
      [environment.defaultTenantId, args.operator],
    );
    const authorizedOperator = operator.rows[0];
    if (!authorizedOperator) {
      throw new Error('A matrícula informada não pertence a um Administrador ativo e habilitado.');
    }

    const windowId = randomUUID();
    const code = `FCM-${randomBytes(18).toString('base64url')}`;
    const endsAt = new Date(Date.now() + args.minutes * 60_000);
    await client.query(
      `INSERT INTO platform.maintenance_windows (
         id,tenant_id,status,reason,starts_at,ends_at,opened_by,challenge_hash
       ) VALUES ($1,$2,'OPEN',$3,clock_timestamp(),$4,$5,$6)`,
      [
        windowId,
        environment.defaultTenantId,
        args.reason,
        endsAt,
        authorizedOperator.id,
        hashMaintenanceCode(environment.auth.maintenanceHmacSecret, code),
      ],
    );
    await client.query(
      `INSERT INTO audit.events (
         tenant_id,user_id,role_snapshot,action,entity_type,entity_id,after_data,
         redacted_fields,source
       ) VALUES ($1,$2,'ADMIN','MAINTENANCE_WINDOW_OPENED',
                 'platform.maintenance_windows',$3,$4,
                 ARRAY['challenge_hash','code'],'ADMINISTRATIVE')`,
      [
        environment.defaultTenantId,
        authorizedOperator.id,
        windowId,
        JSON.stringify({ reason: args.reason, ends_at: endsAt.toISOString() }),
      ],
    );
    await client.query('COMMIT');
    process.stdout.write(
      `${JSON.stringify({
        status: 'ok',
        window_id: windowId,
        code,
        expires_at: endsAt.toISOString(),
        operator: authorizedOperator.name,
        warning: 'O código é de uso único e não será exibido novamente.',
      })}\n`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  const normalized = normalizeError(error);
  process.stderr.write(
    `${JSON.stringify({ status: 'error', code: normalized.code, message: normalized.message })}\n`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
