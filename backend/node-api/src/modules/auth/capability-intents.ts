import type { PoolClient } from 'pg';
import { isDeepStrictEqual } from 'node:util';
import { routeCapability } from './capability-catalog.js';

interface IntentResource {
  readonly table: string;
  readonly parameter: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly operational?: boolean;
}
const common = { nome: 'name', tag: 'tag', status: 'status' };
const equipment = {
  tag: 'tag',
  nome: 'name',
  criticidade: 'criticality',
  status_operacional: 'operational_status',
  status_ciclo_vida: 'lifecycle_status',
  fabricante: 'manufacturer',
  modelo: 'model',
  numero_serie: 'serial_number',
  localizacao_tecnica: 'technical_location',
  metadados: 'metadata',
};
const resources: Readonly<Record<string, IntentResource>> = {
  '/v1/cmms/plants/:plantId': { table: 'cmms.plants', parameter: 'plantId', fields: common },
  '/v1/cmms/sectors/:sectorId': {
    table: 'cmms.sectors',
    parameter: 'sectorId',
    fields: { ...common, planta_id: 'plant_id' },
  },
  '/v1/cmms/lines/:lineId': {
    table: 'cmms.lines',
    parameter: 'lineId',
    fields: { ...common, setor_id: 'sector_id' },
  },
  '/v1/cmms/assets/:assetId': {
    table: 'cmms.assets',
    parameter: 'assetId',
    fields: {
      ...equipment,
      linha_id: 'line_id',
      tipo: 'asset_type',
      saude_percentual: 'health_percent',
      horimetro_atual: 'current_hour_meter',
      modo_horimetro: 'hour_meter_mode',
    },
    operational: true,
  },
  '/v1/cmms/components/:componentId': {
    table: 'cmms.components',
    parameter: 'componentId',
    fields: {
      ...equipment,
      ativo_id: 'asset_id',
      tipo: 'component_type',
      vida_util_horas: 'useful_life_hours',
      vida_util_dias: 'useful_life_days',
      horas_acumuladas: 'accumulated_hours',
      instalado_em: 'installed_at',
    },
    operational: true,
  },
  '/v1/cmms/materials/:materialId': {
    table: 'cmms.materials',
    parameter: 'materialId',
    fields: {
      ...common,
      sku: 'sku',
      nome_facil: 'friendly_name',
      unidade: 'unit',
      valor_unitario: 'unit_cost',
      estoque_atual: 'current_stock',
      estoque_minimo: 'minimum_stock',
    },
  },
  '/v1/maintenance/plans/:planId': {
    table: 'maintenance.maintenance_plans',
    parameter: 'planId',
    fields: { codigo: 'code', nome: 'name', status_ciclo_vida: 'lifecycle_status' },
  },
};
const numericColumns = new Set([
  'unit_cost',
  'current_stock',
  'minimum_stock',
  'health_percent',
  'current_hour_meter',
  'useful_life_hours',
  'useful_life_days',
  'accumulated_hours',
]);
const archiveStates = new Set(['ARCHIVED', 'RETIRED', 'DECOMMISSIONED']);
const statusFields = new Set(['status', 'status_ciclo_vida', 'status_operacional']);

function sameValue(column: string, first: unknown, second: unknown): boolean {
  if (
    numericColumns.has(column) &&
    first !== null &&
    second !== null &&
    first !== undefined &&
    second !== undefined
  ) {
    return Number.isFinite(Number(first)) && Number(first) === Number(second);
  }
  if (column === 'installed_at' && first && second)
    return new Date(String(first)).getTime() === new Date(String(second)).getTime();
  return isDeepStrictEqual(first, second);
}

/** Chamada dentro do contexto RLS; os nomes SQL vêm exclusivamente do mapa constante. */
export async function requiredIntentCapabilities(
  client: Pick<PoolClient, 'query'>,
  method: string,
  route: string,
  rawBody: unknown,
  rawParams: unknown,
): Promise<string[]> {
  const base = routeCapability(method, route, '');
  const resource = method.toUpperCase() === 'PATCH' ? resources[route] : undefined;
  if (!resource || !base) return base ? [base] : [];
  const body =
    rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
      ? (rawBody as Record<string, unknown>)
      : {};
  const params =
    rawParams && typeof rawParams === 'object' ? (rawParams as Record<string, unknown>) : {};
  const id = params[resource.parameter];
  if (
    typeof id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id)
  )
    return [base];
  const result = await client.query<{ current: Record<string, unknown> }>(
    `SELECT to_jsonb(item) AS current FROM ${resource.table} item WHERE id=$1 AND tenant_id=current_setting('app.tenant_id')::uuid AND deleted_at IS NULL`,
    [id],
  );
  const current = result.rows[0]?.current;
  if (!current) return [base];
  const keys = Object.keys(body).filter((key) => body[key] !== undefined);
  const archived = keys
    .filter((key) => statusFields.has(key))
    .some(
      (key) =>
        archiveStates.has(String(body[key])) ||
        archiveStates.has(String(current[resource.fields[key] ?? ''])),
    );
  const special = (key: string): string | null => {
    if (statusFields.has(key)) return archived ? 'archive' : 'status';
    if (resource.table === 'cmms.materials' && ['estoque_atual', 'estoque_minimo'].includes(key))
      return 'stock';
    if (resource.table === 'cmms.materials' && key === 'valor_unitario') return 'cost';
    return null;
  };
  const required = new Set<string>();
  for (const key of keys) {
    const column = resource.fields[key];
    if (column && sameValue(column, body[key], current[column])) continue;
    const intent = special(key);
    required.add(intent ? `${base}.${intent}` : base);
  }
  if (required.size > 0) {
    // Evita sobrescrever valores concorrentes por campos enviados sem alteração e sem autorização própria.
    for (const key of keys) {
      const column = resource.fields[key];
      if (!column || !sameValue(column, body[key], current[column])) continue;
      if (special(key) !== null || !required.has(base)) delete body[key];
    }
  }
  if (!required.size) {
    // Uma chamada explícita apenas de situação/saldo/custo continua exigindo sua própria ação.
    const explicit = keys.length > 0 && keys.every((key) => special(key) !== null);
    if (explicit) for (const key of keys) required.add(`${base}.${special(key)!}`);
    else required.add(base);
  }
  return [...required];
}
