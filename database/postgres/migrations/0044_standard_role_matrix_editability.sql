BEGIN;

-- Somente as identidades centrais do sistema ficam fora da matriz delegável.
UPDATE iam.roles
SET protected = (code IN ('ADMIN', 'SYSTEM')),
    updated_at = clock_timestamp()
WHERE status = 'ACTIVE'
  AND deleted_at IS NULL
  AND code IN (
    'ADMIN', 'SYSTEM', 'MANAGER', 'PCM', 'OPERATOR', 'TECNICO',
    'GESTOR_TECNICO', 'OPERADOR', 'PRODUCAO', 'QUALIDADE', 'SEGURANCA'
  );

COMMIT;
