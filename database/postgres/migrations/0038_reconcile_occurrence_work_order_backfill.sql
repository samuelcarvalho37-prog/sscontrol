BEGIN;

-- The migration role is deliberately subject to FORCE RLS. This policy exists
-- only inside this transaction so the migration can enumerate tenant IDs; all
-- reads and writes to business tables still use their regular tenant policy.
DROP POLICY IF EXISTS migration_0038_tenant_enumeration ON platform.tenants;
CREATE POLICY migration_0038_tenant_enumeration
  ON platform.tenants
  FOR SELECT
  TO CURRENT_USER
  USING (true);

SET LOCAL row_security = on;

CREATE TEMPORARY TABLE migration_0038_candidates (
  tenant_id uuid NOT NULL,
  occurrence_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  work_order_action_id uuid,
  active_notification_count integer NOT NULL,
  PRIMARY KEY (tenant_id, occurrence_id),
  UNIQUE (tenant_id, work_order_id)
) ON COMMIT DROP;

DO $$
DECLARE
  tenant_record record;
  tenant_count integer;
  processed_tenants integer := 0;
  candidate_count integer;
  converted_count integer;
  linked_count integer;
  invalid_count integer;
  total_candidates integer := 0;
BEGIN
  SELECT count(*)::integer INTO tenant_count FROM platform.tenants;

  FOR tenant_record IN
    SELECT tenant.id FROM platform.tenants tenant ORDER BY tenant.id
  LOOP
    PERFORM set_config('app.tenant_id', tenant_record.id::text, true);

    IF platform.current_tenant_id() IS DISTINCT FROM tenant_record.id THEN
      RAISE EXCEPTION
        'Migration 0038 não conseguiu estabelecer o contexto do tenant %.',
        tenant_record.id;
    END IF;

    INSERT INTO migration_0038_candidates (
      tenant_id,
      occurrence_id,
      work_order_id,
      work_order_action_id,
      active_notification_count
    )
    SELECT
      occurrence.tenant_id,
      occurrence.id,
      work_order.id,
      action.id,
      (
        SELECT count(*)::integer
        FROM workflow.notifications notification
        WHERE notification.tenant_id = occurrence.tenant_id
          AND notification.notification_type = 'OCCURRENCE_REPORTED'
          AND notification.entity_type = 'OPERATIONAL_OCCURRENCE'
          AND notification.entity_id = occurrence.id
          AND notification.status = 'ACTIVE'
      )
    FROM maintenance.operational_occurrences occurrence
    JOIN maintenance.work_orders work_order
      ON work_order.tenant_id = occurrence.tenant_id
     AND work_order.origin_entity_id = occurrence.id
    LEFT JOIN maintenance.work_order_actions action
      ON action.tenant_id = work_order.tenant_id
     AND action.work_order_id = work_order.id
     AND action.origin = 'WORK_ORDER_RELEASE'
    WHERE occurrence.tenant_id = tenant_record.id
      AND occurrence.status = 'OPEN'
      AND occurrence.treatment_status = 'UNTRIAGED'
      AND occurrence.work_order_id IS NULL
      AND occurrence.work_order_action_id IS NULL
      AND work_order.origin_type IN ('PCM', 'OCCURRENCE')
      AND work_order.asset_id = occurrence.asset_id
      AND (
        SELECT count(*)
        FROM maintenance.work_orders related_work_order
        WHERE related_work_order.tenant_id = occurrence.tenant_id
          AND related_work_order.origin_entity_id = occurrence.id
      ) = 1;

    GET DIAGNOSTICS candidate_count = ROW_COUNT;
    total_candidates := total_candidates + candidate_count;

    UPDATE maintenance.work_orders work_order
    SET origin_type = 'OCCURRENCE'
    FROM migration_0038_candidates candidate
    WHERE candidate.tenant_id = tenant_record.id
      AND work_order.tenant_id = candidate.tenant_id
      AND work_order.id = candidate.work_order_id
      AND work_order.origin_type = 'PCM';

    GET DIAGNOSTICS converted_count = ROW_COUNT;

    SELECT count(*)::integer
    INTO invalid_count
    FROM migration_0038_candidates candidate
    JOIN maintenance.work_orders work_order
      ON work_order.tenant_id = candidate.tenant_id
     AND work_order.id = candidate.work_order_id
    WHERE candidate.tenant_id = tenant_record.id
      AND work_order.origin_type <> 'OCCURRENCE';

    IF invalid_count <> 0 THEN
      RAISE EXCEPTION
        'Migration 0038 não canonicalizou % OS(s) do tenant %.',
        invalid_count,
        tenant_record.id;
    END IF;

    UPDATE maintenance.operational_occurrences occurrence
    SET work_order_id = candidate.work_order_id,
        work_order_action_id = candidate.work_order_action_id,
        status = 'IN_TREATMENT',
        treatment_status = 'WORK_ORDER_CREATED',
        updated_at = clock_timestamp()
    FROM migration_0038_candidates candidate
    WHERE candidate.tenant_id = tenant_record.id
      AND occurrence.tenant_id = candidate.tenant_id
      AND occurrence.id = candidate.occurrence_id
      AND (occurrence.work_order_id IS NULL OR occurrence.work_order_id = candidate.work_order_id)
      AND (
        occurrence.work_order_action_id IS NULL
        OR occurrence.work_order_action_id IS NOT DISTINCT FROM candidate.work_order_action_id
      );

    GET DIAGNOSTICS linked_count = ROW_COUNT;

    IF linked_count <> candidate_count THEN
      RAISE EXCEPTION
        'Migration 0038 esperava reconciliar % ocorrência(s), mas reconciliou % no tenant %.',
        candidate_count,
        linked_count,
        tenant_record.id;
    END IF;

    UPDATE workflow.notifications notification
    SET status = 'RETRACTED'
    FROM migration_0038_candidates candidate
    WHERE candidate.tenant_id = tenant_record.id
      AND notification.tenant_id = candidate.tenant_id
      AND notification.notification_type = 'OCCURRENCE_REPORTED'
      AND notification.entity_type = 'OPERATIONAL_OCCURRENCE'
      AND notification.entity_id = candidate.occurrence_id
      AND notification.status = 'ACTIVE';

    SELECT count(*)::integer
    INTO invalid_count
    FROM migration_0038_candidates candidate
    JOIN maintenance.operational_occurrences occurrence
      ON occurrence.tenant_id = candidate.tenant_id
     AND occurrence.id = candidate.occurrence_id
    JOIN maintenance.work_orders work_order
      ON work_order.tenant_id = candidate.tenant_id
     AND work_order.id = candidate.work_order_id
    WHERE candidate.tenant_id = tenant_record.id
      AND (
        occurrence.work_order_id IS DISTINCT FROM candidate.work_order_id
        OR occurrence.work_order_action_id IS DISTINCT FROM candidate.work_order_action_id
        OR occurrence.status <> 'IN_TREATMENT'
        OR occurrence.treatment_status <> 'WORK_ORDER_CREATED'
        OR work_order.origin_type <> 'OCCURRENCE'
        OR EXISTS (
          SELECT 1
          FROM workflow.notifications notification
          WHERE notification.tenant_id = candidate.tenant_id
            AND notification.notification_type = 'OCCURRENCE_REPORTED'
            AND notification.entity_type = 'OPERATIONAL_OCCURRENCE'
            AND notification.entity_id = candidate.occurrence_id
            AND notification.status = 'ACTIVE'
        )
      );

    IF invalid_count <> 0 THEN
      RAISE EXCEPTION
        'Migration 0038 deixou % reconciliação(ões) incompleta(s) no tenant %.',
        invalid_count,
        tenant_record.id;
    END IF;

    processed_tenants := processed_tenants + 1;

    RAISE NOTICE
      'Migration 0038 processou tenant %: % candidato(s), % OS(s) canonicalizada(s).',
      tenant_record.id,
      candidate_count,
      converted_count;
  END LOOP;

  IF processed_tenants <> tenant_count THEN
    RAISE EXCEPTION
      'Migration 0038 enumerou % tenant(s), mas processou %.',
      tenant_count,
      processed_tenants;
  END IF;

  RAISE NOTICE
    'Migration 0038 concluiu a reconciliação tenant-aware de % candidato(s) em % tenant(s).',
    total_candidates,
    processed_tenants;
END;
$$;

SELECT set_config('app.tenant_id', '', true);

DROP POLICY migration_0038_tenant_enumeration ON platform.tenants;

COMMIT;
