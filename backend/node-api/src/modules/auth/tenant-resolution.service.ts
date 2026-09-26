import type { QueryResultRow } from 'pg';

import type { Environment } from '../../config/environment.js';
import { AppError } from '../../core/errors/app-error.js';
import type { Database } from '../../infrastructure/database/database.js';

export interface TenantRequestContext {
  readonly host: string | undefined;
  readonly ipAddress: string;
  readonly developmentTenantSlug: string | undefined;
}

export interface ResolvedTenant {
  readonly id: string;
  readonly slug: string;
}

interface TenantRow extends QueryResultRow {
  tenant_id: string;
  tenant_slug: string;
}

const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

function normalizeSlug(value: string | undefined): string | null {
  const slug = value?.trim().toLowerCase() ?? '';
  return slugPattern.test(slug) ? slug : null;
}

function normalizedHost(value: string | undefined): string | null {
  const raw = value?.trim().toLowerCase() ?? '';
  if (!raw || raw.includes('/') || raw.includes('\\') || raw.includes('@')) return null;
  const bracketedIpv6 = /^\[([^\]]+)\](?::\d{1,5})?$/u.exec(raw);
  if (bracketedIpv6) return bracketedIpv6[1] ?? null;
  const host = raw.replace(/:\d{1,5}$/u, '').replace(/\.+$/u, '');
  return host || null;
}

function isLoopbackAddress(value: string): boolean {
  const ip = value.trim().toLowerCase();
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function isLocalHost(host: string | null): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export class TenantResolutionService {
  constructor(
    private readonly environment: Environment,
    private readonly database: Database,
  ) {}

  async resolve(context: TenantRequestContext): Promise<ResolvedTenant> {
    const tenant = await this.tryResolve(context);
    if (tenant) return tenant;

    throw new AppError({
      code: 'AUTH_TENANT_UNAVAILABLE',
      message: 'Não foi possível iniciar a autenticação para esta empresa.',
      statusCode: 401,
    });
  }

  async tryResolve(context: TenantRequestContext): Promise<ResolvedTenant | null> {
    const slug = this.slugFromRequest(context);
    if (!slug) return null;

    const result = await this.database.query<TenantRow>(
      `SELECT tenant_id, tenant_slug
       FROM platform.resolve_active_tenant_by_slug($1, $2)`,
      [slug, this.environment.release.environment],
    );
    const row = result.rows[0];
    return row ? { id: row.tenant_id, slug: row.tenant_slug } : null;
  }

  private slugFromRequest(context: TenantRequestContext): string | null {
    const host = normalizedHost(context.host);
    const baseDomain = this.environment.tenantResolution.baseDomain;
    if (baseDomain && host?.endsWith(`.${baseDomain}`)) {
      const candidate = host.slice(0, -(`.${baseDomain}`).length);
      return candidate.includes('.') ? null : normalizeSlug(candidate);
    }

    if (
      this.environment.release.environment !== 'DEVELOPMENT' ||
      !isLoopbackAddress(context.ipAddress) ||
      !isLocalHost(host)
    ) {
      return null;
    }

    return (
      normalizeSlug(context.developmentTenantSlug) ??
      normalizeSlug(this.environment.tenantResolution.developmentTenantSlug)
    );
  }
}
