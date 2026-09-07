BEGIN;

CREATE OR REPLACE FUNCTION platform.ensure_component_matches_asset()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.component_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM cmms.components component
       WHERE component.tenant_id = NEW.tenant_id
         AND component.id = NEW.component_id
         AND component.asset_id = NEW.asset_id
     ) THEN
    RAISE EXCEPTION 'O componente % não pertence ao ativo % no tenant informado.',
      NEW.component_id,
      NEW.asset_id
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER parameter_definitions_component_asset_guard
BEFORE INSERT OR UPDATE OF tenant_id, asset_id, component_id ON cmms.parameter_definitions
FOR EACH ROW EXECUTE FUNCTION platform.ensure_component_matches_asset();

CREATE TRIGGER checklist_templates_component_asset_guard
BEFORE INSERT OR UPDATE OF tenant_id, asset_id, component_id ON maintenance.checklist_templates
FOR EACH ROW EXECUTE FUNCTION platform.ensure_component_matches_asset();

CREATE TRIGGER maintenance_plans_component_asset_guard
BEFORE INSERT OR UPDATE OF tenant_id, asset_id, component_id ON maintenance.maintenance_plans
FOR EACH ROW EXECUTE FUNCTION platform.ensure_component_matches_asset();

CREATE TRIGGER work_orders_component_asset_guard
BEFORE INSERT OR UPDATE OF tenant_id, asset_id, component_id ON maintenance.work_orders
FOR EACH ROW EXECUTE FUNCTION platform.ensure_component_matches_asset();

CREATE TRIGGER work_order_actions_component_asset_guard
BEFORE INSERT OR UPDATE OF tenant_id, asset_id, component_id ON maintenance.work_order_actions
FOR EACH ROW EXECUTE FUNCTION platform.ensure_component_matches_asset();

CREATE TRIGGER executions_component_asset_guard
BEFORE INSERT OR UPDATE OF tenant_id, asset_id, component_id ON maintenance.executions
FOR EACH ROW EXECUTE FUNCTION platform.ensure_component_matches_asset();

CREATE TRIGGER equipment_stops_component_asset_guard
BEFORE INSERT OR UPDATE OF tenant_id, asset_id, component_id ON maintenance.equipment_stops
FOR EACH ROW EXECUTE FUNCTION platform.ensure_component_matches_asset();

CREATE TRIGGER maintenance_stops_component_asset_guard
BEFORE INSERT OR UPDATE OF tenant_id, asset_id, component_id ON maintenance.maintenance_stops
FOR EACH ROW EXECUTE FUNCTION platform.ensure_component_matches_asset();

CREATE TRIGGER operational_occurrences_component_asset_guard
BEFORE INSERT OR UPDATE OF tenant_id, asset_id, component_id ON maintenance.operational_occurrences
FOR EACH ROW EXECUTE FUNCTION platform.ensure_component_matches_asset();

CREATE TRIGGER operational_alerts_component_asset_guard
BEFORE INSERT OR UPDATE OF tenant_id, asset_id, component_id ON maintenance.operational_alerts
FOR EACH ROW EXECUTE FUNCTION platform.ensure_component_matches_asset();

CREATE TRIGGER technical_analyses_component_asset_guard
BEFORE INSERT OR UPDATE OF tenant_id, asset_id, component_id ON workflow.technical_analyses
FOR EACH ROW EXECUTE FUNCTION platform.ensure_component_matches_asset();

