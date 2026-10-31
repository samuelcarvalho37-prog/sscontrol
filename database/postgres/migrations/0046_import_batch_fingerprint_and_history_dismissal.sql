BEGIN;

ALTER TABLE governance.import_batches
  ADD COLUMN IF NOT EXISTS content_fingerprint_sha256 text,
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dismissed_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'import_batches_dismissed_by_fk'
      AND conrelid = 'governance.import_batches'::regclass
  ) THEN
    ALTER TABLE governance.import_batches
      ADD CONSTRAINT import_batches_dismissed_by_fk
      FOREIGN KEY (tenant_id, dismissed_by)
      REFERENCES iam.users(tenant_id, id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

ALTER TABLE governance.import_batches
  ADD CONSTRAINT import_batches_content_fingerprint_check
  CHECK (content_fingerprint_sha256 IS NULL OR content_fingerprint_sha256 ~ '^[a-f0-9]{64}$');

ALTER TABLE governance.import_batches
  ADD CONSTRAINT import_batches_dismissal_pair_check
  CHECK ((dismissed_at IS NULL) = (dismissed_by IS NULL));

CREATE UNIQUE INDEX import_batches_confirmed_fingerprint_uidx
  ON governance.import_batches (tenant_id, import_type, content_fingerprint_sha256)
  WHERE status = 'CONFIRMED' AND content_fingerprint_sha256 IS NOT NULL;

CREATE INDEX import_batches_visible_history_idx
  ON governance.import_batches (tenant_id, created_at DESC, id)
  WHERE dismissed_at IS NULL;

COMMIT;
