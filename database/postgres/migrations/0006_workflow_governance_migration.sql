BEGIN;

CREATE TABLE workflow.service_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT service_calendars_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT service_calendars_code_key UNIQUE (tenant_id, code),
  CONSTRAINT service_calendars_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE TABLE workflow.service_calendar_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  service_calendar_id uuid NOT NULL,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT service_calendar_windows_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT service_calendar_windows_slot_key UNIQUE (tenant_id, service_calendar_id, weekday, starts_at, ends_at),
  CONSTRAINT service_calendar_windows_calendar_fk
    FOREIGN KEY (tenant_id, service_calendar_id)
    REFERENCES workflow.service_calendars(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT service_calendar_windows_period_check
    CHECK (ends_at > starts_at)
);

CREATE TABLE workflow.service_calendar_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  service_calendar_id uuid NOT NULL,
  holiday_date date NOT NULL,
  name text NOT NULL,
  working boolean NOT NULL DEFAULT false,
  starts_at time,
  ends_at time,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT service_calendar_holidays_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT service_calendar_holidays_date_key UNIQUE (tenant_id, service_calendar_id, holiday_date),
  CONSTRAINT service_calendar_holidays_calendar_fk
    FOREIGN KEY (tenant_id, service_calendar_id)
    REFERENCES workflow.service_calendars(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT service_calendar_holidays_work_window_check
    CHECK (
      (NOT working AND starts_at IS NULL AND ends_at IS NULL)
      OR (working AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at)
    )
);

