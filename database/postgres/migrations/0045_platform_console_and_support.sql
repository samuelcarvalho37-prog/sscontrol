BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'vorqix_platform_auth') THEN
    CREATE ROLE vorqix_platform_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'vorqix_platform_reader') THEN
    CREATE ROLE vorqix_platform_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'vorqix_platform_support_writer') THEN
    CREATE ROLE vorqix_platform_support_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END;
$$;

ALTER ROLE vorqix_platform_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE vorqix_platform_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE vorqix_platform_support_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid = membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid = membership.member
    WHERE granted.rolname IN (
      'vorqix_platform_auth', 'vorqix_platform_reader', 'vorqix_platform_support_writer'
    )
      AND member.rolname <> current_user
  ) THEN
    RAISE EXCEPTION 'Papéis internos da plataforma já possuem membros inesperados.';
  END IF;
END;
$$;

CREATE TABLE platform.platform_operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login_name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  totp_secret_ciphertext text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT platform_operators_login_check CHECK (login_name = lower(login_name) AND length(login_name) BETWEEN 3 AND 120),
  CONSTRAINT platform_operators_status_check CHECK (status IN ('ACTIVE', 'DISABLED'))
);

CREATE TABLE platform.platform_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES platform.platform_operators(id) ON DELETE CASCADE,
  token_hash_sha256 text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip_address inet,
  user_agent text,
  CONSTRAINT platform_sessions_status_check CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
  CONSTRAINT platform_sessions_expiration_check CHECK (expires_at > created_at)
);

CREATE INDEX platform_sessions_active_operator_idx
  ON platform.platform_sessions (operator_id, expires_at DESC)
  WHERE status = 'ACTIVE';