CREATE OR REPLACE FUNCTION maintenance.validate_checklist_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  item_type maintenance.checklist_item_types%ROWTYPE;
BEGIN
  SELECT *
  INTO item_type
  FROM maintenance.checklist_item_types
  WHERE code = NEW.response_type_code
    AND active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tipo de resposta % inexistente ou inativo.', NEW.response_type_code
      USING ERRCODE = '23514';
  END IF;

  IF item_type.requires_options AND jsonb_array_length(NEW.options) = 0 THEN
    RAISE EXCEPTION 'O tipo % exige pelo menos uma opção.', NEW.response_type_code
      USING ERRCODE = '23514';
  END IF;

  IF NOT item_type.supports_limit
     AND (NEW.minimum_value IS NOT NULL OR NEW.maximum_value IS NOT NULL) THEN
    RAISE EXCEPTION 'O tipo % não aceita limites numéricos.', NEW.response_type_code
      USING ERRCODE = '23514';
  END IF;

  IF NEW.evidence_required AND NOT item_type.supports_evidence THEN
    RAISE EXCEPTION 'O tipo % não aceita evidências.', NEW.response_type_code
      USING ERRCODE = '23514';
  END IF;

  IF NEW.parameter_definition_id IS NOT NULL
     AND NEW.response_type_code NOT IN ('PARAMETRO', 'LEITURA_OPERACIONAL') THEN
    RAISE EXCEPTION 'Somente parâmetros e leituras operacionais podem vincular uma definição técnica.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER checklist_items_validation_guard
BEFORE INSERT OR UPDATE ON maintenance.checklist_items
FOR EACH ROW EXECUTE FUNCTION maintenance.validate_checklist_item();

CREATE OR REPLACE FUNCTION maintenance.validate_published_checklist_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  active_item_count integer;
BEGIN
  IF NEW.status = 'PUBLISHED'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT count(*)
    INTO active_item_count
    FROM maintenance.checklist_items item
    WHERE item.tenant_id = NEW.tenant_id
      AND item.checklist_template_version_id = NEW.id
      AND item.status = 'ACTIVE';

    IF active_item_count = 0 THEN
      RAISE EXCEPTION 'Um checklist sem etapas ativas não pode ser publicado.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.required_signatures > 0
       AND NEW.status = 'PUBLISHED'
       AND NEW.submitted_at IS NULL THEN
      RAISE EXCEPTION 'O checklist deve passar por revisão antes da publicação.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER checklist_template_versions_publish_guard
BEFORE INSERT OR UPDATE OF status ON maintenance.checklist_template_versions
FOR EACH ROW EXECUTE FUNCTION maintenance.validate_published_checklist_version();

CREATE OR REPLACE FUNCTION maintenance.validate_published_plan_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  checklist_status text;
  active_item_count integer;
BEGIN
  IF NEW.status = 'PUBLISHED'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT checklist_version.status
    INTO checklist_status
    FROM maintenance.checklist_template_versions checklist_version
    WHERE checklist_version.tenant_id = NEW.tenant_id
      AND checklist_version.id = NEW.checklist_template_version_id;

    SELECT count(*)
    INTO active_item_count
    FROM maintenance.checklist_items item
    WHERE item.tenant_id = NEW.tenant_id
      AND item.checklist_template_version_id = NEW.checklist_template_version_id
      AND item.status = 'ACTIVE';

    IF checklist_status <> 'PUBLISHED' OR active_item_count = 0 THEN
      RAISE EXCEPTION 'Um plano não pode ser publicado sem checklist publicado e executável.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER maintenance_plan_versions_publish_guard
BEFORE INSERT OR UPDATE OF status ON maintenance.maintenance_plan_versions
FOR EACH ROW EXECUTE FUNCTION maintenance.validate_published_plan_version();

CREATE OR REPLACE FUNCTION workflow.validate_technical_signature()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  demand workflow.technical_demands%ROWTYPE;
  requirement workflow.demand_validator_requirements%ROWTYPE;
  assignment_can_sign boolean;
