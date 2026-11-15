BEGIN;

-- Existing external amounts remain unclassified: never relabel invoices as labor.
ALTER TABLE maintenance.external_services ADD COLUMN cost_category text NOT NULL DEFAULT 'UNCLASSIFIED'
 CHECK (cost_category IN ('LABOR','PARTS','OTHER','UNCLASSIFIED'));

CREATE TABLE maintenance.technician_hourly_rates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 hourly_cost numeric(16,4) NOT NULL CHECK (hourly_cost >= 0),
 effective_from timestamptz NOT NULL DEFAULT clock_timestamp(),
 recorded_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (tenant_id,user_id,effective_from),
 FOREIGN KEY (tenant_id,user_id) REFERENCES iam.users(tenant_id,id),
 FOREIGN KEY (tenant_id,recorded_by) REFERENCES iam.users(tenant_id,id)
);
CREATE INDEX technician_hourly_rates_lookup ON maintenance.technician_hourly_rates(tenant_id,user_id,effective_from DESC);
ALTER TABLE maintenance.technician_hourly_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance.technician_hourly_rates FORCE ROW LEVEL SECURITY;
CREATE POLICY technician_hourly_rates_tenant ON maintenance.technician_hourly_rates
 USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());
GRANT SELECT,INSERT ON maintenance.technician_hourly_rates TO fab_control_runtime;
GRANT SELECT ON maintenance.technician_hourly_rates TO fab_control_readonly;

ALTER TABLE maintenance.execution_participant_work_intervals ADD COLUMN hourly_cost_snapshot numeric(16,4)
 CHECK (hourly_cost_snapshot >= 0);
CREATE FUNCTION maintenance.snapshot_participant_hourly_cost() RETURNS trigger
 LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   SELECT rate.hourly_cost INTO NEW.hourly_cost_snapshot
   FROM maintenance.technician_hourly_rates rate
   WHERE rate.tenant_id=NEW.tenant_id AND rate.user_id=NEW.user_id AND rate.effective_from<=NEW.started_at
   ORDER BY rate.effective_from DESC LIMIT 1;
 ELSE
   NEW.hourly_cost_snapshot:=OLD.hourly_cost_snapshot;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER participant_hourly_cost_snapshot BEFORE INSERT OR UPDATE
 ON maintenance.execution_participant_work_intervals FOR EACH ROW
 EXECUTE FUNCTION maintenance.snapshot_participant_hourly_cost();

CREATE VIEW maintenance.work_order_labor_costs WITH (security_invoker=true) AS
 SELECT e.tenant_id,e.work_order_id,
 COALESCE(sum(EXTRACT(EPOCH FROM (i.ended_at-i.started_at))/3600*i.hourly_cost_snapshot),0)::numeric(20,4) AS internal_labor_cost,
 count(*) FILTER (WHERE i.hourly_cost_snapshot IS NULL OR i.ended_at IS NULL)::integer AS pending_intervals
 FROM maintenance.execution_participant_work_intervals i
 JOIN maintenance.executions e ON e.id=i.execution_id AND e.tenant_id=i.tenant_id
 GROUP BY e.tenant_id,e.work_order_id;
GRANT SELECT ON maintenance.work_order_labor_costs TO fab_control_runtime,fab_control_readonly;
CREATE OR REPLACE VIEW maintenance.work_order_realized_costs
WITH (security_invoker = true)
AS
SELECT work_order.tenant_id,
       work_order.id AS work_order_id,
       COALESCE(material_cost.known_total, 0::numeric)::numeric(20,4) AS material_cost,
       COALESCE(external_cost.known_total, 0::numeric)::numeric(20,4) AS external_service_cost,
       (COALESCE(material_cost.known_total, 0::numeric)
        + COALESCE(external_cost.known_total, 0::numeric) + COALESCE(labor.internal_labor_cost,0))::numeric(20,4) AS realized_total,
       COALESCE(material_cost.unknown_count, 0)::integer AS materials_pending_price,
       COALESCE(external_cost.unknown_count, 0)::integer AS external_services_pending_price,
       (COALESCE(material_cost.unknown_count, 0) + COALESCE(external_cost.unknown_count, 0) + COALESCE(labor.pending_intervals,0) > 0
 OR EXISTS(SELECT 1 FROM maintenance.executions e WHERE e.work_order_id=work_order.id AND e.tenant_id=work_order.tenant_id AND e.completed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM maintenance.execution_participant_work_intervals i WHERE i.execution_id=e.id AND i.tenant_id=e.tenant_id))) AS financial_data_pending,
 COALESCE(labor.internal_labor_cost,0)::numeric(20,4) AS internal_labor_cost
FROM maintenance.work_orders work_order
LEFT JOIN LATERAL (
  SELECT sum(material.total_cost) FILTER (WHERE material.total_cost IS NOT NULL) AS known_total,
         count(*) FILTER (WHERE material.total_cost IS NULL)::integer AS unknown_count
  FROM maintenance.material_usage material
  WHERE material.tenant_id = work_order.tenant_id
    AND material.work_order_action_id IN (
      SELECT action.id
      FROM maintenance.work_order_actions action
      WHERE action.tenant_id = work_order.tenant_id
        AND action.work_order_id = work_order.id
    )
) material_cost ON true
LEFT JOIN LATERAL (
  SELECT sum(service.amount) FILTER (WHERE service.amount IS NOT NULL) AS known_total,
         count(*) FILTER (WHERE service.amount IS NULL)::integer AS unknown_count
  FROM maintenance.external_services service
  WHERE service.tenant_id = work_order.tenant_id
    AND service.work_order_id = work_order.id
) external_cost ON true
LEFT JOIN maintenance.work_order_labor_costs labor ON labor.work_order_id=work_order.id AND labor.tenant_id=work_order.tenant_id;


COMMIT;
