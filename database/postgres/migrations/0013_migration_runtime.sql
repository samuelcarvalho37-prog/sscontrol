BEGIN;

CREATE TABLE migration.source_rows (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  migration_run_id uuid NOT NULL REFERENCES migration.runs(id) ON DELETE CASCADE,
  source_snapshot_id uuid NOT NULL REFERENCES migration.source_snapshots(id) ON DELETE CASCADE,
  source_name text NOT NULL,
  source_row_number bigint NOT NULL CHECK (source_row_number > 1),
  legacy_id text,
  source_hash_sha256 text NOT NULL,
  payload jsonb NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT source_rows_snapshot_row_key
    UNIQUE (source_snapshot_id, source_row_number),
  CONSTRAINT source_rows_payload_object_check
    CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX source_rows_run_source_idx
  ON migration.source_rows (migration_run_id, source_name, source_row_number);

CREATE INDEX source_rows_legacy_id_idx
  ON migration.source_rows (migration_run_id, source_name, legacy_id)
  WHERE legacy_id IS NOT NULL;

CREATE TABLE migration.file_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_run_id uuid NOT NULL REFERENCES migration.runs(id) ON DELETE CASCADE,
  source_name text NOT NULL,
  legacy_id text NOT NULL,
  source_file_id text,
  source_url text,
  file_name text,
  mime_type text,
  declared_size_bytes bigint CHECK (declared_size_bytes IS NULL OR declared_size_bytes >= 0),
  captured_size_bytes bigint CHECK (captured_size_bytes IS NULL OR captured_size_bytes >= 0),
  content_hash_sha256 text,
  status text NOT NULL DEFAULT 'PENDING',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT file_reconciliation_source_key
    UNIQUE (migration_run_id, source_name, legacy_id),
  CONSTRAINT file_reconciliation_status_check
    CHECK (status IN ('PENDING', 'VERIFIED', 'MISSING', 'HASH_MISMATCH', 'SIZE_MISMATCH', 'NOT_APPLICABLE')),
  CONSTRAINT file_reconciliation_detail_object_check
    CHECK (jsonb_typeof(detail) = 'object')
);

CREATE INDEX file_reconciliation_status_idx
  ON migration.file_reconciliation (migration_run_id, status, source_name);

CREATE TRIGGER source_rows_immutable
BEFORE UPDATE OR DELETE ON migration.source_rows
FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();

COMMIT;