BEGIN
  SELECT *
  INTO demand
  FROM workflow.technical_demands
  WHERE tenant_id = NEW.tenant_id
    AND id = NEW.technical_demand_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demanda técnica não encontrada para assinatura.'
      USING ERRCODE = '23503';
  END IF;

  IF demand.payload_hash_sha256 <> NEW.payload_hash_sha256
     OR demand.entity_type <> NEW.entity_type
     OR demand.entity_id <> NEW.entity_id
     OR demand.entity_version <> NEW.entity_version THEN
    RAISE EXCEPTION 'Assinatura recusada: conteúdo, entidade ou versão não corresponde à demanda.'
      USING ERRCODE = '23514';
  END IF;

  IF demand.segregation_required AND demand.created_by = NEW.user_id THEN
    RAISE EXCEPTION 'Segregação obrigatória: o autor não pode assinar a própria demanda.'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(assignment.can_sign_override, technical_role.can_sign, technical_area.default_signature_required, false)
  INTO assignment_can_sign
  FROM iam.user_technical_assignments assignment
  JOIN iam.technical_areas technical_area
    ON technical_area.tenant_id = assignment.tenant_id
   AND technical_area.id = assignment.technical_area_id
  LEFT JOIN iam.technical_roles technical_role
    ON technical_role.tenant_id = assignment.tenant_id
   AND technical_role.id = assignment.technical_role_id
  WHERE assignment.tenant_id = NEW.tenant_id
    AND assignment.user_id = NEW.user_id
    AND assignment.technical_area_id = NEW.technical_area_id
    AND assignment.status = 'ACTIVE'
    AND assignment.valid_from <= NEW.signed_at
    AND (assignment.valid_until IS NULL OR assignment.valid_until > NEW.signed_at)
  ORDER BY assignment.is_primary DESC
  LIMIT 1;

  IF NOT COALESCE(assignment_can_sign, false) THEN
    RAISE EXCEPTION 'Usuário sem atribuição técnica ativa para assinar nesta área.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.validator_requirement_id IS NOT NULL THEN
    SELECT *
    INTO requirement
    FROM workflow.demand_validator_requirements
    WHERE tenant_id = NEW.tenant_id
      AND id = NEW.validator_requirement_id
      AND technical_demand_id = NEW.technical_demand_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Requisito de validação não pertence à demanda.'
        USING ERRCODE = '23503';
    END IF;

    IF (requirement.technical_area_id IS NOT NULL AND requirement.technical_area_id <> NEW.technical_area_id)
       OR (requirement.technical_role_id IS NOT NULL AND requirement.technical_role_id IS DISTINCT FROM NEW.technical_role_id)
       OR (requirement.user_id IS NOT NULL AND requirement.user_id <> NEW.user_id) THEN
      RAISE EXCEPTION 'Assinante não atende ao requisito de validação selecionado.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER technical_signatures_validation_guard
BEFORE INSERT ON workflow.technical_signatures
FOR EACH ROW EXECUTE FUNCTION workflow.validate_technical_signature();

CREATE OR REPLACE FUNCTION workflow.refresh_signature_counters()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_demand_id uuid;
  affected_requirement_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'technical_signatures' THEN
    affected_demand_id := NEW.technical_demand_id;
    affected_requirement_id := NEW.validator_requirement_id;
  ELSE
    SELECT signature.technical_demand_id, signature.validator_requirement_id
    INTO affected_demand_id, affected_requirement_id
    FROM workflow.technical_signatures signature
    WHERE signature.tenant_id = NEW.tenant_id
      AND signature.id = NEW.technical_signature_id;
  END IF;

  IF affected_requirement_id IS NOT NULL THEN
    UPDATE workflow.demand_validator_requirements requirement
    SET fulfilled_count = signature_count.count,
        status = CASE
          WHEN signature_count.count >= requirement.required_count THEN 'FULFILLED'
          WHEN signature_count.count > 0 THEN 'PARTIALLY_FULFILLED'
          ELSE 'PENDING'
        END,
        fulfilled_at = CASE
          WHEN signature_count.count >= requirement.required_count THEN clock_timestamp()
          ELSE NULL
        END
    FROM (
      SELECT count(*)::integer AS count
      FROM workflow.technical_signatures signature
      WHERE signature.tenant_id = NEW.tenant_id
        AND signature.validator_requirement_id = affected_requirement_id
        AND NOT EXISTS (
          SELECT 1
          FROM workflow.technical_signature_revocations revocation
          WHERE revocation.tenant_id = signature.tenant_id
            AND revocation.technical_signature_id = signature.id
        )
    ) signature_count
    WHERE requirement.tenant_id = NEW.tenant_id
      AND requirement.id = affected_requirement_id;
  END IF;

  UPDATE workflow.technical_demands demand
  SET completed_signature_count = signature_count.count
  FROM (
    SELECT count(*)::integer AS count
    FROM workflow.technical_signatures signature
    WHERE signature.tenant_id = NEW.tenant_id
      AND signature.technical_demand_id = affected_demand_id
      AND NOT EXISTS (
        SELECT 1
        FROM workflow.technical_signature_revocations revocation
        WHERE revocation.tenant_id = signature.tenant_id
          AND revocation.technical_signature_id = signature.id
      )
  ) signature_count
  WHERE demand.tenant_id = NEW.tenant_id
    AND demand.id = affected_demand_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER technical_signatures_refresh_counters
