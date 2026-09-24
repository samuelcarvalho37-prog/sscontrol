BEGIN;

-- Correct legacy mojibake stored in the permissions catalogue.  Updating the
-- canonical records makes every profile see the proper Portuguese labels.
UPDATE iam.capabilities
SET name = corrected.name,
    description = corrected.description,
    updated_at = clock_timestamp()
FROM (
  VALUES
    ('maintenance.work-orders.read', 'Consultar ordens de serviço', 'Consulta ordens, fila técnica, liberações e rastreabilidade.'),
    ('maintenance.work-orders.manage', 'Gerenciar ordens de serviço', 'Cria ordens exclusivamente a partir de planos publicados e as envia para validação.'),
    ('maintenance.work-orders.review', 'Validar ordens de serviço', 'Solicita ajustes ou registra assinatura técnica permanente em ordens.'),
    ('maintenance.work-orders.release', 'Liberar ordens de serviço', 'Libera ao Operador somente ordens com plano, checklist e validações consistentes.'),
    ('maintenance.executions.read', 'Consultar execuções', 'Consulta fila do Operador, respostas, evidências e histórico de execução.'),
    ('maintenance.executions.perform', 'Executar ordens de serviço', 'Assume, inicia, responde e conclui ações liberadas ao Operador.')
) AS corrected(code, name, description)
WHERE iam.capabilities.code = corrected.code;

-- This is a controlled demonstration record: it represents an OS already
-- approved, waiting only for the PCM release.  Older demo datasets linked it
-- to a pending validation demand, which made it appear stuck in validation.
UPDATE workflow.demand_validator_requirements AS requirement
SET status = 'CANCELLED'
FROM workflow.technical_demands AS demand
JOIN maintenance.work_orders AS work_order
  ON work_order.tenant_id = demand.tenant_id
 AND work_order.id = demand.entity_id
WHERE requirement.tenant_id = demand.tenant_id
  AND requirement.technical_demand_id = demand.id
  AND work_order.code = 'OS-HML-RELEASE-001'
  AND demand.status NOT IN ('COMPLETED', 'CANCELLED');

UPDATE workflow.technical_demands AS demand
SET status = 'CANCELLED',
    completed_at = COALESCE(demand.completed_at, clock_timestamp()),
    updated_at = clock_timestamp()
FROM maintenance.work_orders AS work_order
WHERE demand.tenant_id = work_order.tenant_id
  AND demand.entity_type = 'WORK_ORDER'
  AND demand.entity_id = work_order.id
  AND work_order.code = 'OS-HML-RELEASE-001'
  AND demand.status NOT IN ('COMPLETED', 'CANCELLED');

UPDATE maintenance.work_orders
SET status = 'APPROVED',
    technical_demand_id = NULL,
    submitted_at = NULL,
    updated_at = clock_timestamp()
WHERE code = 'OS-HML-RELEASE-001'
  AND status IN ('DRAFT', 'IN_TECHNICAL_REVIEW', 'APPROVED');

COMMIT;
