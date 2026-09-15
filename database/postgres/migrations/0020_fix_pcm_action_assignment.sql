BEGIN;

-- Migrations use the deployment credential (MIGRATION_DATABASE_URL), rather
-- than the tenant-scoped runtime credential. Keep the bypass transaction-local
-- so RLS remains enforced for all normal connections.
SET LOCAL row_security = off;

INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, effect)
SELECT role.tenant_id, role.id, capability.id, 'ALLOW'
FROM iam.roles AS role
CROSS JOIN iam.capabilities AS capability
WHERE role.code = 'PCM'
  AND role.status = 'ACTIVE'
  AND role.deleted_at IS NULL
  AND capability.code = 'maintenance.actions.assign'
  AND capability.status = 'ACTIVE'
ON CONFLICT (tenant_id, role_id, capability_id) DO UPDATE
SET effect = 'ALLOW';

COMMIT;
