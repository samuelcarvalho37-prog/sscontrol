BEGIN;

INSERT INTO iam.capabilities (code, name, description, module, protected)
VALUES
  ('maintenance.work-orders.read', 'Consultar ordens de serviÃ§o', 'Consulta ordens, fila tÃ©cnica, liberaÃ§Ãµes e rastreabilidade.', 'MAINTENANCE', true),
  ('maintenance.work-orders.manage', 'Gerenciar ordens de serviÃ§o', 'Cria ordens exclusivamente a partir de planos publicados e as envia para validaÃ§Ã£o.', 'MAINTENANCE', true),
  ('maintenance.work-orders.review', 'Validar ordens de serviÃ§o', 'Solicita ajustes ou registra assinatura tÃ©cnica permanente em ordens.', 'MAINTENANCE', true),
  ('maintenance.work-orders.release', 'Liberar ordens de serviÃ§o', 'Libera ao Operador somente ordens com plano, checklist e validaÃ§Ãµes consistentes.', 'MAINTENANCE', true),
  ('maintenance.executions.read', 'Consultar execuÃ§Ãµes', 'Consulta fila do Operador, respostas, evidÃªncias e histÃ³rico de execuÃ§Ã£o.', 'MAINTENANCE', true),
  ('maintenance.executions.perform', 'Executar ordens de serviÃ§o', 'Assume, inicia, responde e conclui aÃ§Ãµes liberadas ao Operador.', 'MAINTENANCE', true)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    module = EXCLUDED.module,
    protected = EXCLUDED.protected,
    status = 'ACTIVE';

ALTER TABLE maintenance.work_orders
  ADD COLUMN technical_demand_id uuid,
  ADD COLUMN content_hash_sha256 text,
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN released_at timestamptz,
  ADD CONSTRAINT work_orders_technical_demand_fk
    FOREIGN KEY (tenant_id, technical_demand_id)
    REFERENCES workflow.technical_demands(tenant_id, id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT work_orders_content_hash_check
    CHECK (content_hash_sha256 IS NULL OR length(content_hash_sha256) = 64);

CREATE UNIQUE INDEX work_orders_one_demand_idx
  ON maintenance.work_orders (tenant_id, technical_demand_id)
  WHERE technical_demand_id IS NOT NULL;

CREATE UNIQUE INDEX work_order_actions_one_primary_idx
  ON maintenance.work_order_actions (tenant_id, work_order_id, origin)
  WHERE origin = 'WORK_ORDER_RELEASE';

CREATE INDEX executions_work_order_time_idx
  ON maintenance.executions (tenant_id, work_order_id, created_at DESC);

CREATE OR REPLACE FUNCTION maintenance.validate_work_order_release()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  plan_status text;
  checklist_status text;
  checklist_version_id uuid;
  active_item_count integer;
  demand_status text;
  demand_hash text;
  pending_requirement_count integer;
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

    IF plan_status <> 'PUBLISHED' OR checklist_status <> 'PUBLISHED' OR active_item_count = 0 THEN
      RAISE EXCEPTION 'LiberaÃ§Ã£o bloqueada: plano e checklist publicados com etapas ativas sÃ£o obrigatÃ³rios.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.technical_demand_id IS NULL OR length(COALESCE(NEW.content_hash_sha256, '')) <> 64 THEN
      RAISE EXCEPTION 'LiberaÃ§Ã£o bloqueada: a validaÃ§Ã£o tÃ©cnica selada Ã© obrigatÃ³ria.'
        USING ERRCODE = '23514';
    END IF;

    SELECT demand.status, demand.payload_hash_sha256
    INTO demand_status, demand_hash
    FROM workflow.technical_demands demand
    WHERE demand.tenant_id = NEW.tenant_id
      AND demand.id = NEW.technical_demand_id
      AND demand.entity_type = 'WORK_ORDER'
      AND demand.entity_id = NEW.id
      AND demand.entity_version = 1;

    IF demand_status <> 'TECHNICALLY_APPROVED' OR demand_hash <> NEW.content_hash_sha256 THEN
      RAISE EXCEPTION 'LiberaÃ§Ã£o bloqueada: a aprovaÃ§Ã£o nÃ£o corresponde ao conteÃºdo atual da OS.'
        USING ERRCODE = '23514';
    END IF;

    SELECT count(*)
    INTO pending_requirement_count
    FROM workflow.demand_validator_requirements requirement
    WHERE requirement.tenant_id = NEW.tenant_id
      AND requirement.technical_demand_id = NEW.technical_demand_id
      AND requirement.status NOT IN ('FULFILLED', 'WAIVED');

    IF pending_requirement_count > 0 THEN
      RAISE EXCEPTION 'LiberaÃ§Ã£o bloqueada: ainda existem assinaturas obrigatÃ³rias pendentes.'
        USING ERRCODE = '23514';
    END IF;

    NEW.released_at := COALESCE(NEW.released_at, clock_timestamp());
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION maintenance.validate_execution_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  action_status text;
  pending_required integer;
  missing_evidence integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT action.status INTO action_status
    FROM maintenance.work_order_actions action
    WHERE action.tenant_id = NEW.tenant_id AND action.id = NEW.work_order_action_id
    FOR UPDATE;

    IF action_status <> 'READY' THEN
      RAISE EXCEPTION 'ExecuÃ§Ã£o bloqueada: a aÃ§Ã£o ainda nÃ£o foi liberada ao Operador.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status = 'COMPLETED'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT count(*) INTO pending_required
    FROM maintenance.execution_checklist_items item
    WHERE item.tenant_id = NEW.tenant_id
      AND item.execution_id = NEW.id
      AND item.required
      AND item.status NOT IN ('ANSWERED', 'NOT_APPLICABLE');

    SELECT count(*) INTO missing_evidence
    FROM maintenance.execution_checklist_items item
    WHERE item.tenant_id = NEW.tenant_id
      AND item.execution_id = NEW.id
      AND item.evidence_required
      AND item.evidence_count < GREATEST(item.minimum_evidence_photos, 1);

    IF pending_required > 0 OR missing_evidence > 0 THEN
      RAISE EXCEPTION 'ConclusÃ£o bloqueada: existem respostas ou evidÃªncias obrigatÃ³rias pendentes.'
        USING ERRCODE = '23514';
    END IF;

    NEW.completed_at := COALESCE(NEW.completed_at, clock_timestamp());
    NEW.duration_seconds := GREATEST(0, EXTRACT(EPOCH FROM (NEW.completed_at - COALESCE(NEW.started_at, NEW.opened_at)))::bigint);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER executions_transition_guard
BEFORE INSERT OR UPDATE OF status ON maintenance.executions
FOR EACH ROW EXECUTE FUNCTION maintenance.validate_execution_transition();

CREATE OR REPLACE FUNCTION maintenance.refresh_execution_evidence_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.execution_checklist_item_id IS NOT NULL THEN
    UPDATE maintenance.execution_checklist_items item
    SET evidence_count = (
      SELECT count(*)::integer
      FROM maintenance.evidence evidence
      WHERE evidence.tenant_id = NEW.tenant_id
        AND evidence.execution_checklist_item_id = NEW.execution_checklist_item_id
    )
    WHERE item.tenant_id = NEW.tenant_id
      AND item.id = NEW.execution_checklist_item_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_refresh_item_count
AFTER INSERT ON maintenance.evidence
FOR EACH ROW EXECUTE FUNCTION maintenance.refresh_execution_evidence_count();

REVOKE INSERT, UPDATE, DELETE ON iam.capabilities FROM fab_control_runtime;

COMMIT;
