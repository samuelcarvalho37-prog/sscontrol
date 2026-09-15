BEGIN;

ALTER TABLE maintenance.executions
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS paused_seconds bigint NOT NULL DEFAULT 0;

ALTER TABLE maintenance.executions
  ADD CONSTRAINT executions_paused_seconds_check CHECK (paused_seconds >= 0);

CREATE OR REPLACE FUNCTION maintenance.execution_pause_duration_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'PAUSED' AND OLD.status = 'IN_PROGRESS' THEN
    NEW.paused_at := clock_timestamp();
  ELSIF NEW.status = 'IN_PROGRESS' AND OLD.status = 'PAUSED' THEN
    NEW.paused_seconds := OLD.paused_seconds + GREATEST(0, EXTRACT(EPOCH FROM (clock_timestamp() - OLD.paused_at))::bigint);
    NEW.paused_at := NULL;
  ELSIF NEW.status = 'COMPLETED' AND OLD.status = 'PAUSED' THEN
    NEW.paused_seconds := OLD.paused_seconds + GREATEST(0, EXTRACT(EPOCH FROM (clock_timestamp() - OLD.paused_at))::bigint);
    NEW.paused_at := NULL;
  END IF;
  IF NEW.status = 'COMPLETED' THEN
    NEW.duration_seconds := GREATEST(0, EXTRACT(EPOCH FROM (NEW.completed_at - COALESCE(NEW.started_at, NEW.opened_at)))::bigint - NEW.paused_seconds);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER zzz_execution_pause_duration_guard
BEFORE UPDATE OF status ON maintenance.executions
FOR EACH ROW EXECUTE FUNCTION maintenance.execution_pause_duration_guard();

COMMIT;