CREATE TABLE platform.platform_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid REFERENCES platform.platform_operators(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  tenant_id uuid,
  request_id text,
  ip_address inet,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX platform_audit_events_created_idx
  ON platform.platform_audit_events (created_at DESC);
CREATE INDEX platform_audit_events_tenant_idx
  ON platform.platform_audit_events (tenant_id, created_at DESC)
  WHERE tenant_id IS NOT NULL;

CREATE TABLE platform.support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  requester_id uuid NOT NULL,
  topic text NOT NULL,
  module text NOT NULL,
  summary varchar(160) NOT NULL,
  technical_context text NOT NULL DEFAULT '',
  request_id text,
  status text NOT NULL DEFAULT 'OPEN',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  CONSTRAINT support_requests_requester_fk
    FOREIGN KEY (tenant_id, requester_id) REFERENCES iam.users(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT support_requests_topic_check CHECK (topic IN ('ERRO', 'DESEMPENHO', 'ACESSO', 'CONFIGURACAO', 'OUTRO')),
  CONSTRAINT support_requests_status_check CHECK (status IN ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED')),
  CONSTRAINT support_requests_summary_check CHECK (length(trim(summary)) BETWEEN 4 AND 160),
  CONSTRAINT support_requests_context_size_check CHECK (octet_length(technical_context) <= 4000)
);

CREATE INDEX support_requests_tenant_created_idx
  ON platform.support_requests (tenant_id, created_at DESC);
CREATE INDEX support_requests_open_created_idx
  ON platform.support_requests (created_at DESC)
  WHERE status IN ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER');

ALTER TABLE platform.platform_operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.platform_operators FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.platform_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.platform_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.platform_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.platform_audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.support_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.support_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant_subscriptions FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_operators_auth_scope ON platform.platform_operators
  TO vorqix_platform_auth USING (true) WITH CHECK (true);
CREATE POLICY platform_operators_bootstrap_scope ON platform.platform_operators
  FOR INSERT TO vorqix_platform_auth WITH CHECK (true);
CREATE POLICY platform_sessions_auth_scope ON platform.platform_sessions
  TO vorqix_platform_auth USING (true) WITH CHECK (true);
CREATE POLICY platform_audit_auth_scope ON platform.platform_audit_events
  TO vorqix_platform_auth USING (true) WITH CHECK (true);
CREATE POLICY platform_audit_reader_scope ON platform.platform_audit_events
  FOR SELECT TO vorqix_platform_reader USING (true);
CREATE POLICY support_requests_tenant_scope ON platform.support_requests
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY support_requests_platform_reader_scope ON platform.support_requests
  FOR SELECT TO vorqix_platform_reader USING (true);
CREATE POLICY support_requests_platform_writer_scope ON platform.support_requests
  TO vorqix_platform_support_writer USING (true) WITH CHECK (true);
CREATE POLICY platform_audit_writer_scope ON platform.platform_audit_events
  FOR INSERT TO vorqix_platform_support_writer WITH CHECK (true);
CREATE POLICY tenant_subscriptions_platform_reader_scope ON platform.tenant_subscriptions
  FOR SELECT TO vorqix_platform_reader USING (true);
CREATE POLICY tenants_platform_reader_scope ON platform.tenants
  FOR SELECT TO vorqix_platform_reader USING (true);

GRANT USAGE ON SCHEMA platform TO vorqix_platform_auth, vorqix_platform_reader, vorqix_platform_support_writer;
GRANT CREATE ON SCHEMA platform TO vorqix_platform_auth, vorqix_platform_reader, vorqix_platform_support_writer;
GRANT SELECT, INSERT, UPDATE ON platform.platform_operators TO vorqix_platform_auth;
GRANT SELECT, INSERT, UPDATE ON platform.platform_sessions TO vorqix_platform_auth;
GRANT INSERT ON platform.platform_audit_events TO vorqix_platform_auth;
GRANT SELECT ON platform.platform_audit_events, platform.support_requests TO vorqix_platform_reader;
GRANT INSERT ON platform.support_requests, platform.platform_audit_events TO vorqix_platform_support_writer;
GRANT UPDATE (status, updated_at, resolved_at) ON platform.support_requests TO vorqix_platform_support_writer;
GRANT SELECT (id, display_name, slug, status, environment, created_at, deleted_at)
  ON platform.tenants TO vorqix_platform_reader;
GRANT SELECT (id, tenant_id, commercial_plan_id, status, starts_at, ends_at, created_at)
  ON platform.tenant_subscriptions TO vorqix_platform_reader;
GRANT SELECT (id, code, name, status) ON platform.commercial_plans TO vorqix_platform_reader;

CREATE OR REPLACE FUNCTION platform.lookup_platform_operator(p_login_name text)
RETURNS TABLE (
  operator_id uuid,
  login_name text,
  display_name text,
  password_hash text,
  status text,
  failed_attempts integer,
  locked_until timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
  SELECT operator.id, operator.login_name, operator.display_name,
         operator.password_hash, operator.status, operator.failed_attempts,
         operator.locked_until
  FROM platform.platform_operators operator
  WHERE operator.login_name = lower(trim(p_login_name))
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION platform.bootstrap_platform_operator(
  p_login_name text, p_display_name text, p_password_hash text, p_totp_ciphertext text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
DECLARE
  created_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM platform.platform_operators) THEN
    RAISE EXCEPTION 'A conta inicial da plataforma já foi provisionada.' USING ERRCODE = '55000';
  END IF;
  INSERT INTO platform.platform_operators (login_name, display_name, password_hash, totp_secret_ciphertext)
  VALUES (lower(trim(p_login_name)), trim(p_display_name), p_password_hash, p_totp_ciphertext)
  RETURNING id INTO created_id;
  INSERT INTO platform.platform_audit_events (operator_id, action, entity_type, entity_id)
  VALUES (created_id, 'PLATFORM_OPERATOR_BOOTSTRAPPED', 'PLATFORM_OPERATOR', created_id::text);
  RETURN created_id;
END;
$$;

CREATE OR REPLACE FUNCTION platform.record_platform_login(
  p_operator_id uuid, p_success boolean, p_ip inet, p_request_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
BEGIN
  IF p_success THEN
    UPDATE platform.platform_operators
       SET failed_attempts = 0, locked_until = NULL,
           last_login_at = clock_timestamp(), updated_at = clock_timestamp()
     WHERE id = p_operator_id AND status = 'ACTIVE';
    INSERT INTO platform.platform_audit_events
      (operator_id, action, entity_type, entity_id, request_id, ip_address)
    VALUES (p_operator_id, 'PLATFORM_LOGIN_SUCCEEDED', 'PLATFORM_SESSION', p_operator_id::text, NULL, p_request_id, p_ip);
  ELSE
    UPDATE platform.platform_operators
       SET failed_attempts = failed_attempts + 1,
           locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN clock_timestamp() + interval '15 minutes' ELSE locked_until END,
           updated_at = clock_timestamp()
     WHERE id = p_operator_id AND status = 'ACTIVE';
    INSERT INTO platform.platform_audit_events
      (operator_id, action, entity_type, entity_id, request_id, ip_address)
    VALUES (p_operator_id, 'PLATFORM_LOGIN_FAILED', 'PLATFORM_OPERATOR', p_operator_id::text, NULL, p_request_id, p_ip);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION platform.create_platform_session(
  p_operator_id uuid, p_token_hash text, p_expires_at timestamptz,
  p_ip inet, p_user_agent text
)
RETURNS TABLE (session_id uuid, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO platform.platform_sessions (operator_id, token_hash_sha256, expires_at, ip_address, user_agent)
  SELECT operator.id, p_token_hash, p_expires_at, p_ip, left(p_user_agent, 2048)
    FROM platform.platform_operators operator
   WHERE operator.id = p_operator_id AND operator.status = 'ACTIVE'
  RETURNING platform_sessions.id, platform_sessions.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION platform.resolve_platform_session(p_token_hash text)
RETURNS TABLE (
  session_id uuid,
  operator_id uuid,
  login_name text,
  display_name text,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
  SELECT session.id, operator.id, operator.login_name, operator.display_name, session.expires_at
  FROM platform.platform_sessions session
  JOIN platform.platform_operators operator ON operator.id = session.operator_id
  WHERE session.token_hash_sha256 = p_token_hash
    AND session.status = 'ACTIVE'
    AND session.expires_at > clock_timestamp()
    AND operator.status = 'ACTIVE'
    AND (operator.locked_until IS NULL OR operator.locked_until <= clock_timestamp())
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION platform.revoke_platform_session(p_token_hash text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
DECLARE
  revoked_operator uuid;
BEGIN
  SELECT operator_id INTO revoked_operator FROM platform.platform_sessions
   WHERE token_hash_sha256 = p_token_hash AND status = 'ACTIVE' FOR UPDATE;
  UPDATE platform.platform_sessions
     SET status = 'REVOKED', revoked_at = clock_timestamp()
   WHERE token_hash_sha256 = p_token_hash AND status = 'ACTIVE';
  IF revoked_operator IS NOT NULL THEN
    INSERT INTO platform.platform_audit_events (operator_id, action, entity_type, entity_id)
    VALUES (revoked_operator, 'PLATFORM_SESSION_REVOKED', 'PLATFORM_SESSION', revoked_operator::text);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION platform.list_console_tenants()
RETURNS TABLE (
  tenant_id uuid,
  display_name text,
  slug text,
  tenant_status text,
  environment text,
  created_at timestamptz,
  plan_code text,
  plan_name text,
  subscription_status text,
  subscription_ends_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
  SELECT tenant.id, tenant.display_name, tenant.slug, tenant.status,
         tenant.environment, tenant.created_at,
         plan.code, plan.name, subscription.status, subscription.ends_at
  FROM platform.tenants tenant
  LEFT JOIN LATERAL (
    SELECT item.commercial_plan_id, item.status, item.ends_at
    FROM platform.tenant_subscriptions item
    WHERE item.tenant_id = tenant.id
    ORDER BY CASE WHEN item.status IN ('ACTIVE', 'TRIAL') THEN 0 ELSE 1 END,
             item.starts_at DESC
    LIMIT 1
  ) subscription ON true
  LEFT JOIN platform.commercial_plans plan ON plan.id = subscription.commercial_plan_id
  WHERE tenant.deleted_at IS NULL
  ORDER BY tenant.display_name, tenant.created_at DESC
$$;

CREATE OR REPLACE FUNCTION platform.list_console_support_requests()
RETURNS TABLE (
  request_id uuid,
  tenant_id uuid,
  tenant_name text,
  requester_id uuid,
  topic text,
  module text,
  summary text,
  technical_context text,
  request_id_header text,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
  SELECT request.id, request.tenant_id, tenant.display_name, request.requester_id,
         request.topic, request.module, request.summary, request.technical_context,
         request.request_id, request.status, request.created_at, request.updated_at
  FROM platform.support_requests request
  JOIN platform.tenants tenant ON tenant.id = request.tenant_id
  ORDER BY CASE request.status WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1 WHEN 'WAITING_CUSTOMER' THEN 2 ELSE 3 END,
           request.created_at DESC
  LIMIT 500
$$;

CREATE OR REPLACE FUNCTION platform.create_support_request(
  p_tenant_id uuid, p_requester_id uuid, p_topic text, p_module text,
  p_summary text, p_technical_context text, p_request_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
DECLARE
  created_id uuid;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id()
     OR p_requester_id IS DISTINCT FROM platform.current_user_id() THEN
    RAISE EXCEPTION 'Escopo de solicitação inválido.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO platform.support_requests (
    tenant_id, requester_id, topic, module, summary, technical_context, request_id
  ) VALUES (
    p_tenant_id, p_requester_id, p_topic, p_module, trim(p_summary),
    coalesce(p_technical_context, ''), p_request_id
  ) RETURNING id INTO created_id;
  INSERT INTO platform.platform_audit_events (
    action, entity_type, entity_id, tenant_id, request_id, before_state, after_state
  ) VALUES (
    'TENANT_SUPPORT_REQUEST_CREATED', 'SUPPORT_REQUEST', created_id::text,
    p_tenant_id, p_request_id, '{}'::jsonb,
    jsonb_build_object('topic', p_topic, 'module', p_module, 'status', 'OPEN')
  );
  RETURN created_id;
END;
$$;

CREATE OR REPLACE FUNCTION platform.update_console_support_request(
  p_operator_id uuid, p_request_id uuid, p_status text, p_request_id_header text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
DECLARE
  before_row platform.support_requests%ROWTYPE;
BEGIN
  IF p_status NOT IN ('IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED') THEN
    RETURN false;
  END IF;
  SELECT * INTO before_row FROM platform.support_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF before_row.status = 'CLOSED' THEN
    RETURN false;
  END IF;
  UPDATE platform.support_requests
     SET status = p_status,
         updated_at = clock_timestamp(),
         resolved_at = CASE WHEN p_status IN ('RESOLVED', 'CLOSED') THEN clock_timestamp() ELSE NULL END
   WHERE id = p_request_id;
  INSERT INTO platform.platform_audit_events (
    operator_id, action, entity_type, entity_id, tenant_id, request_id, before_state, after_state
  ) VALUES (
    p_operator_id, 'PLATFORM_SUPPORT_REQUEST_UPDATED', 'SUPPORT_REQUEST', p_request_id::text,
    before_row.tenant_id, p_request_id_header,
    jsonb_build_object('status', before_row.status),
    jsonb_build_object('status', p_status)
  );
  RETURN true;
END;
$$;

DO $$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    GRANT vorqix_platform_auth, vorqix_platform_reader, vorqix_platform_support_writer
      TO CURRENT_USER WITH SET TRUE;
  END IF;
END;
$$;

ALTER FUNCTION platform.lookup_platform_operator(text) OWNER TO vorqix_platform_auth;
ALTER FUNCTION platform.bootstrap_platform_operator(text, text, text, text) OWNER TO vorqix_platform_auth;
ALTER FUNCTION platform.record_platform_login(uuid, boolean, inet, text) OWNER TO vorqix_platform_auth;
ALTER FUNCTION platform.create_platform_session(uuid, text, timestamptz, inet, text) OWNER TO vorqix_platform_auth;
ALTER FUNCTION platform.resolve_platform_session(text) OWNER TO vorqix_platform_auth;
ALTER FUNCTION platform.revoke_platform_session(text) OWNER TO vorqix_platform_auth;
ALTER FUNCTION platform.list_console_tenants() OWNER TO vorqix_platform_reader;
ALTER FUNCTION platform.list_console_support_requests() OWNER TO vorqix_platform_reader;
ALTER FUNCTION platform.create_support_request(uuid, uuid, text, text, text, text, text) OWNER TO vorqix_platform_support_writer;
ALTER FUNCTION platform.update_console_support_request(uuid, uuid, text, text) OWNER TO vorqix_platform_support_writer;
REVOKE CREATE ON SCHEMA platform FROM vorqix_platform_auth, vorqix_platform_reader, vorqix_platform_support_writer;

REVOKE ALL ON FUNCTION platform.lookup_platform_operator(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.bootstrap_platform_operator(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.record_platform_login(uuid, boolean, inet, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.create_platform_session(uuid, text, timestamptz, inet, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.resolve_platform_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.revoke_platform_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.list_console_tenants() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.list_console_support_requests() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.create_support_request(uuid, uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.update_console_support_request(uuid, uuid, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION platform.lookup_platform_operator(text) TO fab_control_runtime;
GRANT EXECUTE ON FUNCTION platform.bootstrap_platform_operator(text, text, text, text) TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION platform.record_platform_login(uuid, boolean, inet, text) TO fab_control_runtime;
GRANT EXECUTE ON FUNCTION platform.create_platform_session(uuid, text, timestamptz, inet, text) TO fab_control_runtime;
GRANT EXECUTE ON FUNCTION platform.resolve_platform_session(text) TO fab_control_runtime;
GRANT EXECUTE ON FUNCTION platform.revoke_platform_session(text) TO fab_control_runtime;
GRANT EXECUTE ON FUNCTION platform.list_console_tenants() TO fab_control_runtime;
GRANT EXECUTE ON FUNCTION platform.list_console_support_requests() TO fab_control_runtime;
GRANT EXECUTE ON FUNCTION platform.create_support_request(uuid, uuid, text, text, text, text, text) TO fab_control_runtime;
GRANT EXECUTE ON FUNCTION platform.update_console_support_request(uuid, uuid, text, text) TO fab_control_runtime;

DO $$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    REVOKE vorqix_platform_auth, vorqix_platform_reader, vorqix_platform_support_writer
      FROM CURRENT_USER;
  END IF;
END;
$$;

COMMIT;
