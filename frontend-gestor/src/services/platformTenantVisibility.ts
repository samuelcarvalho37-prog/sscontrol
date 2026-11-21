import type { PlatformTenantSummary } from "./api/platform";

export function platformCustomerTenants(tenants: PlatformTenantSummary[]): PlatformTenantSummary[] {
  const testRecord = /(?:^|[-_\s])(?:test|tests|teste|testes|numbering|numera[cç][aã]o)(?:$|[-_\s])/iu;
  const candidates = tenants.filter((tenant) =>
    !tenant.slug.toLowerCase().startsWith("fab-control-") &&
    !testRecord.test(`${tenant.slug} ${tenant.display_name}`),
  );
  const byName = new Map<string, PlatformTenantSummary[]>();
  for (const tenant of candidates) {
    const name = tenant.display_name.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
    byName.set(name, [...(byName.get(name) ?? []), tenant]);
  }
  return [...byName.values()].map((items) =>
    items.sort((first, second) => {
      const demoPriority = Number(second.slug.endsWith("-demo")) - Number(first.slug.endsWith("-demo"));
      if (demoPriority) return demoPriority;
      return new Date(second.created_at).getTime() - new Date(first.created_at).getTime();
    })[0],
  ).filter((tenant): tenant is PlatformTenantSummary => Boolean(tenant));
}
