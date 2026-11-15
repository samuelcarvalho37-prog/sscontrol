import type { PoolClient } from 'pg';
import { AppError } from '../../core/errors/app-error.js';

export interface HourlyRateInput {
  userId: string;
  hourlyCost: number;
  effectiveFrom: string | null;
}

export async function listHourlyRates(client: PoolClient) {
  const result = await client.query(`SELECT r.id,r.user_id AS usuario_id,u.name AS nome,
    r.hourly_cost AS custo_hora,r.effective_from AS vigente_desde
    FROM maintenance.technician_hourly_rates r
    JOIN iam.users u ON u.id=r.user_id AND u.tenant_id=r.tenant_id
    ORDER BY u.name,r.effective_from DESC`);
  return result.rows;
}

export async function recordHourlyRate(
  client: PoolClient,
  tenantId: string,
  recordedBy: string,
  input: HourlyRateInput,
) {
  const result = await client.query(
    `INSERT INTO maintenance.technician_hourly_rates
    (tenant_id,user_id,hourly_cost,effective_from,recorded_by)
    SELECT $1,u.id,$3,COALESCE($4::timestamptz,clock_timestamp()),$5 FROM iam.users u
    WHERE u.tenant_id=$1 AND u.id=$2
      AND ($4::timestamptz IS NULL OR $4::timestamptz>=now())
    ON CONFLICT (tenant_id,user_id,effective_from) DO NOTHING
    RETURNING id,user_id AS usuario_id,hourly_cost AS custo_hora,effective_from AS vigente_desde`,
    [tenantId, input.userId, input.hourlyCost, input.effectiveFrom, recordedBy],
  );
  if (!result.rows[0])
    throw new AppError({
      code: 'HOURLY_RATE_INVALID',
      message:
        'Selecione uma pessoa da empresa e uma vigência atual ou futura ainda não cadastrada.',
      statusCode: 400,
    });
  return result.rows[0];
}
