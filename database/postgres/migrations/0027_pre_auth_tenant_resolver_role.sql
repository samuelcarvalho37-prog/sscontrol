BEGIN;

-- This role exists only as the owner of the narrowly scoped pre-auth resolver.
-- It cannot log in, cannot administer PostgreSQL, and is not granted to runtime
-- application roles. RLS remains enforced; the policy below applies only while
-- this SECURITY DEFINER function is executing as its owner.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'vorqix_tenant_resolver'
  ) THEN
    CREATE ROLE vorqix_tenant_resolver
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS;
  END IF;
END;
$$;

ALTER ROLE vorqix_tenant_resolver
  NOLOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOBYPASSRLS;

GRANT USAGE ON SCHEMA platform TO vorqix_tenant_resolver;
GRANT SELECT (id, slug, status, deleted_at, environment)
  ON platform.tenants TO vorqix_tenant_resolver;

DROP POLICY IF EXISTS tenant_pre_auth_resolver ON platform.tenants;
CREATE POLICY tenant_pre_auth_resolver
  ON platform.tenants
  FOR SELECT
  TO vorqix_tenant_resolver
  USING (true);

ALTER FUNCTION platform.resolve_active_tenant_by_slug(text, text)
  OWNER TO vorqix_tenant_resolver;

REVOKE ALL ON FUNCTION platform.resolve_active_tenant_by_slug(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.resolve_active_tenant_by_slug(text, text)
  TO fab_control_runtime;

COMMIT;
