BEGIN;

CREATE TABLE maintenance.checklist_item_types (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  requires_response boolean NOT NULL,
  requires_value boolean NOT NULL,
  requires_options boolean NOT NULL,
  supports_limit boolean NOT NULL,
  supports_evidence boolean NOT NULL,
  default_category text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO maintenance.checklist_item_types (
  code,
  name,
  description,
  requires_response,
  requires_value,
  requires_options,
  supports_limit,
  supports_evidence,
  default_category
)
VALUES
  ('CONFIRMACAO', 'Confirmação', 'Aceite ou confirmação em uma etapa.', true, false, false, false, true, 'OPERACIONAL'),
  ('OK_NOK', 'Conforme ou não conforme', 'Resposta OK, NOK ou não aplicável.', true, false, false, false, true, 'OPERACIONAL'),
  ('NUMERO', 'Número', 'Medição numérica simples.', true, true, false, true, true, 'PARAMETRO'),
  ('PARAMETRO', 'Parâmetro técnico', 'Leitura vinculada a uma definição e faixa técnica.', true, true, false, true, true, 'TECNICO'),
  ('TEXTO', 'Texto', 'Resposta livre, observação ou justificativa.', true, false, false, false, true, 'OPERACIONAL'),
  ('SELECAO', 'Lista de opções', 'Seleção entre opções cadastradas.', true, false, true, false, true, 'OPERACIONAL'),
  ('EVIDENCIA', 'Evidência obrigatória', 'Etapa destinada ao registro de evidência.', false, false, false, false, true, 'TECNICO'),
  ('LEITURA_OPERACIONAL', 'Leitura operacional', 'Leitura de campo como horímetro, pressão, temperatura ou corrente.', true, true, false, true, true, 'OPERACIONAL'),
  ('INSTRUCAO', 'Instrução', 'Orientação de execução sem campo de resposta.', false, false, false, false, true, 'SEGURANCA')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  requires_response = EXCLUDED.requires_response,
  requires_value = EXCLUDED.requires_value,
  requires_options = EXCLUDED.requires_options,
  supports_limit = EXCLUDED.supports_limit,
  supports_evidence = EXCLUDED.supports_evidence,
  default_category = EXCLUDED.default_category;

CREATE TABLE maintenance.checklist_validation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type_code text NOT NULL REFERENCES maintenance.checklist_item_types(code) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  rule jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT checklist_validation_rules_code_key UNIQUE (item_type_code, code),
  CONSTRAINT checklist_validation_rules_rule_object_check
    CHECK (jsonb_typeof(rule) = 'object')
);

