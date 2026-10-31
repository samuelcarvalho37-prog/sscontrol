BEGIN;

INSERT INTO iam.capabilities (code, name, description, module, protected, status)
VALUES (
  'admin.technical-structure.manage',
  'Gerenciar áreas e cargos técnicos',
  'Cria e altera áreas técnicas e cargos da equipe.',
  'ADMIN',
  true,
  'ACTIVE'
)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    module = EXCLUDED.module,
    protected = true,
    status = 'ACTIVE',
    updated_at = clock_timestamp();

DROP POLICY IF EXISTS migration_0050_tenant_enumeration ON platform.tenants;
CREATE POLICY migration_0050_tenant_enumeration
  ON platform.tenants FOR SELECT TO CURRENT_USER USING (true);
SET LOCAL row_security = on;

DO $$
DECLARE
  tenant_record record;
BEGIN
  FOR tenant_record IN
    SELECT tenant.id FROM platform.tenants tenant ORDER BY tenant.id
  LOOP
    PERFORM set_config('app.tenant_id', tenant_record.id::text, true);
    IF platform.current_tenant_id() IS DISTINCT FROM tenant_record.id THEN
      RAISE EXCEPTION 'Migration 0050 não conseguiu estabelecer o contexto do tenant %.', tenant_record.id;
    END IF;

    UPDATE iam.roles
    SET name = 'TI',
        description = 'Administração de TI da empresa e configuração da estrutura técnica.',
        updated_at = clock_timestamp()
    WHERE tenant_id = tenant_record.id
      AND code = 'ADMIN'
      AND status = 'ACTIVE'
      AND deleted_at IS NULL;

    INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, effect)
    SELECT role.tenant_id, role.id, capability.id, 'ALLOW'
    FROM iam.roles role
    CROSS JOIN iam.capabilities capability
    WHERE role.tenant_id = tenant_record.id
      AND role.code IN ('ADMIN', 'PCM')
      AND role.status = 'ACTIVE'
      AND role.deleted_at IS NULL
      AND capability.code = 'admin.technical-structure.manage'
      AND capability.status = 'ACTIVE'
    ON CONFLICT (tenant_id, role_id, capability_id) DO UPDATE
      SET effect = 'ALLOW', granted_at = clock_timestamp();
  END LOOP;
END;
$$;

DROP POLICY migration_0050_tenant_enumeration ON platform.tenants;

COMMIT;
