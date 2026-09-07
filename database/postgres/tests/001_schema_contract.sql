\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  unprotected_tables integer;
  checklist_type_count integer;
  monitoring_capability_count integer;
  monitoring_trigger_count integer;
BEGIN
  SELECT count(*)
  INTO unprotected_tables
  FROM pg_catalog.pg_class table_definition
  JOIN pg_catalog.pg_namespace schema_definition
    ON schema_definition.oid = table_definition.relnamespace
  JOIN information_schema.columns tenant_column
    ON tenant_column.table_schema = schema_definition.nspname
   AND tenant_column.table_name = table_definition.relname
   AND tenant_column.column_name = 'tenant_id'
  WHERE schema_definition.nspname IN (
      'platform',
      'iam',
      'cmms',
      'maintenance',
      'workflow',
      'governance',
      'audit',
      'migration'
    )
    AND table_definition.relkind = 'r'
    AND (NOT table_definition.relrowsecurity OR NOT table_definition.relforcerowsecurity);

  IF unprotected_tables <> 0 THEN
    RAISE EXCEPTION '% tabela(s) multiempresa sem RLS forçada.', unprotected_tables;
  END IF;

  SELECT count(*)
  INTO checklist_type_count
  FROM maintenance.checklist_item_types
  WHERE active;

  IF checklist_type_count <> 9 THEN
    RAISE EXCEPTION 'Catálogo de checklist inválido: esperado 9, encontrado %.', checklist_type_count;
  END IF;
  SELECT count(*)
  INTO monitoring_capability_count
  FROM iam.capabilities
  WHERE code IN (
    'maintenance.occurrences.read',
    'maintenance.occurrences.report',
    'maintenance.occurrences.triage',
    'maintenance.stops.read',
    'maintenance.stops.manage',
    'maintenance.alerts.read',
    'maintenance.alerts.manage',
    'workflow.notifications.read',
    'analytics.technical.read'
  )
    AND status = 'ACTIVE';

  IF monitoring_capability_count <> 9 THEN
    RAISE EXCEPTION 'Capacidades de monitoramento inválidas: esperado 9, encontrado %.', monitoring_capability_count;
  END IF;

  SELECT count(*)
  INTO monitoring_trigger_count
  FROM pg_catalog.pg_trigger
  WHERE tgname IN ('equipment_stops_transition_guard', 'equipment_stops_asset_status_sync')
    AND NOT tgisinternal;

  IF monitoring_trigger_count <> 2 THEN
    RAISE EXCEPTION 'Proteções de parada inválidas: esperado 2, encontrado %.', monitoring_trigger_count;
  END IF;
END;
$$;

INSERT INTO platform.tenants (
  id,
  legacy_id,
  legal_name,
  display_name,
  slug,
  environment
)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'TENANT-A', 'Fábrica A Ltda.', 'Fábrica A', 'fabrica-a', 'HOMOLOGATION'),
  ('22222222-2222-4222-8222-222222222222', 'TENANT-B', 'Fábrica B Ltda.', 'Fábrica B', 'fabrica-b', 'HOMOLOGATION');

INSERT INTO iam.users (
  id,
  tenant_id,
  legacy_id,
  employee_number,
  name,
  email,
  first_access_required
)
VALUES
  (
    '11111111-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'USR-ADMIN-TEST',
    'ADM-TEST',
    'Administrador Teste',
    'admin.test@example.invalid',
    false
  ),
  (
    '11111111-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'USR-QUALITY-TEST',
    'QLT-TEST',
    'Qualidade Teste',
    'quality.test@example.invalid',
    false
  ),
  (
    '11111111-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111',
    'USR-OPERATOR-TEST',
    'OP-TEST',
    'Operador Teste',
    'operator.test@example.invalid',
    false
  );

INSERT INTO iam.technical_areas (
  id,
  tenant_id,
  legacy_id,
  code,
  name,
  description,
  default_signature_required,
  validation_area
)
VALUES (
  '11111111-1000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'AREA-QUALITY-TEST',
  'QUALIDADE',
  'Qualidade',
  'Validação técnica de qualidade.',
  true,
  true
);

