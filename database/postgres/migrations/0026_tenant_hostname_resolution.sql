BEGIN;

-- Tenant slugs are public routing identifiers, never client-supplied tenant IDs.
UPDATE platform.tenants
SET slug = lower(btrim(slug))
WHERE slug <> lower(btrim(slug));

ALTER TABLE platform.tenants
  ADD CONSTRAINT tenants_slug_normalized_check
  CHECK (slug = lower(btrim(slug)) AND slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$');

CREATE UNIQUE INDEX tenants_slug_lower_key ON platform.tenants (lower(slug));

-- RLS deliberately hides platform.tenants without a tenant context. This narrowly
-- scoped function is the only pre-auth lookup: it returns an active tenant ID for
-- a normalized slug and environment, and exposes no tenant metadata.
CREATE OR REPLACE FUNCTION platform.resolve_active_tenant_by_slug(
  requested_slug text,
  requested_environment text
)
RETURNS TABLE (tenant_id uuid, tenant_slug text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
  SELECT tenant.id, tenant.slug
  FROM platform.tenants AS tenant
  WHERE tenant.slug = lower(btrim(requested_slug))
    AND tenant.status = 'ACTIVE'
    AND tenant.deleted_at IS NULL
    AND tenant.environment = requested_environment
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION platform.resolve_active_tenant_by_slug(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.resolve_active_tenant_by_slug(text, text)
  TO fab_control_runtime;

COMMIT;
