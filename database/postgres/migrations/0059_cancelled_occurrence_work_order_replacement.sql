BEGIN;

-- Keep cancelled work orders as history while allowing a replacement for the
-- same operational occurrence. Existing non-cancelled uniqueness is retained.
DROP INDEX maintenance.work_orders_one_occurrence_idx;

CREATE UNIQUE INDEX work_orders_one_occurrence_idx
  ON maintenance.work_orders (tenant_id, origin_entity_id)
  WHERE origin_type='OCCURRENCE'
    AND origin_entity_id IS NOT NULL
    AND status<>'CANCELLED';

COMMIT;
