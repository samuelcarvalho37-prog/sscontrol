BEGIN;

ALTER TABLE workflow.technical_validation_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.technical_validation_reports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS technical_validation_reports_tenant_isolation
  ON workflow.technical_validation_reports;

CREATE POLICY technical_validation_reports_tenant_isolation
  ON workflow.technical_validation_reports
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