INSERT INTO iam.technical_roles (
  id,
  tenant_id,
  legacy_id,
  technical_area_id,
  code,
  name,
  description,
  can_sign
)
VALUES (
  '11111111-1100-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'ROLE-QUALITY-TEST',
  '11111111-1000-4000-8000-000000000001',
  'INSPETOR_QUALIDADE',
  'Inspetor de qualidade',
  'Responsável por validar e assinar.',
  true
);

INSERT INTO iam.user_technical_assignments (
  id,
  tenant_id,
  user_id,
  technical_area_id,
  technical_role_id,
  is_primary
)
VALUES (
  '11111111-1200-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '11111111-0000-4000-8000-000000000002',
  '11111111-1000-4000-8000-000000000001',
  '11111111-1100-4000-8000-000000000001',
  true
);

INSERT INTO cmms.plants (id, tenant_id, legacy_id, tag, name)
VALUES (
  '11111111-2000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'PLANT-TEST',
  'PLT-01',
  'Planta de teste'
);

INSERT INTO cmms.sectors (id, tenant_id, legacy_id, plant_id, tag, name)
VALUES (
  '11111111-2100-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'SECTOR-TEST',
  '11111111-2000-4000-8000-000000000001',
  'SET-01',
  'Setor de teste'
);

INSERT INTO cmms.lines (id, tenant_id, legacy_id, sector_id, tag, name)
VALUES (
  '11111111-2200-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'LINE-TEST',
  '11111111-2100-4000-8000-000000000001',
  'LIN-01',
  'Linha de teste'
);

INSERT INTO cmms.assets (
  id,
  tenant_id,
  legacy_id,
  line_id,
  tag,
  qr_payload,
  name,
  asset_type
)
VALUES
  (
    '11111111-2300-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'ASSET-TEST-1',
    '11111111-2200-4000-8000-000000000001',
    'EQ-TEST-01',
    'FAB:ASSET:EQ-TEST-01',
    'Equipamento de teste 1',
    'MACHINE'
  ),
  (
    '11111111-2300-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'ASSET-TEST-2',
    '11111111-2200-4000-8000-000000000001',
    'EQ-TEST-02',
    'FAB:ASSET:EQ-TEST-02',
    'Equipamento de teste 2',
    'MACHINE'
  );

