BEGIN;

GRANT USAGE ON SCHEMA iam TO vorqix_platform_support_writer;
GRANT SELECT ON iam.capabilities TO vorqix_platform_support_writer;
GRANT SELECT, INSERT ON iam.roles TO vorqix_platform_support_writer;
GRANT SELECT, INSERT ON iam.role_capabilities TO vorqix_platform_support_writer;
GRANT SELECT, INSERT ON iam.users TO vorqix_platform_support_writer;
GRANT INSERT ON iam.credentials TO vorqix_platform_support_writer;
GRANT SELECT, INSERT ON iam.user_roles TO vorqix_platform_support_writer;

CREATE POLICY roles_platform_writer_scope ON iam.roles
  TO vorqix_platform_support_writer USING (true) WITH CHECK (true);
CREATE POLICY role_capabilities_platform_writer_scope ON iam.role_capabilities
  TO vorqix_platform_support_writer USING (true) WITH CHECK (true);
CREATE POLICY users_platform_writer_scope ON iam.users
  TO vorqix_platform_support_writer USING (true) WITH CHECK (true);
CREATE POLICY credentials_platform_writer_scope ON iam.credentials
  TO vorqix_platform_support_writer WITH CHECK (true);
CREATE POLICY user_roles_platform_writer_scope ON iam.user_roles
  TO vorqix_platform_support_writer USING (true) WITH CHECK (true);

CREATE FUNCTION platform.create_console_tenant_initial_admin(
  p_operator_id uuid,
  p_tenant_id uuid,
  p_name text,
  p_employee_number text,
  p_email text,
  p_password_hash text,
  p_request_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, iam
AS $$
DECLARE
  tenant_record record;
  admin_role_id uuid;
  created_user_id uuid;
  expected_capabilities text[] := ARRAY[
    'admin.identity.read', 'admin.identity.manage', 'admin.governance.read',
    'admin.governance.manage', 'admin.configuration.manage',
    'admin.technical-structure.manage', 'maintenance.occurrences.read',
    'maintenance.stops.read', 'maintenance.alerts.read',
    'maintenance.work-orders.read', 'maintenance.executions.read',
    'maintenance.checklists.read', 'maintenance.plans.read',
    'maintenance.plans.publish', 'cmms.structure.read', 'cmms.assets.read',
    'cmms.parameters.read', 'cmms.materials.read',
    'workflow.notifications.read', 'analytics.technical.read'
  ];
  matched_capabilities integer;
BEGIN
  IF p_operator_id IS NULL OR p_tenant_id IS NULL
     OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 3 AND 160
     OR p_employee_number IS NULL OR p_employee_number !~ '^[A-Z0-9._-]{3,40}$'
     OR p_email IS NULL OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR p_password_hash IS NULL OR length(p_password_hash) < 32
     OR p_request_id IS NULL OR length(p_request_id) > 160 THEN
    RAISE EXCEPTION 'Dados do acesso inicial inválidos.' USING ERRCODE = '22023';
  END IF;

  SELECT id, display_name, status INTO tenant_record
  FROM platform.tenants
  WHERE id = p_tenant_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR tenant_record.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'A empresa não está ativa.' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM iam.user_roles link
    JOIN iam.roles role ON role.tenant_id = link.tenant_id AND role.id = link.role_id
    JOIN iam.users account ON account.tenant_id = link.tenant_id AND account.id = link.user_id
    WHERE link.tenant_id = p_tenant_id AND role.code = 'ADMIN'
      AND role.status = 'ACTIVE' AND role.deleted_at IS NULL
      AND link.valid_from <= clock_timestamp()
      AND (link.valid_until IS NULL OR link.valid_until > clock_timestamp())
      AND account.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Esta empresa já possui um perfil TI. Use a gestão de usuários para criar ou redefinir acessos.' USING ERRCODE = '23505';
  END IF;

  SELECT id INTO admin_role_id
  FROM iam.roles
  WHERE tenant_id = p_tenant_id AND code = 'ADMIN' AND role_type = 'ADMIN'
    AND status = 'ACTIVE' AND deleted_at IS NULL
  FOR UPDATE;
  IF admin_role_id IS NULL THEN
    INSERT INTO iam.roles (tenant_id, code, name, description, role_type, protected, status)
    VALUES (p_tenant_id, 'ADMIN', 'TI',
      'Administração de TI e configuração da estrutura técnica.', 'ADMIN', true, 'ACTIVE')
    RETURNING id INTO admin_role_id;
  END IF;

  SELECT count(DISTINCT capability.code)::integer INTO matched_capabilities
  FROM iam.capabilities capability
  WHERE capability.status = 'ACTIVE' AND capability.code = ANY(expected_capabilities);
  IF matched_capabilities <> cardinality(expected_capabilities) THEN
    RAISE EXCEPTION 'O catálogo de permissões está incompleto para criar o acesso TI.' USING ERRCODE = '55000';
  END IF;

  INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, effect)
  SELECT p_tenant_id, admin_role_id, capability.id, 'ALLOW'
  FROM iam.capabilities capability
  WHERE capability.status = 'ACTIVE' AND capability.code = ANY(expected_capabilities)
  ON CONFLICT (tenant_id, role_id, capability_id) DO UPDATE SET effect = 'ALLOW';

  INSERT INTO iam.users
    (tenant_id, name, email, employee_number, status, first_access_required, metadata)
  VALUES
    (p_tenant_id, trim(p_name), lower(trim(p_email)), p_employee_number, 'ACTIVE', true,
     jsonb_build_object('created_by_platform', true, 'initial_access', true))
  RETURNING id INTO created_user_id;

  INSERT INTO iam.credentials
    (tenant_id, user_id, credential_type, algorithm, password_hash, legacy_migration_status)
  VALUES (p_tenant_id, created_user_id, 'PASSWORD', 'ARGON2ID', p_password_hash, 'NOT_REQUIRED');

  INSERT INTO iam.user_roles (tenant_id, user_id, role_id)
  VALUES (p_tenant_id, created_user_id, admin_role_id);

  INSERT INTO platform.platform_audit_events
    (operator_id, action, entity_type, entity_id, tenant_id, request_id, before_state, after_state)
  VALUES (
    p_operator_id, 'PLATFORM_TENANT_INITIAL_ADMIN_CREATED', 'IAM_USER', created_user_id::text,
    p_tenant_id, p_request_id, '{}'::jsonb,
    jsonb_build_object(
      'name', trim(p_name), 'employee_number', p_employee_number,
      'email', lower(trim(p_email)), 'profile', 'ADMIN', 'first_access_required', true
    )
  );

  RETURN created_user_id;