AFTER INSERT ON workflow.technical_signatures
FOR EACH ROW EXECUTE FUNCTION workflow.refresh_signature_counters();

CREATE TRIGGER technical_signature_revocations_refresh_counters
AFTER INSERT ON workflow.technical_signature_revocations
FOR EACH ROW EXECUTE FUNCTION workflow.refresh_signature_counters();

CREATE OR REPLACE FUNCTION maintenance.validate_work_order_release()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  plan_status text;
  checklist_status text;
  checklist_version_id uuid;
  active_item_count integer;
  pending_signature_demand_count integer;
BEGIN
  IF NEW.status = 'RELEASED'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT plan_version.status, plan_version.checklist_template_version_id
    INTO plan_status, checklist_version_id
    FROM maintenance.maintenance_plan_versions plan_version
    WHERE plan_version.tenant_id = NEW.tenant_id
      AND plan_version.id = NEW.maintenance_plan_version_id;

    SELECT checklist_version.status
    INTO checklist_status
    FROM maintenance.checklist_template_versions checklist_version
    WHERE checklist_version.tenant_id = NEW.tenant_id
      AND checklist_version.id = checklist_version_id;

    SELECT count(*)
    INTO active_item_count
    FROM maintenance.checklist_items item
    WHERE item.tenant_id = NEW.tenant_id
      AND item.checklist_template_version_id = checklist_version_id
      AND item.status = 'ACTIVE';

    IF plan_status <> 'PUBLISHED'
       OR checklist_status <> 'PUBLISHED'
       OR active_item_count = 0 THEN
      RAISE EXCEPTION 'Liberação bloqueada: plano e checklist publicados com etapas ativas são obrigatórios.'
        USING ERRCODE = '23514';
    END IF;

    SELECT count(*)
    INTO pending_signature_demand_count
    FROM workflow.technical_demands demand
    WHERE demand.tenant_id = NEW.tenant_id
      AND demand.entity_type = 'WORK_ORDER'
      AND demand.entity_id = NEW.id
      AND demand.signature_required
      AND (
        demand.completed_signature_count < demand.required_signature_count
        OR demand.status NOT IN ('TECHNICALLY_APPROVED', 'RELEASED_TO_OPERATION', 'COMPLETED')
      );

    IF pending_signature_demand_count > 0 THEN
      RAISE EXCEPTION 'Liberação bloqueada: validações técnicas ou assinaturas obrigatórias estão pendentes.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER work_orders_release_guard
BEFORE INSERT OR UPDATE OF status ON maintenance.work_orders
FOR EACH ROW EXECUTE FUNCTION maintenance.validate_work_order_release();

CREATE OR REPLACE FUNCTION maintenance.validate_action_ready()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status text;
  plan_status text;
BEGIN
  IF NEW.status = 'READY'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT work_order.status
    INTO parent_status
    FROM maintenance.work_orders work_order
    WHERE work_order.tenant_id = NEW.tenant_id
      AND work_order.id = NEW.work_order_id;

    SELECT plan_version.status
    INTO plan_status
    FROM maintenance.maintenance_plan_versions plan_version
    WHERE plan_version.tenant_id = NEW.tenant_id
      AND plan_version.id = NEW.maintenance_plan_version_id;

    IF parent_status <> 'RELEASED' OR plan_status <> 'PUBLISHED' THEN
      RAISE EXCEPTION 'Ação não pode chegar ao Operador antes da liberação da OS e publicação do plano.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER work_order_actions_ready_guard
