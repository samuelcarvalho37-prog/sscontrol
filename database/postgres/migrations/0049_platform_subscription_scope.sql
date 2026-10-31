BEGIN;

GRANT EXECUTE ON FUNCTION platform.current_tenant_id()
  TO vorqix_platform_support_writer;

CREATE POLICY tenants_platform_writer_scope
ON platform.tenants
FOR SELECT
TO vorqix_platform_support_writer
USING (true);

COMMIT;
