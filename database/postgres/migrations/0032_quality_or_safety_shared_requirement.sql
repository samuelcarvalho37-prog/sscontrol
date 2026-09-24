BEGIN;

ALTER TABLE workflow.demand_validator_requirements
  DROP CONSTRAINT demand_validator_requirements_target_check;

ALTER TABLE workflow.demand_validator_requirements
  ADD CONSTRAINT demand_validator_requirements_target_check
  CHECK (
    num_nonnulls(technical_area_id, technical_role_id, user_id) = 1
    OR (
      requirement_code = 'QUALITY_OR_SAFETY'
      AND num_nonnulls(technical_area_id, technical_role_id, user_id) = 0
    )
  );

COMMIT;