CREATE TABLE workflow.sla_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  demand_type text NOT NULL,
  priority text NOT NULL,
  technical_area_id uuid,
  first_response_minutes integer NOT NULL CHECK (first_response_minutes > 0),
  resolution_minutes integer NOT NULL CHECK (resolution_minutes > 0),
  service_calendar_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sla_policies_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT sla_policies_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT sla_policies_scope_key UNIQUE (tenant_id, demand_type, priority, technical_area_id),
  CONSTRAINT sla_policies_area_fk
    FOREIGN KEY (tenant_id, technical_area_id)
    REFERENCES iam.technical_areas(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT sla_policies_calendar_fk
    FOREIGN KEY (tenant_id, service_calendar_id)
    REFERENCES workflow.service_calendars(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT sla_policies_priority_check
    CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  CONSTRAINT sla_policies_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE TABLE workflow.technical_demands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  demand_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  origin_type text NOT NULL,
  origin_id uuid,
  title text NOT NULL,
  description text NOT NULL,
  priority text NOT NULL DEFAULT 'MEDIUM',
  status text NOT NULL DEFAULT 'OPEN',
  origin_area_id uuid,
  current_area_id uuid,
  current_technical_role_id uuid,
  current_responsible_id uuid,
  created_by uuid NOT NULL,
  creator_role_snapshot text NOT NULL,
  signature_required boolean NOT NULL DEFAULT false,
  required_signature_count integer NOT NULL DEFAULT 0 CHECK (required_signature_count >= 0),
  completed_signature_count integer NOT NULL DEFAULT 0 CHECK (completed_signature_count >= 0),
  segregation_required boolean NOT NULL DEFAULT true,
  signature_policy text NOT NULL DEFAULT 'QUALIDADE_OU_SEGURANCA',
  first_response_due_at timestamptz,
  resolution_due_at timestamptz,
  first_attended_at timestamptz,
  completed_at timestamptz,
  entity_version integer NOT NULL DEFAULT 1 CHECK (entity_version > 0),
  payload_hash_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT technical_demands_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT technical_demands_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT technical_demands_origin_area_fk
    FOREIGN KEY (tenant_id, origin_area_id)
    REFERENCES iam.technical_areas(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT technical_demands_current_area_fk
    FOREIGN KEY (tenant_id, current_area_id)
    REFERENCES iam.technical_areas(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT technical_demands_current_role_fk
    FOREIGN KEY (tenant_id, current_technical_role_id)
    REFERENCES iam.technical_roles(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT technical_demands_current_responsible_fk
    FOREIGN KEY (tenant_id, current_responsible_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT technical_demands_created_by_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT technical_demands_priority_check
    CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  CONSTRAINT technical_demands_status_check
    CHECK (status IN ('OPEN', 'TRIAGE', 'IN_TECHNICAL_REVIEW', 'AWAITING_SIGNATURE', 'FORWARDED', 'CHANGES_REQUESTED', 'TECHNICALLY_APPROVED', 'RELEASED_TO_OPERATION', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT technical_demands_signature_policy_check
    CHECK (signature_policy IN ('QUALIDADE_OU_SEGURANCA', 'QUALIDADE', 'SEGURANCA', 'QUALIDADE_E_SEGURANCA', 'PERSONALIZADA')),
  CONSTRAINT technical_demands_signature_counts_check
    CHECK (completed_signature_count <= required_signature_count)
);

CREATE INDEX technical_demands_queue_idx
  ON workflow.technical_demands (tenant_id, current_area_id, status, priority, created_at);

CREATE INDEX technical_demands_entity_idx
  ON workflow.technical_demands (tenant_id, entity_type, entity_id, entity_version);

CREATE INDEX technical_demands_title_trgm_idx
  ON workflow.technical_demands USING gin (title public.gin_trgm_ops);

CREATE TABLE workflow.demand_validator_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  technical_demand_id uuid NOT NULL,
  requirement_code text NOT NULL,
  technical_area_id uuid,
  technical_role_id uuid,
  user_id uuid,
  required_count integer NOT NULL DEFAULT 1 CHECK (required_count > 0),
  fulfilled_count integer NOT NULL DEFAULT 0 CHECK (fulfilled_count >= 0),
  status text NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  fulfilled_at timestamptz,
  CONSTRAINT demand_validator_requirements_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT demand_validator_requirements_code_key UNIQUE (tenant_id, technical_demand_id, requirement_code),
  CONSTRAINT demand_validator_requirements_demand_fk
    FOREIGN KEY (tenant_id, technical_demand_id)
    REFERENCES workflow.technical_demands(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT demand_validator_requirements_area_fk
    FOREIGN KEY (tenant_id, technical_area_id)
    REFERENCES iam.technical_areas(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT demand_validator_requirements_role_fk
    FOREIGN KEY (tenant_id, technical_role_id)
    REFERENCES iam.technical_roles(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT demand_validator_requirements_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT demand_validator_requirements_target_check
    CHECK (num_nonnulls(technical_area_id, technical_role_id, user_id) = 1),
  CONSTRAINT demand_validator_requirements_count_check
    CHECK (fulfilled_count <= required_count),
  CONSTRAINT demand_validator_requirements_status_check
    CHECK (status IN ('PENDING', 'PARTIALLY_FULFILLED', 'FULFILLED', 'WAIVED', 'CANCELLED'))
);

CREATE TABLE workflow.demand_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  technical_demand_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  action text NOT NULL,
  from_area_id uuid,
  from_technical_role_id uuid,
  from_user_id uuid,
  to_area_id uuid,
  to_technical_role_id uuid,
  to_user_id uuid,
  decision text,
  opinion text,
  reason text,
  payload_hash_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT demand_events_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT demand_events_sequence_key UNIQUE (tenant_id, technical_demand_id, sequence),
  CONSTRAINT demand_events_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT demand_events_demand_fk
    FOREIGN KEY (tenant_id, technical_demand_id)
    REFERENCES workflow.technical_demands(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT demand_events_from_area_fk
    FOREIGN KEY (tenant_id, from_area_id)
    REFERENCES iam.technical_areas(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT demand_events_from_role_fk
    FOREIGN KEY (tenant_id, from_technical_role_id)
    REFERENCES iam.technical_roles(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT demand_events_from_user_fk
    FOREIGN KEY (tenant_id, from_user_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT demand_events_to_area_fk
    FOREIGN KEY (tenant_id, to_area_id)
    REFERENCES iam.technical_areas(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT demand_events_to_role_fk
    FOREIGN KEY (tenant_id, to_technical_role_id)
    REFERENCES iam.technical_roles(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT demand_events_to_user_fk
    FOREIGN KEY (tenant_id, to_user_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE workflow.technical_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  technical_demand_id uuid NOT NULL,
  validator_requirement_id uuid,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  entity_version integer NOT NULL CHECK (entity_version > 0),
  user_id uuid NOT NULL,
  role_snapshot text NOT NULL,
  technical_area_id uuid NOT NULL,
  technical_role_id uuid,
  meaning text NOT NULL,
  declaration text NOT NULL,
  payload_hash_sha256 text NOT NULL,
  signature_hash_sha256 text NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT technical_signatures_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT technical_signatures_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT technical_signatures_identity_key
    UNIQUE (tenant_id, entity_type, entity_id, entity_version, user_id, payload_hash_sha256),
  CONSTRAINT technical_signatures_hash_key UNIQUE (tenant_id, signature_hash_sha256),
  CONSTRAINT technical_signatures_demand_fk
    FOREIGN KEY (tenant_id, technical_demand_id)
    REFERENCES workflow.technical_demands(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT technical_signatures_requirement_fk
    FOREIGN KEY (tenant_id, validator_requirement_id)
    REFERENCES workflow.demand_validator_requirements(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT technical_signatures_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT technical_signatures_area_fk
    FOREIGN KEY (tenant_id, technical_area_id)
    REFERENCES iam.technical_areas(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT technical_signatures_role_fk
    FOREIGN KEY (tenant_id, technical_role_id)
    REFERENCES iam.technical_roles(tenant_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX technical_signatures_demand_idx
  ON workflow.technical_signatures (tenant_id, technical_demand_id, signed_at);

CREATE TABLE workflow.technical_signature_revocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  technical_signature_id uuid NOT NULL,
  reason text NOT NULL,
  revoked_by uuid NOT NULL,
  payload_hash_sha256 text NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT technical_signature_revocations_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT technical_signature_revocations_signature_key UNIQUE (tenant_id, technical_signature_id),
  CONSTRAINT technical_signature_revocations_signature_fk
    FOREIGN KEY (tenant_id, technical_signature_id)
    REFERENCES workflow.technical_signatures(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT technical_signature_revocations_revoked_by_fk
    FOREIGN KEY (tenant_id, revoked_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE workflow.technical_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  technical_demand_id uuid,
  occurrence_id uuid,
  asset_id uuid NOT NULL,
  component_id uuid,
  author_id uuid NOT NULL,
  technical_area_id uuid NOT NULL,
  technical_role_id uuid,
  title text NOT NULL,
  diagnosis text NOT NULL,
  risk text NOT NULL,
  probable_cause text,
  recommendation text NOT NULL,
  recommends_checklist boolean NOT NULL DEFAULT false,
  recommends_work_order boolean NOT NULL DEFAULT false,
  priority text NOT NULL DEFAULT 'MEDIUM',
  status text NOT NULL DEFAULT 'DRAFT',
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_to_admin_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT technical_analyses_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT technical_analyses_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT technical_analyses_demand_fk
    FOREIGN KEY (tenant_id, technical_demand_id)
    REFERENCES workflow.technical_demands(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT technical_analyses_occurrence_fk
    FOREIGN KEY (tenant_id, occurrence_id)
    REFERENCES maintenance.operational_occurrences(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT technical_analyses_asset_fk
    FOREIGN KEY (tenant_id, asset_id)
    REFERENCES cmms.assets(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT technical_analyses_component_fk
    FOREIGN KEY (tenant_id, component_id)
    REFERENCES cmms.components(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT technical_analyses_author_fk
    FOREIGN KEY (tenant_id, author_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT technical_analyses_area_fk
    FOREIGN KEY (tenant_id, technical_area_id)
    REFERENCES iam.technical_areas(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT technical_analyses_role_fk
    FOREIGN KEY (tenant_id, technical_role_id)
    REFERENCES iam.technical_roles(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT technical_analyses_priority_check
    CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  CONSTRAINT technical_analyses_status_check
    CHECK (status IN ('DRAFT', 'SENT_TO_ADMIN', 'ACCEPTED', 'SUPERSEDED', 'ARCHIVED')),
  CONSTRAINT technical_analyses_report_object_check
    CHECK (jsonb_typeof(report) = 'object')
);

ALTER TABLE maintenance.operational_occurrences
  ADD CONSTRAINT operational_occurrences_technical_demand_fk
  FOREIGN KEY (tenant_id, technical_demand_id)
  REFERENCES workflow.technical_demands(tenant_id, id)
  ON DELETE RESTRICT;

ALTER TABLE maintenance.operational_occurrences
  ADD CONSTRAINT operational_occurrences_technical_analysis_fk
  FOREIGN KEY (tenant_id, technical_analysis_id)
  REFERENCES workflow.technical_analyses(tenant_id, id)
  ON DELETE RESTRICT;

CREATE TABLE workflow.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  notification_type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  entity_type text,
  entity_id uuid,
  priority text NOT NULL DEFAULT 'MEDIUM',
  status text NOT NULL DEFAULT 'ACTIVE',
  action_route text,
  action_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  audience jsonb NOT NULL DEFAULT '{}'::jsonb,
  deduplication_key text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT notifications_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT notifications_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT notifications_priority_check
    CHECK (priority IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  CONSTRAINT notifications_status_check
    CHECK (status IN ('ACTIVE', 'EXPIRED', 'RETRACTED')),
  CONSTRAINT notifications_action_payload_object_check
    CHECK (jsonb_typeof(action_payload) = 'object'),
  CONSTRAINT notifications_audience_object_check
    CHECK (jsonb_typeof(audience) = 'object')
);

CREATE UNIQUE INDEX notifications_active_deduplication_key
  ON workflow.notifications (tenant_id, deduplication_key)
  WHERE deduplication_key IS NOT NULL AND status = 'ACTIVE';

CREATE TABLE workflow.notification_recipients (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  notification_id uuid NOT NULL,
  user_id uuid NOT NULL,
  delivery_status text NOT NULL DEFAULT 'PENDING',
  delivered_at timestamptz,
  read_at timestamptz,
  dismissed_at timestamptz,
  last_notified_at timestamptz,
  delivery_attempts integer NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, notification_id, user_id),
  CONSTRAINT notification_recipients_notification_fk
    FOREIGN KEY (tenant_id, notification_id)
    REFERENCES workflow.notifications(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT notification_recipients_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT notification_recipients_delivery_status_check
    CHECK (delivery_status IN ('PENDING', 'DELIVERED', 'FAILED', 'SUPPRESSED'))
);

CREATE INDEX notification_recipients_unread_idx
  ON workflow.notification_recipients (tenant_id, user_id, created_at DESC)
  WHERE read_at IS NULL AND dismissed_at IS NULL;

CREATE TABLE governance.technical_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  code text NOT NULL,
  title text NOT NULL,
  document_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  status text NOT NULL DEFAULT 'DRAFT',
  current_revision integer NOT NULL DEFAULT 1 CHECK (current_revision > 0),
  valid_until date,
  responsible_id uuid,
  description text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT technical_documents_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT technical_documents_code_key UNIQUE (tenant_id, code),
  CONSTRAINT technical_documents_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT technical_documents_responsible_fk
    FOREIGN KEY (tenant_id, responsible_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT technical_documents_created_by_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT technical_documents_status_check
    CHECK (status IN ('DRAFT', 'IN_REVIEW', 'ACTIVE', 'EXPIRED', 'SUPERSEDED', 'ARCHIVED'))
);

CREATE INDEX technical_documents_title_trgm_idx
  ON governance.technical_documents USING gin (title public.gin_trgm_ops);

CREATE TABLE governance.document_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  technical_document_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  storage_object_id uuid NOT NULL,
  observation text,
  content_hash_sha256 text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT document_revisions_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT document_revisions_revision_key UNIQUE (tenant_id, technical_document_id, revision),
  CONSTRAINT document_revisions_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT document_revisions_document_fk
    FOREIGN KEY (tenant_id, technical_document_id)
    REFERENCES governance.technical_documents(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT document_revisions_storage_fk
    FOREIGN KEY (tenant_id, storage_object_id)
    REFERENCES platform.storage_objects(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT document_revisions_created_by_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE governance.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  import_type text NOT NULL,
  entity_type text NOT NULL,
  source_file_name text NOT NULL,
  source_sheet_name text,
  source_storage_object_id uuid,
  status text NOT NULL DEFAULT 'UPLOADED',
  total_rows integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  valid_rows integer NOT NULL DEFAULT 0 CHECK (valid_rows >= 0),
  invalid_rows integer NOT NULL DEFAULT 0 CHECK (invalid_rows >= 0),
  validation_hash_sha256 text,
  headers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ignored_headers jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  confirmed_by uuid,
  rolled_back_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  confirmed_at timestamptz,
  rolled_back_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT import_batches_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT import_batches_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT import_batches_storage_fk
    FOREIGN KEY (tenant_id, source_storage_object_id)
    REFERENCES platform.storage_objects(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT import_batches_created_by_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT import_batches_confirmed_by_fk
    FOREIGN KEY (tenant_id, confirmed_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT import_batches_rolled_back_by_fk
    FOREIGN KEY (tenant_id, rolled_back_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT import_batches_status_check
    CHECK (status IN ('UPLOADED', 'VALIDATING', 'VALIDATED', 'REJECTED', 'CONFIRMED', 'ROLLING_BACK', 'ROLLED_BACK', 'FAILED')),
  CONSTRAINT import_batches_row_totals_check
    CHECK (valid_rows + invalid_rows <= total_rows),
  CONSTRAINT import_batches_headers_array_check
    CHECK (jsonb_typeof(headers) = 'array' AND jsonb_typeof(ignored_headers) = 'array'),
  CONSTRAINT import_batches_result_object_check
    CHECK (jsonb_typeof(result) = 'object')
);

CREATE TABLE governance.import_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  import_batch_id uuid NOT NULL,
  source_row_number integer NOT NULL CHECK (source_row_number > 0),
  entity_type text NOT NULL,
  entity_id uuid,
  operation text,
  status text NOT NULL DEFAULT 'PENDING',
  raw_data jsonb NOT NULL,
  normalized_data jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  before_data jsonb,
  after_data jsonb,
  applied_at timestamptz,
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT import_records_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT import_records_row_key UNIQUE (tenant_id, import_batch_id, source_row_number),
  CONSTRAINT import_records_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT import_records_batch_fk
    FOREIGN KEY (tenant_id, import_batch_id)
    REFERENCES governance.import_batches(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT import_records_status_check
    CHECK (status IN ('PENDING', 'VALID', 'INVALID', 'APPLIED', 'SKIPPED', 'ROLLED_BACK', 'FAILED')),
  CONSTRAINT import_records_raw_object_check
    CHECK (jsonb_typeof(raw_data) = 'object'),
  CONSTRAINT import_records_errors_array_check
    CHECK (jsonb_typeof(errors) = 'array')
);

CREATE TABLE governance.backup_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  backup_type text NOT NULL,
  status text NOT NULL DEFAULT 'REQUESTED',
  reason text NOT NULL,
  storage_object_id uuid,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  checksum_sha256 text,
  requested_by uuid NOT NULL,
  confirmed_by uuid,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  verified_at timestamptz,
  CONSTRAINT backup_snapshots_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT backup_snapshots_storage_fk
    FOREIGN KEY (tenant_id, storage_object_id)
    REFERENCES platform.storage_objects(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT backup_snapshots_requested_by_fk
    FOREIGN KEY (tenant_id, requested_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT backup_snapshots_confirmed_by_fk
    FOREIGN KEY (tenant_id, confirmed_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT backup_snapshots_status_check
    CHECK (status IN ('REQUESTED', 'RUNNING', 'COMPLETED', 'VERIFIED', 'FAILED')),
  CONSTRAINT backup_snapshots_manifest_object_check
    CHECK (jsonb_typeof(manifest) = 'object')
);

CREATE TABLE governance.legacy_quarantine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  source_name text NOT NULL,
  source_row text,
  reason_code text NOT NULL,
  reason_detail text NOT NULL,
  payload jsonb NOT NULL,
  migration_run_id uuid,
  quarantined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  CONSTRAINT legacy_quarantine_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legacy_quarantine_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT legacy_quarantine_payload_object_check
    CHECK (jsonb_typeof(payload) = 'object')
);

CREATE TABLE audit.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  user_id uuid,
  role_snapshot text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  redacted_fields text[] NOT NULL DEFAULT '{}',
  trace_id text,
  source text NOT NULL DEFAULT 'APPLICATION',
  user_agent text,
  ip_address inet,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT audit_events_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT audit_events_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT audit_events_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT audit_events_source_check
    CHECK (source IN ('APPLICATION', 'MIGRATION', 'DATABASE', 'ADMINISTRATIVE'))
);

CREATE INDEX audit_events_entity_idx
  ON audit.events (tenant_id, entity_type, entity_id, occurred_at DESC);

CREATE INDEX audit_events_occurred_brin_idx
  ON audit.events USING brin (occurred_at);

CREATE TABLE migration.runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  environment text NOT NULL,
  source_release text NOT NULL,
  target_schema_version text NOT NULL,
  source_snapshot_hash_sha256 text NOT NULL,
  mode text NOT NULL DEFAULT 'DRY_RUN',
  status text NOT NULL DEFAULT 'CREATED',
  started_at timestamptz,
  completed_at timestamptz,
  initiated_by text NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT migration_runs_environment_check
    CHECK (environment IN ('DEVELOPMENT', 'HOMOLOGATION', 'PRODUCTION')),
  CONSTRAINT migration_runs_mode_check
    CHECK (mode IN ('DRY_RUN', 'FULL', 'DELTA', 'RECONCILIATION_ONLY')),
  CONSTRAINT migration_runs_status_check
    CHECK (status IN ('CREATED', 'RUNNING', 'VALIDATING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  CONSTRAINT migration_runs_summary_object_check
    CHECK (jsonb_typeof(summary) = 'object')
);

CREATE TABLE migration.source_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_run_id uuid NOT NULL REFERENCES migration.runs(id) ON DELETE CASCADE,
  source_kind text NOT NULL,
  source_name text NOT NULL,
  source_identifier text,
  row_count bigint NOT NULL CHECK (row_count >= 0),
  header_hash_sha256 text,
  content_hash_sha256 text NOT NULL,
  captured_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT source_snapshots_source_key UNIQUE (migration_run_id, source_kind, source_name),
  CONSTRAINT source_snapshots_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE migration.legacy_id_map (
  migration_run_id uuid NOT NULL REFERENCES migration.runs(id) ON DELETE CASCADE,
  source_name text NOT NULL,
  legacy_id text NOT NULL,
  target_schema text NOT NULL,
  target_table text NOT NULL,
  target_id uuid NOT NULL,
  source_hash_sha256 text NOT NULL,
  migrated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (migration_run_id, source_name, legacy_id),
  CONSTRAINT legacy_id_map_target_key UNIQUE (migration_run_id, target_schema, target_table, target_id)
);

CREATE TABLE migration.row_results (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  migration_run_id uuid NOT NULL REFERENCES migration.runs(id) ON DELETE CASCADE,
  source_name text NOT NULL,
  source_row_number bigint NOT NULL CHECK (source_row_number > 0),
  legacy_id text,
  status text NOT NULL,
  target_schema text,
  target_table text,
  target_id uuid,
  source_hash_sha256 text NOT NULL,
  error_code text,
  error_detail text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT row_results_source_row_key UNIQUE (migration_run_id, source_name, source_row_number),
  CONSTRAINT row_results_status_check
    CHECK (status IN ('MIGRATED', 'UNCHANGED', 'QUARANTINED', 'FAILED', 'SKIPPED'))
);

CREATE INDEX row_results_status_idx
  ON migration.row_results (migration_run_id, source_name, status);

CREATE TABLE migration.reconciliation_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_run_id uuid NOT NULL REFERENCES migration.runs(id) ON DELETE CASCADE,
  check_code text NOT NULL,
  entity_name text NOT NULL,
  source_value text,
  target_value text,
  passed boolean NOT NULL,
  severity text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT reconciliation_checks_code_key UNIQUE (migration_run_id, check_code, entity_name),
  CONSTRAINT reconciliation_checks_severity_check
    CHECK (severity IN ('INFO', 'WARNING', 'ERROR', 'BLOCKER')),
  CONSTRAINT reconciliation_checks_detail_object_check
    CHECK (jsonb_typeof(detail) = 'object')
);

ALTER TABLE governance.legacy_quarantine
  ADD CONSTRAINT legacy_quarantine_migration_run_fk
  FOREIGN KEY (migration_run_id)
  REFERENCES migration.runs(id)
  ON DELETE RESTRICT;

CREATE TRIGGER service_calendars_touch_updated_at
BEFORE UPDATE ON workflow.service_calendars
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER sla_policies_touch_updated_at
BEFORE UPDATE ON workflow.sla_policies
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER technical_demands_touch_updated_at
BEFORE UPDATE ON workflow.technical_demands
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER technical_analyses_touch_updated_at
BEFORE UPDATE ON workflow.technical_analyses
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER technical_documents_touch_updated_at
BEFORE UPDATE ON governance.technical_documents
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER import_batches_touch_updated_at
BEFORE UPDATE ON governance.import_batches
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER import_records_touch_updated_at
BEFORE UPDATE ON governance.import_records
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

COMMIT;
