BEGIN;

-- O código histórico permanece intocado. O número abaixo é a identidade humana
-- canônica e independente por tenant.
ALTER TABLE maintenance.work_orders
  ADD COLUMN operational_number bigint,
  ADD COLUMN execution_mode text NOT NULL DEFAULT 'INTERNAL',
  ADD COLUMN improvement_category text;

DROP POLICY IF EXISTS migration_0039_tenant_enumeration ON platform.tenants;
CREATE POLICY migration_0039_tenant_enumeration
  ON platform.tenants
  FOR SELECT
  TO CURRENT_USER
  USING (true);

SET LOCAL row_security = on;

DO $$
DECLARE
  tenant_record record;
  tenant_count integer;
  processed_tenants integer := 0;
  candidate_count integer;
  updated_count integer;
  classification_candidate_count integer;
  classification_updated_count integer;
  unsupported_count integer;
BEGIN
  SELECT count(*)::integer INTO tenant_count FROM platform.tenants;

  FOR tenant_record IN
    SELECT tenant.id FROM platform.tenants tenant ORDER BY tenant.id
  LOOP
    PERFORM set_config('app.tenant_id', tenant_record.id::text, true);

    IF platform.current_tenant_id() IS DISTINCT FROM tenant_record.id THEN
      RAISE EXCEPTION 'Migration 0039 não conseguiu estabelecer o contexto do tenant %.', tenant_record.id;
    END IF;

    -- O valor histórico INSPECTION descrevia tanto plano quanto origem. Só é
    -- convertido quando a classificação V1 é demonstrável por uma FK atual:
    -- ocorrência operacional => corretiva; plano explicitamente classificado
    -- como preventiva/preditiva/corretiva => o mesmo tipo. Qualquer outro caso
    -- permanece ambíguo e faz a migration abortar abaixo.
    SELECT count(*)::integer
    INTO classification_candidate_count
    FROM maintenance.work_orders work_order
    LEFT JOIN maintenance.operational_occurrences occurrence
      ON occurrence.tenant_id = work_order.tenant_id
     AND occurrence.id = work_order.origin_entity_id
    LEFT JOIN maintenance.maintenance_plan_versions plan_version
      ON plan_version.tenant_id = work_order.tenant_id
     AND plan_version.id = work_order.maintenance_plan_version_id
    LEFT JOIN maintenance.maintenance_plans plan
      ON plan.tenant_id = plan_version.tenant_id
     AND plan.id = plan_version.maintenance_plan_id
    WHERE work_order.tenant_id = tenant_record.id
      AND work_order.work_type = 'INSPECTION'
      AND (
        occurrence.id IS NOT NULL
        OR plan.plan_type IN ('CORRECTIVE', 'PREVENTIVE', 'PREDICTIVE')
      );

    WITH classifications AS (
      SELECT work_order.id,
             CASE
               WHEN occurrence.id IS NOT NULL THEN 'CORRECTIVE'
               ELSE plan.plan_type
             END AS work_type
      FROM maintenance.work_orders work_order
      LEFT JOIN maintenance.operational_occurrences occurrence
        ON occurrence.tenant_id = work_order.tenant_id
       AND occurrence.id = work_order.origin_entity_id
      LEFT JOIN maintenance.maintenance_plan_versions plan_version
        ON plan_version.tenant_id = work_order.tenant_id
       AND plan_version.id = work_order.maintenance_plan_version_id
      LEFT JOIN maintenance.maintenance_plans plan
        ON plan.tenant_id = plan_version.tenant_id
       AND plan.id = plan_version.maintenance_plan_id
      WHERE work_order.tenant_id = tenant_record.id
        AND work_order.work_type = 'INSPECTION'
        AND (
          occurrence.id IS NOT NULL
          OR plan.plan_type IN ('CORRECTIVE', 'PREVENTIVE', 'PREDICTIVE')
        )
    )
    UPDATE maintenance.work_orders work_order
    SET work_type = classifications.work_type
    FROM classifications
    WHERE work_order.tenant_id = tenant_record.id
      AND work_order.id = classifications.id;

    GET DIAGNOSTICS classification_updated_count = ROW_COUNT;

    IF classification_updated_count <> classification_candidate_count THEN
      RAISE EXCEPTION
        'Migration 0039 esperava classificar % OS(s) históricas, mas classificou % no tenant %.',
        classification_candidate_count,
        classification_updated_count,
        tenant_record.id;
    END IF;

    SELECT count(*)::integer
    INTO unsupported_count
    FROM maintenance.work_orders work_order
    WHERE work_order.tenant_id = tenant_record.id
      AND work_order.work_type NOT IN ('CORRECTIVE', 'PREVENTIVE', 'PREDICTIVE', 'IMPROVEMENT');

    IF unsupported_count <> 0 THEN
      RAISE EXCEPTION
        'Migration 0039 encontrou % OS(s) com tipo histórico ambíguo no tenant %. A classificação deve ser reconciliada antes da evolução.',
        unsupported_count,
        tenant_record.id;
    END IF;

    SELECT count(*)::integer
    INTO candidate_count
    FROM maintenance.work_orders work_order
    WHERE work_order.tenant_id = tenant_record.id;

    WITH ordered AS (
      SELECT work_order.id,
             row_number() OVER (ORDER BY work_order.created_at, work_order.id) AS operational_number
      FROM maintenance.work_orders work_order
      WHERE work_order.tenant_id = tenant_record.id
    )
    UPDATE maintenance.work_orders work_order
    SET operational_number = ordered.operational_number
    FROM ordered
    WHERE work_order.tenant_id = tenant_record.id
      AND work_order.id = ordered.id
      AND work_order.operational_number IS NULL;

    GET DIAGNOSTICS updated_count = ROW_COUNT;

    IF updated_count <> candidate_count THEN
      RAISE EXCEPTION
        'Migration 0039 esperava numerar % OS(s), mas numerou % no tenant %.',
        candidate_count,
        updated_count,
        tenant_record.id;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM maintenance.work_orders work_order
      WHERE work_order.tenant_id = tenant_record.id
        AND work_order.operational_number IS NULL
    ) THEN
      RAISE EXCEPTION 'Migration 0039 deixou OS sem número operacional no tenant %.', tenant_record.id;
    END IF;

    processed_tenants := processed_tenants + 1;
  END LOOP;

  IF processed_tenants <> tenant_count THEN
    RAISE EXCEPTION
      'Migration 0039 enumerou % tenant(s), mas processou %.',
      tenant_count,
      processed_tenants;
  END IF;
