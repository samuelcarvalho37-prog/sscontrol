BEGIN;

-- Lubrication is a supported V1 work-order type. PREDICTIVE remains in the
-- constraint so historical records and imports remain readable. The API
-- rejects new predictive work orders and plans in V1.
ALTER TABLE maintenance.work_orders
  DROP CONSTRAINT work_orders_work_type_v1_check,
  ADD CONSTRAINT work_orders_work_type_v1_check
    CHECK (work_type IN ('CORRECTIVE', 'PREVENTIVE', 'PREDICTIVE', 'LUBRICATION', 'IMPROVEMENT'));

COMMIT;
