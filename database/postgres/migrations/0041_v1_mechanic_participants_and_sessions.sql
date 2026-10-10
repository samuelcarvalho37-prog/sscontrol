BEGIN;

CREATE TABLE maintenance.work_order_action_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  action_id uuid NOT NULL,
  execution_id uuid,
  user_id uuid NOT NULL,
  participant_role text NOT NULL,
  invitation_status text NOT NULL,
  invited_by uuid,
  invited_at timestamptz,
  responded_at timestamptz,
  joined_at timestamptz,
  left_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT work_order_action_participants_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT work_order_action_participants_tenant_identity_key
    UNIQUE (tenant_id, id, execution_id, user_id),
  CONSTRAINT work_order_action_participants_role_check
    CHECK (participant_role IN ('PRIMARY', 'COLLABORATOR')),
  CONSTRAINT work_order_action_participants_status_check
    CHECK (invitation_status IN ('PRIMARY', 'INVITED', 'ACCEPTED', 'DECLINED', 'REMOVED')),
  CONSTRAINT work_order_action_participants_role_status_check
    CHECK ((participant_role = 'PRIMARY' AND invitation_status = 'PRIMARY')
        OR (participant_role = 'COLLABORATOR' AND invitation_status <> 'PRIMARY')),
  CONSTRAINT work_order_action_participants_dates_check
    CHECK ((invitation_status <> 'INVITED' OR (invited_by IS NOT NULL AND invited_at IS NOT NULL))
       AND (invitation_status NOT IN ('ACCEPTED', 'DECLINED') OR responded_at IS NOT NULL)
       AND (invitation_status NOT IN ('PRIMARY', 'ACCEPTED') OR joined_at IS NOT NULL)
       AND (invitation_status <> 'REMOVED' OR left_at IS NOT NULL)),
  CONSTRAINT work_order_action_participants_action_fk
    FOREIGN KEY (tenant_id, action_id)
    REFERENCES maintenance.work_order_actions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT work_order_action_participants_execution_fk
    FOREIGN KEY (tenant_id, execution_id)
    REFERENCES maintenance.executions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT work_order_action_participants_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES iam.users (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT work_order_action_participants_inviter_fk
    FOREIGN KEY (tenant_id, invited_by)
    REFERENCES iam.users (tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX work_order_action_participants_one_primary
  ON maintenance.work_order_action_participants (tenant_id, action_id)
  WHERE participant_role = 'PRIMARY' AND invitation_status = 'PRIMARY';
CREATE UNIQUE INDEX work_order_action_participants_unique_active_user
  ON maintenance.work_order_action_participants (tenant_id, action_id, user_id)
  WHERE invitation_status IN ('PRIMARY', 'INVITED', 'ACCEPTED');
CREATE INDEX work_order_action_participants_user_queue_idx
  ON maintenance.work_order_action_participants (tenant_id, user_id, invitation_status, action_id);

CREATE TABLE maintenance.execution_participant_work_intervals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  user_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz,
  ended_reason text,
  pause_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT execution_participant_work_intervals_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT execution_participant_work_intervals_period_check
    CHECK (ended_at IS NULL OR ended_at >= started_at),
  CONSTRAINT execution_participant_work_intervals_reason_check
    CHECK (ended_reason IS NULL OR ended_reason IN ('PAUSE', 'GLOBAL_PAUSE', 'COMPLETED', 'LEFT')),
  CONSTRAINT execution_participant_work_intervals_pause_reason_check
    CHECK (pause_reason IS NULL OR length(btrim(pause_reason)) BETWEEN 3 AND 500),
  CONSTRAINT execution_participant_work_intervals_close_check
    CHECK ((ended_at IS NULL AND ended_reason IS NULL) OR ended_at IS NOT NULL),
  CONSTRAINT execution_participant_work_intervals_participant_fk
    FOREIGN KEY (tenant_id, participant_id, execution_id, user_id)
    REFERENCES maintenance.work_order_action_participants (tenant_id, id, execution_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT execution_participant_work_intervals_execution_fk
    FOREIGN KEY (tenant_id, execution_id)
    REFERENCES maintenance.executions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT execution_participant_work_intervals_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES iam.users (tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX execution_participant_work_intervals_one_open
  ON maintenance.execution_participant_work_intervals (tenant_id, participant_id)
  WHERE ended_at IS NULL;
CREATE INDEX execution_participant_work_intervals_summary_idx
  ON maintenance.execution_participant_work_intervals (tenant_id, execution_id, user_id, started_at);

CREATE TABLE maintenance.execution_global_pause_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  paused_by uuid NOT NULL,
  resumed_by uuid,
  reason_code text NOT NULL,
  reason_detail text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT execution_global_pause_periods_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT execution_global_pause_periods_reason_check
    CHECK (reason_code IN ('SUPER_URGENCIA', 'AGUARDANDO_PECA', 'AGUARDANDO_PRODUCAO',
      'AGUARDANDO_TERCEIRO', 'CONTINUIDADE_PROXIMO_TURNO', 'DIAGNOSTICO_PENDENTE', 'OUTRO')),
  CONSTRAINT execution_global_pause_periods_detail_check
    CHECK (reason_code <> 'OUTRO' OR (reason_detail IS NOT NULL AND length(btrim(reason_detail)) BETWEEN 3 AND 500)),
  CONSTRAINT execution_global_pause_periods_period_check
    CHECK (ended_at IS NULL OR ended_at >= started_at),
  CONSTRAINT execution_global_pause_periods_actor_check
    CHECK ((ended_at IS NULL AND resumed_by IS NULL) OR (ended_at IS NOT NULL AND resumed_by IS NOT NULL)),
  CONSTRAINT execution_global_pause_periods_execution_fk
    FOREIGN KEY (tenant_id, execution_id)
    REFERENCES maintenance.executions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT execution_global_pause_periods_paused_by_fk
    FOREIGN KEY (tenant_id, paused_by) REFERENCES iam.users (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT execution_global_pause_periods_resumed_by_fk
    FOREIGN KEY (tenant_id, resumed_by) REFERENCES iam.users (tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX execution_global_pause_periods_one_open
  ON maintenance.execution_global_pause_periods (tenant_id, execution_id)
  WHERE ended_at IS NULL;
CREATE INDEX execution_global_pause_periods_history_idx
  ON maintenance.execution_global_pause_periods (tenant_id, execution_id, started_at);

CREATE FUNCTION maintenance.validate_action_participant_execution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE execution_action_id uuid; execution_operator_id uuid;
BEGIN
  IF NEW.execution_id IS NULL THEN RETURN NEW; END IF;
  SELECT execution.work_order_action_id, execution.operator_id
    INTO execution_action_id, execution_operator_id
  FROM maintenance.executions execution
  WHERE execution.tenant_id=NEW.tenant_id AND execution.id=NEW.execution_id;
  IF execution_action_id IS NULL OR execution_action_id <> NEW.action_id THEN
    RAISE EXCEPTION 'participant execution must belong to the same action and tenant'
      USING ERRCODE='23514', CONSTRAINT='work_order_action_participants_execution_action_check';
  END IF;
  IF NEW.participant_role='PRIMARY' AND execution_operator_id IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'primary participant must match execution.operator_id'
      USING ERRCODE='23514', CONSTRAINT='work_order_action_participants_primary_operator_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER work_order_action_participants_execution_guard
BEFORE INSERT OR UPDATE OF tenant_id,action_id,execution_id,user_id,participant_role
ON maintenance.work_order_action_participants
FOR EACH ROW EXECUTE FUNCTION maintenance.validate_action_participant_execution();

CREATE FUNCTION maintenance.prevent_execution_primary_replacement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM maintenance.work_order_action_participants participant
    WHERE participant.tenant_id=OLD.tenant_id AND participant.execution_id=OLD.id
      AND (participant.action_id IS DISTINCT FROM NEW.work_order_action_id OR
        (participant.participant_role='PRIMARY' AND participant.invitation_status='PRIMARY'
          AND participant.user_id IS DISTINCT FROM NEW.operator_id))
  ) THEN
    RAISE EXCEPTION 'execution action and operator must remain consistent with participants'
      USING ERRCODE='23514', CONSTRAINT='executions_primary_operator_stable_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER executions_primary_operator_guard
BEFORE UPDATE OF tenant_id,operator_id,work_order_action_id ON maintenance.executions
FOR EACH ROW EXECUTE FUNCTION maintenance.prevent_execution_primary_replacement();

-- Preserve the current owner of any still-actionable legacy action as its
-- principal. Completed execution history remains in the existing execution
-- and history tables; no work interval is inferred for historical records.
INSERT INTO maintenance.work_order_action_participants
  (tenant_id, action_id, execution_id, user_id, participant_role, invitation_status, joined_at)
SELECT action.tenant_id, action.id, execution.id,
       COALESCE(execution.operator_id, action.responsible_id), 'PRIMARY', 'PRIMARY',
       COALESCE(execution.opened_at, action.generated_at)
FROM maintenance.work_order_actions action
LEFT JOIN LATERAL (
  SELECT current_execution.id, current_execution.operator_id, current_execution.opened_at
  FROM maintenance.executions current_execution
  WHERE current_execution.tenant_id = action.tenant_id
    AND current_execution.work_order_action_id = action.id
    AND current_execution.status IN ('OPEN', 'IN_PROGRESS', 'PAUSED', 'BLOCKED')
  ORDER BY current_execution.created_at DESC, current_execution.id DESC
  LIMIT 1
) execution ON true
WHERE action.status IN ('READY', 'IN_PROGRESS', 'BLOCKED')
  AND COALESCE(execution.operator_id, action.responsible_id) IS NOT NULL;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'work_order_action_participants',
    'execution_participant_work_intervals',
    'execution_global_pause_periods'
  ] LOOP
    EXECUTE format('ALTER TABLE maintenance.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE maintenance.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON maintenance.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())',
      table_name || '_tenant_isolation', table_name
    );
  END LOOP;
END;
$$;

GRANT SELECT, INSERT, UPDATE ON maintenance.work_order_action_participants TO fab_control_runtime;
GRANT SELECT ON maintenance.work_order_action_participants TO fab_control_readonly;
GRANT SELECT, INSERT, UPDATE ON maintenance.execution_participant_work_intervals TO fab_control_runtime;
GRANT SELECT ON maintenance.execution_participant_work_intervals TO fab_control_readonly;
GRANT SELECT, INSERT, UPDATE ON maintenance.execution_global_pause_periods TO fab_control_runtime;
GRANT SELECT ON maintenance.execution_global_pause_periods TO fab_control_readonly;

COMMIT;