BEFORE INSERT OR UPDATE OF status ON maintenance.work_order_actions
FOR EACH ROW EXECUTE FUNCTION maintenance.validate_action_ready();

CREATE TRIGGER checklist_model_reviews_immutable
BEFORE UPDATE OR DELETE ON maintenance.checklist_model_reviews
FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();

CREATE TRIGGER checklist_model_audit_immutable
BEFORE UPDATE OR DELETE ON maintenance.checklist_model_audit
FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();

CREATE TRIGGER history_events_immutable
BEFORE UPDATE OR DELETE ON maintenance.history_events
FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();

CREATE TRIGGER demand_events_immutable
BEFORE UPDATE OR DELETE ON workflow.demand_events
FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();

CREATE TRIGGER technical_signatures_immutable
BEFORE UPDATE OR DELETE ON workflow.technical_signatures
FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();

CREATE TRIGGER technical_signature_revocations_immutable
BEFORE UPDATE OR DELETE ON workflow.technical_signature_revocations
FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();

CREATE TRIGGER document_revisions_immutable
BEFORE UPDATE OR DELETE ON governance.document_revisions
FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();

CREATE TRIGGER audit_events_immutable
BEFORE UPDATE OR DELETE ON audit.events
FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();

CREATE TRIGGER source_snapshots_immutable
BEFORE UPDATE OR DELETE ON migration.source_snapshots
FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();

CREATE VIEW workflow.v_signature_state AS
SELECT
  demand.tenant_id,
  demand.id AS technical_demand_id,
  demand.entity_type,
  demand.entity_id,
  demand.entity_version,
  demand.signature_policy,
  demand.required_signature_count,
  count(signature.id) FILTER (WHERE revocation.id IS NULL)::integer AS valid_signature_count,
  bool_and(requirement.status IN ('FULFILLED', 'WAIVED')) AS all_requirements_fulfilled,
  demand.status
FROM workflow.technical_demands demand
LEFT JOIN workflow.demand_validator_requirements requirement
  ON requirement.tenant_id = demand.tenant_id
 AND requirement.technical_demand_id = demand.id
LEFT JOIN workflow.technical_signatures signature
  ON signature.tenant_id = demand.tenant_id
 AND signature.technical_demand_id = demand.id
LEFT JOIN workflow.technical_signature_revocations revocation
  ON revocation.tenant_id = signature.tenant_id
 AND revocation.technical_signature_id = signature.id
GROUP BY
  demand.tenant_id,
  demand.id,
  demand.entity_type,
  demand.entity_id,
  demand.entity_version,
  demand.signature_policy,
  demand.required_signature_count,
  demand.status;

CREATE VIEW workflow.v_notification_inbox AS
SELECT
  recipient.tenant_id,
  recipient.user_id,
  notification.id,
  notification.notification_type,
  notification.title,
  notification.message,
  notification.entity_type,
  notification.entity_id,
  notification.priority,
  notification.action_route,
  notification.action_payload,
  notification.created_at,
  recipient.delivery_status,
  recipient.delivered_at,
  recipient.read_at,
  recipient.dismissed_at,
  (recipient.read_at IS NULL AND recipient.dismissed_at IS NULL) AS unread
FROM workflow.notification_recipients recipient
JOIN workflow.notifications notification
  ON notification.tenant_id = recipient.tenant_id
 AND notification.id = recipient.notification_id
WHERE notification.status = 'ACTIVE'
  AND (notification.expires_at IS NULL OR notification.expires_at > clock_timestamp());

CREATE VIEW maintenance.v_operator_action_queue AS
SELECT
  action.tenant_id,
  action.id AS action_id,
  action.work_order_id,
  work_order.code AS work_order_code,
  action.asset_id,
  asset.tag AS asset_tag,
  asset.name AS asset_name,
  action.component_id,
  component.tag AS component_tag,
  component.name AS component_name,
  action.maintenance_plan_version_id,
  plan_version.checklist_template_version_id,
  action.title,
  action.description,
  action.priority,
  action.status,
  action.responsible_id,
  action.generated_at
