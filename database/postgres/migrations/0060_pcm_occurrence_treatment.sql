BEGIN;

ALTER TABLE maintenance.operational_occurrences
  ADD COLUMN treatment_scheduled_for timestamptz,
  ADD COLUMN treatment_decision_note text,
  ADD COLUMN treatment_decided_by uuid,
  ADD COLUMN treatment_decided_at timestamptz;

ALTER TABLE maintenance.operational_occurrences
  ADD CONSTRAINT operational_occurrences_decided_by_fk
  FOREIGN KEY (tenant_id, treatment_decided_by) REFERENCES iam.users(tenant_id,id) ON DELETE RESTRICT;

CREATE INDEX operational_occurrences_scheduled_treatment_idx
  ON maintenance.operational_occurrences (tenant_id,treatment_scheduled_for)
  WHERE treatment_scheduled_for IS NOT NULL AND status IN ('OPEN','IN_TREATMENT');

COMMIT;
