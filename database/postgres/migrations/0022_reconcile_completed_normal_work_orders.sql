BEGIN;

SET LOCAL row_security = off;

-- Reconcile executions completed before the normal completion transition started
-- closing their action and work order.  The predicate deliberately excludes the
-- explicit post-intervention-release workflow: those records must stay pending
-- until their formal signatures are completed.
WITH eligible_actions AS (
  SELECT action.id
  FROM maintenance.work_order_actions AS action
  JOIN maintenance.work_orders AS work_order
    ON work_order.id = action.work_order_id
   AND work_order.tenant_id = action.tenant_id
  WHERE action.status = 'PENDING'
    AND EXISTS (
      SELECT 1
      FROM maintenance.executions AS execution
      WHERE execution.tenant_id = action.tenant_id
        AND execution.work_order_action_id = action.id
        AND execution.status = 'COMPLETED'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM maintenance.executions AS execution
      WHERE execution.tenant_id = action.tenant_id
        AND execution.work_order_action_id = action.id
        AND execution.status NOT IN ('COMPLETED', 'CANCELLED')
    )
    AND NOT (
      COALESCE(work_order.technical_analysis ->> 'exige_liberacao_pos_intervencao', 'false') = 'true'
      AND EXISTS (
        SELECT 1
        FROM workflow.technical_demands AS demand
        WHERE demand.tenant_id = work_order.tenant_id
          AND demand.id = work_order.technical_demand_id
          AND demand.demand_type = 'POST_INTERVENTION_RELEASE'
          AND demand.status <> 'COMPLETED'
      )
    )
)
UPDATE maintenance.work_order_actions AS action
SET status = 'COMPLETED',
    completed_at = COALESCE(action.completed_at, clock_timestamp()),
    updated_at = clock_timestamp()
FROM eligible_actions
WHERE action.id = eligible_actions.id;

UPDATE maintenance.work_orders AS work_order
SET status = 'COMPLETED',
    completed_at = COALESCE(work_order.completed_at, clock_timestamp()),
    updated_at = clock_timestamp()
WHERE work_order.status = 'IN_PROGRESS'
  AND EXISTS (
    SELECT 1
    FROM maintenance.work_order_actions AS action
    WHERE action.tenant_id = work_order.tenant_id
      AND action.work_order_id = work_order.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM maintenance.work_order_actions AS action
    WHERE action.tenant_id = work_order.tenant_id
      AND action.work_order_id = work_order.id
      AND action.status <> 'COMPLETED'
  )
  AND NOT (
    COALESCE(work_order.technical_analysis ->> 'exige_liberacao_pos_intervencao', 'false') = 'true'
    AND EXISTS (
      SELECT 1
      FROM workflow.technical_demands AS demand
      WHERE demand.tenant_id = work_order.tenant_id
        AND demand.id = work_order.technical_demand_id
        AND demand.demand_type = 'POST_INTERVENTION_RELEASE'
        AND demand.status <> 'COMPLETED'
    )
  );

COMMIT;
