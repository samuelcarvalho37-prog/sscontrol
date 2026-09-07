BEGIN;

CREATE TABLE iam.capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL,
  module text NOT NULL,
  protected boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT capabilities_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'RETIRED'))
);

CREATE TABLE iam.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  code text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  role_type text NOT NULL DEFAULT 'CUSTOM',
  protected boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT roles_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT roles_code_key UNIQUE (tenant_id, code),
  CONSTRAINT roles_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT roles_type_check
    CHECK (role_type IN ('ADMIN', 'MANAGER', 'OPERATOR', 'CUSTOM')),
  CONSTRAINT roles_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'RETIRED'))
);

CREATE TABLE iam.role_capabilities (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  role_id uuid NOT NULL,
  capability_id uuid NOT NULL REFERENCES iam.capabilities(id) ON DELETE RESTRICT,
  effect text NOT NULL DEFAULT 'ALLOW',
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, role_id, capability_id),
  CONSTRAINT role_capabilities_role_fk
    FOREIGN KEY (tenant_id, role_id)
    REFERENCES iam.roles(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT role_capabilities_effect_check
    CHECK (effect IN ('ALLOW', 'DENY')),
  CONSTRAINT role_capabilities_conditions_object_check
    CHECK (jsonb_typeof(conditions) = 'object')
);

CREATE TABLE iam.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  employee_number text NOT NULL,
  name text NOT NULL,
  email text,
  status text NOT NULL DEFAULT 'ACTIVE',
  first_access_required boolean NOT NULL DEFAULT true,
  failed_login_attempts integer NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until timestamptz,
  last_login_at timestamptz,
  password_changed_at timestamptz,
  recovery_reference text,
  recovery_requested_at timestamptz,
  specialties jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT users_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT users_employee_number_key UNIQUE (tenant_id, employee_number),
  CONSTRAINT users_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT users_email_key UNIQUE (tenant_id, email),
  CONSTRAINT users_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'BLOCKED', 'ARCHIVED')),
  CONSTRAINT users_specialties_array_check
    CHECK (jsonb_typeof(specialties) = 'array'),
  CONSTRAINT users_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX users_name_trgm_idx
  ON iam.users USING gin (name public.gin_trgm_ops);

CREATE INDEX users_employee_number_trgm_idx
  ON iam.users USING gin (employee_number public.gin_trgm_ops);

CREATE TABLE iam.user_roles (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT clock_timestamp(),
  valid_until timestamptz,
  assigned_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, user_id, role_id),
  CONSTRAINT user_roles_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT user_roles_role_fk
    FOREIGN KEY (tenant_id, role_id)
    REFERENCES iam.roles(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT user_roles_period_check
    CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE TABLE iam.user_capabilities (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  capability_id uuid NOT NULL REFERENCES iam.capabilities(id) ON DELETE RESTRICT,
  effect text NOT NULL,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  valid_from timestamptz NOT NULL DEFAULT clock_timestamp(),
  valid_until timestamptz,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, user_id, capability_id),
  CONSTRAINT user_capabilities_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT user_capabilities_effect_check
    CHECK (effect IN ('ALLOW', 'DENY')),
  CONSTRAINT user_capabilities_conditions_object_check
    CHECK (jsonb_typeof(conditions) = 'object'),
  CONSTRAINT user_capabilities_period_check
    CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE TABLE iam.credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  credential_type text NOT NULL DEFAULT 'PASSWORD',
  algorithm text NOT NULL,
  password_hash text,
  pin_hash text,
  legacy_hash text,
  legacy_algorithm text,
  legacy_migration_status text NOT NULL DEFAULT 'NOT_REQUIRED',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  CONSTRAINT credentials_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT credentials_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT credentials_user_type_key UNIQUE (tenant_id, user_id, credential_type),
  CONSTRAINT credentials_type_check
    CHECK (credential_type IN ('PASSWORD', 'PIN', 'PASSKEY', 'LEGACY_PASSWORD')),
  CONSTRAINT credentials_legacy_status_check
    CHECK (legacy_migration_status IN ('NOT_REQUIRED', 'PENDING', 'VERIFIED', 'REHASHED', 'RESET_REQUIRED', 'REVOKED')),
  CONSTRAINT credentials_material_check
    CHECK (
      password_hash IS NOT NULL
      OR pin_hash IS NOT NULL
      OR legacy_hash IS NOT NULL
    )
);

CREATE TABLE iam.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  user_id uuid NOT NULL,
  token_hash_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  environment text NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_agent text,
  ip_address inet,
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  maintenance_window_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sessions_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT sessions_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT sessions_token_hash_key UNIQUE (token_hash_sha256),
  CONSTRAINT sessions_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT sessions_maintenance_window_fk
    FOREIGN KEY (tenant_id, maintenance_window_id)
    REFERENCES platform.maintenance_windows(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT sessions_status_check
    CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED', 'ARCHIVED')),
  CONSTRAINT sessions_environment_check
    CHECK (environment IN ('DEVELOPMENT', 'HOMOLOGATION', 'PRODUCTION')),
  CONSTRAINT sessions_scope_object_check
    CHECK (jsonb_typeof(scope) = 'object')
);

