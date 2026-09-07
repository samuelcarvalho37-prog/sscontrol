BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS cmms;
CREATE SCHEMA IF NOT EXISTS maintenance;
CREATE SCHEMA IF NOT EXISTS workflow;
CREATE SCHEMA IF NOT EXISTS governance;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS migration;

CREATE TABLE IF NOT EXISTS platform.schema_migrations (
  version text PRIMARY KEY,
  checksum_sha256 text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  execution_ms integer NOT NULL CHECK (execution_ms >= 0)
);

CREATE OR REPLACE FUNCTION platform.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION platform.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION platform.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION platform.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'A tabela %.% é imutável: operação % recusada.',
    TG_TABLE_SCHEMA,
    TG_TABLE_NAME,
    TG_OP
    USING ERRCODE = '55000';
END;
$$;

CREATE TABLE platform.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text,
  legal_name text NOT NULL,
  display_name text NOT NULL,
  slug text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  environment text NOT NULL DEFAULT 'HOMOLOGATION',
  status text NOT NULL DEFAULT 'ACTIVE',
  data_residency text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT tenants_slug_key UNIQUE (slug),
  CONSTRAINT tenants_environment_check
    CHECK (environment IN ('DEVELOPMENT', 'HOMOLOGATION', 'PRODUCTION')),
  CONSTRAINT tenants_status_check
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED'))
);

CREATE UNIQUE INDEX tenants_legacy_id_key
  ON platform.tenants (legacy_id)
  WHERE legacy_id IS NOT NULL;

CREATE TABLE platform.company_profiles (
  tenant_id uuid PRIMARY KEY REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  trade_name text NOT NULL,
  legal_name text,
  tax_identifier text,
  logo_storage_object_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT company_profiles_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE platform.feature_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL,
  module text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  protected boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT feature_catalog_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'RETIRED'))
);

CREATE TABLE platform.commercial_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT commercial_plans_status_check
    CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  CONSTRAINT commercial_plans_limits_object_check
    CHECK (jsonb_typeof(limits) = 'object')
);

