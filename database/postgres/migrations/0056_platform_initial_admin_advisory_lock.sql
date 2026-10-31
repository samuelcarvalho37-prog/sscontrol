BEGIN;

CREATE OR REPLACE FUNCTION platform.create_console_tenant_initial_admin(
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

  PERFORM pg_advisory_xact_lock(1649959237, hashtext(p_tenant_id::text));

  SELECT id, display_name, status INTO tenant_record
  FROM platform.tenants
  WHERE id = p_tenant_id AND deleted_at IS NULL;
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
    AND status = 'ACTIVE' AND deleted_at IS NULL;
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

COMMIT;