INSERT INTO cmms.components (
  id,
  tenant_id,
  legacy_id,
  asset_id,
  tag,
  qr_payload,
  name,
  component_type
)
VALUES (
  '11111111-2400-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'COMPONENT-TEST',
  '11111111-2300-4000-8000-000000000001',
  'MOT-TEST-01',
  'FAB:COMPONENT:MOT-TEST-01',
  'Motor de teste',
  'MOTOR'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO cmms.parameter_definitions (
      tenant_id,
      asset_id,
      component_id,
      code,
      name,
      unit
    )
    VALUES (
      '11111111-1111-4111-8111-111111111111',
      '11111111-2300-4000-8000-000000000002',
      '11111111-2400-4000-8000-000000000001',
      'TEMPERATURE',
      'Temperatura',
      '°C'
    );

    RAISE EXCEPTION 'O vínculo inválido entre componente e ativo foi aceito.';
  EXCEPTION
    WHEN foreign_key_violation THEN
      NULL;
  END;
END;
$$;

INSERT INTO maintenance.checklist_templates (
  id,
  tenant_id,
  legacy_id,
  code,
  name,
  asset_id,
  component_id,
  checklist_type,
  created_by
)
VALUES (
  '11111111-3000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'CHECKLIST-TEST',
  'CHK-TEST-01',
  'Checklist de teste',
  '11111111-2300-4000-8000-000000000001',
  '11111111-2400-4000-8000-000000000001',
  'PREVENTIVE',
  '11111111-0000-4000-8000-000000000001'
);

INSERT INTO maintenance.checklist_template_versions (
  id,
  tenant_id,
  legacy_id,
  checklist_template_id,
  revision,
  status,
  signature_policy,
  required_signatures,
  content_hash_sha256,
  created_by
)
VALUES (
  '11111111-3100-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'CHECKLIST-VERSION-TEST',
  '11111111-3000-4000-8000-000000000001',
  1,
  'DRAFT',
  'QUALIDADE',
  1,
  repeat('a', 64),
  '11111111-0000-4000-8000-000000000001'
);

DO $$
BEGIN
  BEGIN
    UPDATE maintenance.checklist_template_versions
    SET status = 'PUBLISHED',
        submitted_at = clock_timestamp()
    WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
      AND id = '11111111-3100-4000-8000-000000000001';

    RAISE EXCEPTION 'Checklist sem etapa foi publicado.';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;
END;
$$;

INSERT INTO maintenance.checklist_items (
  id,
  tenant_id,
  legacy_id,
  checklist_template_version_id,
  sequence,
  title,
  instruction,
  response_type_code,
  required,
  evidence_required,
  blocks_completion
)
VALUES (
  '11111111-3200-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'CHECKLIST-ITEM-TEST',
  '11111111-3100-4000-8000-000000000001',
  1,
  'Confirmar condição segura',
  'Inspecione o bloqueio antes de iniciar.',
  'OK_NOK',
  true,
  true,
  true
);

UPDATE maintenance.checklist_template_versions
SET status = 'APPROVED',
    submitted_at = clock_timestamp(),
    content_hash_sha256 = repeat('c', 64)
WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
  AND id = '11111111-3100-4000-8000-000000000001';

UPDATE maintenance.checklist_template_versions
SET status = 'PUBLISHED',
    published_at = clock_timestamp()
WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
  AND id = '11111111-3100-4000-8000-000000000001';

INSERT INTO maintenance.maintenance_plans (
  id,
  tenant_id,
  legacy_id,
  code,
  name,
  asset_id,
  component_id,
  plan_type,
  created_by
)
VALUES (
  '11111111-3300-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'PLAN-TEST',
  'PLN-TEST-01',
  'Plano de teste',
  '11111111-2300-4000-8000-000000000001',
  '11111111-2400-4000-8000-000000000001',
  'PREVENTIVE',
  '11111111-0000-4000-8000-000000000001'
);

INSERT INTO maintenance.maintenance_plan_versions (
  id,
  tenant_id,
  legacy_id,
  maintenance_plan_id,
  checklist_template_version_id,
  revision,
  status,
  trigger_type,
  recurrence_days,
  estimated_duration_minutes,
  content_hash_sha256,
  created_by,
  published_at
)
VALUES (
  '11111111-3400-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'PLAN-VERSION-TEST',
  '11111111-3300-4000-8000-000000000001',
  '11111111-3100-4000-8000-000000000001',
  1,
  'PUBLISHED',
  'PERIODICITY',
  30,
  60,
  repeat('b', 64),
  '11111111-0000-4000-8000-000000000001',
  clock_timestamp()
);

INSERT INTO maintenance.work_orders (
  id,
  tenant_id,
  legacy_id,
  code,
  asset_id,
  component_id,
  maintenance_plan_version_id,
  origin_type,
  work_type,
  title,
  description,
  priority,
  requester_id,
  content_hash_sha256
)
VALUES (
  '11111111-3500-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'WORK-ORDER-TEST',
  'OS-TEST-01',
  '11111111-2300-4000-8000-000000000001',
  '11111111-2400-4000-8000-000000000001',
  '11111111-3400-4000-8000-000000000001',
  'ADMIN',
  'PREVENTIVE',
  'OS de teste',
  'Validação do bloqueio de liberação.',
  'HIGH',
  '11111111-0000-4000-8000-000000000001',
  repeat('c', 64)
);

INSERT INTO workflow.technical_demands (
  id,
  tenant_id,
  legacy_id,
  demand_type,
  entity_type,
  entity_id,
  origin_type,
  title,
  description,
  priority,
  status,
  current_area_id,
  created_by,
  creator_role_snapshot,
  signature_required,
  required_signature_count,
  signature_policy,
  entity_version,
  payload_hash_sha256
)
VALUES (
  '11111111-4000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'DEMAND-TEST',
  'WORK_ORDER_VALIDATION',
  'WORK_ORDER',
  '11111111-3500-4000-8000-000000000001',
  'ADMIN',
  'Validar OS de teste',
  'Aprovação e assinatura antes da liberação.',
  'HIGH',
  'AWAITING_SIGNATURE',
  '11111111-1000-4000-8000-000000000001',
  '11111111-0000-4000-8000-000000000001',
  'ADMIN',
  true,
  1,
  'QUALIDADE',
  1,
  repeat('c', 64)
);

INSERT INTO workflow.demand_validator_requirements (
  id,
  tenant_id,
  technical_demand_id,
  requirement_code,
  technical_area_id
)
VALUES (
  '11111111-4100-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '11111111-4000-4000-8000-000000000001',
  'QUALIDADE',
  '11111111-1000-4000-8000-000000000001'
);

UPDATE maintenance.work_orders
SET technical_demand_id = '11111111-4000-4000-8000-000000000001',
    submitted_at = clock_timestamp(),
    status = 'IN_TECHNICAL_REVIEW'
WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
  AND id = '11111111-3500-4000-8000-000000000001';

DO $$
BEGIN
  BEGIN
    UPDATE maintenance.work_orders
    SET status = 'RELEASED'
    WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
      AND id = '11111111-3500-4000-8000-000000000001';

    RAISE EXCEPTION 'OS com assinatura pendente foi liberada.';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;
END;
$$;

INSERT INTO workflow.technical_signatures (
  id,
  tenant_id,
  legacy_id,
  technical_demand_id,
  validator_requirement_id,
  entity_type,
  entity_id,
  entity_version,
  user_id,
  role_snapshot,
  technical_area_id,
  technical_role_id,
  meaning,
  declaration,
  payload_hash_sha256,
  signature_hash_sha256
)
VALUES (
  '11111111-4200-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'SIGNATURE-TEST',
  '11111111-4000-4000-8000-000000000001',
  '11111111-4100-4000-8000-000000000001',
  'WORK_ORDER',
  '11111111-3500-4000-8000-000000000001',
  1,
  '11111111-0000-4000-8000-000000000002',
  'GESTOR_QUALIDADE',
  '11111111-1000-4000-8000-000000000001',
  '11111111-1100-4000-8000-000000000001',
  'TECHNICAL_APPROVAL',
  'Confirmo a revisão técnica desta versão.',
  repeat('c', 64),
  repeat('d', 64)
);

DO $$
DECLARE
  actual_count integer;
BEGIN
  SELECT completed_signature_count
  INTO actual_count
  FROM workflow.technical_demands
  WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
    AND id = '11111111-4000-4000-8000-000000000001';

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'Contador de assinaturas inválido: %.', actual_count;
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE workflow.technical_signatures
    SET declaration = 'Tentativa de adulteração'
    WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
      AND id = '11111111-4200-4000-8000-000000000001';

    RAISE EXCEPTION 'Assinatura imutável foi alterada.';
  EXCEPTION
    WHEN object_not_in_prerequisite_state THEN
      NULL;
  END;
END;
$$;

UPDATE workflow.technical_demands
SET status = 'TECHNICALLY_APPROVED',
    completed_at = clock_timestamp()
WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
  AND id = '11111111-4000-4000-8000-000000000001';

UPDATE maintenance.work_orders
SET status = 'RELEASED',
    opened_at = clock_timestamp()
WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
  AND id = '11111111-3500-4000-8000-000000000001';

INSERT INTO maintenance.work_order_actions (
  id,
  tenant_id,
  legacy_id,
  work_order_id,
  asset_id,
  component_id,
  maintenance_plan_version_id,
  origin,
  action_type,
  title,
  description,
  priority,
  responsible_id
)
VALUES (
  '11111111-3600-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'WORK-ORDER-ACTION-TEST',
  '11111111-3500-4000-8000-000000000001',
  '11111111-2300-4000-8000-000000000001',
  '11111111-2400-4000-8000-000000000001',
  '11111111-3400-4000-8000-000000000001',
  'WORK_ORDER',
  'CHECKLIST_EXECUTION',
  'Executar checklist de teste',
  'Ação liberada após validação.',
  'HIGH',
  '11111111-0000-4000-8000-000000000003'
);

UPDATE maintenance.work_order_actions
SET status = 'READY'
WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
  AND id = '11111111-3600-4000-8000-000000000001';

DO $$
DECLARE
  operator_queue_count integer;
BEGIN
  SELECT count(*)
  INTO operator_queue_count
  FROM maintenance.v_operator_action_queue
  WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
    AND action_id = '11111111-3600-4000-8000-000000000001';

  IF operator_queue_count <> 1 THEN
    RAISE EXCEPTION 'Ação válida não apareceu na fila segura do Operador.';
  END IF;
END;
$$;

INSERT INTO workflow.notifications (
  id,
  tenant_id,
  legacy_id,
  notification_type,
  title,
  message,
  entity_type,
  entity_id,
  priority,
  action_route,
  action_payload,
  deduplication_key
)
VALUES (
  '11111111-4300-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'NOTIFICATION-TEST',
  'WORK_ORDER_RELEASED',
  'OS liberada',
  'A OS de teste foi liberada.',
  'WORK_ORDER',
  '11111111-3500-4000-8000-000000000001',
  'HIGH',
  '/work-orders/11111111-3500-4000-8000-000000000001',
  '{"workOrderId":"11111111-3500-4000-8000-000000000001"}'::jsonb,
  'work-order-released:11111111-3500-4000-8000-000000000001'
);

INSERT INTO workflow.notification_recipients (
  tenant_id,
  notification_id,
  user_id,
  delivery_status,
  delivered_at,
  read_at
)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  '11111111-4300-4000-8000-000000000001',
  '11111111-0000-4000-8000-000000000002',
  'DELIVERED',
  clock_timestamp(),
  clock_timestamp()
);

