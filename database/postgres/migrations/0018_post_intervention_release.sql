BEGIN;

CREATE OR REPLACE FUNCTION maintenance.validate_work_order_release()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  plan_status text;
  checklist_status text;
  checklist_version_id uuid;
  active_item_count integer;
  demand_status text;
  demand_type text;
  demand_hash text;
  signature_count integer;
  pending_requirement_count integer;
  exception_required boolean;
BEGIN
  IF NEW.status = 'RELEASED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT version.status, version.checklist_template_version_id INTO plan_status,checklist_version_id
    FROM maintenance.maintenance_plan_versions version WHERE version.tenant_id=NEW.tenant_id AND version.id=NEW.maintenance_plan_version_id;
    SELECT version.status INTO checklist_status FROM maintenance.checklist_template_versions version
    WHERE version.tenant_id=NEW.tenant_id AND version.id=checklist_version_id;
    SELECT count(*) INTO active_item_count FROM maintenance.checklist_items item
    WHERE item.tenant_id=NEW.tenant_id AND item.checklist_template_version_id=checklist_version_id AND item.status='ACTIVE';
    IF plan_status IS DISTINCT FROM 'PUBLISHED' OR checklist_status IS DISTINCT FROM 'PUBLISHED' OR active_item_count=0 THEN
      RAISE EXCEPTION 'Liberação exige plano e checklist publicados com etapas ativas.' USING ERRCODE='23514';
    END IF;
    IF length(COALESCE(NEW.content_hash_sha256,''))<>64 THEN
      RAISE EXCEPTION 'Liberação exige conteúdo técnico selado.' USING ERRCODE='23514';
    END IF;
    exception_required := NEW.work_type='PREVENTIVE' AND NEW.scheduled_for IS NOT NULL
      AND NEW.maintenance_stop_mode='MANDATORY_STOP'
      AND COALESCE(NEW.technical_analysis->'exige_liberacao_pos_intervencao'='true'::jsonb,false);
    IF NEW.technical_demand_id IS NULL THEN
      IF exception_required THEN
        RAISE EXCEPTION 'Esta preventiva exige requisitos de liberação pós-intervenção.' USING ERRCODE='23514';
      END IF;
    ELSE
      SELECT demand.status,demand.demand_type,demand.payload_hash_sha256,demand.required_signature_count
      INTO demand_status,demand_type,demand_hash,signature_count FROM workflow.technical_demands demand
      WHERE demand.tenant_id=NEW.tenant_id AND demand.id=NEW.technical_demand_id
        AND demand.entity_type='WORK_ORDER' AND demand.entity_id=NEW.id AND demand.entity_version=1;
      IF NOT FOUND OR demand_hash IS DISTINCT FROM NEW.content_hash_sha256 THEN
        RAISE EXCEPTION 'A demanda não corresponde ao conteúdo desta OS.' USING ERRCODE='23514';
      END IF;
      IF demand_type='POST_INTERVENTION_RELEASE' THEN
        IF NOT exception_required OR demand_status<>'OPEN' OR signature_count<1 OR NOT EXISTS (
          SELECT 1 FROM workflow.demand_validator_requirements requirement
          WHERE requirement.tenant_id=NEW.tenant_id AND requirement.technical_demand_id=NEW.technical_demand_id
        ) THEN
          RAISE EXCEPTION 'Requisitos de liberação pós-intervenção inconsistentes.' USING ERRCODE='23514';
        END IF;
      ELSE
        IF demand_status<>'TECHNICALLY_APPROVED' THEN
          RAISE EXCEPTION 'A aprovação técnica existente ainda está pendente.' USING ERRCODE='23514';
        END IF;
        SELECT count(*) INTO pending_requirement_count FROM workflow.demand_validator_requirements requirement
        WHERE requirement.tenant_id=NEW.tenant_id AND requirement.technical_demand_id=NEW.technical_demand_id
          AND requirement.status NOT IN ('FULFILLED','WAIVED');
        IF pending_requirement_count>0 THEN
          RAISE EXCEPTION 'Assinaturas da demanda existente estão pendentes.' USING ERRCODE='23514';
        END IF;
      END IF;
    END IF;
    NEW.released_at:=COALESCE(NEW.released_at,clock_timestamp());
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION maintenance.validate_post_intervention_completion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='COMPLETED' AND EXISTS (
    SELECT 1 FROM workflow.technical_demands demand WHERE demand.tenant_id=NEW.tenant_id
      AND demand.id=NEW.technical_demand_id AND demand.demand_type='POST_INTERVENTION_RELEASE'
      AND demand.status<>'COMPLETED'
  ) THEN
    RAISE EXCEPTION 'A OS aguarda liberação pós-intervenção.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER work_orders_post_intervention_completion_guard
BEFORE INSERT OR UPDATE OF status ON maintenance.work_orders
FOR EACH ROW EXECUTE FUNCTION maintenance.validate_post_intervention_completion();

COMMIT;
