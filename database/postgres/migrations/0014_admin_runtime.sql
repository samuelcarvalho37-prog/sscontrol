BEGIN;

CREATE TABLE platform.commercial_catalog_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL DEFAULT 'PUBLISHED',
  origin text NOT NULL DEFAULT 'PUBLICATION',
  base_version_id uuid,
  catalog jsonb NOT NULL,
  content_hash_sha256 text NOT NULL,
  validation_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT commercial_catalog_versions_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT commercial_catalog_versions_number_key UNIQUE (tenant_id,version_number),
  CONSTRAINT commercial_catalog_versions_base_fk FOREIGN KEY (tenant_id,base_version_id)
    REFERENCES platform.commercial_catalog_versions(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT commercial_catalog_versions_user_fk FOREIGN KEY (tenant_id,created_by)
    REFERENCES iam.users(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT commercial_catalog_versions_status_check CHECK (status IN ('PUBLISHED','SUPERSEDED')),
  CONSTRAINT commercial_catalog_versions_origin_check CHECK (origin IN ('PUBLICATION','ROLLBACK')),
  CONSTRAINT commercial_catalog_versions_catalog_object_check CHECK (jsonb_typeof(catalog)='object')
);

CREATE UNIQUE INDEX commercial_catalog_versions_one_published
  ON platform.commercial_catalog_versions(tenant_id) WHERE status='PUBLISHED';

CREATE TABLE platform.commercial_catalog_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  base_version_id uuid,
  catalog jsonb NOT NULL,
  content_hash_sha256 text NOT NULL,
  validation_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'EDITING',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT commercial_catalog_drafts_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT commercial_catalog_drafts_user_fk FOREIGN KEY (tenant_id,user_id)
    REFERENCES iam.users(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT commercial_catalog_drafts_base_fk FOREIGN KEY (tenant_id,base_version_id)
    REFERENCES platform.commercial_catalog_versions(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT commercial_catalog_drafts_status_check CHECK (status IN ('EDITING','VALID','INVALID','PUBLISHED','DISCARDED')),
  CONSTRAINT commercial_catalog_drafts_catalog_object_check CHECK (jsonb_typeof(catalog)='object')
);

CREATE UNIQUE INDEX commercial_catalog_drafts_one_open_per_user
  ON platform.commercial_catalog_drafts(tenant_id,user_id)
  WHERE status IN ('EDITING','VALID','INVALID');

CREATE TRIGGER commercial_catalog_drafts_touch_updated_at
BEFORE UPDATE ON platform.commercial_catalog_drafts
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

ALTER TABLE platform.commercial_catalog_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.commercial_catalog_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON platform.commercial_catalog_versions
USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());
ALTER TABLE platform.commercial_catalog_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.commercial_catalog_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON platform.commercial_catalog_drafts
USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());

GRANT SELECT,INSERT,UPDATE,DELETE ON platform.commercial_catalog_versions TO fab_control_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON platform.commercial_catalog_drafts TO fab_control_runtime;

INSERT INTO iam.capabilities (code, name, description, module, protected)
VALUES
  ('admin.identity.read', 'Consultar identidades', 'Consulta usuários, áreas, cargos e matriz de capacidades.', 'ADMIN', true),
  ('admin.identity.manage', 'Gerenciar identidades', 'Cria e altera usuários, credenciais, vínculos técnicos e permissões.', 'ADMIN', true),
  ('admin.governance.read', 'Consultar governança', 'Consulta empresa, assinatura, auditoria, documentos, importações e continuidade.', 'ADMIN', true),
  ('admin.governance.manage', 'Gerenciar governança', 'Altera identidade empresarial e executa operações administrativas auditadas.', 'ADMIN', true),
  ('admin.configuration.manage', 'Gerenciar configuração', 'Valida, publica e restaura versões do motor de configuração.', 'ADMIN', true)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    module = EXCLUDED.module,
    protected = EXCLUDED.protected,
    status = 'ACTIVE';

INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, effect)
SELECT role.tenant_id, role.id, capability.id, 'ALLOW'
FROM iam.roles role
CROSS JOIN iam.capabilities capability
WHERE role.role_type = 'ADMIN'
  AND role.status = 'ACTIVE'
  AND capability.code IN (
    'admin.identity.read',
    'admin.identity.manage',
    'admin.governance.read',
    'admin.governance.manage',
    'admin.configuration.manage'
  )
ON CONFLICT (tenant_id, role_id, capability_id) DO UPDATE SET effect = 'ALLOW';

REVOKE INSERT, UPDATE, DELETE ON iam.capabilities FROM fab_control_runtime;

COMMIT;