FROM maintenance.work_order_actions action
JOIN maintenance.work_orders work_order
  ON work_order.tenant_id = action.tenant_id
 AND work_order.id = action.work_order_id
JOIN maintenance.maintenance_plan_versions plan_version
  ON plan_version.tenant_id = action.tenant_id
 AND plan_version.id = action.maintenance_plan_version_id
JOIN maintenance.checklist_template_versions checklist_version
  ON checklist_version.tenant_id = plan_version.tenant_id
 AND checklist_version.id = plan_version.checklist_template_version_id
JOIN cmms.assets asset
  ON asset.tenant_id = action.tenant_id
 AND asset.id = action.asset_id
LEFT JOIN cmms.components component
  ON component.tenant_id = action.tenant_id
 AND component.id = action.component_id
WHERE action.status IN ('READY', 'IN_PROGRESS', 'BLOCKED')
  AND work_order.status IN ('RELEASED', 'IN_PROGRESS')
  AND plan_version.status = 'PUBLISHED'
  AND checklist_version.status = 'PUBLISHED'
  AND EXISTS (
    SELECT 1
    FROM maintenance.checklist_items item
    WHERE item.tenant_id = checklist_version.tenant_id
      AND item.checklist_template_version_id = checklist_version.id
      AND item.status = 'ACTIVE'
  );

CREATE VIEW cmms.v_asset_search AS
SELECT
  asset.tenant_id,
  asset.id AS asset_id,
  asset.tag,
  asset.name,
  asset.asset_type,
  asset.criticality,
  asset.operational_status,
  asset.lifecycle_status,
  asset.health_percent,
  asset.current_hour_meter,
  asset.manufacturer,
  asset.model,
  asset.serial_number,
  asset.technical_location,
  line.id AS line_id,
  line.name AS line_name,
  sector.id AS sector_id,
  sector.name AS sector_name,
  plant.id AS plant_id,
  plant.name AS plant_name,
  concat_ws(
    ' ',
    asset.tag,
    asset.name,
    asset.asset_type,
    asset.manufacturer,
    asset.model,
    asset.serial_number,
    asset.technical_location,
    line.name,
    sector.name,
    plant.name
  ) AS search_document
FROM cmms.assets asset
JOIN cmms.lines line
  ON line.tenant_id = asset.tenant_id
 AND line.id = asset.line_id
JOIN cmms.sectors sector
  ON sector.tenant_id = line.tenant_id
 AND sector.id = line.sector_id
JOIN cmms.plants plant
  ON plant.tenant_id = sector.tenant_id
 AND plant.id = sector.plant_id
WHERE asset.deleted_at IS NULL;

DO $$
DECLARE
  tenant_table record;
BEGIN
  FOR tenant_table IN
    SELECT column_table.table_schema, column_table.table_name
    FROM information_schema.columns column_table
    JOIN information_schema.tables base_table
      ON base_table.table_schema = column_table.table_schema
     AND base_table.table_name = column_table.table_name
    WHERE column_table.column_name = 'tenant_id'
      AND column_table.table_schema IN (
        'platform',
        'iam',
        'cmms',
        'maintenance',
        'workflow',
        'governance',
        'audit',
        'migration'
      )
      AND base_table.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      tenant_table.table_schema,
      tenant_table.table_name
    );
    EXECUTE format(
      'ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',
      tenant_table.table_schema,
      tenant_table.table_name
    );
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())',
      tenant_table.table_schema,
      tenant_table.table_name
    );
  END LOOP;
END;
$$;

ALTER TABLE platform.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenants FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_self_isolation
ON platform.tenants
USING (id = platform.current_tenant_id())
WITH CHECK (id = platform.current_tenant_id());

REVOKE ALL ON SCHEMA platform, iam, cmms, maintenance, workflow, governance, audit, migration FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA platform, iam, cmms, maintenance, workflow, governance, audit, migration FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA platform, iam, cmms, maintenance, workflow, governance, audit, migration FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA platform, iam, cmms, maintenance, workflow, governance, audit, migration FROM PUBLIC;

COMMIT;
