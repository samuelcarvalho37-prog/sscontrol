BEGIN;

INSERT INTO iam.capabilities (code, name, description, module, protected)
VALUES
  (
    'maintenance.checklists.read',
    'Consultar checklists',
    'Consulta modelos, revisões, etapas e histórico de validação de checklists.',
    'MAINTENANCE',
    true
  ),
  (
    'maintenance.checklists.manage',
    'Gerenciar checklists',
    'Cria modelos e altera exclusivamente revisões editáveis de checklists.',
    'MAINTENANCE',
    true
  ),
  (
    'maintenance.checklists.review',
    'Revisar checklists',
    'Aprova, reprova ou solicita ajustes em modelos submetidos ao filtro técnico.',
    'MAINTENANCE',
    true
  ),
  (
    'maintenance.checklists.publish',
    'Publicar checklists',
    'Publica uma revisão aprovada e preserva as versões anteriores.',
    'MAINTENANCE',
    true
  ),
  (
    'maintenance.plans.read',
    'Consultar planos de manutenção',
    'Consulta planos programados, condicionais e não programados.',
    'MAINTENANCE',
    true
  ),
  (
    'maintenance.plans.manage',
    'Gerenciar planos de manutenção',
    'Cria e altera revisões de planos vinculadas a checklists publicados.',
    'MAINTENANCE',
    true
  ),
  (
    'maintenance.plans.publish',
    'Publicar planos de manutenção',
    'Publica planos consistentes e habilita seu uso operacional.',
    'MAINTENANCE',
    true
  )
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  module = EXCLUDED.module,
  protected = EXCLUDED.protected,
  status = 'ACTIVE';

CREATE INDEX checklist_template_versions_status_idx
  ON maintenance.checklist_template_versions (
    tenant_id,
    status,
    created_at DESC,
    id DESC
  );

CREATE INDEX checklist_items_version_sequence_active_idx
  ON maintenance.checklist_items (
    tenant_id,
    checklist_template_version_id,
    sequence
  )
  WHERE status = 'ACTIVE';

CREATE INDEX checklist_model_reviews_version_created_idx
  ON maintenance.checklist_model_reviews (
    tenant_id,
    checklist_template_version_id,
    created_at,
    id
  );

CREATE UNIQUE INDEX checklist_model_reviews_one_per_reviewer_idx
  ON maintenance.checklist_model_reviews (
    tenant_id,
    checklist_template_version_id,
    reviewer_id
  );

CREATE INDEX maintenance_plan_versions_status_idx
  ON maintenance.maintenance_plan_versions (
    tenant_id,
    status,
    created_at DESC,
    id DESC
  );

CREATE OR REPLACE FUNCTION maintenance.ensure_checklist_items_editable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_tenant_id uuid;
  target_version_id uuid;
  version_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_tenant_id := OLD.tenant_id;
    target_version_id := OLD.checklist_template_version_id;
  ELSE
    target_tenant_id := NEW.tenant_id;
    target_version_id := NEW.checklist_template_version_id;
  END IF;

  SELECT version.status
  INTO version_status
  FROM maintenance.checklist_template_versions version
  WHERE version.tenant_id = target_tenant_id
    AND version.id = target_version_id
  FOR UPDATE;

  IF version_status IS NULL THEN
    RAISE EXCEPTION 'A revisão do checklist não foi encontrada.'
      USING ERRCODE = '23503';
  END IF;

  IF version_status NOT IN ('DRAFT', 'CHANGES_REQUESTED') THEN
    RAISE EXCEPTION 'As etapas só podem ser alteradas em uma revisão editável.'
      USING ERRCODE = '23514';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER checklist_items_editable_guard
BEFORE INSERT OR UPDATE OR DELETE ON maintenance.checklist_items
FOR EACH ROW EXECUTE FUNCTION maintenance.ensure_checklist_items_editable();

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

    IF TG_OP = 'UPDATE' AND OLD.status <> 'APPROVED' THEN
      RAISE EXCEPTION 'Somente uma revisão aprovada pode ser publicada.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.submitted_at IS NULL OR length(NEW.content_hash_sha256) <> 64 THEN
      RAISE EXCEPTION 'A revisão precisa estar submetida e possuir hash SHA-256 válido.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION maintenance.validate_published_plan_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  checklist_status text;
  active_item_count integer;
BEGIN
  IF NEW.trigger_type = 'PERIODICITY' AND NEW.recurrence_days IS NULL THEN
    RAISE EXCEPTION 'Planos por periodicidade exigem recorrência em dias.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.trigger_type = 'HOUR_METER'
     AND (NEW.trigger_value IS NULL OR NEW.trigger_unit IS NULL) THEN
    RAISE EXCEPTION 'Planos por horímetro exigem valor e unidade de disparo.'
      USING ERRCODE = '23514';
  END IF;

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

    IF length(NEW.content_hash_sha256) <> 64 THEN
      RAISE EXCEPTION 'O plano precisa possuir hash SHA-256 válido.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE INSERT, UPDATE, DELETE
ON iam.capabilities
FROM fab_control_runtime;

COMMIT;
