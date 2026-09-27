BEGIN;

ALTER TABLE cmms.material_value_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE cmms.material_value_sources FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS material_value_sources_tenant_isolation
  ON cmms.material_value_sources;

CREATE POLICY material_value_sources_tenant_isolation
  ON cmms.material_value_sources
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
