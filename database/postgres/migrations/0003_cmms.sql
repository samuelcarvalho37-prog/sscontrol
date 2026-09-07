BEGIN;

CREATE TABLE cmms.plants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  tag text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT plants_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT plants_tag_key UNIQUE (tenant_id, tag),
  CONSTRAINT plants_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT plants_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))
);

CREATE TABLE cmms.sectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  plant_id uuid NOT NULL,
  tag text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT sectors_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT sectors_plant_tag_key UNIQUE (tenant_id, plant_id, tag),
  CONSTRAINT sectors_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT sectors_plant_fk
    FOREIGN KEY (tenant_id, plant_id)
    REFERENCES cmms.plants(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT sectors_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))
);

CREATE TABLE cmms.lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  sector_id uuid NOT NULL,
  tag text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT lines_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT lines_sector_tag_key UNIQUE (tenant_id, sector_id, tag),
  CONSTRAINT lines_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT lines_sector_fk
    FOREIGN KEY (tenant_id, sector_id)
    REFERENCES cmms.sectors(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT lines_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))
);

CREATE TABLE cmms.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  line_id uuid NOT NULL,
  tag text NOT NULL,
  qr_payload text NOT NULL,
  name text NOT NULL,
  asset_type text NOT NULL,
  criticality text NOT NULL DEFAULT 'MEDIUM',
  operational_status text NOT NULL DEFAULT 'OPERATING',
  lifecycle_status text NOT NULL DEFAULT 'ACTIVE',
  health_percent numeric(5,2),
  current_hour_meter numeric(18,3),
  hour_meter_mode text,
  hour_meter_updated_at timestamptz,
  service_hour_meter_baseline numeric(18,3),
  service_hour_meter_baseline_at timestamptz,
  manufacturer text,
  model text,
  serial_number text,
  technical_location text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT assets_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT assets_tag_key UNIQUE (tenant_id, tag),
  CONSTRAINT assets_qr_payload_key UNIQUE (tenant_id, qr_payload),
  CONSTRAINT assets_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT assets_line_fk
    FOREIGN KEY (tenant_id, line_id)
    REFERENCES cmms.lines(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT assets_criticality_check
    CHECK (criticality IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  CONSTRAINT assets_operational_status_check
    CHECK (operational_status IN ('OPERATING', 'STOPPED', 'INSPECTION', 'MAINTENANCE_PLANNED', 'MAINTENANCE_UNPLANNED', 'UNAVAILABLE')),
  CONSTRAINT assets_lifecycle_status_check
    CHECK (lifecycle_status IN ('ACTIVE', 'INACTIVE', 'DECOMMISSIONED', 'ARCHIVED')),
  CONSTRAINT assets_health_percent_check
    CHECK (health_percent IS NULL OR health_percent BETWEEN 0 AND 100),
  CONSTRAINT assets_hour_meter_check
    CHECK (current_hour_meter IS NULL OR current_hour_meter >= 0),
  CONSTRAINT assets_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX assets_name_trgm_idx
  ON cmms.assets USING gin (name public.gin_trgm_ops);

CREATE INDEX assets_technical_location_trgm_idx
  ON cmms.assets USING gin (technical_location public.gin_trgm_ops);

CREATE INDEX assets_status_idx
  ON cmms.assets (tenant_id, operational_status, criticality);

CREATE TABLE cmms.components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  asset_id uuid NOT NULL,
  tag text NOT NULL,
  qr_payload text NOT NULL,
  name text NOT NULL,
  component_type text NOT NULL,
  criticality text NOT NULL DEFAULT 'MEDIUM',
  operational_status text NOT NULL DEFAULT 'OPERATING',
  lifecycle_status text NOT NULL DEFAULT 'ACTIVE',
  useful_life_hours numeric(18,3),
  useful_life_days integer,
  accumulated_hours numeric(18,3),
  installed_at timestamptz,
  manufacturer text,
  model text,
  serial_number text,
  technical_location text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT components_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT components_tag_key UNIQUE (tenant_id, tag),
  CONSTRAINT components_qr_payload_key UNIQUE (tenant_id, qr_payload),
  CONSTRAINT components_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT components_asset_fk
    FOREIGN KEY (tenant_id, asset_id)
    REFERENCES cmms.assets(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT components_criticality_check
    CHECK (criticality IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  CONSTRAINT components_operational_status_check
    CHECK (operational_status IN ('OPERATING', 'STOPPED', 'INSPECTION', 'MAINTENANCE_PLANNED', 'MAINTENANCE_UNPLANNED', 'UNAVAILABLE')),
  CONSTRAINT components_lifecycle_status_check
    CHECK (lifecycle_status IN ('ACTIVE', 'INACTIVE', 'DECOMMISSIONED', 'ARCHIVED')),
  CONSTRAINT components_useful_life_hours_check
    CHECK (useful_life_hours IS NULL OR useful_life_hours >= 0),
  CONSTRAINT components_useful_life_days_check
    CHECK (useful_life_days IS NULL OR useful_life_days >= 0),
  CONSTRAINT components_accumulated_hours_check
    CHECK (accumulated_hours IS NULL OR accumulated_hours >= 0),
  CONSTRAINT components_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX components_asset_status_idx
  ON cmms.components (tenant_id, asset_id, operational_status);

CREATE INDEX components_name_trgm_idx
  ON cmms.components USING gin (name public.gin_trgm_ops);

CREATE TABLE cmms.materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  sku text NOT NULL,
  name text NOT NULL,
  unit text NOT NULL,
  current_stock numeric(18,4) NOT NULL DEFAULT 0,
  minimum_stock numeric(18,4) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT materials_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT materials_sku_key UNIQUE (tenant_id, sku),
  CONSTRAINT materials_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT materials_stock_check
    CHECK (current_stock >= 0 AND minimum_stock >= 0),
  CONSTRAINT materials_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))
);

CREATE INDEX materials_name_trgm_idx
  ON cmms.materials USING gin (name public.gin_trgm_ops);

CREATE TABLE iam.user_scope_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  plant_id uuid,
  sector_id uuid,
  line_id uuid,
  asset_id uuid,
  scope_type text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  assigned_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT user_scope_assignments_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT user_scope_assignments_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT user_scope_assignments_plant_fk
    FOREIGN KEY (tenant_id, plant_id)
    REFERENCES cmms.plants(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT user_scope_assignments_sector_fk
    FOREIGN KEY (tenant_id, sector_id)
    REFERENCES cmms.sectors(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT user_scope_assignments_line_fk
    FOREIGN KEY (tenant_id, line_id)
    REFERENCES cmms.lines(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT user_scope_assignments_asset_fk
    FOREIGN KEY (tenant_id, asset_id)
    REFERENCES cmms.assets(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT user_scope_assignments_scope_type_check
    CHECK (scope_type IN ('TENANT', 'PLANT', 'SECTOR', 'LINE', 'ASSET')),
  CONSTRAINT user_scope_assignments_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT user_scope_assignments_target_check
    CHECK (
      (scope_type = 'TENANT' AND plant_id IS NULL AND sector_id IS NULL AND line_id IS NULL AND asset_id IS NULL)
      OR (scope_type = 'PLANT' AND plant_id IS NOT NULL AND sector_id IS NULL AND line_id IS NULL AND asset_id IS NULL)
      OR (scope_type = 'SECTOR' AND plant_id IS NULL AND sector_id IS NOT NULL AND line_id IS NULL AND asset_id IS NULL)
      OR (scope_type = 'LINE' AND plant_id IS NULL AND sector_id IS NULL AND line_id IS NOT NULL AND asset_id IS NULL)
      OR (scope_type = 'ASSET' AND plant_id IS NULL AND sector_id IS NULL AND line_id IS NULL AND asset_id IS NOT NULL)
    )
);

CREATE INDEX user_scope_assignments_user_idx
  ON iam.user_scope_assignments (tenant_id, user_id, status);

CREATE TABLE cmms.parameter_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  asset_id uuid NOT NULL,
  component_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  unit text NOT NULL,
  value_type text NOT NULL DEFAULT 'DECIMAL',
  source_type text NOT NULL DEFAULT 'MANUAL',
  description text,
  status text NOT NULL DEFAULT 'ACTIVE',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT parameter_definitions_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT parameter_definitions_target_code_key UNIQUE (tenant_id, asset_id, component_id, code),
  CONSTRAINT parameter_definitions_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT parameter_definitions_asset_fk
    FOREIGN KEY (tenant_id, asset_id)
    REFERENCES cmms.assets(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT parameter_definitions_component_fk
    FOREIGN KEY (tenant_id, component_id)
    REFERENCES cmms.components(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT parameter_definitions_value_type_check
    CHECK (value_type IN ('DECIMAL', 'INTEGER', 'BOOLEAN', 'TEXT')),
  CONSTRAINT parameter_definitions_source_type_check
    CHECK (source_type IN ('MANUAL', 'CHECKLIST', 'SENSOR', 'IMPORT')),
  CONSTRAINT parameter_definitions_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'RETIRED')),
  CONSTRAINT parameter_definitions_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX parameter_definitions_name_trgm_idx
  ON cmms.parameter_definitions USING gin (name public.gin_trgm_ops);

CREATE TABLE cmms.parameter_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  parameter_definition_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  warning_min numeric,
  warning_max numeric,
  critical_min numeric,
  critical_max numeric,
  validation_rule jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  status text NOT NULL DEFAULT 'DRAFT',
  content_hash_sha256 text NOT NULL,
  created_by uuid,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  approved_at timestamptz,
  CONSTRAINT parameter_policies_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT parameter_policies_version_key UNIQUE (tenant_id, parameter_definition_id, version),
  CONSTRAINT parameter_policies_definition_fk
    FOREIGN KEY (tenant_id, parameter_definition_id)
    REFERENCES cmms.parameter_definitions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT parameter_policies_created_by_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT parameter_policies_approved_by_fk
    FOREIGN KEY (tenant_id, approved_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT parameter_policies_status_check
    CHECK (status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'RETIRED')),
  CONSTRAINT parameter_policies_warning_range_check
    CHECK (warning_min IS NULL OR warning_max IS NULL OR warning_min <= warning_max),
  CONSTRAINT parameter_policies_critical_range_check
    CHECK (critical_min IS NULL OR critical_max IS NULL OR critical_min <= critical_max),
  CONSTRAINT parameter_policies_period_check
    CHECK (effective_until IS NULL OR effective_until > effective_from),
  CONSTRAINT parameter_policies_rule_object_check
    CHECK (jsonb_typeof(validation_rule) = 'object')
);

CREATE UNIQUE INDEX parameter_policies_one_active
  ON cmms.parameter_policies (tenant_id, parameter_definition_id)
  WHERE status = 'ACTIVE';

CREATE TABLE cmms.parameter_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  parameter_definition_id uuid NOT NULL,
  parameter_policy_id uuid,
  numeric_value numeric,
  text_value text,
  boolean_value boolean,
  unit text NOT NULL,
  classification text NOT NULL DEFAULT 'UNCLASSIFIED',
  source text NOT NULL,
  source_entity_type text,
  source_entity_id uuid,
  recorded_by uuid,
  recorded_at timestamptz NOT NULL,
  raw_value text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT parameter_readings_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT parameter_readings_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT parameter_readings_definition_fk
    FOREIGN KEY (tenant_id, parameter_definition_id)
    REFERENCES cmms.parameter_definitions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT parameter_readings_policy_fk
    FOREIGN KEY (tenant_id, parameter_policy_id)
    REFERENCES cmms.parameter_policies(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT parameter_readings_recorded_by_fk
    FOREIGN KEY (tenant_id, recorded_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT parameter_readings_value_check
    CHECK (num_nonnulls(numeric_value, text_value, boolean_value) = 1),
  CONSTRAINT parameter_readings_classification_check
    CHECK (classification IN ('NORMAL', 'WARNING_LOW', 'WARNING_HIGH', 'CRITICAL_LOW', 'CRITICAL_HIGH', 'UNCLASSIFIED')),
  CONSTRAINT parameter_readings_source_check
    CHECK (source IN ('MANUAL', 'CHECKLIST', 'SENSOR', 'IMPORT', 'MIGRATION')),
  CONSTRAINT parameter_readings_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX parameter_readings_definition_time_idx
  ON cmms.parameter_readings (tenant_id, parameter_definition_id, recorded_at DESC);

CREATE INDEX parameter_readings_abnormal_idx
  ON cmms.parameter_readings (tenant_id, classification, recorded_at DESC)
  WHERE classification <> 'NORMAL';

CREATE INDEX parameter_readings_recorded_at_brin_idx
  ON cmms.parameter_readings USING brin (recorded_at);

CREATE TRIGGER plants_touch_updated_at
BEFORE UPDATE ON cmms.plants
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER sectors_touch_updated_at
BEFORE UPDATE ON cmms.sectors
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER lines_touch_updated_at
BEFORE UPDATE ON cmms.lines
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER assets_touch_updated_at
BEFORE UPDATE ON cmms.assets
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER components_touch_updated_at
BEFORE UPDATE ON cmms.components
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER materials_touch_updated_at
BEFORE UPDATE ON cmms.materials
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER user_scope_assignments_touch_updated_at
BEFORE UPDATE ON iam.user_scope_assignments
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER parameter_definitions_touch_updated_at
BEFORE UPDATE ON cmms.parameter_definitions
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

COMMIT;