DO $$
DECLARE
  unread_state boolean;
BEGIN
  SELECT unread
  INTO unread_state
  FROM workflow.v_notification_inbox
  WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
    AND user_id = '11111111-0000-4000-8000-000000000002'
    AND id = '11111111-4300-4000-8000-000000000001';

  IF unread_state IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Leitura da notificação não permaneceu registrada.';
  END IF;
END;
$$;

DO $$
DECLARE
  admin_capabilities integer;
BEGIN
  IF to_regclass('platform.commercial_catalog_versions') IS NULL
     OR to_regclass('platform.commercial_catalog_drafts') IS NULL THEN
    RAISE EXCEPTION 'Tabelas do catÃ¡logo comercial versionado nÃ£o foram criadas.';
  END IF;

  IF to_regclass('maintenance.checklist_version_validator_users') IS NULL THEN
    RAISE EXCEPTION 'Tabela de validadores nominais de checklist não foi criada.';
  END IF;

  SELECT count(*)
  INTO admin_capabilities
  FROM iam.capabilities
  WHERE code IN (
    'admin.identity.read',
    'admin.identity.manage',
    'admin.governance.read',
    'admin.governance.manage',
    'admin.configuration.manage'
  );

  IF admin_capabilities <> 5 THEN
    RAISE EXCEPTION 'Capacidades administrativas incompletas: % de 5.', admin_capabilities;
  END IF;
