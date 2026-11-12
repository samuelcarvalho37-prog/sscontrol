import type { PoolClient } from 'pg';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { AppError } from '../../core/errors/app-error.js';

export async function assertSharedAsset(client: PoolClient, assetId: string, userId: string) {
  const result = await client.query<{ allowed: boolean }>(
    'SELECT maintenance.shared_asset_visible($1,$2) AS allowed',
    [assetId, userId],
  );
  if (!result.rows[0]?.allowed)
    throw new AppError({
      code: 'ASSET_SCOPE_DENIED',
      message: 'Equipamento fora da sua unidade ou escopo autorizado.',
      statusCode: 403,
    });
}

// Both events run in the same transaction as the operation. Repeated attempts
// cannot duplicate the notification, and an observer never releases an OS.
export async function notifySharedObservers(
  client: PoolClient,
  tenantId: string,
  workOrderId: string,
  event: 'RELEASED' | 'STARTED',
) {
  const order = await client.query<{
    asset_id: string;
    title: string;
    scheduled_for: string | null;
    operational_code: string;
  }>(
    'SELECT asset_id,title,scheduled_for,operational_code FROM maintenance.work_orders WHERE id=$1',
    [workOrderId],
  );
  const row = order.rows[0];
  if (!row) return;
  const recipients = await client.query<{ id: string }>(
    `SELECT DISTINCT u.id FROM iam.users u
    JOIN iam.user_roles ur ON ur.user_id=u.id AND ur.tenant_id=u.tenant_id
    JOIN iam.roles r ON r.id=ur.role_id AND r.tenant_id=ur.tenant_id
    WHERE u.tenant_id=$1 AND u.status='ACTIVE' AND u.deleted_at IS NULL AND r.status='ACTIVE' AND r.deleted_at IS NULL
    AND r.code IN ('QUALIDADE','SEGURANCA') AND ur.valid_from<=clock_timestamp()
    AND (ur.valid_until IS NULL OR ur.valid_until>clock_timestamp())
    AND maintenance.shared_asset_visible($2,u.id)`,
    [tenantId, row.asset_id],
  );
  if (!recipients.rows.length) return;
  const key = `shared:${workOrderId}:${event}`;
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
  const exists = await client.query(
    "SELECT id FROM workflow.notifications WHERE tenant_id=$1 AND action_payload->>'sharedEventKey'=$2",
    [tenantId, key],
  );
  if (exists.rows.length) return;
  const notification = await client.query<{ id: string }>(
    `INSERT INTO workflow.notifications
    (tenant_id,notification_type,title,message,entity_type,entity_id,priority,action_route,action_payload,audience)
    VALUES($1,$2,$3,$4,'WORK_ORDER',$5,'INFO','/shared',$6::jsonb,$7::jsonb) RETURNING id`,
    [
      tenantId,
      `SHARED_WORK_ORDER_${event}`,
      `${row.operational_code}: ${event === 'RELEASED' ? 'OS liberada' : 'Execução iniciada'}`,
      `${row.title}. Consulte local, programação, executor e acompanhamento.`,
      workOrderId,
      JSON.stringify({ workOrderId, sharedEventKey: key }),
      JSON.stringify({ userIds: recipients.rows.map((item) => item.id) }),
    ],
  );
  for (const recipient of recipients.rows)
    await client.query(
      `INSERT INTO workflow.notification_recipients
    (tenant_id,notification_id,user_id,delivery_status,delivered_at,last_notified_at,delivery_attempts)
    VALUES($1,$2,$3,'DELIVERED',clock_timestamp(),clock_timestamp(),1) ON CONFLICT DO NOTHING`,
      [tenantId, notification.rows[0]!.id, recipient.id],
    );
}

export function observerArea(user: AuthenticatedUser, area: string) {
  const capability =
    area === 'QUALITY' ? 'maintenance.shared.observe.quality' : 'maintenance.shared.observe.safety';
  if (!['QUALITY', 'SAFETY'].includes(area) || !user.capabilities.includes(capability))
    throw new AppError({
      code: 'OBSERVATION_FORBIDDEN',
      message: 'Seu perfil não registra acompanhamento nesta área.',
      statusCode: 403,
    });
}
