BEGIN;

CREATE TABLE IF NOT EXISTS cmms.material_value_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  category text NOT NULL,
  reference_used text NOT NULL,
  source_url text NOT NULL,
  observation text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT material_value_sources_url_scheme_check
    CHECK (source_url ~* '^https?://'),
  CONSTRAINT material_value_sources_tenant_url_key UNIQUE (tenant_id, source_url),
  CONSTRAINT material_value_sources_tenant_id_id_key UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS material_value_sources_category_idx
  ON cmms.material_value_sources (tenant_id, category);

CREATE TRIGGER material_value_sources_touch_updated_at
BEFORE UPDATE ON cmms.material_value_sources
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

COMMIT;
