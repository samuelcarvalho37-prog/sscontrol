BEGIN;

CREATE TABLE maintenance.work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  code text NOT NULL,
  asset_id uuid NOT NULL,
  component_id uuid,
  maintenance_plan_version_id uuid NOT NULL,
  origin_type text NOT NULL,
  origin_entity_id uuid,
  work_type text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  priority text NOT NULL DEFAULT 'MEDIUM',
  status text NOT NULL DEFAULT 'DRAFT',
  requester_id uuid NOT NULL,
  responsible_id uuid,
  maintenance_stop_mode text NOT NULL DEFAULT 'EXECUTOR_DECISION',
  technical_analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
  opened_at timestamptz,
  scheduled_for timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT work_orders_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT work_orders_code_key UNIQUE (tenant_id, code),
  CONSTRAINT work_orders_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT work_orders_asset_fk
    FOREIGN KEY (tenant_id, asset_id)
    REFERENCES cmms.assets(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT work_orders_component_fk
    FOREIGN KEY (tenant_id, component_id)
    REFERENCES cmms.components(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT work_orders_plan_version_fk
    FOREIGN KEY (tenant_id, maintenance_plan_version_id)
    REFERENCES maintenance.maintenance_plan_versions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT work_orders_requester_fk
    FOREIGN KEY (tenant_id, requester_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT work_orders_responsible_fk
    FOREIGN KEY (tenant_id, responsible_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT work_orders_priority_check
    CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  CONSTRAINT work_orders_status_check
    CHECK (status IN ('DRAFT', 'IN_TECHNICAL_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'RELEASED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED', 'QUARANTINED')),
  CONSTRAINT work_orders_stop_mode_check
    CHECK (maintenance_stop_mode IN ('NO_STOP', 'MANDATORY_STOP', 'EXECUTOR_DECISION')),
  CONSTRAINT work_orders_analysis_object_check
    CHECK (jsonb_typeof(technical_analysis) = 'object')
);

CREATE INDEX work_orders_queue_idx
  ON maintenance.work_orders (tenant_id, status, priority, scheduled_for);

CREATE INDEX work_orders_asset_time_idx
  ON maintenance.work_orders (tenant_id, asset_id, created_at DESC);

CREATE INDEX work_orders_title_trgm_idx
  ON maintenance.work_orders USING gin (title public.gin_trgm_ops);

ALTER TABLE maintenance.plan_trigger_state
  ADD CONSTRAINT plan_trigger_state_last_work_order_fk
  FOREIGN KEY (tenant_id, last_work_order_id)
  REFERENCES maintenance.work_orders(tenant_id, id)
  ON DELETE RESTRICT;

CREATE TABLE maintenance.work_order_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  work_order_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  component_id uuid,
  maintenance_plan_version_id uuid NOT NULL,
  origin text NOT NULL,
  action_type text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  priority text NOT NULL DEFAULT 'MEDIUM',
  status text NOT NULL DEFAULT 'PENDING',
  responsible_id uuid,
  maintenance_stop_mode text NOT NULL DEFAULT 'EXECUTOR_DECISION',
  technical_analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT work_order_actions_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT work_order_actions_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT work_order_actions_work_order_fk
    FOREIGN KEY (tenant_id, work_order_id)
    REFERENCES maintenance.work_orders(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT work_order_actions_asset_fk
    FOREIGN KEY (tenant_id, asset_id)
    REFERENCES cmms.assets(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT work_order_actions_component_fk
    FOREIGN KEY (tenant_id, component_id)
    REFERENCES cmms.components(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT work_order_actions_plan_version_fk
    FOREIGN KEY (tenant_id, maintenance_plan_version_id)
    REFERENCES maintenance.maintenance_plan_versions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT work_order_actions_responsible_fk
    FOREIGN KEY (tenant_id, responsible_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT work_order_actions_priority_check
    CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  CONSTRAINT work_order_actions_status_check
    CHECK (status IN ('PENDING', 'READY', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED', 'QUARANTINED')),
  CONSTRAINT work_order_actions_stop_mode_check
    CHECK (maintenance_stop_mode IN ('NO_STOP', 'MANDATORY_STOP', 'EXECUTOR_DECISION')),
  CONSTRAINT work_order_actions_analysis_object_check
    CHECK (jsonb_typeof(technical_analysis) = 'object')
);

CREATE INDEX work_order_actions_operator_queue_idx
  ON maintenance.work_order_actions (tenant_id, status, priority, generated_at)
  WHERE status IN ('PENDING', 'READY', 'IN_PROGRESS', 'BLOCKED');

CREATE TABLE maintenance.executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  work_order_action_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  component_id uuid,
  operator_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  result text,
  observation text,
  duration_seconds bigint,
  execution_stop_mode text,
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT executions_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT executions_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT executions_action_fk
    FOREIGN KEY (tenant_id, work_order_action_id)
    REFERENCES maintenance.work_order_actions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT executions_work_order_fk
    FOREIGN KEY (tenant_id, work_order_id)
    REFERENCES maintenance.work_orders(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT executions_asset_fk
    FOREIGN KEY (tenant_id, asset_id)
    REFERENCES cmms.assets(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT executions_component_fk
    FOREIGN KEY (tenant_id, component_id)
    REFERENCES cmms.components(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT executions_operator_fk
    FOREIGN KEY (tenant_id, operator_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT executions_status_check
    CHECK (status IN ('OPEN', 'IN_PROGRESS', 'PAUSED', 'BLOCKED', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT executions_duration_check
    CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  CONSTRAINT executions_stop_mode_check
    CHECK (execution_stop_mode IS NULL OR execution_stop_mode IN ('NO_STOP', 'STOPPED', 'EXECUTOR_DECISION'))
);

CREATE UNIQUE INDEX executions_one_active_per_action
  ON maintenance.executions (tenant_id, work_order_action_id)
  WHERE status IN ('OPEN', 'IN_PROGRESS', 'PAUSED', 'BLOCKED');

CREATE INDEX executions_operator_status_idx
  ON maintenance.executions (tenant_id, operator_id, status, opened_at DESC);

CREATE TABLE maintenance.execution_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  execution_id uuid NOT NULL,
  work_order_action_id uuid NOT NULL,
  checklist_item_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  title_snapshot text NOT NULL,
  instruction_snapshot text,
  response_type_code text NOT NULL REFERENCES maintenance.checklist_item_types(code) ON DELETE RESTRICT,
  category_snapshot text NOT NULL,
  required boolean NOT NULL,
  evidence_required boolean NOT NULL,
  minimum_evidence_photos integer NOT NULL DEFAULT 0 CHECK (minimum_evidence_photos >= 0),
  blocks_completion boolean NOT NULL,
  parameter_definition_id uuid,
  parameter_policy_id uuid,
  expected_value_snapshot text,
  minimum_value_snapshot numeric,
  maximum_value_snapshot numeric,
  unit_snapshot text,
  options_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_rule_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_text text,
  response_number numeric,
  response_boolean boolean,
  response_option text,
  observation text,
  compliant boolean,
  validation_message text,
  evidence_count integer NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  status text NOT NULL DEFAULT 'PENDING',
  answered_by uuid,
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT execution_checklist_items_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT execution_checklist_items_sequence_key UNIQUE (tenant_id, execution_id, sequence),
  CONSTRAINT execution_checklist_items_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT execution_checklist_items_execution_fk
    FOREIGN KEY (tenant_id, execution_id)
    REFERENCES maintenance.executions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT execution_checklist_items_action_fk
    FOREIGN KEY (tenant_id, work_order_action_id)
    REFERENCES maintenance.work_order_actions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT execution_checklist_items_item_fk
    FOREIGN KEY (tenant_id, checklist_item_id)
    REFERENCES maintenance.checklist_items(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT execution_checklist_items_parameter_definition_fk
    FOREIGN KEY (tenant_id, parameter_definition_id)
    REFERENCES cmms.parameter_definitions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT execution_checklist_items_parameter_policy_fk
    FOREIGN KEY (tenant_id, parameter_policy_id)
    REFERENCES cmms.parameter_policies(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT execution_checklist_items_answered_by_fk
    FOREIGN KEY (tenant_id, answered_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT execution_checklist_items_range_check
    CHECK (minimum_value_snapshot IS NULL OR maximum_value_snapshot IS NULL OR minimum_value_snapshot <= maximum_value_snapshot),
  CONSTRAINT execution_checklist_items_options_array_check
    CHECK (jsonb_typeof(options_snapshot) = 'array'),
  CONSTRAINT execution_checklist_items_rule_object_check
    CHECK (jsonb_typeof(validation_rule_snapshot) = 'object'),
  CONSTRAINT execution_checklist_items_status_check
    CHECK (status IN ('PENDING', 'ANSWERED', 'NONCOMPLIANT', 'BLOCKED', 'NOT_APPLICABLE'))
);

CREATE INDEX execution_checklist_items_execution_status_idx
  ON maintenance.execution_checklist_items (tenant_id, execution_id, status, sequence);

CREATE TABLE maintenance.evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  execution_id uuid NOT NULL,
  work_order_action_id uuid NOT NULL,
  execution_checklist_item_id uuid,
  asset_id uuid NOT NULL,
  component_id uuid,
  evidence_type text NOT NULL,
  storage_object_id uuid NOT NULL,
  observation text,
  user_id uuid NOT NULL,
  captured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT evidence_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT evidence_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT evidence_execution_fk
    FOREIGN KEY (tenant_id, execution_id)
    REFERENCES maintenance.executions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_action_fk
    FOREIGN KEY (tenant_id, work_order_action_id)
    REFERENCES maintenance.work_order_actions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_item_fk
    FOREIGN KEY (tenant_id, execution_checklist_item_id)
    REFERENCES maintenance.execution_checklist_items(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_asset_fk
    FOREIGN KEY (tenant_id, asset_id)
    REFERENCES cmms.assets(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_component_fk
    FOREIGN KEY (tenant_id, component_id)
    REFERENCES cmms.components(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_storage_fk
    FOREIGN KEY (tenant_id, storage_object_id)
    REFERENCES platform.storage_objects(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_type_check
    CHECK (evidence_type IN ('PHOTO', 'VIDEO', 'DOCUMENT', 'AUDIO', 'OTHER'))
);

CREATE INDEX evidence_item_idx
  ON maintenance.evidence (tenant_id, execution_checklist_item_id, created_at);

CREATE TABLE maintenance.material_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  execution_id uuid NOT NULL,
  work_order_action_id uuid NOT NULL,
  material_id uuid NOT NULL,
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  observation text,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT material_usage_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT material_usage_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT material_usage_execution_fk
    FOREIGN KEY (tenant_id, execution_id)
    REFERENCES maintenance.executions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT material_usage_action_fk
    FOREIGN KEY (tenant_id, work_order_action_id)
    REFERENCES maintenance.work_order_actions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT material_usage_material_fk
    FOREIGN KEY (tenant_id, material_id)
    REFERENCES cmms.materials(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT material_usage_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE maintenance.equipment_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  asset_id uuid NOT NULL,
  component_id uuid,
  work_order_id uuid,
  work_order_action_id uuid,
  execution_id uuid,
  origin text NOT NULL,
  stop_type text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  started_at timestamptz NOT NULL,
  started_by uuid NOT NULL,
  maintenance_started_at timestamptz,
  maintenance_completed_at timestamptz,
  completed_at timestamptz,
  completed_by uuid,
  downtime_seconds bigint,
  maintenance_wait_seconds bigint,
  execution_seconds bigint,
  operational_return_seconds bigint,
  reason text NOT NULL,
  return_category text,
  divergence_justification text,
  return_tolerance_minutes integer NOT NULL DEFAULT 10 CHECK (return_tolerance_minutes >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT equipment_stops_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT equipment_stops_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT equipment_stops_asset_fk
    FOREIGN KEY (tenant_id, asset_id)
    REFERENCES cmms.assets(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT equipment_stops_component_fk
    FOREIGN KEY (tenant_id, component_id)
    REFERENCES cmms.components(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT equipment_stops_work_order_fk
    FOREIGN KEY (tenant_id, work_order_id)
    REFERENCES maintenance.work_orders(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT equipment_stops_action_fk
    FOREIGN KEY (tenant_id, work_order_action_id)
    REFERENCES maintenance.work_order_actions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT equipment_stops_execution_fk
    FOREIGN KEY (tenant_id, execution_id)
    REFERENCES maintenance.executions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT equipment_stops_started_by_fk
    FOREIGN KEY (tenant_id, started_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT equipment_stops_completed_by_fk
    FOREIGN KEY (tenant_id, completed_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT equipment_stops_status_check
    CHECK (status IN ('OPEN', 'WAITING_MAINTENANCE', 'IN_MAINTENANCE', 'WAITING_OPERATIONAL_RETURN', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT equipment_stops_duration_check
    CHECK (
      (downtime_seconds IS NULL OR downtime_seconds >= 0)
      AND (maintenance_wait_seconds IS NULL OR maintenance_wait_seconds >= 0)
      AND (execution_seconds IS NULL OR execution_seconds >= 0)
      AND (operational_return_seconds IS NULL OR operational_return_seconds >= 0)
    )
);

CREATE INDEX equipment_stops_open_idx
  ON maintenance.equipment_stops (tenant_id, asset_id, started_at DESC)
  WHERE status NOT IN ('COMPLETED', 'CANCELLED');

CREATE TABLE maintenance.maintenance_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  asset_id uuid NOT NULL,
  component_id uuid,
  work_order_id uuid NOT NULL,
  work_order_action_id uuid NOT NULL,
  execution_id uuid,
  configured_mode text NOT NULL,
  execution_decision text,
  status text NOT NULL DEFAULT 'OPEN',
  equipment_already_stopped boolean NOT NULL DEFAULT false,
  changed_asset_status boolean NOT NULL DEFAULT false,
  started_at timestamptz,
  completed_at timestamptz,
  duration_seconds bigint,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT maintenance_stops_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT maintenance_stops_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT maintenance_stops_asset_fk
    FOREIGN KEY (tenant_id, asset_id)
    REFERENCES cmms.assets(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT maintenance_stops_component_fk
    FOREIGN KEY (tenant_id, component_id)
    REFERENCES cmms.components(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT maintenance_stops_work_order_fk
    FOREIGN KEY (tenant_id, work_order_id)
    REFERENCES maintenance.work_orders(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT maintenance_stops_action_fk
    FOREIGN KEY (tenant_id, work_order_action_id)
    REFERENCES maintenance.work_order_actions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT maintenance_stops_execution_fk
    FOREIGN KEY (tenant_id, execution_id)
    REFERENCES maintenance.executions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT maintenance_stops_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT maintenance_stops_mode_check
    CHECK (configured_mode IN ('NO_STOP', 'MANDATORY_STOP', 'EXECUTOR_DECISION')),
  CONSTRAINT maintenance_stops_status_check
    CHECK (status IN ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT maintenance_stops_duration_check
    CHECK (duration_seconds IS NULL OR duration_seconds >= 0)
);

CREATE TABLE maintenance.operational_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  asset_id uuid NOT NULL,
  component_id uuid,
  occurrence_type text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  severity text NOT NULL DEFAULT 'MEDIUM',
  status text NOT NULL DEFAULT 'OPEN',
  treatment_status text NOT NULL DEFAULT 'UNTRIAGED',
  reported_by uuid NOT NULL,
  reporter_role_snapshot text NOT NULL,
  work_order_id uuid,
  work_order_action_id uuid,
  equipment_stop_id uuid,
  technical_demand_id uuid,
  technical_analysis_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_at timestamptz,
  CONSTRAINT operational_occurrences_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT operational_occurrences_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT operational_occurrences_asset_fk
    FOREIGN KEY (tenant_id, asset_id)
    REFERENCES cmms.assets(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT operational_occurrences_component_fk
    FOREIGN KEY (tenant_id, component_id)
    REFERENCES cmms.components(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT operational_occurrences_reported_by_fk
    FOREIGN KEY (tenant_id, reported_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT operational_occurrences_work_order_fk
    FOREIGN KEY (tenant_id, work_order_id)
    REFERENCES maintenance.work_orders(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT operational_occurrences_action_fk
    FOREIGN KEY (tenant_id, work_order_action_id)
    REFERENCES maintenance.work_order_actions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT operational_occurrences_equipment_stop_fk
    FOREIGN KEY (tenant_id, equipment_stop_id)
    REFERENCES maintenance.equipment_stops(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT operational_occurrences_severity_check
    CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  CONSTRAINT operational_occurrences_status_check
    CHECK (status IN ('OPEN', 'IN_TREATMENT', 'RESOLVED', 'CLOSED', 'CANCELLED')),
  CONSTRAINT operational_occurrences_treatment_status_check
    CHECK (treatment_status IN ('UNTRIAGED', 'UNDER_ANALYSIS', 'DEMAND_CREATED', 'CHECKLIST_REQUESTED', 'WORK_ORDER_CREATED', 'IN_EXECUTION', 'RESOLVED'))
);

CREATE INDEX operational_occurrences_queue_idx
  ON maintenance.operational_occurrences (tenant_id, status, severity, created_at DESC);

CREATE TABLE maintenance.operational_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  asset_id uuid NOT NULL,
  component_id uuid,
  parameter_reading_id uuid,
  occurrence_id uuid,
  equipment_stop_id uuid,
  alert_type text NOT NULL,
  severity text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  deduplication_key text NOT NULL,
  first_detected_at timestamptz NOT NULL,
  last_detected_at timestamptz NOT NULL,
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  resolved_by uuid,
  resolved_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT operational_alerts_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT operational_alerts_asset_fk
    FOREIGN KEY (tenant_id, asset_id)
    REFERENCES cmms.assets(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT operational_alerts_component_fk
    FOREIGN KEY (tenant_id, component_id)
    REFERENCES cmms.components(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT operational_alerts_reading_fk
    FOREIGN KEY (tenant_id, parameter_reading_id)
    REFERENCES cmms.parameter_readings(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT operational_alerts_occurrence_fk
    FOREIGN KEY (tenant_id, occurrence_id)
    REFERENCES maintenance.operational_occurrences(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT operational_alerts_stop_fk
    FOREIGN KEY (tenant_id, equipment_stop_id)
    REFERENCES maintenance.equipment_stops(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT operational_alerts_acknowledged_by_fk
    FOREIGN KEY (tenant_id, acknowledged_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT operational_alerts_resolved_by_fk
    FOREIGN KEY (tenant_id, resolved_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT operational_alerts_severity_check
    CHECK (severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  CONSTRAINT operational_alerts_status_check
    CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'IN_TREATMENT', 'RESOLVED', 'DISMISSED')),
  CONSTRAINT operational_alerts_detection_period_check
    CHECK (last_detected_at >= first_detected_at),
  CONSTRAINT operational_alerts_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX operational_alerts_open_deduplication_key
  ON maintenance.operational_alerts (tenant_id, deduplication_key)
  WHERE status IN ('OPEN', 'ACKNOWLEDGED', 'IN_TREATMENT');

CREATE INDEX operational_alerts_queue_idx
  ON maintenance.operational_alerts (tenant_id, status, severity, last_detected_at DESC);

CREATE TABLE maintenance.history_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  asset_id uuid NOT NULL,
  component_id uuid,
  work_order_id uuid,
  work_order_action_id uuid,
  execution_id uuid,
  event_type text NOT NULL,
  description text NOT NULL,
  user_id uuid,
  role_snapshot text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT history_events_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT history_events_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT history_events_asset_fk
    FOREIGN KEY (tenant_id, asset_id)
    REFERENCES cmms.assets(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT history_events_component_fk
    FOREIGN KEY (tenant_id, component_id)
    REFERENCES cmms.components(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT history_events_work_order_fk
    FOREIGN KEY (tenant_id, work_order_id)
    REFERENCES maintenance.work_orders(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT history_events_action_fk
    FOREIGN KEY (tenant_id, work_order_action_id)
    REFERENCES maintenance.work_order_actions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT history_events_execution_fk
    FOREIGN KEY (tenant_id, execution_id)
    REFERENCES maintenance.executions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT history_events_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT history_events_payload_object_check
    CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX history_events_asset_time_idx
  ON maintenance.history_events (tenant_id, asset_id, occurred_at DESC);

CREATE INDEX history_events_occurred_brin_idx
  ON maintenance.history_events USING brin (occurred_at);

CREATE TABLE maintenance.execution_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  asset_id uuid NOT NULL,
  work_order_action_id uuid NOT NULL,
  user_id uuid NOT NULL,
  session_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ACQUIRED',
  acquired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  heartbeat_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  release_reason text,
  user_agent text,
  CONSTRAINT execution_locks_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT execution_locks_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT execution_locks_asset_fk
    FOREIGN KEY (tenant_id, asset_id)
    REFERENCES cmms.assets(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT execution_locks_action_fk
    FOREIGN KEY (tenant_id, work_order_action_id)
    REFERENCES maintenance.work_order_actions(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT execution_locks_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT execution_locks_session_fk
    FOREIGN KEY (tenant_id, session_id)
    REFERENCES iam.sessions(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT execution_locks_status_check
    CHECK (status IN ('ACQUIRED', 'RELEASED', 'EXPIRED')),
  CONSTRAINT execution_locks_expiry_check
    CHECK (expires_at > acquired_at)
);

CREATE UNIQUE INDEX execution_locks_one_active_per_action
  ON maintenance.execution_locks (tenant_id, work_order_action_id)
  WHERE status = 'ACQUIRED';

CREATE TABLE maintenance.telemetry_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  asset_id uuid,
  work_order_action_id uuid,
  event_type text NOT NULL,
  visibility text,
  delta_seconds integer NOT NULL DEFAULT 0,
  total_seconds integer NOT NULL DEFAULT 0,
  visible_seconds integer NOT NULL DEFAULT 0,
  hidden_seconds integer NOT NULL DEFAULT 0,
  user_agent text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT telemetry_sessions_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT telemetry_sessions_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT telemetry_sessions_session_fk
    FOREIGN KEY (tenant_id, session_id)
    REFERENCES iam.sessions(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT telemetry_sessions_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT telemetry_sessions_asset_fk
    FOREIGN KEY (tenant_id, asset_id)
    REFERENCES cmms.assets(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT telemetry_sessions_action_fk
    FOREIGN KEY (tenant_id, work_order_action_id)
    REFERENCES maintenance.work_order_actions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT telemetry_sessions_durations_check
    CHECK (delta_seconds >= 0 AND total_seconds >= 0 AND visible_seconds >= 0 AND hidden_seconds >= 0)
);

CREATE INDEX telemetry_sessions_occurred_brin_idx
  ON maintenance.telemetry_sessions USING brin (occurred_at);

CREATE TABLE maintenance.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  plant_id uuid NOT NULL,
  sector_id uuid,
  line_id uuid,
  name text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  weekdays smallint[] NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT shifts_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT shifts_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT shifts_plant_fk
    FOREIGN KEY (tenant_id, plant_id)
    REFERENCES cmms.plants(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT shifts_sector_fk
    FOREIGN KEY (tenant_id, sector_id)
    REFERENCES cmms.sectors(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT shifts_line_fk
    FOREIGN KEY (tenant_id, line_id)
    REFERENCES cmms.lines(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT shifts_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT shifts_weekdays_check
    CHECK (weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[] AND cardinality(weekdays) > 0)
);

CREATE TABLE maintenance.production_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  shift_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  planned_seconds bigint NOT NULL,
  operating_seconds bigint NOT NULL,
  ideal_cycle_seconds numeric(18,6),
  total_quantity numeric(18,4),
  good_quantity numeric(18,4),
  rejected_quantity numeric(18,4),
  source text NOT NULL,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT production_entries_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT production_entries_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT production_entries_shift_fk
    FOREIGN KEY (tenant_id, shift_id)
    REFERENCES maintenance.shifts(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT production_entries_asset_fk
    FOREIGN KEY (tenant_id, asset_id)
    REFERENCES cmms.assets(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT production_entries_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT production_entries_period_check
    CHECK (ended_at > started_at),
  CONSTRAINT production_entries_duration_check
    CHECK (planned_seconds >= 0 AND operating_seconds >= 0 AND operating_seconds <= planned_seconds),
  CONSTRAINT production_entries_quantity_check
    CHECK (
      (total_quantity IS NULL OR total_quantity >= 0)
      AND (good_quantity IS NULL OR good_quantity >= 0)
      AND (rejected_quantity IS NULL OR rejected_quantity >= 0)
    )
);

CREATE INDEX production_entries_asset_time_idx
  ON maintenance.production_entries (tenant_id, asset_id, started_at DESC);

CREATE INDEX production_entries_started_brin_idx
  ON maintenance.production_entries USING brin (started_at);

CREATE TRIGGER work_orders_touch_updated_at
BEFORE UPDATE ON maintenance.work_orders
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER work_order_actions_touch_updated_at
BEFORE UPDATE ON maintenance.work_order_actions
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER executions_touch_updated_at
BEFORE UPDATE ON maintenance.executions
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER execution_checklist_items_touch_updated_at
BEFORE UPDATE ON maintenance.execution_checklist_items
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER equipment_stops_touch_updated_at
BEFORE UPDATE ON maintenance.equipment_stops
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER maintenance_stops_touch_updated_at
BEFORE UPDATE ON maintenance.maintenance_stops
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER operational_occurrences_touch_updated_at
BEFORE UPDATE ON maintenance.operational_occurrences
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER operational_alerts_touch_updated_at
BEFORE UPDATE ON maintenance.operational_alerts
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER shifts_touch_updated_at
BEFORE UPDATE ON maintenance.shifts
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER production_entries_touch_updated_at
BEFORE UPDATE ON maintenance.production_entries
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

COMMIT;
