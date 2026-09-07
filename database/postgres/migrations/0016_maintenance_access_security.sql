BEGIN;

ALTER TABLE platform.maintenance_windows
  ADD COLUMN failed_exchange_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN exchange_locked_until timestamptz;

ALTER TABLE platform.maintenance_windows
  ADD CONSTRAINT maintenance_windows_failed_exchange_attempts_check
    CHECK (failed_exchange_attempts >= 0),
  ADD CONSTRAINT maintenance_windows_challenge_required_check
    CHECK (status <> 'OPEN' OR challenge_hash IS NOT NULL);

CREATE INDEX maintenance_windows_exchange_lookup_idx
  ON platform.maintenance_windows (tenant_id, status, starts_at, ends_at)
  WHERE status = 'OPEN' AND single_use_consumed_at IS NULL;

COMMIT;
