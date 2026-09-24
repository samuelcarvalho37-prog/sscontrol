BEGIN;

-- Qualidade e Segurança validam a conclusão pós-intervenção. A demanda aberta
-- não pode impedir que uma OS já aprovada chegue à fila de execução.

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
      AND demand.demand_type <> 'POST_INTERVENTION_RELEASE'
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

COMMIT;
