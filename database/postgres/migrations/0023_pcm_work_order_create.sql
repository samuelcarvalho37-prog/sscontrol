BEGIN;

SET LOCAL row_security = off;

-- PCM creates and corrects work orders, but does not receive technical
-- execution or validation capabilities.
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, effect)
SELECT role.tenant_id, role.id, capability.id, 'ALLOW'
FROM iam.roles AS role
CROSS JOIN iam.capabilities AS capability
WHERE role.code = 'PCM'
  AND role.status = 'ACTIVE'
  AND role.deleted_at IS NULL
  AND capability.code = 'maintenance.work-orders.manage'
  AND capability.status = 'ACTIVE'
ON CONFLICT (tenant_id, role_id, capability_id) DO UPDATE
SET effect = 'ALLOW';

COMMIT;
