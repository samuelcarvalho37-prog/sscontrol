import type { PoolClient } from 'pg';
import { PERMISSION_CATALOG, permissionDefinition } from './permission-catalog.js';

export interface PermissionPolicy {
  readonly personalizavel: boolean;
  readonly permissoes: readonly string[] | null;
  readonly recursos: readonly string[] | null;
  readonly plano?: string | null;
}
export async function readPermissionPolicy(client: PoolClient): Promise<PermissionPolicy> {
  const result = await client.query<{ policy: PermissionPolicy }>(
    'SELECT platform.current_permission_policy() AS policy',
  );
  const value = result.rows[0]?.policy;
  if (!value) throw new Error('Não foi possível consultar os limites de acesso da empresa.');
  return value;
}
export function policyAllows(policy: PermissionPolicy, code: string): boolean {
  const definition = permissionDefinition(code);
  if (policy.permissoes !== null && !policy.permissoes.includes(code)) return false;
  return (
    !definition?.feature || policy.recursos === null || policy.recursos.includes(definition.feature)
  );
}
export function effectiveCapabilities(
  codes: readonly string[],
  policy: PermissionPolicy,
): string[] {
  const parents = new Set(
    PERMISSION_CATALOG.filter((item) => item.id !== item.legado).map((item) => item.legado),
  );
  const permitted = new Set(
    codes.filter((code) => !parents.has(code) && policyAllows(policy, code)),
  );
  // Compatibilidade de navegação: o servidor protege a ação específica de cada rota.
  for (const definition of PERMISSION_CATALOG) {
    if (permitted.has(definition.id)) permitted.add(definition.legado);
  }
  return ['permissions.catalog.v2', ...permitted];
}
