BEGIN;

ALTER TABLE platform.commercial_plans
  ADD COLUMN monthly_price numeric(12,2) NOT NULL DEFAULT 0
  CHECK (monthly_price >= 0);

ALTER TABLE platform.support_requests
  ADD COLUMN scheduled_at timestamptz,
  ADD COLUMN service_mode text NOT NULL DEFAULT 'REMOTE'
    CHECK (service_mode IN ('REMOTE', 'ONSITE'));

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
    VALUES
      (p_operator_id, 'PLATFORM_LOGIN_SUCCEEDED', 'PLATFORM_SESSION',
       p_operator_id::text, p_request_id, p_ip);
  ELSE
    UPDATE platform.platform_operators
       SET failed_attempts = failed_attempts + 1,
           locked_until = CASE WHEN failed_attempts + 1 >= 5
             THEN clock_timestamp() + interval '15 minutes' ELSE locked_until END,
           updated_at = clock_timestamp()
     WHERE id = p_operator_id AND status = 'ACTIVE';
    INSERT INTO platform.platform_audit_events
      (operator_id, action, entity_type, entity_id, request_id, ip_address)
    VALUES
      (p_operator_id, 'PLATFORM_LOGIN_FAILED', 'PLATFORM_OPERATOR',
       p_operator_id::text, p_request_id, p_ip);
  END IF;
END;
$$;