CREATE TABLE maintenance.checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  code text NOT NULL,
  name text NOT NULL,
  asset_id uuid NOT NULL,
  component_id uuid,
  checklist_type text NOT NULL,
  criticality text NOT NULL DEFAULT 'MEDIUM',
  lifecycle_status text NOT NULL DEFAULT 'ACTIVE',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT checklist_templates_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT checklist_templates_code_key UNIQUE (tenant_id, code),
  CONSTRAINT checklist_templates_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT checklist_templates_asset_fk
    FOREIGN KEY (tenant_id, asset_id)
    REFERENCES cmms.assets(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT checklist_templates_component_fk
    FOREIGN KEY (tenant_id, component_id)
    REFERENCES cmms.components(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT checklist_templates_creator_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT checklist_templates_criticality_check
    CHECK (criticality IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  CONSTRAINT checklist_templates_lifecycle_status_check
    CHECK (lifecycle_status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))
);

CREATE INDEX checklist_templates_name_trgm_idx
  ON maintenance.checklist_templates USING gin (name public.gin_trgm_ops);

CREATE TABLE maintenance.checklist_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  checklist_template_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL DEFAULT 'DRAFT',
  technical_area_id uuid,
  technical_role_id uuid,
  signature_policy text NOT NULL DEFAULT 'QUALIDADE_OU_SEGURANCA',
  required_signatures integer NOT NULL DEFAULT 1 CHECK (required_signatures >= 0),
  segregation_required boolean NOT NULL DEFAULT true,
  manager_guidance text,
  safety_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_hash_sha256 text NOT NULL,
  source_version_id uuid,
  replaces_version_id uuid,
  created_by uuid NOT NULL,
  submitted_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT checklist_template_versions_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT checklist_template_versions_revision_key UNIQUE (tenant_id, checklist_template_id, revision),
  CONSTRAINT checklist_template_versions_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT checklist_template_versions_template_fk
    FOREIGN KEY (tenant_id, checklist_template_id)
    REFERENCES maintenance.checklist_templates(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT checklist_template_versions_area_fk
    FOREIGN KEY (tenant_id, technical_area_id)
    REFERENCES iam.technical_areas(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT checklist_template_versions_role_fk
    FOREIGN KEY (tenant_id, technical_role_id)
    REFERENCES iam.technical_roles(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT checklist_template_versions_source_fk
    FOREIGN KEY (tenant_id, source_version_id)
    REFERENCES maintenance.checklist_template_versions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT checklist_template_versions_replaces_fk
    FOREIGN KEY (tenant_id, replaces_version_id)
    REFERENCES maintenance.checklist_template_versions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT checklist_template_versions_creator_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT checklist_template_versions_status_check
    CHECK (status IN ('DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'PUBLISHED', 'SUPERSEDED', 'REJECTED')),
  CONSTRAINT checklist_template_versions_signature_policy_check
    CHECK (signature_policy IN ('QUALIDADE_OU_SEGURANCA', 'QUALIDADE', 'SEGURANCA', 'QUALIDADE_E_SEGURANCA', 'PERSONALIZADA')),
  CONSTRAINT checklist_template_versions_safety_requirements_array_check
    CHECK (jsonb_typeof(safety_requirements) = 'array')
);

CREATE UNIQUE INDEX checklist_template_versions_one_published
  ON maintenance.checklist_template_versions (tenant_id, checklist_template_id)
  WHERE status = 'PUBLISHED';

CREATE TABLE maintenance.checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  checklist_template_version_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  title text NOT NULL,
  instruction text,
  response_type_code text NOT NULL REFERENCES maintenance.checklist_item_types(code) ON DELETE RESTRICT,
  category text NOT NULL DEFAULT 'OPERACIONAL',
  required boolean NOT NULL DEFAULT true,
  evidence_required boolean NOT NULL DEFAULT false,
  minimum_evidence_photos integer NOT NULL DEFAULT 0 CHECK (minimum_evidence_photos >= 0),
  blocks_completion boolean NOT NULL DEFAULT false,
  reference_storage_object_id uuid,
  parameter_definition_id uuid,
  expected_value text,
  minimum_value numeric,
  maximum_value numeric,
  unit text,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_rule_code text,
  weight numeric(8,3) NOT NULL DEFAULT 1 CHECK (weight >= 0),
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT checklist_items_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT checklist_items_sequence_key UNIQUE (tenant_id, checklist_template_version_id, sequence),
  CONSTRAINT checklist_items_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT checklist_items_version_fk
    FOREIGN KEY (tenant_id, checklist_template_version_id)
    REFERENCES maintenance.checklist_template_versions(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT checklist_items_reference_storage_fk
    FOREIGN KEY (tenant_id, reference_storage_object_id)
    REFERENCES platform.storage_objects(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT checklist_items_parameter_definition_fk
    FOREIGN KEY (tenant_id, parameter_definition_id)
    REFERENCES cmms.parameter_definitions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT checklist_items_range_check
    CHECK (minimum_value IS NULL OR maximum_value IS NULL OR minimum_value <= maximum_value),
  CONSTRAINT checklist_items_options_array_check
    CHECK (jsonb_typeof(options) = 'array'),
  CONSTRAINT checklist_items_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE TABLE maintenance.checklist_model_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  checklist_template_version_id uuid NOT NULL,
  decision text NOT NULL,
  justification text NOT NULL,
  reviewer_id uuid NOT NULL,
  reviewer_role_snapshot text NOT NULL,
  payload_hash_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT checklist_model_reviews_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT checklist_model_reviews_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT checklist_model_reviews_version_fk
    FOREIGN KEY (tenant_id, checklist_template_version_id)
    REFERENCES maintenance.checklist_template_versions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT checklist_model_reviews_reviewer_fk
    FOREIGN KEY (tenant_id, reviewer_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT checklist_model_reviews_decision_check
    CHECK (decision IN ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED'))
);

CREATE TABLE maintenance.checklist_model_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  checklist_template_version_id uuid NOT NULL,
  checklist_item_id uuid,
  event_type text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  user_id uuid,
  role_snapshot text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT checklist_model_audit_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT checklist_model_audit_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT checklist_model_audit_version_fk
    FOREIGN KEY (tenant_id, checklist_template_version_id)
    REFERENCES maintenance.checklist_template_versions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT checklist_model_audit_item_fk
    FOREIGN KEY (tenant_id, checklist_item_id)
    REFERENCES maintenance.checklist_items(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT checklist_model_audit_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE maintenance.maintenance_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  code text NOT NULL,
  name text NOT NULL,
  asset_id uuid NOT NULL,
  component_id uuid,
  plan_type text NOT NULL,
  lifecycle_status text NOT NULL DEFAULT 'ACTIVE',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT maintenance_plans_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT maintenance_plans_code_key UNIQUE (tenant_id, code),
  CONSTRAINT maintenance_plans_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT maintenance_plans_asset_fk
    FOREIGN KEY (tenant_id, asset_id)
    REFERENCES cmms.assets(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT maintenance_plans_component_fk
    FOREIGN KEY (tenant_id, component_id)
    REFERENCES cmms.components(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT maintenance_plans_creator_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT maintenance_plans_type_check
    CHECK (plan_type IN ('PREVENTIVE', 'PREDICTIVE', 'INSPECTION', 'LUBRICATION', 'CORRECTIVE', 'CONDITION_BASED')),
  CONSTRAINT maintenance_plans_lifecycle_status_check
    CHECK (lifecycle_status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))
);

CREATE INDEX maintenance_plans_name_trgm_idx
  ON maintenance.maintenance_plans USING gin (name public.gin_trgm_ops);

CREATE TABLE maintenance.maintenance_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  maintenance_plan_id uuid NOT NULL,
  checklist_template_version_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL DEFAULT 'DRAFT',
  criticality text NOT NULL DEFAULT 'MEDIUM',
  trigger_type text NOT NULL,
  trigger_value numeric,
  trigger_unit text,
  recurrence_days integer,
  estimated_duration_minutes integer,
  lockout_required boolean NOT NULL DEFAULT false,
  evidence_required boolean NOT NULL DEFAULT false,
  maximum_sessions integer,
  maintenance_stop_mode text NOT NULL DEFAULT 'EXECUTOR_DECISION',
  technical_analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
  technical_area_id uuid,
  content_hash_sha256 text NOT NULL,
  source_version_id uuid,
  replaces_version_id uuid,
  created_by uuid NOT NULL,
  submitted_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT maintenance_plan_versions_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT maintenance_plan_versions_revision_key UNIQUE (tenant_id, maintenance_plan_id, revision),
  CONSTRAINT maintenance_plan_versions_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT maintenance_plan_versions_plan_fk
    FOREIGN KEY (tenant_id, maintenance_plan_id)
    REFERENCES maintenance.maintenance_plans(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT maintenance_plan_versions_checklist_fk
    FOREIGN KEY (tenant_id, checklist_template_version_id)
    REFERENCES maintenance.checklist_template_versions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT maintenance_plan_versions_area_fk
    FOREIGN KEY (tenant_id, technical_area_id)
    REFERENCES iam.technical_areas(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT maintenance_plan_versions_source_fk
    FOREIGN KEY (tenant_id, source_version_id)
    REFERENCES maintenance.maintenance_plan_versions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT maintenance_plan_versions_replaces_fk
    FOREIGN KEY (tenant_id, replaces_version_id)
    REFERENCES maintenance.maintenance_plan_versions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT maintenance_plan_versions_creator_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT maintenance_plan_versions_status_check
    CHECK (status IN ('DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'PUBLISHED', 'SUPERSEDED', 'REJECTED')),
  CONSTRAINT maintenance_plan_versions_criticality_check
    CHECK (criticality IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  CONSTRAINT maintenance_plan_versions_trigger_type_check
    CHECK (trigger_type IN ('PERIODICITY', 'HOUR_METER', 'CONDITION', 'MANUAL', 'OCCURRENCE')),
  CONSTRAINT maintenance_plan_versions_recurrence_check
    CHECK (recurrence_days IS NULL OR recurrence_days > 0),
  CONSTRAINT maintenance_plan_versions_duration_check
    CHECK (estimated_duration_minutes IS NULL OR estimated_duration_minutes > 0),
  CONSTRAINT maintenance_plan_versions_sessions_check
    CHECK (maximum_sessions IS NULL OR maximum_sessions > 0),
  CONSTRAINT maintenance_plan_versions_stop_mode_check
    CHECK (maintenance_stop_mode IN ('NO_STOP', 'MANDATORY_STOP', 'EXECUTOR_DECISION')),
  CONSTRAINT maintenance_plan_versions_analysis_object_check
    CHECK (jsonb_typeof(technical_analysis) = 'object')
);

CREATE UNIQUE INDEX maintenance_plan_versions_one_published
  ON maintenance.maintenance_plan_versions (tenant_id, maintenance_plan_id)
  WHERE status = 'PUBLISHED';

CREATE TABLE maintenance.plan_trigger_state (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  maintenance_plan_id uuid NOT NULL,
  maintenance_plan_version_id uuid NOT NULL,
  last_processed_value numeric,
  next_trigger_value numeric,
  last_triggered_at timestamptz,
  last_work_order_id uuid,
  last_work_order_status text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, maintenance_plan_id),
  CONSTRAINT plan_trigger_state_plan_fk
    FOREIGN KEY (tenant_id, maintenance_plan_id)
    REFERENCES maintenance.maintenance_plans(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT plan_trigger_state_version_fk
    FOREIGN KEY (tenant_id, maintenance_plan_version_id)
    REFERENCES maintenance.maintenance_plan_versions(tenant_id, id)
    ON DELETE RESTRICT
);

CREATE TRIGGER checklist_templates_touch_updated_at
BEFORE UPDATE ON maintenance.checklist_templates
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER checklist_items_touch_updated_at
BEFORE UPDATE ON maintenance.checklist_items
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER maintenance_plans_touch_updated_at
BEFORE UPDATE ON maintenance.maintenance_plans
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

COMMIT;
