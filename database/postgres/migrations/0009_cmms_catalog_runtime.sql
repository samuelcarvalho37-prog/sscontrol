BEGIN;

INSERT INTO iam.capabilities (code, name, description, module, protected)
VALUES
  (
    'cmms.structure.read',
    'Consultar estrutura fabril',
    'Consulta plantas, setores e linhas do tenant autenticado.',
    'CMMS',
    true
  ),
  (
    'cmms.structure.manage',
    'Gerenciar estrutura fabril',
    'Cria e altera plantas, setores e linhas sem exclusão física.',
    'CMMS',
    true
  ),
  (
    'cmms.assets.read',
    'Consultar ativos técnicos',
    'Consulta equipamentos, componentes, QR Codes e histórico técnico.',
    'CMMS',
    true
  ),
  (
    'cmms.assets.manage',
    'Gerenciar ativos técnicos',
    'Cria e altera equipamentos e componentes sem exclusão física.',
    'CMMS',
    true
  ),
  (
    'cmms.parameters.read',
    'Consultar parâmetros técnicos',
    'Consulta definições, limites, leituras e classificações técnicas.',
    'CMMS',
    true
  ),
  (
    'cmms.parameters.manage',
    'Gerenciar parâmetros técnicos',
    'Cria definições e publica políticas versionadas de limites.',
    'CMMS',
    true
  ),
  (
    'cmms.materials.read',
    'Consultar materiais',
    'Consulta estoque e situação dos materiais técnicos.',
    'CMMS',
    true
  ),
  (
    'cmms.materials.manage',
    'Gerenciar materiais',
    'Cadastra, altera e desativa materiais técnicos.',
    'CMMS',
    true
  ),
  (
    'cmms.readings.create',
    'Registrar leituras técnicas',
    'Registra leituras rastreáveis e dispara classificação automática.',
    'CMMS',
    true
  )
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  module = EXCLUDED.module,
  protected = EXCLUDED.protected,
  status = 'ACTIVE';

ALTER TABLE cmms.parameter_readings
  ADD COLUMN idempotency_key text;

CREATE UNIQUE INDEX parameter_readings_idempotency_key
  ON cmms.parameter_readings (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX parameter_definitions_asset_code_without_component_key
  ON cmms.parameter_definitions (tenant_id, asset_id, code)
  WHERE component_id IS NULL AND deleted_at IS NULL;

ALTER TABLE cmms.parameter_policies
  ADD CONSTRAINT parameter_policies_threshold_order_check
  CHECK (
    (critical_min IS NULL OR warning_min IS NULL OR critical_min <= warning_min)
    AND (warning_min IS NULL OR warning_max IS NULL OR warning_min <= warning_max)
    AND (warning_max IS NULL OR critical_max IS NULL OR warning_max <= critical_max)
  );

CREATE OR REPLACE FUNCTION cmms.classify_parameter_reading()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  definition_record record;
  policy_record record;
BEGIN
  SELECT
    definition.value_type,
    definition.unit,
    definition.status
  INTO STRICT definition_record
  FROM cmms.parameter_definitions definition
  WHERE definition.tenant_id = NEW.tenant_id
    AND definition.id = NEW.parameter_definition_id;

  IF definition_record.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'O parâmetro técnico % não está ativo.', NEW.parameter_definition_id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.unit <> definition_record.unit THEN
    RAISE EXCEPTION 'A unidade % difere da unidade configurada %.', NEW.unit, definition_record.unit
      USING ERRCODE = '23514';
  END IF;

  IF definition_record.value_type = 'DECIMAL' AND NEW.numeric_value IS NULL THEN
    RAISE EXCEPTION 'O parâmetro % exige um valor decimal.', NEW.parameter_definition_id
      USING ERRCODE = '23514';
  ELSIF definition_record.value_type = 'INTEGER'
    AND (NEW.numeric_value IS NULL OR trunc(NEW.numeric_value) <> NEW.numeric_value) THEN
    RAISE EXCEPTION 'O parâmetro % exige um valor inteiro.', NEW.parameter_definition_id
      USING ERRCODE = '23514';
  ELSIF definition_record.value_type = 'BOOLEAN' AND NEW.boolean_value IS NULL THEN
    RAISE EXCEPTION 'O parâmetro % exige um valor booleano.', NEW.parameter_definition_id
      USING ERRCODE = '23514';
  ELSIF definition_record.value_type = 'TEXT' AND NEW.text_value IS NULL THEN
    RAISE EXCEPTION 'O parâmetro % exige um valor textual.', NEW.parameter_definition_id
      USING ERRCODE = '23514';
  END IF;

  NEW.classification := 'UNCLASSIFIED';

  IF NEW.parameter_policy_id IS NULL OR NEW.numeric_value IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    policy.parameter_definition_id,
    policy.warning_min,
    policy.warning_max,
    policy.critical_min,
    policy.critical_max,
    policy.status
  INTO STRICT policy_record
  FROM cmms.parameter_policies policy
  WHERE policy.tenant_id = NEW.tenant_id
    AND policy.id = NEW.parameter_policy_id;

  IF policy_record.parameter_definition_id <> NEW.parameter_definition_id THEN
    RAISE EXCEPTION 'A política % não pertence ao parâmetro informado.', NEW.parameter_policy_id
      USING ERRCODE = '23514';
  END IF;

  IF policy_record.status NOT IN ('ACTIVE', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'A política % não pode classificar leituras.', NEW.parameter_policy_id
      USING ERRCODE = '23514';
  END IF;

  NEW.classification := CASE
    WHEN policy_record.critical_min IS NOT NULL
      AND NEW.numeric_value < policy_record.critical_min THEN 'CRITICAL_LOW'
    WHEN policy_record.warning_min IS NOT NULL
      AND NEW.numeric_value < policy_record.warning_min THEN 'WARNING_LOW'
    WHEN policy_record.critical_max IS NOT NULL
      AND NEW.numeric_value > policy_record.critical_max THEN 'CRITICAL_HIGH'
    WHEN policy_record.warning_max IS NOT NULL
      AND NEW.numeric_value > policy_record.warning_max THEN 'WARNING_HIGH'
    ELSE 'NORMAL'
  END;

  RETURN NEW;
END;
$$;

CREATE TRIGGER parameter_readings_classify
BEFORE INSERT ON cmms.parameter_readings
FOR EACH ROW EXECUTE FUNCTION cmms.classify_parameter_reading();

CREATE TRIGGER parameter_readings_immutable
BEFORE UPDATE OR DELETE ON cmms.parameter_readings
FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();

CREATE INDEX assets_catalog_cursor_idx
  ON cmms.assets (tenant_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX components_catalog_cursor_idx
  ON cmms.components (tenant_id, asset_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

REVOKE INSERT, UPDATE, DELETE
ON iam.capabilities,
   platform.feature_catalog,
   platform.commercial_plans,
   platform.commercial_plan_features,
   platform.tenant_subscriptions
FROM fab_control_runtime;

COMMIT;
