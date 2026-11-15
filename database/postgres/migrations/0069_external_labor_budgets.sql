BEGIN;
CREATE TABLE maintenance.external_labor_budgets (
 tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
 month_start date NOT NULL CHECK (EXTRACT(DAY FROM month_start)=1),
 amount numeric(20,4) NOT NULL CHECK(amount>=0),
 recorded_by uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,month_start),
 FOREIGN KEY(tenant_id,recorded_by) REFERENCES iam.users(tenant_id,id)
);
ALTER TABLE maintenance.external_labor_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance.external_labor_budgets FORCE ROW LEVEL SECURITY;
CREATE POLICY external_labor_budgets_tenant ON maintenance.external_labor_budgets
 USING(tenant_id=platform.current_tenant_id()) WITH CHECK(tenant_id=platform.current_tenant_id());
GRANT SELECT,INSERT,UPDATE ON maintenance.external_labor_budgets TO fab_control_runtime;
GRANT SELECT ON maintenance.external_labor_budgets TO fab_control_readonly;
COMMIT;