END;
$$;

SELECT set_config('app.tenant_id', '', true);
DROP POLICY migration_0039_tenant_enumeration ON platform.tenants;

ALTER TABLE maintenance.work_orders
  ALTER COLUMN operational_number SET NOT NULL,
  ADD COLUMN operational_code text
    GENERATED ALWAYS AS ('OS-' || lpad(operational_number::text, 8, '0')) STORED,
  ADD CONSTRAINT work_orders_operational_number_range_check
    CHECK (operational_number BETWEEN 1 AND 99999999),
  ADD CONSTRAINT work_orders_operational_number_key
    UNIQUE (tenant_id, operational_number),
  ADD CONSTRAINT work_orders_operational_code_key
    UNIQUE (tenant_id, operational_code),
  ADD CONSTRAINT work_orders_work_type_v1_check
    CHECK (work_type IN ('CORRECTIVE', 'PREVENTIVE', 'PREDICTIVE', 'IMPROVEMENT')),
  ADD CONSTRAINT work_orders_execution_mode_check
    CHECK (execution_mode IN ('INTERNAL', 'EXTERNAL', 'MIXED')),
  ADD CONSTRAINT work_orders_improvement_category_check
    CHECK (
      (work_type = 'IMPROVEMENT' AND improvement_category IN ('MODIFICATION', 'MANUFACTURE', 'INSTALLATION', 'ADEQUACY', 'OTHER'))
      OR (work_type <> 'IMPROVEMENT' AND improvement_category IS NULL)
    );

ALTER TABLE maintenance.maintenance_plans
  DROP CONSTRAINT maintenance_plans_type_check,
  ADD CONSTRAINT maintenance_plans_type_check
    CHECK (plan_type IN ('PREVENTIVE', 'PREDICTIVE', 'INSPECTION', 'LUBRICATION', 'CORRECTIVE', 'CONDITION_BASED', 'IMPROVEMENT'));

