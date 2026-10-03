BEGIN;

CREATE TABLE maintenance.execution_support_technicians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  user_id uuid NOT NULL,
  support_slot smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT execution_support_technicians_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT execution_support_technicians_unique_member UNIQUE (tenant_id, execution_id, user_id),
  CONSTRAINT execution_support_technicians_unique_slot UNIQUE (tenant_id, execution_id, support_slot),
  CONSTRAINT execution_support_technicians_slot_check CHECK (support_slot IN (1, 2)),
  CONSTRAINT execution_support_technicians_execution_fkey
    FOREIGN KEY (tenant_id, execution_id)
    REFERENCES maintenance.executions (tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT execution_support_technicians_user_fkey
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES iam.users (tenant_id, id)
    ON DELETE RESTRICT
);

CREATE FUNCTION maintenance.enforce_execution_support_technician_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM maintenance.executions execution
    WHERE execution.tenant_id = NEW.tenant_id
      AND execution.id = NEW.execution_id
      AND execution.operator_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'O técnico principal não pode ser registrado como auxiliar.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER execution_support_technicians_integrity_trigger
BEFORE INSERT OR UPDATE OF tenant_id, execution_id, user_id
ON maintenance.execution_support_technicians
FOR EACH ROW
EXECUTE FUNCTION maintenance.enforce_execution_support_technician_integrity();

CREATE FUNCTION maintenance.enforce_execution_operator_not_support()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM maintenance.execution_support_technicians support
    WHERE support.tenant_id = NEW.tenant_id
      AND support.execution_id = NEW.id
      AND support.user_id = NEW.operator_id
  ) THEN
    RAISE EXCEPTION 'O técnico principal não pode coincidir com um auxiliar registrado.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER executions_operator_not_support_trigger
BEFORE UPDATE OF operator_id
ON maintenance.executions
FOR EACH ROW
WHEN (OLD.operator_id IS DISTINCT FROM NEW.operator_id)
EXECUTE FUNCTION maintenance.enforce_execution_operator_not_support();

CREATE INDEX execution_support_technicians_execution_idx
  ON maintenance.execution_support_technicians (tenant_id, execution_id, support_slot);

ALTER TABLE maintenance.execution_support_technicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance.execution_support_technicians FORCE ROW LEVEL SECURITY;

CREATE POLICY execution_support_technicians_tenant_isolation
  ON maintenance.execution_support_technicians
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