CREATE INDEX sessions_active_user_idx
  ON iam.sessions (tenant_id, user_id, expires_at)
  WHERE status = 'ACTIVE';

CREATE TABLE iam.login_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  user_id uuid,
  employee_number_digest text NOT NULL,
  successful boolean NOT NULL,
  failure_code text,
  ip_address inet,
  user_agent text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT login_attempts_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE SET NULL
);

CREATE INDEX login_attempts_lookup_idx
  ON iam.login_attempts (employee_number_digest, occurred_at DESC);

CREATE INDEX login_attempts_occurred_brin_idx
  ON iam.login_attempts USING brin (occurred_at);

CREATE TABLE iam.recovery_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  user_id uuid,
  public_reference text NOT NULL UNIQUE,
  secret_hash_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  requested_ip inet,
  requested_user_agent text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT recovery_requests_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE SET NULL,
  CONSTRAINT recovery_requests_status_check
    CHECK (status IN ('PENDING', 'CONSUMED', 'EXPIRED', 'CANCELLED'))
);

CREATE INDEX recovery_requests_pending_idx
  ON iam.recovery_requests (expires_at)
  WHERE status = 'PENDING';

CREATE TABLE iam.technical_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  code text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  default_signature_required boolean NOT NULL DEFAULT false,
  validation_area boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT technical_areas_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT technical_areas_code_key UNIQUE (tenant_id, code),
  CONSTRAINT technical_areas_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT technical_areas_creator_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT technical_areas_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'RETIRED'))
);

CREATE TABLE iam.technical_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  legacy_id text,
  technical_area_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  can_sign boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT technical_roles_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT technical_roles_area_code_key UNIQUE (tenant_id, technical_area_id, code),
  CONSTRAINT technical_roles_legacy_id_key UNIQUE (tenant_id, legacy_id),
  CONSTRAINT technical_roles_area_fk
    FOREIGN KEY (tenant_id, technical_area_id)
    REFERENCES iam.technical_areas(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT technical_roles_creator_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT technical_roles_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'RETIRED'))
);

CREATE TABLE iam.user_technical_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  technical_area_id uuid NOT NULL,
  technical_role_id uuid,
  is_primary boolean NOT NULL DEFAULT false,
  can_sign_override boolean,
  status text NOT NULL DEFAULT 'ACTIVE',
  valid_from timestamptz NOT NULL DEFAULT clock_timestamp(),
  valid_until timestamptz,
  assigned_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT user_technical_assignments_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT user_technical_assignments_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT user_technical_assignments_area_fk
    FOREIGN KEY (tenant_id, technical_area_id)
    REFERENCES iam.technical_areas(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT user_technical_assignments_role_fk
    FOREIGN KEY (tenant_id, technical_role_id)
    REFERENCES iam.technical_roles(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT user_technical_assignments_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'EXPIRED')),
  CONSTRAINT user_technical_assignments_period_check
    CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE UNIQUE INDEX user_technical_assignments_one_primary
  ON iam.user_technical_assignments (tenant_id, user_id)
  WHERE is_primary AND status = 'ACTIVE';

ALTER TABLE platform.company_profiles
  ADD CONSTRAINT company_profiles_updated_by_fk
  FOREIGN KEY (tenant_id, updated_by)
  REFERENCES iam.users(tenant_id, id)
  ON DELETE RESTRICT;

ALTER TABLE platform.storage_objects
  ADD CONSTRAINT storage_objects_created_by_fk
  FOREIGN KEY (tenant_id, created_by)
  REFERENCES iam.users(tenant_id, id)
  ON DELETE RESTRICT;

ALTER TABLE platform.configuration_versions
  ADD CONSTRAINT configuration_versions_created_by_fk
  FOREIGN KEY (tenant_id, created_by)
  REFERENCES iam.users(tenant_id, id)
  ON DELETE RESTRICT;

ALTER TABLE platform.configuration_drafts
  ADD CONSTRAINT configuration_drafts_user_fk
  FOREIGN KEY (tenant_id, user_id)
  REFERENCES iam.users(tenant_id, id)
  ON DELETE CASCADE;

ALTER TABLE platform.maintenance_windows
  ADD CONSTRAINT maintenance_windows_opened_by_fk
  FOREIGN KEY (tenant_id, opened_by)
  REFERENCES iam.users(tenant_id, id)
  ON DELETE RESTRICT;

ALTER TABLE platform.maintenance_windows
  ADD CONSTRAINT maintenance_windows_closed_by_fk
  FOREIGN KEY (tenant_id, closed_by)
  REFERENCES iam.users(tenant_id, id)
  ON DELETE RESTRICT;

CREATE TRIGGER capabilities_touch_updated_at
BEFORE UPDATE ON iam.capabilities
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER roles_touch_updated_at
BEFORE UPDATE ON iam.roles
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER users_touch_updated_at
BEFORE UPDATE ON iam.users
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER credentials_touch_updated_at
BEFORE UPDATE ON iam.credentials
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER technical_areas_touch_updated_at
BEFORE UPDATE ON iam.technical_areas
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER technical_roles_touch_updated_at
BEFORE UPDATE ON iam.technical_roles
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER user_technical_assignments_touch_updated_at
BEFORE UPDATE ON iam.user_technical_assignments
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

COMMIT;
