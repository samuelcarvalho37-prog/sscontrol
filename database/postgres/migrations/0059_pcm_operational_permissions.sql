BEGIN;
INSERT INTO iam.capabilities (code,name,description,module)
VALUES ('cmms.imports.manage','Importar cadastros da manutenção','Pré-analisar e confirmar importações autorizadas do PCM.','cmms')
ON CONFLICT (code) DO NOTHING;
INSERT INTO iam.role_capabilities (tenant_id,role_id,capability_id,effect)
SELECT role.tenant_id,role.id,capability.id,'ALLOW'
FROM iam.roles role CROSS JOIN iam.capabilities capability
WHERE role.code='PCM' AND role.deleted_at IS NULL
AND capability.code IN ('maintenance.plans.publish','cmms.imports.manage','admin.technical-structure.manage')
ON CONFLICT (tenant_id,role_id,capability_id) DO UPDATE SET effect='ALLOW';
COMMIT;
