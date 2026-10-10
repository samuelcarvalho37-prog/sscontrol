BEGIN;

-- Existing deployments and seed-based environments both need this migration:
-- changing only the seed would leave already-granted ADMIN capabilities active.
DROP POLICY IF EXISTS migration_0040_tenant_enumeration ON platform.tenants;
CREATE POLICY migration_0040_tenant_enumeration
  ON platform.tenants FOR SELECT TO CURRENT_USER USING (true);
SET LOCAL row_security = on;

DO $$
DECLARE
  tenant_record record;
  maintenance_write_capabilities text[] := ARRAY[
  'maintenance.occurrences.report',
  'maintenance.occurrences.triage',
  'maintenance.stops.manage',
  'maintenance.alerts.manage',
  'maintenance.work-orders.manage',
  'maintenance.work-orders.review',
  'maintenance.work-orders.release',
  'maintenance.actions.assign',
  'maintenance.executions.perform',
  'maintenance.checklists.manage',
  'maintenance.checklists.review',
  'maintenance.checklists.publish',
  'maintenance.plans.manage',
  'cmms.structure.manage',
  'cmms.assets.manage',
  'cmms.parameters.manage',
  'cmms.materials.manage',
  'cmms.readings.create'
];
  pcm_capabilities text[] := ARRAY[
  'maintenance.occurrences.read',
  'maintenance.occurrences.triage',
  'maintenance.stops.read',
  'maintenance.stops.manage',
  'maintenance.alerts.read',
  'maintenance.alerts.manage',
  'maintenance.work-orders.read',
  'maintenance.work-orders.manage',
  'maintenance.work-orders.review',
  'maintenance.work-orders.release',
  'maintenance.actions.assign',
  'maintenance.executions.read',
  'maintenance.checklists.read',
  'maintenance.checklists.manage',
  'maintenance.checklists.review',
  'maintenance.checklists.publish',
  'maintenance.plans.read',
  'maintenance.plans.manage',
  'cmms.structure.read',
  'cmms.structure.manage',
  'cmms.assets.read',
  'cmms.assets.manage',
  'cmms.parameters.read',
  'cmms.parameters.manage',
  'cmms.materials.read',
  'cmms.materials.manage',
  'cmms.readings.create',
  'workflow.notifications.read',
  'analytics.technical.read'
];
BEGIN
  FOR tenant_record IN SELECT tenant.id FROM platform.tenants tenant ORDER BY tenant.id LOOP
    PERFORM set_config('app.tenant_id', tenant_record.id::text, true);
    IF platform.current_tenant_id() IS DISTINCT FROM tenant_record.id THEN
      RAISE EXCEPTION 'Migration 0040 não conseguiu estabelecer o contexto do tenant %.', tenant_record.id;
    END IF;

    -- ADMIN and legacy GESTOR roles lose operational writes. Plan publication
    -- remains available to ADMIN as the existing plan-governance action.
    DELETE FROM iam.role_capabilities role_capability
    USING iam.roles role, iam.capabilities capability
    WHERE role_capability.tenant_id = tenant_record.id
      AND role.tenant_id = role_capability.tenant_id
      AND role.id = role_capability.role_id
      AND capability.id = role_capability.capability_id
      AND role_capability.effect = 'ALLOW'
      AND capability.code = ANY(maintenance_write_capabilities)
      AND capability.code <> 'maintenance.plans.publish'
      AND role.code IN ('ADMIN', 'GESTOR_TECNICO', 'GESTOR', 'MANAGER');

    DELETE FROM iam.user_capabilities user_capability
    USING iam.user_roles user_role, iam.roles role, iam.capabilities capability
    WHERE user_capability.tenant_id = tenant_record.id
      AND user_role.tenant_id = user_capability.tenant_id
      AND user_role.user_id = user_capability.user_id
      AND role.tenant_id = user_role.tenant_id
      AND role.id = user_role.role_id
      AND role.role_type = 'ADMIN'
      AND capability.id = user_capability.capability_id
      AND user_capability.effect = 'ALLOW'
      AND capability.code = ANY(maintenance_write_capabilities)
      AND capability.code <> 'maintenance.plans.publish';

    INSERT INTO iam.roles (tenant_id, code, name, description, role_type, protected, status)
    VALUES (tenant_record.id, 'PCM', 'PCM', 'Administração e operação do domínio da manutenção.', 'MANAGER', true, 'ACTIVE')
    ON CONFLICT (tenant_id, code) DO UPDATE
      SET name = EXCLUDED.name,
          description = EXCLUDED.description,
          role_type = 'MANAGER',
          protected = true,
          status = 'ACTIVE',
          deleted_at = NULL,
          updated_at = clock_timestamp();

    -- Existing maintenance managers become PCM operators. Keep their original
    -- users and assignment validity; only replace the legacy role association.
    INSERT INTO iam.user_roles
      (tenant_id, user_id, role_id, valid_from, valid_until, assigned_by, created_at)
    SELECT user_role.tenant_id, user_role.user_id, pcm_role.id,
           user_role.valid_from, user_role.valid_until, user_role.assigned_by, user_role.created_at
    FROM iam.user_roles user_role
    JOIN iam.roles legacy_role
      ON legacy_role.tenant_id = user_role.tenant_id
     AND legacy_role.id = user_role.role_id
    JOIN iam.roles pcm_role
      ON pcm_role.tenant_id = user_role.tenant_id
     AND pcm_role.code = 'PCM'
     AND pcm_role.status = 'ACTIVE'
    WHERE user_role.tenant_id = tenant_record.id
      AND legacy_role.code IN ('GESTOR_TECNICO', 'GESTOR', 'MANAGER')
    ON CONFLICT (tenant_id, user_id, role_id) DO UPDATE
      SET valid_from = LEAST(iam.user_roles.valid_from, EXCLUDED.valid_from),
          valid_until = CASE
            WHEN iam.user_roles.valid_until IS NULL OR EXCLUDED.valid_until IS NULL THEN NULL
            ELSE GREATEST(iam.user_roles.valid_until, EXCLUDED.valid_until)
          END;

    DELETE FROM iam.user_roles user_role
    USING iam.roles legacy_role
    WHERE user_role.tenant_id = tenant_record.id
      AND legacy_role.tenant_id = user_role.tenant_id
      AND legacy_role.id = user_role.role_id
      AND legacy_role.code IN ('GESTOR_TECNICO', 'GESTOR', 'MANAGER');

    DELETE FROM iam.user_capabilities user_capability
    USING iam.user_roles user_role, iam.roles role, iam.capabilities capability
    WHERE user_capability.tenant_id = tenant_record.id
      AND user_role.tenant_id = user_capability.tenant_id
      AND user_role.user_id = user_capability.user_id
      AND role.tenant_id = user_role.tenant_id
      AND role.id = user_role.role_id
      AND role.code IN ('GESTOR_TECNICO', 'GESTOR', 'MANAGER', 'PCM')
      AND capability.id = user_capability.capability_id
      AND user_capability.effect = 'ALLOW'
      AND capability.code = ANY(maintenance_write_capabilities)
      AND capability.code <> 'maintenance.plans.publish';

    INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, effect)
    SELECT tenant_record.id, role.id, capability.id, 'ALLOW'
    FROM iam.roles role
    JOIN iam.capabilities capability ON capability.code = ANY(pcm_capabilities)
    WHERE role.tenant_id = tenant_record.id
      AND role.code = 'PCM'
      AND role.status = 'ACTIVE'
      AND capability.status = 'ACTIVE'
    ON CONFLICT (tenant_id, role_id, capability_id) DO UPDATE SET effect = 'ALLOW';

    -- PCM manages plan content but cannot self-publish. Remove pre-existing
    -- role and direct-user ALLOW grants while leaving ADMIN publication intact.
    DELETE FROM iam.role_capabilities role_capability
    USING iam.roles role, iam.capabilities capability
    WHERE role_capability.tenant_id = tenant_record.id
      AND role.tenant_id = role_capability.tenant_id
      AND role.id = role_capability.role_id
      AND role.code = 'PCM'
      AND capability.id = role_capability.capability_id
      AND capability.code = 'maintenance.plans.publish'
      AND role_capability.effect = 'ALLOW';

    DELETE FROM iam.user_capabilities user_capability
    USING iam.user_roles user_role, iam.roles role, iam.capabilities capability
    WHERE user_capability.tenant_id = tenant_record.id
      AND user_role.tenant_id = user_capability.tenant_id
      AND user_role.user_id = user_capability.user_id
      AND role.tenant_id = user_role.tenant_id
      AND role.id = user_role.role_id
      AND role.code = 'PCM'
      AND capability.id = user_capability.capability_id
      AND capability.code = 'maintenance.plans.publish'
      AND user_capability.effect = 'ALLOW';

    IF NOT EXISTS (
      SELECT 1 FROM iam.roles role
      WHERE role.tenant_id = tenant_record.id AND role.code = 'PCM' AND role.status = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'Migration 0040 não criou o perfil PCM para o tenant %.', tenant_record.id;
    END IF;
  END LOOP;
END;
$$;

DROP POLICY migration_0040_tenant_enumeration ON platform.tenants;

COMMIT;
