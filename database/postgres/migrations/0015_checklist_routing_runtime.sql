BEGIN;

CREATE TABLE maintenance.checklist_version_validator_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  checklist_template_version_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT checklist_version_validator_users_scope_key
    UNIQUE (tenant_id, checklist_template_version_id, user_id),
  CONSTRAINT checklist_version_validator_users_version_fk
    FOREIGN KEY (tenant_id, checklist_template_version_id)
    REFERENCES maintenance.checklist_template_versions(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT checklist_version_validator_users_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT checklist_version_validator_users_creator_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX checklist_version_validator_users_user_idx
  ON maintenance.checklist_version_validator_users
  (tenant_id, user_id, checklist_template_version_id);

ALTER TABLE maintenance.checklist_version_validator_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance.checklist_version_validator_users FORCE ROW LEVEL SECURITY;

CREATE POLICY checklist_version_validator_users_tenant_isolation
  ON maintenance.checklist_version_validator_users
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE
  ON maintenance.checklist_version_validator_users TO fab_control_runtime;

COMMIT;