CREATE TABLE maintenance.work_order_number_counters (
  tenant_id uuid PRIMARY KEY REFERENCES platform.tenants(id) ON DELETE RESTRICT,
  next_number bigint NOT NULL CHECK (next_number BETWEEN 1 AND 100000000),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE maintenance.work_order_number_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance.work_order_number_counters FORCE ROW LEVEL SECURITY;

CREATE POLICY work_order_number_counters_tenant_isolation
  ON maintenance.work_order_number_counters
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

DROP POLICY IF EXISTS migration_0039_tenant_enumeration ON platform.tenants;
CREATE POLICY migration_0039_tenant_enumeration
  ON platform.tenants
  FOR SELECT
  TO CURRENT_USER
  USING (true);

DO $$
DECLARE
  tenant_record record;
  highest_number bigint;
BEGIN
  FOR tenant_record IN
    SELECT tenant.id FROM platform.tenants tenant ORDER BY tenant.id
  LOOP
    PERFORM set_config('app.tenant_id', tenant_record.id::text, true);
    SELECT COALESCE(max(work_order.operational_number), 0)
    INTO highest_number
    FROM maintenance.work_orders work_order
    WHERE work_order.tenant_id = tenant_record.id;

    INSERT INTO maintenance.work_order_number_counters (tenant_id, next_number)
    VALUES (tenant_record.id, highest_number + 1);
  END LOOP;
END;
$$;

SELECT set_config('app.tenant_id', '', true);
DROP POLICY migration_0039_tenant_enumeration ON platform.tenants;

CREATE FUNCTION maintenance.assign_work_order_operational_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  existing_number bigint;
BEGIN
  IF platform.current_tenant_id() IS NOT NULL
     AND NEW.tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'Não é permitido gerar número de OS fora do tenant atual.'
      USING ERRCODE = '42501';
  END IF;

  -- Serializa somente tentativas com a mesma identidade legada. Isso evita
  -- consumir um novo número quando um import/seed idempotente repete o mesmo
  -- INSERT ... ON CONFLICT para a OS já existente.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.tenant_id::text || ':' || NEW.code, 0)
  );

  SELECT work_order.operational_number
  INTO existing_number
  FROM maintenance.work_orders work_order
  WHERE work_order.tenant_id = NEW.tenant_id
    AND work_order.code = NEW.code;

  IF FOUND THEN
    NEW.operational_number := existing_number;
    RETURN NEW;
  END IF;

  INSERT INTO maintenance.work_order_number_counters (tenant_id, next_number)
  VALUES (NEW.tenant_id, 2)
  ON CONFLICT (tenant_id) DO UPDATE
    SET next_number = maintenance.work_order_number_counters.next_number + 1,
        updated_at = clock_timestamp()
  RETURNING next_number - 1 INTO NEW.operational_number;

  IF NEW.operational_number > 99999999 THEN
    RAISE EXCEPTION 'A sequência operacional de OS do tenant foi esgotada.'
      USING ERRCODE = '22003';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER work_orders_assign_operational_number
BEFORE INSERT ON maintenance.work_orders
FOR EACH ROW
EXECUTE FUNCTION maintenance.assign_work_order_operational_number();

-- Preço desconhecido não equivale a preço zero e não pode bloquear a execução.
ALTER TABLE cmms.materials
  ALTER COLUMN unit_cost DROP NOT NULL,
  ALTER COLUMN unit_cost DROP DEFAULT;

ALTER TABLE cmms.materials
  DROP CONSTRAINT materials_unit_cost_non_negative,
  ADD CONSTRAINT materials_unit_cost_non_negative
    CHECK (unit_cost IS NULL OR unit_cost >= 0);

ALTER TABLE maintenance.material_usage
  ALTER COLUMN unit_cost DROP NOT NULL,
  ALTER COLUMN unit_cost DROP DEFAULT,
  ALTER COLUMN total_cost DROP NOT NULL,
  ALTER COLUMN total_cost DROP DEFAULT;

ALTER TABLE maintenance.material_usage
  DROP CONSTRAINT material_usage_cost_non_negative,
  ADD CONSTRAINT material_usage_cost_non_negative
    CHECK (
      (unit_cost IS NULL AND total_cost IS NULL)
      OR (
        unit_cost >= 0
        AND total_cost >= 0
        AND total_cost = round(quantity * unit_cost, 4)
      )
    );

