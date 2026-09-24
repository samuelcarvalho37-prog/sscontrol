BEGIN;

INSERT INTO iam.capabilities (code, name, description, module, protected)
VALUES (
  'maintenance.actions.assign',
  'Atribuir ações de manutenção',
  'Atribui ações prontas a técnicos ativos, sem permitir edição ou liberação da OS.',
  'MAINTENANCE',
  true
)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    module = EXCLUDED.module,
    protected = EXCLUDED.protected,
    status = 'ACTIVE';

INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, effect)
SELECT role.tenant_id, role.id, capability.id, 'ALLOW'
FROM iam.roles role
JOIN iam.capabilities capability ON capability.code = 'maintenance.actions.assign'
WHERE role.code = 'PCM'
  AND role.status = 'ACTIVE'
  AND role.deleted_at IS NULL
  AND capability.status = 'ACTIVE'
ON CONFLICT (tenant_id, role_id, capability_id) DO UPDATE SET effect = 'ALLOW';

COMMIT;
