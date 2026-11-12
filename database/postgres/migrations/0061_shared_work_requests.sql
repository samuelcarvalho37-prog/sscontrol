BEGIN;

ALTER TABLE maintenance.operational_occurrences
  ADD COLUMN request_kind text CHECK (request_kind IN ('CORRECTIVE','PREVENTIVE','LUBRICATION','INSPECTION','IMPROVEMENT')),
  ADD COLUMN requested_quality boolean NOT NULL DEFAULT false,
  ADD COLUMN requested_safety boolean NOT NULL DEFAULT false,
  ADD COLUMN request_submission_key uuid,
  ADD COLUMN request_returned boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX shared_request_submission_key ON maintenance.operational_occurrences(tenant_id,reported_by,request_submission_key) WHERE request_submission_key IS NOT NULL;

CREATE FUNCTION maintenance.shared_asset_visible(target_asset uuid, target_user uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM cmms.assets a JOIN cmms.lines l ON l.id=a.line_id AND l.tenant_id=a.tenant_id
 JOIN cmms.sectors s ON s.id=l.sector_id AND s.tenant_id=l.tenant_id
 JOIN iam.user_scope_assignments scope ON scope.tenant_id=a.tenant_id AND scope.user_id=target_user AND scope.status='ACTIVE'
 WHERE a.id=target_asset AND a.deleted_at IS NULL AND
 (scope.scope_type='TENANT' OR (scope.scope_type='PLANT' AND scope.plant_id=s.plant_id)
 OR (scope.scope_type='SECTOR' AND scope.sector_id=s.id) OR (scope.scope_type='LINE' AND scope.line_id=l.id)
 OR (scope.scope_type='ASSET' AND scope.asset_id=a.id)))
$$;
REVOKE ALL ON FUNCTION maintenance.shared_asset_visible(uuid,uuid) FROM PUBLIC;

CREATE TABLE maintenance.work_order_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
 work_order_id uuid NOT NULL REFERENCES maintenance.work_orders(id), user_id uuid NOT NULL REFERENCES iam.users(id),
 area text NOT NULL CHECK(area IN ('QUALITY','SAFETY')), note text NOT NULL CHECK(length(note) BETWEEN 3 AND 4000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE maintenance.work_order_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance.work_order_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY shared_observation_tenant ON maintenance.work_order_observations
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT ON maintenance.work_order_observations TO fab_control_runtime;
GRANT EXECUTE ON FUNCTION maintenance.shared_asset_visible(uuid,uuid) TO fab_control_runtime;

INSERT INTO iam.capabilities(code,name,description,module) VALUES
 ('maintenance.shared.request','Solicitar OS','Registra pedido para análise do PCM, sem liberar execução.','MAINTENANCE'),
 ('maintenance.shared.read','Acompanhar manutenção da unidade','Consulta solicitações e OS no escopo autorizado.','MAINTENANCE'),
 ('maintenance.shared.observe.quality','Registrar acompanhamento de Qualidade','Registra presença e observações; não substitui assinatura final.','MAINTENANCE'),
 ('maintenance.shared.observe.safety','Registrar acompanhamento de Segurança','Registra presença e observações; não substitui assinatura final.','MAINTENANCE')
 ON CONFLICT(code) DO NOTHING;
INSERT INTO iam.role_capabilities(tenant_id,role_id,capability_id,effect)
 SELECT r.tenant_id,r.id,c.id,'ALLOW' FROM iam.roles r CROSS JOIN iam.capabilities c
 WHERE r.deleted_at IS NULL AND r.status='ACTIVE' AND (
 (r.code IN ('PCM','PRODUCAO','OPERADOR','TECNICO','MECANICO','ELETRICISTA','LUBRIFICADOR','QUALIDADE','SEGURANCA','GESTOR_TECNICO')
 AND c.code IN ('maintenance.shared.request','maintenance.shared.read'))
 OR (r.code='PCM' AND c.code='maintenance.occurrences.triage')
 OR (r.code='QUALIDADE' AND c.code='maintenance.shared.observe.quality')
 OR (r.code='SEGURANCA' AND c.code='maintenance.shared.observe.safety'))
 ON CONFLICT(tenant_id,role_id,capability_id) DO UPDATE SET effect='ALLOW';

COMMIT;