CREATE TABLE maintenance.external_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  provider_name text NOT NULL,
  description text NOT NULL,
  amount numeric(18,2),
  service_date date,
  notes text,
  recorded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT external_services_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT external_services_work_order_fk
    FOREIGN KEY (tenant_id, work_order_id)
    REFERENCES maintenance.work_orders(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT external_services_recorded_by_fk
    FOREIGN KEY (tenant_id, recorded_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT external_services_provider_check CHECK (length(btrim(provider_name)) BETWEEN 2 AND 240),
  CONSTRAINT external_services_description_check CHECK (length(btrim(description)) BETWEEN 3 AND 2000),
  CONSTRAINT external_services_amount_check CHECK (amount IS NULL OR amount >= 0)
);

CREATE INDEX external_services_work_order_idx
  ON maintenance.external_services (tenant_id, work_order_id, created_at, id);

CREATE TRIGGER external_services_touch_updated_at
BEFORE UPDATE ON maintenance.external_services
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

ALTER TABLE maintenance.external_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance.external_services FORCE ROW LEVEL SECURITY;

CREATE POLICY external_services_tenant_isolation
  ON maintenance.external_services
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE TABLE maintenance.improvement_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  category text NOT NULL,
  suggestion text NOT NULL,
  reason text NOT NULL,
  evidence_storage_object_id uuid,
  status text NOT NULL DEFAULT 'OPEN',
  requested_by uuid NOT NULL,
  converted_work_order_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT improvement_requests_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT improvement_requests_asset_fk
    FOREIGN KEY (tenant_id, asset_id)
    REFERENCES cmms.assets(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT improvement_requests_requested_by_fk
    FOREIGN KEY (tenant_id, requested_by)
    REFERENCES iam.users(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT improvement_requests_evidence_fk
    FOREIGN KEY (tenant_id, evidence_storage_object_id)
    REFERENCES platform.storage_objects(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT improvement_requests_work_order_fk
    FOREIGN KEY (tenant_id, converted_work_order_id)
    REFERENCES maintenance.work_orders(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT improvement_requests_category_check
    CHECK (category IN ('MODIFICATION', 'MANUFACTURE', 'INSTALLATION', 'ADEQUACY', 'OTHER')),
  CONSTRAINT improvement_requests_status_check
    CHECK (status IN ('OPEN', 'CONVERTED', 'REJECTED')),
  CONSTRAINT improvement_requests_conversion_check
    CHECK ((status = 'CONVERTED') = (converted_work_order_id IS NOT NULL)),
  CONSTRAINT improvement_requests_suggestion_check CHECK (length(btrim(suggestion)) BETWEEN 3 AND 4000),
  CONSTRAINT improvement_requests_reason_check CHECK (length(btrim(reason)) BETWEEN 3 AND 4000),
  CONSTRAINT improvement_requests_one_work_order_key UNIQUE (tenant_id, converted_work_order_id)
);

CREATE INDEX improvement_requests_queue_idx
  ON maintenance.improvement_requests (tenant_id, status, created_at DESC, id DESC);

CREATE TRIGGER improvement_requests_touch_updated_at
BEFORE UPDATE ON maintenance.improvement_requests
FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

ALTER TABLE maintenance.improvement_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance.improvement_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY improvement_requests_tenant_isolation
  ON maintenance.improvement_requests
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE VIEW maintenance.work_order_realized_costs
WITH (security_invoker = true)
AS
SELECT work_order.tenant_id,
       work_order.id AS work_order_id,
       COALESCE(material_cost.known_total, 0::numeric)::numeric(20,4) AS material_cost,
       COALESCE(external_cost.known_total, 0::numeric)::numeric(20,4) AS external_service_cost,
       (COALESCE(material_cost.known_total, 0::numeric)
        + COALESCE(external_cost.known_total, 0::numeric))::numeric(20,4) AS realized_total,
       COALESCE(material_cost.unknown_count, 0)::integer AS materials_pending_price,
       COALESCE(external_cost.unknown_count, 0)::integer AS external_services_pending_price,
       (COALESCE(material_cost.unknown_count, 0) + COALESCE(external_cost.unknown_count, 0) > 0) AS financial_data_pending
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
) external_cost ON true;

GRANT SELECT, INSERT, UPDATE ON maintenance.work_order_number_counters TO fab_control_runtime;
GRANT SELECT ON maintenance.work_order_number_counters TO fab_control_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON maintenance.external_services TO fab_control_runtime;
GRANT SELECT ON maintenance.external_services TO fab_control_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON maintenance.improvement_requests TO fab_control_runtime;
GRANT SELECT ON maintenance.improvement_requests TO fab_control_readonly;
GRANT SELECT ON maintenance.work_order_realized_costs TO fab_control_runtime, fab_control_readonly;

COMMIT;
