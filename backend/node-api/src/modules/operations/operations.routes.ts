import { type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';

import { successEnvelopeSchema } from '../auth/auth.schemas.js';
import type { OperationsController } from './operations.controller.js';
import {
  actionReviewBodySchema,
  assignActionBodySchema,
  completeExecutionBodySchema,
  correctWorkOrderBodySchema,
  consumeMaterialBodySchema,
  createWorkOrderBodySchema,
  evidenceBodySchema,
  executionBatchResponseBodySchema,
  executionResponseBodySchema,
  maintenanceActionListQuerySchema,
  operatorActionListQuerySchema,
  operationsIdentifierParamsSchema,
  pauseExecutionBodySchema,
  requestChangesBodySchema,
  signatureBodySchema,
  startExecutionBodySchema,
  submitReviewBodySchema,
  technicalDemandListQuerySchema,
  workOrderListQuerySchema,
} from './operations.schemas.js';

const secured = {
  response: { 200: successEnvelopeSchema },
  security: [{ bearerAuth: [] }],
  tags: ['Operations'],
};

export function createOperationsRoutes(
  controller: OperationsController,
): FastifyPluginAsyncTypebox {
  return (app) => {
    app.get('/v1/workflow/technical-context', {
      preHandler: (request) => app.authorize(request, 'maintenance.work-orders.read'),
      schema: {
        ...secured,
        summary: 'Consulta o escopo técnico e as capacidades do Gestor.',
      },
      handler: controller.getTechnicalContext,
    });
    app.get('/v1/workflow/technical-demands', {
      preHandler: (request) => app.authorize(request, 'maintenance.work-orders.read'),
      schema: {
        ...secured,
        querystring: technicalDemandListQuerySchema,
        summary: 'Consulta somente demandas visíveis no escopo técnico atual.',
      },
      handler: controller.listTechnicalDemands,
    });
    app.get('/v1/workflow/technical-reports', {
      preHandler: (request) => app.authorize(request, 'maintenance.work-orders.read'),
      schema: { ...secured, summary: 'Consulta relatórios auditáveis da área técnica atual.' },
      handler: controller.listTechnicalValidationReports,
    });
    app.post('/v1/workflow/technical-demands/:demandId/assume', {
      preHandler: (request) => app.authorize(request, 'maintenance.work-orders.review'),
      schema: {
        ...secured,
        params: operationsIdentifierParamsSchema,
        summary: 'Assume uma demanda elegível sem alterar sua política de assinatura.',
      },
      handler: controller.assumeTechnicalDemand,
    });
    app.get('/v1/maintenance/actions', {
      preHandler: (request) => app.authorize(request, 'maintenance.executions.read'),
      schema: {
        ...secured,
        querystring: maintenanceActionListQuerySchema,
        summary: 'Consulta ações ativas e concluídas para acompanhamento técnico.',
      },
      handler: controller.listMaintenanceActions,
    });
    app.get('/v1/maintenance/technicians', {
      preHandler: (request) => app.authorize(request, 'maintenance.actions.assign'),
      schema: { ...secured, summary: 'Lista técnicos ativos disponíveis para atribuição.' },
      handler: controller.listActiveTechnicians,
    });
    app.put('/v1/maintenance/actions/:actionId/assignment', {
      preHandler: (request) => app.authorize(request, 'maintenance.actions.assign'),
      schema: { ...secured, params: operationsIdentifierParamsSchema, body: assignActionBodySchema, summary: 'Atribui uma ação pronta a um técnico ativo.' },
      handler: controller.assignMaintenanceAction,
    });
    app.get('/v1/maintenance/actions/:actionId', {
      preHandler: (request) => app.authorize(request, 'maintenance.executions.read'),
      schema: {
        ...secured,
        params: operationsIdentifierParamsSchema,
        summary: 'Consulta a ação, o checklist materializado e suas evidências.',
      },
      handler: controller.getMaintenanceAction,
    });
    app.post('/v1/maintenance/actions/:actionId/review', {
      preHandler: (request) => app.authorize(request, 'maintenance.work-orders.review'),
      schema: {
        ...secured,
        params: operationsIdentifierParamsSchema,
        body: actionReviewBodySchema,
        summary: 'Aprova ou devolve uma execucao concluida pelo Operador.',
      },
      handler: controller.reviewMaintenanceAction,
    });
    app.get('/v1/maintenance/work-orders', {
      preHandler: (request) => app.authorize(request, 'maintenance.work-orders.read'),
      schema: {
        ...secured,
        querystring: workOrderListQuerySchema,
        summary: 'Consulta a fila rastreável de ordens.',
      },
      handler: controller.listWorkOrders,
    });
    app.post('/v1/maintenance/work-orders', {
      preHandler: (request) => app.authorize(request, 'maintenance.work-orders.manage'),
      schema: {
        ...secured,
        body: createWorkOrderBodySchema,
        summary: 'Cria OS a partir de plano publicado.',
      },
      handler: controller.createWorkOrder,
    });
    app.get('/v1/maintenance/work-orders/:workOrderId', {
      preHandler: (request) => app.authorize(request, 'maintenance.work-orders.read'),
      schema: {
        ...secured,
        params: operationsIdentifierParamsSchema,
        summary: 'Consulta OS, validação, assinaturas e ações.',
      },
      handler: controller.getWorkOrder,
    });
    app.patch('/v1/maintenance/work-orders/:workOrderId', {
      preHandler: (request) => app.authorize(request, 'maintenance.work-orders.manage'),
      schema: {
        ...secured,
        params: operationsIdentifierParamsSchema,
        body: correctWorkOrderBodySchema,
        summary: 'Corrige uma OS devolvida e preserva a revisão anterior no histórico.',
      },
      handler: controller.correctWorkOrder,
    });
    app.post('/v1/maintenance/work-orders/:workOrderId/submit-review', {
      preHandler: (request) => app.authorize(request, 'maintenance.work-orders.manage'),
      schema: {
        ...secured,
        params: operationsIdentifierParamsSchema,
        body: submitReviewBodySchema,
        summary: 'Sela a OS e cria a demanda de validação.',
      },
      handler: controller.submitReview,
    });
    app.post('/v1/workflow/technical-demands/:demandId/sign', {
      preHandler: (request) => app.authorize(request, 'maintenance.work-orders.review'),
      schema: {
        ...secured,
        params: operationsIdentifierParamsSchema,
        body: signatureBodySchema,
        summary: 'Registra assinatura técnica permanente.',
      },
      handler: controller.signDemand,
    });
    app.post('/v1/workflow/technical-demands/:demandId/request-changes', {
      preHandler: (request) => app.authorize(request, 'maintenance.work-orders.review'),
      schema: {
        ...secured,
        params: operationsIdentifierParamsSchema,
        body: requestChangesBodySchema,
        summary: 'Devolve a OS ao Administrador com justificativa.',
      },
      handler: controller.requestChanges,
    });
    app.post('/v1/maintenance/work-orders/:workOrderId/release', {
      preHandler: (request) => app.authorize(request, 'maintenance.work-orders.release'),
      schema: {
        ...secured,
        params: operationsIdentifierParamsSchema,
        summary: 'Libera OS validada e cria a ação do Operador.',
      },
      handler: controller.releaseWorkOrder,
    });
    app.get('/v1/maintenance/operator-actions', {
      preHandler: (request) => app.authorize(request, 'maintenance.executions.perform'),
      schema: {
        ...secured,
        querystring: operatorActionListQuerySchema,
        summary: 'Consulta somente ações executáveis e não concluídas.',
      },
      handler: controller.listOperatorActions,
    });
    app.get('/v1/maintenance/operator-actions/:actionId', {
      preHandler: (request) => app.authorize(request, 'maintenance.executions.perform'),
      schema: {
        ...secured,
        params: operationsIdentifierParamsSchema,
        summary: 'Consulta o contexto executável da ação e seu checklist publicado.',
      },
      handler: controller.getOperatorAction,
    });
    app.post('/v1/maintenance/operator-actions/:actionId/start', {
      preHandler: (request) => app.authorize(request, 'maintenance.executions.perform'),
      schema: {
        ...secured,
        params: operationsIdentifierParamsSchema,
        body: startExecutionBodySchema,
        summary: 'Assume e inicia a ação de forma atômica e idempotente.',
      },
      handler: controller.startOperatorAction,
    });
    app.put('/v1/maintenance/operator-actions/:actionId/responses', {
      preHandler: (request) => app.authorize(request, 'maintenance.executions.perform'),
      schema: {
        ...secured,
        params: operationsIdentifierParamsSchema,
        body: executionBatchResponseBodySchema,
        summary: 'Salva um lote de respostas de forma transacional.',
      },
      handler: controller.saveOperatorResponses,
    });
    app.get('/v1/maintenance/operator-actions/:actionId/materials', {
      preHandler: (request) => app.authorize(request, 'maintenance.executions.perform'),
      schema: { ...secured, params: operationsIdentifierParamsSchema, summary: 'Consulta materiais ativos para consumo na execução.' },
      handler: controller.listOperatorMaterials,
    });
    app.post('/v1/maintenance/operator-actions/:actionId/materials', {
      preHandler: (request) => app.authorize(request, 'maintenance.executions.perform'),
      schema: { ...secured, params: operationsIdentifierParamsSchema, body: consumeMaterialBodySchema, summary: 'Baixa material do estoque e registra seu custo na OS.' },
      handler: controller.consumeOperatorMaterial,
    });
    app.get('/v1/maintenance/operator-actions/:actionId/validation', {
      preHandler: (request) => app.authorize(request, 'maintenance.executions.perform'),
      schema: {
        ...secured,
        params: operationsIdentifierParamsSchema,
        summary: 'Valida bloqueios da ação antes da conclusão.',
      },
      handler: controller.validateOperatorAction,
    });
    app.post('/v1/maintenance/operator-actions/:actionId/complete', {
      preHandler: (request) => app.authorize(request, 'maintenance.executions.perform'),
      schema: {
        ...secured,
        params: operationsIdentifierParamsSchema,
        body: completeExecutionBodySchema,
        summary: 'Conclui a ação do Operador após validar todos os bloqueios.',
      },
      handler: controller.completeOperatorAction,
    });
    app.post('/v1/maintenance/operator-actions/:actionId/assume', {
      preHandler: (request) => app.authorize(request, 'maintenance.executions.perform'),
      schema: {
        ...secured,
        params: operationsIdentifierParamsSchema,
        summary: 'Assume a ação e materializa o checklist publicado.',
      },
      handler: controller.assumeAction,
    });
    app.get('/v1/maintenance/executions/:executionId', {
      preHandler: (request) => app.authorize(request, 'maintenance.executions.read'),
      schema: {
        ...secured,
        params: operationsIdentifierParamsSchema,
        summary: 'Consulta execução e respostas materializadas.',
      },
      handler: controller.getExecution,
    });
    app.get('/v1/maintenance/executions/:executionId/validation', {
      preHandler: (request) => app.authorize(request, 'maintenance.executions.read'),
      schema: {
        ...secured,
        params: operationsIdentifierParamsSchema,
        summary: 'Valida respostas e evidências antes da conclusão.',
      },
      handler: controller.validateExecutionCompletion,
    });
    app.post('/v1/maintenance/executions/:executionId/start', {
      preHandler: (request) => app.authorize(request, 'maintenance.executions.perform'),
      schema: {
        ...secured,
        params: operationsIdentifierParamsSchema,
        body: startExecutionBodySchema,
        summary: 'Inicia a execução atribuída.',
      },
      handler: controller.startExecution,
    });
    app.post('/v1/maintenance/executions/:executionId/pause', {
      preHandler: (request) => app.authorize(request, 'maintenance.executions.perform'),
      schema: {
        ...secured,
        params: operationsIdentifierParamsSchema,
        body: pauseExecutionBodySchema,
        summary: 'Pausa uma execução em andamento e registra o motivo.',
      },
      handler: controller.pauseExecution,
    });
    app.post('/v1/maintenance/executions/:executionId/resume', {
      preHandler: (request) => app.authorize(request, 'maintenance.executions.perform'),
      schema: {
        ...secured,
        params: operationsIdentifierParamsSchema,
        summary: 'Retoma uma execução pausada sem contabilizar o tempo de pausa.',
      },
      handler: controller.resumeExecution,
    });
    app.put('/v1/maintenance/executions/:executionId/items/:itemId/response', {
      preHandler: (request) => app.authorize(request, 'maintenance.executions.perform'),
      schema: {
        ...secured,
        params: operationsIdentifierParamsSchema,
        body: executionResponseBodySchema,
        summary: 'Registra e valida a resposta de uma etapa.',
      },
      handler: controller.answerItem,
    });
    app.post('/v1/maintenance/executions/:executionId/items/:itemId/evidence', {
      preHandler: (request) => app.authorize(request, 'maintenance.executions.perform'),
      schema: {
        ...secured,
        params: operationsIdentifierParamsSchema,
        body: evidenceBodySchema,
        summary: 'Vincula evidência previamente armazenada à etapa.',
      },
      handler: controller.addEvidence,
    });
    app.post('/v1/maintenance/executions/:executionId/items/:itemId/evidence-file', {
      preHandler: (request) => app.authorize(request, 'maintenance.executions.perform'),
      schema: {
        ...secured,
        consumes: ['multipart/form-data'],
        params: operationsIdentifierParamsSchema,
        summary: 'Armazena uma foto privada e a vincula à etapa da execução.',
      },
      handler: controller.addEvidenceFile,
    });
    app.get('/v1/maintenance/evidence-files/:objectId', {
      preHandler: (request) => app.authorize(request, 'maintenance.executions.read'),
      schema: {
        security: secured.security,
        tags: secured.tags,
        params: operationsIdentifierParamsSchema,
        summary: 'Lê uma evidência privada autorizada do tenant.',
      },
      handler: controller.openEvidenceFile,
    });
    app.post('/v1/maintenance/executions/:executionId/complete', {
      preHandler: (request) => app.authorize(request, 'maintenance.executions.perform'),
      schema: {
        ...secured,
        params: operationsIdentifierParamsSchema,
        body: completeExecutionBodySchema,
        summary: 'Conclui somente após validar respostas e evidências.',
      },
      handler: controller.completeExecution,
    });
    return Promise.resolve();
  };
}
