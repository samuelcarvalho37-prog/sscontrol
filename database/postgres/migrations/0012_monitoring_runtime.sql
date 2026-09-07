BEGIN;

INSERT INTO iam.capabilities (code, name, description, module, protected)
VALUES
  ('maintenance.occurrences.read', 'Consultar ocorrências', 'Consulta ocorrências, análises e tratamento.', 'MAINTENANCE', true),
  ('maintenance.occurrences.report', 'Registrar ocorrências', 'Registra ocorrências operacionais com ativo e componente.', 'MAINTENANCE', true),
  ('maintenance.occurrences.triage', 'Tratar ocorrências', 'Classifica ocorrências e envia análise técnica ao Administrador.', 'MAINTENANCE', true),
  ('maintenance.stops.read', 'Consultar paradas', 'Consulta paradas abertas e histórico de indisponibilidade.', 'MAINTENANCE', true),
  ('maintenance.stops.manage', 'Gerenciar paradas', 'Registra e movimenta o ciclo de parada e retorno operacional.', 'MAINTENANCE', true),
  ('maintenance.alerts.read', 'Consultar alertas', 'Consulta alertas técnicos deduplicados.', 'MAINTENANCE', true),
  ('maintenance.alerts.manage', 'Tratar alertas', 'Reconhece alertas e os transforma em ocorrências rastreáveis.', 'MAINTENANCE', true),
  ('workflow.notifications.read', 'Consultar notificações', 'Consulta e confirma notificações destinadas ao usuário autenticado.', 'WORKFLOW', true),
  ('analytics.technical.read', 'Consultar indicadores técnicos', 'Consulta disponibilidade, MTTR, MTBF, SLA e ranking de ativos.', 'ANALYTICS', true)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    module = EXCLUDED.module,
    protected = EXCLUDED.protected,
    status = 'ACTIVE';

CREATE UNIQUE INDEX equipment_stops_one_open_per_asset_idx
  ON maintenance.equipment_stops (tenant_id, asset_id)
  WHERE status NOT IN ('COMPLETED', 'CANCELLED');

CREATE INDEX technical_analyses_admin_queue_idx
  ON workflow.technical_analyses (tenant_id, status, priority, sent_to_admin_at DESC)
  WHERE status = 'SENT_TO_ADMIN';

CREATE INDEX notifications_entity_idx
  ON workflow.notifications (tenant_id, entity_type, entity_id, created_at DESC);

CREATE OR REPLACE FUNCTION maintenance.validate_equipment_stop_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  valid_transition boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' THEN
      RAISE EXCEPTION 'Uma parada deve ser criada no estado OPEN.' USING ERRCODE = '23514';
    END IF;
    IF NEW.started_at > clock_timestamp() + interval '5 minutes' THEN
      RAISE EXCEPTION 'O início da parada não pode estar no futuro.' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    valid_transition :=
      (OLD.status = 'OPEN' AND NEW.status IN ('WAITING_MAINTENANCE', 'IN_MAINTENANCE', 'CANCELLED')) OR
      (OLD.status = 'WAITING_MAINTENANCE' AND NEW.status IN ('IN_MAINTENANCE', 'CANCELLED')) OR
      (OLD.status = 'IN_MAINTENANCE' AND NEW.status IN ('WAITING_OPERATIONAL_RETURN', 'CANCELLED')) OR
      (OLD.status = 'WAITING_OPERATIONAL_RETURN' AND NEW.status IN ('COMPLETED', 'CANCELLED'));

    IF NOT valid_transition THEN
      RAISE EXCEPTION 'Transição de parada inválida: % -> %.', OLD.status, NEW.status
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status = 'IN_MAINTENANCE' AND NEW.maintenance_started_at IS NULL THEN
    NEW.maintenance_started_at := clock_timestamp();
    NEW.maintenance_wait_seconds := GREATEST(0, EXTRACT(EPOCH FROM (NEW.maintenance_started_at - NEW.started_at))::bigint);
  END IF;

  IF NEW.status = 'WAITING_OPERATIONAL_RETURN' AND NEW.maintenance_completed_at IS NULL THEN
    NEW.maintenance_completed_at := clock_timestamp();
    NEW.execution_seconds := GREATEST(0, EXTRACT(EPOCH FROM (NEW.maintenance_completed_at - COALESCE(NEW.maintenance_started_at, NEW.started_at)))::bigint);
  END IF;

  IF NEW.status IN ('COMPLETED', 'CANCELLED') AND NEW.completed_at IS NULL THEN
    NEW.completed_at := clock_timestamp();
    NEW.downtime_seconds := GREATEST(0, EXTRACT(EPOCH FROM (NEW.completed_at - NEW.started_at))::bigint);
    NEW.operational_return_seconds := GREATEST(0, EXTRACT(EPOCH FROM (NEW.completed_at - COALESCE(NEW.maintenance_completed_at, NEW.started_at)))::bigint);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER equipment_stops_transition_guard
BEFORE INSERT OR UPDATE OF status ON maintenance.equipment_stops
FOR EACH ROW EXECUTE FUNCTION maintenance.validate_equipment_stop_transition();

CREATE OR REPLACE FUNCTION maintenance.synchronize_asset_stop_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status NOT IN ('COMPLETED', 'CANCELLED') THEN
    UPDATE cmms.assets
    SET operational_status = 'STOPPED', updated_at = clock_timestamp()
    WHERE tenant_id = NEW.tenant_id AND id = NEW.asset_id;

    IF NEW.component_id IS NOT NULL THEN
      UPDATE cmms.components
      SET operational_status = 'STOPPED', updated_at = clock_timestamp()
      WHERE tenant_id = NEW.tenant_id AND id = NEW.component_id;
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM maintenance.equipment_stops stop
    WHERE stop.tenant_id = NEW.tenant_id
      AND stop.asset_id = NEW.asset_id
      AND stop.id <> NEW.id
      AND stop.status NOT IN ('COMPLETED', 'CANCELLED')
  ) THEN
    UPDATE cmms.assets
    SET operational_status = 'OPERATING', updated_at = clock_timestamp()
    WHERE tenant_id = NEW.tenant_id AND id = NEW.asset_id;

    IF NEW.component_id IS NOT NULL THEN
      UPDATE cmms.components
      SET operational_status = 'OPERATING', updated_at = clock_timestamp()
      WHERE tenant_id = NEW.tenant_id AND id = NEW.component_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER equipment_stops_asset_status_sync
AFTER INSERT OR UPDATE OF status ON maintenance.equipment_stops
FOR EACH ROW EXECUTE FUNCTION maintenance.synchronize_asset_stop_status();

REVOKE INSERT, UPDATE, DELETE ON iam.capabilities FROM fab_control_runtime;

COMMIT;
