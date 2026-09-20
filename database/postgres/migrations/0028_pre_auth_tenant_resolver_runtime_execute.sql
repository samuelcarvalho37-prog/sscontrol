BEGIN;

-- The API connects as vorqix_api. Its membership in fab_control_runtime is
-- deliberately non-inheritable, so grant only the resolver entry point to
-- the effective runtime login role.
REVOKE EXECUTE ON FUNCTION platform.resolve_active_tenant_by_slug(text, text)
  FROM fab_control_runtime;
GRANT EXECUTE ON FUNCTION platform.resolve_active_tenant_by_slug(text, text)
  TO vorqix_api;

COMMIT;