END;
$$;

CREATE FUNCTION platform.console_tenant_has_admin(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, iam
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM iam.user_roles link
    JOIN iam.roles role ON role.tenant_id = link.tenant_id AND role.id = link.role_id
    JOIN iam.users account ON account.tenant_id = link.tenant_id AND account.id = link.user_id
    WHERE link.tenant_id = p_tenant_id AND role.code = 'ADMIN'
      AND role.status = 'ACTIVE' AND role.deleted_at IS NULL
      AND link.valid_from <= clock_timestamp()
      AND (link.valid_until IS NULL OR link.valid_until > clock_timestamp())
      AND account.deleted_at IS NULL
  )
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
  feature_codes jsonb,
  initial_admin_created boolean
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
         COALESCE(features.codes, '[]'::jsonb),
         platform.console_tenant_has_admin(tenant.id)
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
  LEFT JOIN platform.commercial_plans plan ON plan.id = subscription.commercial_plan_id
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

ALTER FUNCTION platform.create_console_tenant_initial_admin(uuid, uuid, text, text, text, text, text)
  OWNER TO vorqix_platform_support_writer;
ALTER FUNCTION platform.console_tenant_has_admin(uuid) OWNER TO vorqix_platform_support_writer;
ALTER FUNCTION platform.list_console_tenants() OWNER TO vorqix_platform_reader;
REVOKE ALL ON FUNCTION platform.create_console_tenant_initial_admin(uuid, uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.console_tenant_has_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.list_console_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.create_console_tenant_initial_admin(uuid, uuid, text, text, text, text, text)
  TO fab_control_runtime;
GRANT EXECUTE ON FUNCTION platform.console_tenant_has_admin(uuid) TO vorqix_platform_reader;
GRANT EXECUTE ON FUNCTION platform.list_console_tenants() TO fab_control_runtime;

COMMIT;
