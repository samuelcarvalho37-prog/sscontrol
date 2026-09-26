BEGIN;

CREATE TABLE workflow.technical_validation_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  technical_signature_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  report_type text NOT NULL CHECK (report_type IN ('QUALITY','SAFETY')),
  report_code text NOT NULL,
  technical_opinion text NOT NULL,
  attestation_text text NOT NULL,
  digital_signature_storage_key text NULL,
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  content_hash_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT technical_validation_reports_signature_fk
    FOREIGN KEY (tenant_id, technical_signature_id)
    REFERENCES workflow.technical_signatures (tenant_id, id),
  CONSTRAINT technical_validation_reports_work_order_fk
    FOREIGN KEY (tenant_id, work_order_id)
    REFERENCES maintenance.work_orders (tenant_id, id),
  CONSTRAINT technical_validation_reports_unique_signature
    UNIQUE (tenant_id, technical_signature_id),
  CONSTRAINT technical_validation_reports_unique_code
    UNIQUE (tenant_id, report_code)
);

CREATE INDEX technical_validation_reports_lookup_idx
  ON workflow.technical_validation_reports (tenant_id, report_type, approved_at DESC);

ALTER TABLE workflow.technical_validation_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.technical_validation_reports FORCE ROW LEVEL SECURITY;

CREATE POLICY technical_validation_reports_tenant_isolation
  ON workflow.technical_validation_reports
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE TRIGGER technical_validation_reports_immutable
BEFORE UPDATE OR DELETE ON workflow.technical_validation_reports
FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();

COMMIT;
