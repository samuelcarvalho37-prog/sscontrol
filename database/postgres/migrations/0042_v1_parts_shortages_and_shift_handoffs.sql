BEGIN;

-- Composite keys let new records prove that their action, order, and execution
-- form one tenant-safe chain rather than merely referencing three valid IDs.
CREATE UNIQUE INDEX work_order_actions_tenant_id_order_key
  ON maintenance.work_order_actions (tenant_id, id, work_order_id);
CREATE UNIQUE INDEX executions_tenant_id_action_order_key
  ON maintenance.executions (tenant_id, id, work_order_action_id, work_order_id);

ALTER TABLE maintenance.execution_participant_work_intervals
  DROP CONSTRAINT execution_participant_work_intervals_reason_check;
ALTER TABLE maintenance.execution_participant_work_intervals
  ADD CONSTRAINT execution_participant_work_intervals_reason_check
  CHECK (ended_reason IS NULL OR ended_reason IN ('PAUSE', 'GLOBAL_PAUSE', 'COMPLETED', 'LEFT', 'SHIFT_HANDOFF'));

CREATE TABLE maintenance.work_order_part_shortages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  action_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  reported_by uuid NOT NULL,
  part_code text,
  description text NOT NULL,
  quantity numeric(18,4) NOT NULL,
  unit text NOT NULL,
  observation text,
  blocking boolean NOT NULL DEFAULT true,
  evidence_id uuid,
  status text NOT NULL DEFAULT 'OPEN',
  resolution_note text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT work_order_part_shortages_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT work_order_part_shortages_description_check
    CHECK (length(btrim(description)) BETWEEN 3 AND 500),
  CONSTRAINT work_order_part_shortages_code_check
    CHECK (part_code IS NULL OR length(btrim(part_code)) BETWEEN 1 AND 120),
  CONSTRAINT work_order_part_shortages_quantity_check CHECK (quantity > 0),
  CONSTRAINT work_order_part_shortages_unit_check CHECK (length(btrim(unit)) BETWEEN 1 AND 40),
  CONSTRAINT work_order_part_shortages_observation_check
    CHECK (observation IS NULL OR length(btrim(observation)) <= 2_000),
  CONSTRAINT work_order_part_shortages_status_check CHECK (status IN ('OPEN','RESOLVED','CANCELLED')),
  CONSTRAINT work_order_part_shortages_resolution_check CHECK (
    (status='OPEN' AND resolved_by IS NULL AND resolved_at IS NULL AND resolution_note IS NULL)
    OR (status IN ('RESOLVED','CANCELLED') AND resolved_by IS NOT NULL
      AND resolved_at IS NOT NULL AND resolution_note IS NOT NULL
      AND length(btrim(resolution_note)) BETWEEN 3 AND 2_000)
  ),
  CONSTRAINT work_order_part_shortages_order_fk
    FOREIGN KEY (tenant_id,work_order_id) REFERENCES maintenance.work_orders(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT work_order_part_shortages_action_order_fk
    FOREIGN KEY (tenant_id,action_id,work_order_id)
    REFERENCES maintenance.work_order_actions(tenant_id,id,work_order_id) ON DELETE RESTRICT,
  CONSTRAINT work_order_part_shortages_execution_chain_fk
    FOREIGN KEY (tenant_id,execution_id,action_id,work_order_id)
    REFERENCES maintenance.executions(tenant_id,id,work_order_action_id,work_order_id) ON DELETE RESTRICT,
  CONSTRAINT work_order_part_shortages_reporter_fk
    FOREIGN KEY (tenant_id,reported_by) REFERENCES iam.users(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT work_order_part_shortages_resolver_fk
    FOREIGN KEY (tenant_id,resolved_by) REFERENCES iam.users(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT work_order_part_shortages_evidence_fk
    FOREIGN KEY (tenant_id,evidence_id) REFERENCES maintenance.evidence(tenant_id,id) ON DELETE RESTRICT
);

CREATE INDEX work_order_part_shortages_open_order_idx
  ON maintenance.work_order_part_shortages(tenant_id,work_order_id,created_at)
  WHERE status='OPEN';
CREATE INDEX work_order_part_shortages_execution_status_idx
  ON maintenance.work_order_part_shortages(tenant_id,execution_id,status,blocking);

CREATE TABLE maintenance.execution_shift_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  action_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  equipment_condition text NOT NULL,
  pending_work text NOT NULL,
  recommended_next_step text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT execution_shift_handoffs_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT execution_shift_handoffs_condition_check CHECK (length(btrim(equipment_condition)) BETWEEN 3 AND 2_000),
  CONSTRAINT execution_shift_handoffs_pending_check CHECK (length(btrim(pending_work)) BETWEEN 1 AND 4_000),
  CONSTRAINT execution_shift_handoffs_next_step_check CHECK (length(btrim(recommended_next_step)) BETWEEN 3 AND 2_000),
  CONSTRAINT execution_shift_handoffs_order_fk
    FOREIGN KEY (tenant_id,work_order_id) REFERENCES maintenance.work_orders(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT execution_shift_handoffs_action_order_fk
    FOREIGN KEY (tenant_id,action_id,work_order_id)
    REFERENCES maintenance.work_order_actions(tenant_id,id,work_order_id) ON DELETE RESTRICT,
  CONSTRAINT execution_shift_handoffs_execution_chain_fk
    FOREIGN KEY (tenant_id,execution_id,action_id,work_order_id)
    REFERENCES maintenance.executions(tenant_id,id,work_order_action_id,work_order_id) ON DELETE RESTRICT,
  CONSTRAINT execution_shift_handoffs_participant_fk
    FOREIGN KEY (tenant_id,participant_id,execution_id,user_id)
    REFERENCES maintenance.work_order_action_participants(tenant_id,id,execution_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT execution_shift_handoffs_user_fk
    FOREIGN KEY (tenant_id,user_id) REFERENCES iam.users(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX execution_shift_handoffs_execution_time_idx
  ON maintenance.execution_shift_handoffs(tenant_id,execution_id,created_at DESC);

CREATE FUNCTION maintenance.guard_part_shortage_evidence_chain()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.evidence_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM maintenance.evidence evidence
    WHERE evidence.tenant_id=NEW.tenant_id AND evidence.id=NEW.evidence_id
      AND evidence.execution_id=NEW.execution_id AND evidence.work_order_action_id=NEW.action_id
      AND evidence.user_id=NEW.reported_by AND evidence.evidence_type='PHOTO'
      AND evidence.execution_checklist_item_id IS NULL
  ) THEN
    RAISE EXCEPTION 'shortage photo must be a photo uploaded by its reporter for the same execution'
      USING ERRCODE='23514', CONSTRAINT='work_order_part_shortages_evidence_chain_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER work_order_part_shortages_evidence_guard
BEFORE INSERT OR UPDATE OF tenant_id,action_id,execution_id,reported_by,evidence_id
ON maintenance.work_order_part_shortages
FOR EACH ROW EXECUTE FUNCTION maintenance.guard_part_shortage_evidence_chain();

CREATE FUNCTION maintenance.guard_part_shortage_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (NEW.tenant_id,NEW.work_order_id,NEW.action_id,NEW.execution_id,NEW.reported_by,
        NEW.part_code,NEW.description,NEW.quantity,NEW.unit,NEW.observation,NEW.blocking,
        NEW.evidence_id,NEW.created_at)
       IS DISTINCT FROM
       (OLD.tenant_id,OLD.work_order_id,OLD.action_id,OLD.execution_id,OLD.reported_by,
        OLD.part_code,OLD.description,OLD.quantity,OLD.unit,OLD.observation,OLD.blocking,
        OLD.evidence_id,OLD.created_at) THEN
      RAISE EXCEPTION 'reported shortage details are immutable'
        USING ERRCODE='23514', CONSTRAINT='work_order_part_shortages_immutable_report_check';
    END IF;
    IF OLD.status <> 'OPEN' OR NEW.status NOT IN ('RESOLVED','CANCELLED') THEN
      RAISE EXCEPTION 'only an open shortage may be resolved or cancelled once'
        USING ERRCODE='23514', CONSTRAINT='work_order_part_shortages_terminal_state_check';
    END IF;
    NEW.updated_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER work_order_part_shortages_transition_guard
BEFORE UPDATE ON maintenance.work_order_part_shortages
FOR EACH ROW EXECUTE FUNCTION maintenance.guard_part_shortage_transition();

CREATE FUNCTION maintenance.guard_blocked_execution_resume()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='PAUSED' AND NEW.status='IN_PROGRESS' AND EXISTS (
    SELECT 1 FROM maintenance.work_order_part_shortages shortage
    WHERE shortage.tenant_id=OLD.tenant_id AND shortage.execution_id=OLD.id
      AND shortage.status='OPEN' AND shortage.blocking
      AND EXISTS (SELECT 1 FROM maintenance.execution_global_pause_periods pause
        WHERE pause.tenant_id=OLD.tenant_id AND pause.execution_id=OLD.id
          AND pause.ended_at IS NULL AND pause.reason_code='AGUARDANDO_PECA')
  ) THEN
    RAISE EXCEPTION 'blocking part shortages must be resolved or cancelled before resuming'
      USING ERRCODE='23514', CONSTRAINT='executions_open_blocking_shortage_resume_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER executions_blocking_shortage_resume_guard
BEFORE UPDATE OF status ON maintenance.executions
FOR EACH ROW EXECUTE FUNCTION maintenance.guard_blocked_execution_resume();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['work_order_part_shortages','execution_shift_handoffs'] LOOP
    EXECUTE format('ALTER TABLE maintenance.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE maintenance.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format(
      'CREATE POLICY %I ON maintenance.%I USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id())',
      table_name || '_tenant_isolation',table_name);
  END LOOP;
END;
$$;

GRANT SELECT,INSERT,UPDATE ON maintenance.work_order_part_shortages TO fab_control_runtime;
GRANT SELECT ON maintenance.work_order_part_shortages TO fab_control_readonly;
GRANT SELECT,INSERT ON maintenance.execution_shift_handoffs TO fab_control_runtime;
GRANT SELECT ON maintenance.execution_shift_handoffs TO fab_control_readonly;
REVOKE DELETE ON maintenance.work_order_part_shortages,maintenance.execution_shift_handoffs FROM fab_control_runtime;

COMMIT;