CREATE TABLE platform.commercial_plan_features (
  commercial_plan_id uuid NOT NULL REFERENCES platform.commercial_plans(id) ON DELETE CASCADE,
  feature_id uuid NOT NULL REFERENCES platform.feature_catalog(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT true,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (commercial_plan_id, feature_id),
  CONSTRAINT commercial_plan_features_limits_object_check
    CHECK (jsonb_typeof(limits) = 'object')
);

CREATE TABLE platform.tenant_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  commercial_plan_id uuid NOT NULL REFERENCES platform.commercial_plans(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'TRIAL',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  grace_ends_at timestamptz,
  overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT tenant_subscriptions_status_check
    CHECK (status IN ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED')),
  CONSTRAINT tenant_subscriptions_period_check
    CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT tenant_subscriptions_overrides_object_check
    CHECK (jsonb_typeof(overrides) = 'object')
);

CREATE UNIQUE INDEX tenant_subscriptions_one_current
  ON platform.tenant_subscriptions (tenant_id)
  WHERE status IN ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED');

CREATE TABLE platform.storage_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  provider text NOT NULL,
  bucket text NOT NULL,
  object_key text NOT NULL,
  original_name text NOT NULL,
  media_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  checksum_sha256 text,
  encryption_key_ref text,
  status text NOT NULL DEFAULT 'AVAILABLE',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT storage_objects_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT storage_objects_provider_key UNIQUE (tenant_id, provider, bucket, object_key),
  CONSTRAINT storage_objects_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT storage_objects_status_check
    CHECK (status IN ('PENDING', 'AVAILABLE', 'QUARANTINED', 'DELETED')),
  CONSTRAINT storage_objects_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

ALTER TABLE platform.company_profiles
  ADD CONSTRAINT company_profiles_logo_storage_object_fk
  FOREIGN KEY (tenant_id, logo_storage_object_id)
  REFERENCES platform.storage_objects(tenant_id, id)
  ON DELETE RESTRICT;

CREATE TABLE platform.configuration_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL DEFAULT 'DRAFT',
  source text NOT NULL,
  base_version_id uuid,
  configuration jsonb NOT NULL,
  content_hash_sha256 text NOT NULL,
  validation_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  CONSTRAINT configuration_versions_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT configuration_versions_number_key UNIQUE (tenant_id, version_number),
  CONSTRAINT configuration_versions_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT configuration_versions_base_fk
    FOREIGN KEY (tenant_id, base_version_id)
    REFERENCES platform.configuration_versions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT configuration_versions_status_check
    CHECK (status IN ('DRAFT', 'VALIDATED', 'PUBLISHED', 'SUPERSEDED', 'REJECTED')),
  CONSTRAINT configuration_versions_configuration_object_check
    CHECK (jsonb_typeof(configuration) = 'object'),
  CONSTRAINT configuration_versions_validation_object_check
    CHECK (jsonb_typeof(validation_result) = 'object')
);

CREATE UNIQUE INDEX configuration_versions_one_published
  ON platform.configuration_versions (tenant_id)
  WHERE status = 'PUBLISHED';

CREATE TABLE platform.configuration_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  user_id uuid NOT NULL,
  base_version_id uuid,
  configuration jsonb NOT NULL,
  content_hash_sha256 text NOT NULL,
  validation_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'EDITING',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT configuration_drafts_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT configuration_drafts_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT configuration_drafts_base_fk
    FOREIGN KEY (tenant_id, base_version_id)
    REFERENCES platform.configuration_versions(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT configuration_drafts_status_check
    CHECK (status IN ('EDITING', 'VALID', 'INVALID', 'PUBLISHED', 'DISCARDED')),
  CONSTRAINT configuration_drafts_configuration_object_check
    CHECK (jsonb_typeof(configuration) = 'object'),
  CONSTRAINT configuration_drafts_validation_object_check
    CHECK (jsonb_typeof(validation_result) = 'object')
);

CREATE UNIQUE INDEX configuration_drafts_one_open_per_user
  ON platform.configuration_drafts (tenant_id, user_id)
  WHERE status IN ('EDITING', 'VALID', 'INVALID');

CREATE TABLE platform.maintenance_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'SCHEDULED',
  reason text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  opened_by uuid NOT NULL,
  closed_by uuid,
  challenge_hash text,
  single_use_consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT maintenance_windows_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT maintenance_windows_status_check
    CHECK (status IN ('SCHEDULED', 'OPEN', 'CLOSED', 'CANCELLED', 'EXPIRED')),
  CONSTRAINT maintenance_windows_period_check
    CHECK (ends_at > starts_at)
);

CREATE UNIQUE INDEX maintenance_windows_one_open
  ON platform.maintenance_windows (tenant_id)
  WHERE status = 'OPEN';

CREATE TABLE platform.idempotency_keys (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash_sha256 text NOT NULL,
  response_status integer,
  response_body jsonb,
  locked_until timestamptz,
  completed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, scope, idempotency_key),
  CONSTRAINT idempotency_keys_response_status_check
    CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599)
);

CREATE INDEX idempotency_keys_expiry_idx
  ON platform.idempotency_keys (expires_at);

CREATE TABLE platform.outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  event_version integer NOT NULL DEFAULT 1 CHECK (event_version > 0),
  payload jsonb NOT NULL,
  trace_id text,
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT outbox_events_payload_object_check
    CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX outbox_events_pending_idx
  ON platform.outbox_events (available_at, created_at)
  WHERE published_at IS NULL;

CREATE TRIGGER tenants_touch_updated_at
BEFORE UPDATE ON platform.tenants
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER company_profiles_touch_updated_at
BEFORE UPDATE ON platform.company_profiles
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER feature_catalog_touch_updated_at
BEFORE UPDATE ON platform.feature_catalog
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER commercial_plans_touch_updated_at
BEFORE UPDATE ON platform.commercial_plans
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER tenant_subscriptions_touch_updated_at
BEFORE UPDATE ON platform.tenant_subscriptions
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER configuration_drafts_touch_updated_at
BEFORE UPDATE ON platform.configuration_drafts
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER maintenance_windows_touch_updated_at
BEFORE UPDATE ON platform.maintenance_windows
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

COMMIT;