END;
$$;

CREATE ROLE fab_schema_test_runtime NOLOGIN;
GRANT USAGE ON SCHEMA platform TO fab_schema_test_runtime;
GRANT SELECT ON platform.tenants TO fab_schema_test_runtime;
GRANT EXECUTE ON FUNCTION platform.current_tenant_id() TO fab_schema_test_runtime;

SET SESSION AUTHORIZATION fab_schema_test_runtime;
SELECT set_config('app.tenant_id', '11111111-1111-4111-8111-111111111111', true);

DO $$
DECLARE
  visible_tenants integer;
  visible_tenant_id uuid;
BEGIN
  SELECT count(*), min(id::text)::uuid
  INTO visible_tenants, visible_tenant_id
  FROM platform.tenants;

  IF visible_tenants <> 1
     OR visible_tenant_id <> '11111111-1111-4111-8111-111111111111'::uuid THEN
    RAISE EXCEPTION 'RLS permitiu acesso cruzado entre tenants: contagem %, tenant %.',
      visible_tenants,
      visible_tenant_id;
  END IF;
END;
$$;

RESET SESSION AUTHORIZATION;

SELECT
  'PASS' AS result,
  'RLS, catálogo, vínculos, publicação, assinatura, fila, monitoramento e notificações validados' AS contract;

ROLLBACK;
