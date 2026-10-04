BEGIN;

DO $$
DECLARE
  ambiguous_occurrences integer;
BEGIN
  SELECT count(*)
  INTO ambiguous_occurrences
  FROM (
    SELECT work_order.tenant_id,work_order.origin_entity_id
    FROM maintenance.work_orders work_order
    JOIN maintenance.operational_occurrences occurrence
      ON occurrence.tenant_id=work_order.tenant_id
     AND occurrence.id=work_order.origin_entity_id
    GROUP BY work_order.tenant_id,work_order.origin_entity_id
    HAVING count(*)>1
  ) ambiguous;

  IF ambiguous_occurrences>0 THEN
    RAISE NOTICE '% ocorrência(s) histórica(s) com múltiplas OS foram preservadas sem backfill canônico.',
      ambiguous_occurrences;
  END IF;
END;
$$;

WITH unambiguous AS (
  SELECT work_order.tenant_id,work_order.origin_entity_id AS occurrence_id,
         (array_agg(work_order.id ORDER BY work_order.created_at,work_order.id))[1] AS work_order_id
  FROM maintenance.work_orders work_order
  JOIN maintenance.operational_occurrences occurrence
    ON occurrence.tenant_id=work_order.tenant_id
   AND occurrence.id=work_order.origin_entity_id
  GROUP BY work_order.tenant_id,work_order.origin_entity_id
  HAVING count(*)=1
)
UPDATE maintenance.work_orders work_order
SET origin_type='OCCURRENCE'
FROM unambiguous
WHERE work_order.tenant_id=unambiguous.tenant_id
  AND work_order.id=unambiguous.work_order_id;

CREATE UNIQUE INDEX work_orders_one_occurrence_idx
  ON maintenance.work_orders (tenant_id,origin_entity_id)
  WHERE origin_type='OCCURRENCE' AND origin_entity_id IS NOT NULL;

WITH canonical AS (
  SELECT work_order.tenant_id,work_order.id AS work_order_id,
         work_order.origin_entity_id AS occurrence_id,work_order.status,
         action.id AS action_id
  FROM maintenance.work_orders work_order
  LEFT JOIN maintenance.work_order_actions action
    ON action.tenant_id=work_order.tenant_id
   AND action.work_order_id=work_order.id
   AND action.origin='WORK_ORDER_RELEASE'
  WHERE work_order.origin_type='OCCURRENCE'
    AND work_order.origin_entity_id IS NOT NULL
)
UPDATE maintenance.operational_occurrences occurrence
SET work_order_id=canonical.work_order_id,
    work_order_action_id=canonical.action_id,
    status=CASE WHEN canonical.status='COMPLETED' THEN 'RESOLVED' ELSE 'IN_TREATMENT' END,
    treatment_status=CASE WHEN canonical.status='COMPLETED' THEN 'RESOLVED' ELSE 'WORK_ORDER_CREATED' END,
    closed_at=CASE WHEN canonical.status='COMPLETED' THEN COALESCE(occurrence.closed_at,clock_timestamp()) ELSE occurrence.closed_at END,
    updated_at=clock_timestamp()
FROM canonical
WHERE occurrence.tenant_id=canonical.tenant_id
  AND occurrence.id=canonical.occurrence_id
  AND (occurrence.work_order_id IS NULL OR occurrence.work_order_id=canonical.work_order_id);

UPDATE workflow.notifications notification
SET status='RETRACTED'
WHERE notification.status='ACTIVE'
  AND notification.notification_type='OCCURRENCE_REPORTED'
  AND EXISTS (
    SELECT 1
    FROM maintenance.operational_occurrences occurrence
    WHERE occurrence.tenant_id=notification.tenant_id
      AND occurrence.id=notification.entity_id
      AND occurrence.work_order_id IS NOT NULL
  );

CREATE OR REPLACE FUNCTION maintenance.link_occurrence_work_order()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  linked_rows integer;
  existing_work_order_id uuid;
BEGIN
  IF NEW.origin_type<>'OCCURRENCE' THEN
    RETURN NEW;
  END IF;
  IF NEW.origin_entity_id IS NULL THEN
    RAISE EXCEPTION 'OS originada por ocorrência exige origin_entity_id.' USING ERRCODE='23502';
  END IF;

  UPDATE maintenance.operational_occurrences occurrence
  SET work_order_id=NEW.id,status='IN_TREATMENT',treatment_status='WORK_ORDER_CREATED',
      updated_at=clock_timestamp()
  WHERE occurrence.tenant_id=NEW.tenant_id
    AND occurrence.id=NEW.origin_entity_id
    AND (occurrence.work_order_id IS NULL OR occurrence.work_order_id=NEW.id);
  GET DIAGNOSTICS linked_rows=ROW_COUNT;

  IF linked_rows<>1 THEN
    SELECT occurrence.work_order_id
    INTO existing_work_order_id
    FROM maintenance.operational_occurrences occurrence
    WHERE occurrence.tenant_id=NEW.tenant_id
      AND occurrence.id=NEW.origin_entity_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ocorrência operacional não encontrada no tenant da OS.' USING ERRCODE='23503';
    END IF;
    RAISE EXCEPTION 'Ocorrência operacional já vinculada à OS %.',existing_work_order_id USING ERRCODE='23505';
  END IF;

  UPDATE workflow.notifications notification
  SET status='RETRACTED'
  WHERE notification.tenant_id=NEW.tenant_id
    AND notification.notification_type='OCCURRENCE_REPORTED'
    AND notification.entity_type='OPERATIONAL_OCCURRENCE'
    AND notification.entity_id=NEW.origin_entity_id
    AND notification.status='ACTIVE';

  RETURN NEW;
END;
$$;

CREATE TRIGGER work_orders_occurrence_link
AFTER INSERT OR UPDATE OF origin_type,origin_entity_id ON maintenance.work_orders
FOR EACH ROW EXECUTE FUNCTION maintenance.link_occurrence_work_order();

CREATE OR REPLACE FUNCTION maintenance.link_occurrence_release_action()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.origin='WORK_ORDER_RELEASE' THEN
    UPDATE maintenance.operational_occurrences occurrence
    SET work_order_action_id=NEW.id,updated_at=clock_timestamp()
    WHERE occurrence.tenant_id=NEW.tenant_id
      AND occurrence.work_order_id=NEW.work_order_id
      AND (occurrence.work_order_action_id IS NULL OR occurrence.work_order_action_id=NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER work_order_actions_occurrence_link
AFTER INSERT OR UPDATE OF origin ON maintenance.work_order_actions
FOR EACH ROW EXECUTE FUNCTION maintenance.link_occurrence_release_action();

COMMIT;
