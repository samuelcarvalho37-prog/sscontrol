BEGIN;
ALTER TABLE maintenance.checklist_template_versions
  ADD COLUMN execution_defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT checklist_execution_defaults_object CHECK (jsonb_typeof(execution_defaults) = 'object');
ALTER TABLE maintenance.maintenance_plans DROP CONSTRAINT maintenance_plans_type_check;
ALTER TABLE maintenance.maintenance_plans ADD CONSTRAINT maintenance_plans_type_check CHECK (plan_type IN ('PREVENTIVE', 'PREDICTIVE', 'INSPECTION', 'LUBRICATION', 'CORRECTIVE', 'CONDITION_BASED', 'IMPROVEMENT'));
COMMIT;