DROP FUNCTION platform.lookup_platform_operator(text);
CREATE FUNCTION platform.lookup_platform_operator(p_login_name text)
RETURNS TABLE (
  operator_id uuid,
  login_name text,
  display_name text,
  password_hash text,
  totp_secret_ciphertext text,
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
         operator.password_hash, operator.totp_secret_ciphertext, operator.status,
         operator.failed_attempts, operator.locked_until
  FROM platform.platform_operators operator
  WHERE operator.login_name = lower(trim(p_login_name))
  LIMIT 1
$$;

DROP FUNCTION platform.list_console_tenants();
CREATE FUNCTION platform.list_console_tenants()
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
  subscription_ends_at timestamptz,
  subscription_id uuid,
  monthly_price numeric,
  discount_percent numeric,
  implementation_days integer,
  feature_codes jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
  SELECT tenant.id, tenant.display_name, tenant.slug, tenant.status,
         tenant.environment, tenant.created_at,
         plan.code, plan.name, subscription.status, subscription.ends_at,
         subscription.id,
         COALESCE((subscription.overrides #>> '{commercial,monthly_price}')::numeric,
                  plan.monthly_price, 0),
         COALESCE((subscription.overrides #>> '{commercial,discount_percent}')::numeric, 0),
         COALESCE((subscription.overrides #>> '{commercial,implementation_days}')::integer, 0),
         COALESCE(features.codes, '[]'::jsonb)
  FROM platform.tenants tenant
  LEFT JOIN LATERAL (
    SELECT item.id, item.commercial_plan_id, item.status, item.ends_at, item.overrides
    FROM platform.tenant_subscriptions item
    WHERE item.tenant_id = tenant.id
    ORDER BY CASE WHEN item.status IN ('ACTIVE', 'TRIAL') THEN 0
                  WHEN item.status IN ('PAST_DUE', 'SUSPENDED') THEN 1 ELSE 2 END,
             item.starts_at DESC
    LIMIT 1
  ) subscription ON true
  LEFT JOIN platform.commercial_plans plan
    ON plan.id = subscription.commercial_plan_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(feature.code ORDER BY feature.code) AS codes
    FROM platform.feature_catalog feature
    LEFT JOIN platform.commercial_plan_features plan_feature
      ON plan_feature.feature_id = feature.id
     AND plan_feature.commercial_plan_id = subscription.commercial_plan_id
    WHERE feature.status = 'ACTIVE'
      AND COALESCE((subscription.overrides -> 'features' ->> feature.code)::boolean,
                   plan_feature.enabled, false)
  ) features ON true
  WHERE tenant.deleted_at IS NULL
  ORDER BY tenant.display_name, tenant.created_at DESC
$$;

CREATE OR REPLACE FUNCTION platform.list_console_plans()
RETURNS TABLE (
  plan_id uuid,
  code text,
  name text,
  description text,
  status text,
  version integer,
  monthly_price numeric,
  features jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
  SELECT plan.id, plan.code, plan.name, plan.description, plan.status,
         plan.version, plan.monthly_price,
         COALESCE(features.items, '[]'::jsonb)
  FROM platform.commercial_plans plan
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'code', feature.code,
        'name', feature.name,
        'description', feature.description,
        'module', feature.module
      ) ORDER BY feature.module, feature.name
    ) AS items
    FROM platform.commercial_plan_features plan_feature
    JOIN platform.feature_catalog feature
      ON feature.id = plan_feature.feature_id AND feature.status = 'ACTIVE'
    WHERE plan_feature.commercial_plan_id = plan.id AND plan_feature.enabled
  ) features ON true
  ORDER BY CASE plan.status WHEN 'ACTIVE' THEN 0 WHEN 'DRAFT' THEN 1 ELSE 2 END,
           plan.name
$$;

CREATE OR REPLACE FUNCTION platform.save_console_plan(
  p_operator_id uuid,
  p_plan_id uuid,
  p_code text,
  p_name text,
  p_description text,
  p_status text,
  p_monthly_price numeric,
  p_feature_codes text[],
  p_request_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
DECLARE
  saved_plan_id uuid;
  before_state jsonb := '{}'::jsonb;
  requested_count integer;
  matched_count integer;
BEGIN
  IF p_code !~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'
     OR length(trim(p_name)) NOT BETWEEN 2 AND 100
     OR length(trim(p_description)) > 1000
     OR p_status NOT IN ('DRAFT', 'ACTIVE', 'RETIRED')
     OR p_monthly_price < 0
     OR p_monthly_price > 100000000 OR p_monthly_price IS NULL THEN
    RAISE EXCEPTION 'Dados do plano inválidos.' USING ERRCODE = '22023';
  END IF;

  requested_count := cardinality(COALESCE(p_feature_codes, ARRAY[]::text[]));
  IF requested_count <> cardinality(ARRAY(SELECT DISTINCT item FROM unnest(COALESCE(p_feature_codes, ARRAY[]::text[])) item)) THEN
    RAISE EXCEPTION 'A lista de módulos contém duplicatas.' USING ERRCODE = '22023';
  END IF;
  SELECT count(DISTINCT feature.code)::integer INTO matched_count
  FROM platform.feature_catalog feature
  WHERE feature.status = 'ACTIVE'
    AND feature.code = ANY(COALESCE(p_feature_codes, ARRAY[]::text[]));
  IF requested_count <> matched_count THEN
    RAISE EXCEPTION 'Um ou mais módulos não estão disponíveis.' USING ERRCODE = '22023';
  END IF;

  IF p_plan_id IS NULL THEN
    INSERT INTO platform.commercial_plans
      (code, name, description, status, monthly_price)
    VALUES
      (p_code, trim(p_name), trim(p_description), p_status, p_monthly_price)
    RETURNING id INTO saved_plan_id;
  ELSE
    SELECT jsonb_build_object(
      'code', code, 'name', name, 'description', description,
      'status', status, 'monthly_price', monthly_price
    ) INTO before_state
    FROM platform.commercial_plans WHERE id = p_plan_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'O plano não foi encontrado.' USING ERRCODE = 'P0002';
    END IF;
    UPDATE platform.commercial_plans
       SET code = p_code, name = trim(p_name), description = trim(p_description),
           status = p_status, monthly_price = p_monthly_price, version = version + 1
     WHERE id = p_plan_id
     RETURNING id INTO saved_plan_id;
  END IF;

  DELETE FROM platform.commercial_plan_features
   WHERE commercial_plan_id = saved_plan_id;
  INSERT INTO platform.commercial_plan_features
    (commercial_plan_id, feature_id, enabled)
  SELECT saved_plan_id, feature.id, true
  FROM platform.feature_catalog feature
  WHERE feature.status = 'ACTIVE'
    AND feature.code = ANY(COALESCE(p_feature_codes, ARRAY[]::text[]));

  INSERT INTO platform.platform_audit_events
    (operator_id, action, entity_type, entity_id, request_id, before_state, after_state)
  VALUES (
    p_operator_id,
    CASE WHEN p_plan_id IS NULL THEN 'PLATFORM_PLAN_CREATED' ELSE 'PLATFORM_PLAN_UPDATED' END,
    'COMMERCIAL_PLAN', saved_plan_id::text, p_request_id, before_state,
    jsonb_build_object(
      'code', p_code, 'name', trim(p_name), 'description', trim(p_description),
      'status', p_status, 'monthly_price', p_monthly_price,
      'feature_codes', COALESCE(p_feature_codes, ARRAY[]::text[])
    )
  );
  RETURN saved_plan_id;
END;
$$;

CREATE OR REPLACE FUNCTION platform.update_console_tenant_subscription(
  p_operator_id uuid,
  p_tenant_id uuid,
  p_plan_id uuid,
  p_status text,
  p_monthly_price numeric,
  p_discount_percent numeric,
  p_implementation_days integer,
  p_feature_codes text[],
  p_request_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
DECLARE
  selected_subscription_id uuid;
  before_state jsonb := '{}'::jsonb;
  feature_overrides jsonb;
  commercial_terms jsonb;
  requested_count integer;
  matched_count integer;
BEGIN
  IF p_status NOT IN ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED')
     OR p_monthly_price < 0 OR p_monthly_price > 100000000
     OR p_discount_percent < 0 OR p_discount_percent > 100 OR p_monthly_price IS NULL
     OR p_discount_percent IS NULL OR p_implementation_days IS NULL
     OR p_implementation_days < 0 OR p_implementation_days > 3650 THEN
    RAISE EXCEPTION 'Condições da assinatura inválidas.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.tenants WHERE id = p_tenant_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'A empresa não foi encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.commercial_plans WHERE id = p_plan_id AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'Selecione um plano ativo.' USING ERRCODE = '22023';
  END IF;

  requested_count := cardinality(COALESCE(p_feature_codes, ARRAY[]::text[]));
  IF requested_count <> cardinality(ARRAY(SELECT DISTINCT item FROM unnest(COALESCE(p_feature_codes, ARRAY[]::text[])) item)) THEN
    RAISE EXCEPTION 'A lista de módulos contém duplicatas.' USING ERRCODE = '22023';
  END IF;
  SELECT count(DISTINCT feature.code)::integer INTO matched_count
  FROM platform.feature_catalog feature
  WHERE feature.status = 'ACTIVE'
    AND feature.code = ANY(COALESCE(p_feature_codes, ARRAY[]::text[]));
  IF requested_count <> matched_count THEN
    RAISE EXCEPTION 'Um ou mais módulos selecionados não estão disponíveis.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_object_agg(feature.code, feature.code = ANY(
           COALESCE(p_feature_codes, ARRAY[]::text[]))), '{}'::jsonb)
    INTO feature_overrides
  FROM platform.feature_catalog feature
  WHERE feature.status = 'ACTIVE';
  commercial_terms := jsonb_build_object(
    'monthly_price', p_monthly_price,
    'discount_percent', p_discount_percent,
    'implementation_days', p_implementation_days
  );

  SELECT subscription.id,
         jsonb_build_object(
           'plan_id', subscription.commercial_plan_id,
           'status', subscription.status,
           'ends_at', subscription.ends_at,
           'overrides', subscription.overrides
         )
    INTO selected_subscription_id, before_state
  FROM platform.tenant_subscriptions subscription
  WHERE subscription.tenant_id = p_tenant_id
    AND subscription.status IN ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED')
  ORDER BY subscription.starts_at DESC
  LIMIT 1 FOR UPDATE;

  IF selected_subscription_id IS NULL THEN
    INSERT INTO platform.tenant_subscriptions
      (tenant_id, commercial_plan_id, status, starts_at, overrides)
    VALUES (
      p_tenant_id, p_plan_id, p_status, clock_timestamp(),
      jsonb_build_object('commercial', commercial_terms, 'features', feature_overrides)
    )
    RETURNING id INTO selected_subscription_id;
  ELSE
    UPDATE platform.tenant_subscriptions
       SET commercial_plan_id = p_plan_id,
           status = p_status,
           overrides = jsonb_set(
             jsonb_set(COALESCE(overrides, '{}'::jsonb), '{commercial}', commercial_terms, true),
             '{features}', feature_overrides, true
           )
     WHERE id = selected_subscription_id;
  END IF;

  INSERT INTO platform.platform_audit_events
    (operator_id, action, entity_type, entity_id, tenant_id, request_id, before_state, after_state)
  VALUES (
    p_operator_id, 'PLATFORM_TENANT_SUBSCRIPTION_UPDATED', 'TENANT_SUBSCRIPTION',
    selected_subscription_id::text, p_tenant_id, p_request_id, before_state,
    jsonb_build_object(
      'plan_id', p_plan_id, 'status', p_status, 'monthly_price', p_monthly_price,
      'discount_percent', p_discount_percent,
      'implementation_days', p_implementation_days,
      'feature_codes', COALESCE(p_feature_codes, ARRAY[]::text[])
    )
  );
  RETURN selected_subscription_id;
END;
$$;

DROP FUNCTION platform.list_console_support_requests();
CREATE FUNCTION platform.list_console_support_requests()
RETURNS TABLE (
  request_id uuid, tenant_id uuid, tenant_name text, requester_id uuid,
  topic text, module text, summary text, technical_context text,
  request_id_header text, status text, created_at timestamptz,
  updated_at timestamptz, scheduled_at timestamptz, service_mode text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
  SELECT request.id, request.tenant_id, tenant.display_name, request.requester_id,
         request.topic, request.module, request.summary, request.technical_context,
         request.request_id, request.status, request.created_at, request.updated_at,
         request.scheduled_at, request.service_mode
  FROM platform.support_requests request
  JOIN platform.tenants tenant ON tenant.id = request.tenant_id
  ORDER BY CASE request.status WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1
           WHEN 'WAITING_CUSTOMER' THEN 2 ELSE 3 END, request.created_at DESC
  LIMIT 500
$$;

CREATE OR REPLACE FUNCTION platform.create_support_request(
  p_tenant_id uuid, p_requester_id uuid, p_topic text, p_module text,
  p_summary text, p_technical_context text, p_request_id text,
  p_preferred_at timestamptz, p_service_mode text
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
  IF p_preferred_at IS NOT NULL AND p_preferred_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'A data sugerida deve estar no futuro.' USING ERRCODE = '22023';
  END IF;
  IF p_service_mode NOT IN ('REMOTE', 'ONSITE') THEN
    RAISE EXCEPTION 'Modo de atendimento inválido.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO platform.support_requests (
    tenant_id, requester_id, topic, module, summary, technical_context,
    request_id, scheduled_at, service_mode
  ) VALUES (
    p_tenant_id, p_requester_id, p_topic, p_module, trim(p_summary),
    coalesce(p_technical_context, ''), p_request_id, p_preferred_at, p_service_mode
  ) RETURNING id INTO created_id;
  INSERT INTO platform.platform_audit_events (
    action, entity_type, entity_id, tenant_id, request_id, before_state, after_state
  ) VALUES (
    'TENANT_SUPPORT_REQUEST_CREATED', 'SUPPORT_REQUEST', created_id::text,
    p_tenant_id, p_request_id, '{}'::jsonb,
    jsonb_build_object('topic', p_topic, 'module', p_module, 'status', 'OPEN',
                       'scheduled_at', p_preferred_at, 'service_mode', p_service_mode)
  );
  RETURN created_id;
END;
$$;

CREATE OR REPLACE FUNCTION platform.update_console_support_request(
  p_operator_id uuid,
  p_request_id uuid,
  p_status text,
  p_scheduled_at timestamptz,
  p_service_mode text,
  p_request_id_header text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
DECLARE
  before_row platform.support_requests%ROWTYPE;
BEGIN
  IF p_status NOT IN ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED')
     OR p_service_mode NOT IN ('REMOTE', 'ONSITE') THEN
    RETURN false;
  END IF;
  IF p_status = 'IN_PROGRESS' AND p_scheduled_at IS NOT NULL
     AND p_scheduled_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'O horário agendado deve estar no futuro.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO before_row FROM platform.support_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR before_row.status = 'CLOSED' THEN RETURN false; END IF;

  UPDATE platform.support_requests
     SET status = p_status, scheduled_at = p_scheduled_at,
         service_mode = p_service_mode, updated_at = clock_timestamp(),
         resolved_at = CASE WHEN p_status IN ('RESOLVED', 'CLOSED')
                            THEN clock_timestamp() ELSE NULL END
   WHERE id = p_request_id;
  INSERT INTO platform.platform_audit_events
    (operator_id, action, entity_type, entity_id, tenant_id, request_id, before_state, after_state)
  VALUES (
    p_operator_id, 'PLATFORM_SUPPORT_REQUEST_UPDATED', 'SUPPORT_REQUEST',
    p_request_id::text, before_row.tenant_id, p_request_id_header,
    jsonb_build_object('status', before_row.status, 'scheduled_at', before_row.scheduled_at,
                       'service_mode', before_row.service_mode),
    jsonb_build_object('status', p_status, 'scheduled_at', p_scheduled_at,
                       'service_mode', p_service_mode)
  );
  RETURN true;
END;
$$;

ALTER FUNCTION platform.record_platform_login(uuid, boolean, inet, text) OWNER TO vorqix_platform_auth;
ALTER FUNCTION platform.lookup_platform_operator(text) OWNER TO vorqix_platform_auth;
ALTER FUNCTION platform.list_console_tenants() OWNER TO vorqix_platform_reader;
ALTER FUNCTION platform.list_console_plans() OWNER TO vorqix_platform_reader;
ALTER FUNCTION platform.list_console_support_requests() OWNER TO vorqix_platform_reader;
ALTER FUNCTION platform.create_support_request(uuid, uuid, text, text, text, text, text, timestamptz, text) OWNER TO vorqix_platform_support_writer;
ALTER FUNCTION platform.save_console_plan(uuid, uuid, text, text, text, text, numeric, text[], text) OWNER TO vorqix_platform_support_writer;
ALTER FUNCTION platform.update_console_tenant_subscription(uuid, uuid, uuid, text, numeric, numeric, integer, text[], text) OWNER TO vorqix_platform_support_writer;
ALTER FUNCTION platform.update_console_support_request(uuid, uuid, text, timestamptz, text, text) OWNER TO vorqix_platform_support_writer;

GRANT SELECT ON platform.feature_catalog, platform.commercial_plan_features TO vorqix_platform_reader;
GRANT SELECT ON platform.commercial_plans, platform.tenant_subscriptions TO vorqix_platform_reader;
GRANT SELECT, INSERT, UPDATE ON platform.commercial_plans TO vorqix_platform_support_writer;
GRANT SELECT, INSERT, DELETE ON platform.commercial_plan_features TO vorqix_platform_support_writer;
GRANT SELECT, INSERT, UPDATE ON platform.tenant_subscriptions TO vorqix_platform_support_writer;
GRANT SELECT ON platform.feature_catalog, platform.tenants TO vorqix_platform_support_writer;
GRANT SELECT ON platform.support_requests TO vorqix_platform_support_writer, fab_control_runtime;
GRANT UPDATE (status, updated_at, resolved_at, scheduled_at, service_mode)
  ON platform.support_requests TO vorqix_platform_support_writer;
GRANT USAGE ON SCHEMA platform TO vorqix_platform_reader, vorqix_platform_support_writer;

DROP POLICY IF EXISTS tenant_subscriptions_platform_writer_scope ON platform.tenant_subscriptions;
CREATE POLICY tenant_subscriptions_platform_writer_scope ON platform.tenant_subscriptions
  TO vorqix_platform_support_writer USING (true) WITH CHECK (true);

REVOKE ALL ON FUNCTION platform.list_console_tenants() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.lookup_platform_operator(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.list_console_plans() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.list_console_support_requests() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.create_support_request(uuid, uuid, text, text, text, text, text, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.save_console_plan(uuid, uuid, text, text, text, text, numeric, text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.update_console_tenant_subscription(uuid, uuid, uuid, text, numeric, numeric, integer, text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.update_console_support_request(uuid, uuid, text, timestamptz, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION platform.list_console_tenants() TO fab_control_runtime;
GRANT EXECUTE ON FUNCTION platform.lookup_platform_operator(text) TO fab_control_runtime;
GRANT EXECUTE ON FUNCTION platform.list_console_plans() TO fab_control_runtime;
GRANT EXECUTE ON FUNCTION platform.list_console_support_requests() TO fab_control_runtime;
GRANT EXECUTE ON FUNCTION platform.create_support_request(uuid, uuid, text, text, text, text, text, timestamptz, text) TO fab_control_runtime;
GRANT EXECUTE ON FUNCTION platform.save_console_plan(uuid, uuid, text, text, text, text, numeric, text[], text) TO fab_control_runtime;
GRANT EXECUTE ON FUNCTION platform.update_console_tenant_subscription(uuid, uuid, uuid, text, numeric, numeric, integer, text[], text) TO fab_control_runtime;
GRANT EXECUTE ON FUNCTION platform.update_console_support_request(uuid, uuid, text, timestamptz, text, text) TO fab_control_runtime;

COMMIT;
