import { type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';

import { successEnvelopeSchema } from '../auth/auth.schemas.js';
import type { PlanningController } from './planning.controller.js';
import {
  checklistAggregateBodySchema,
  checklistItemBodySchema,
  checklistListQuerySchema,
  createChecklistBodySchema,
  createPlanBodySchema,
  planningIdentifierParamsSchema,
  planListQuerySchema,
  reorderChecklistItemsBodySchema,
  reviewChecklistBodySchema,
  submitChecklistConfiguredBodySchema,
  updateChecklistBodySchema,
  updatePlanBodySchema,
} from './planning.schemas.js';

const securedResponse = {
  response: { 200: successEnvelopeSchema },
  security: [{ bearerAuth: [] }],
  tags: ['Maintenance Planning'],
};

export function createPlanningRoutes(controller: PlanningController): FastifyPluginAsyncTypebox {
  return (app) => {
    app.get('/v1/maintenance/checklist-item-types', {
      preHandler: async (request) => app.authorize(request, 'maintenance.checklists.read'),
      schema: {
        ...securedResponse,
        summary: 'Consulta os nove tipos de resposta suportados.',
      },
      handler: controller.listItemTypes,
    });

    app.get('/v1/maintenance/checklists', {
      preHandler: async (request) => app.authorize(request, 'maintenance.checklists.read'),
      schema: {
        ...securedResponse,
        querystring: checklistListQuerySchema,
        summary: 'Pesquisa modelos e a situação de sua revisão atual.',
      },
      handler: controller.listChecklists,
    });

    app.post('/v1/maintenance/checklists', {
      preHandler: async (request) => app.authorize(request, 'maintenance.checklists.manage'),
      schema: {
        ...securedResponse,
        body: createChecklistBodySchema,
        summary: 'Cria um modelo com sua primeira revisão em rascunho.',
      },
      handler: controller.createChecklist,
    });

    app.post('/v1/maintenance/checklists/save', {
      preHandler: async (request) => app.authorize(request, 'maintenance.checklists.manage'),
      schema: {
        ...securedResponse,
        body: checklistAggregateBodySchema,
        summary: 'Cria ou atualiza um rascunho completo com suas etapas em uma transação.',
      },
      handler: controller.saveChecklistAggregate,
    });

    app.get('/v1/maintenance/checklists/:checklistId', {
      preHandler: async (request) => app.authorize(request, 'maintenance.checklists.read'),
      schema: {
        ...securedResponse,
        params: planningIdentifierParamsSchema,
        summary: 'Consulta modelo, revisões, etapas e pareceres técnicos.',
      },
      handler: controller.getChecklist,
    });

    app.patch('/v1/maintenance/checklists/:checklistId', {
      preHandler: async (request) => app.authorize(request, 'maintenance.checklists.manage'),
      schema: {
        ...securedResponse,
        params: planningIdentifierParamsSchema,
        body: updateChecklistBodySchema,
        summary: 'Altera a identidade e a revisão editável do modelo.',
      },
      handler: controller.updateChecklist,
    });

    app.post('/v1/maintenance/checklists/:checklistId/items', {
      preHandler: async (request) => app.authorize(request, 'maintenance.checklists.manage'),
      schema: {
        ...securedResponse,
        params: planningIdentifierParamsSchema,
        body: checklistItemBodySchema,
        summary: 'Adiciona uma etapa validada ao rascunho.',
      },
      handler: controller.addChecklistItem,
    });

    app.put('/v1/maintenance/checklists/:checklistId/items/:itemId', {
      preHandler: async (request) => app.authorize(request, 'maintenance.checklists.manage'),
      schema: {
        ...securedResponse,
        params: planningIdentifierParamsSchema,
        body: checklistItemBodySchema,
        summary: 'Substitui o conteúdo de uma etapa do rascunho.',
      },
      handler: controller.updateChecklistItem,
    });

    app.delete('/v1/maintenance/checklists/:checklistId/items/:itemId', {
      preHandler: async (request) => app.authorize(request, 'maintenance.checklists.manage'),
      schema: {
        ...securedResponse,
        params: planningIdentifierParamsSchema,
        summary: 'Remove uma etapa e recompõe a sequência.',
      },
      handler: controller.deleteChecklistItem,
    });

    app.post('/v1/maintenance/checklists/:checklistId/items/reorder', {
      preHandler: async (request) => app.authorize(request, 'maintenance.checklists.manage'),
      schema: {
        ...securedResponse,
        params: planningIdentifierParamsSchema,
        body: reorderChecklistItemsBodySchema,
        summary: 'Reordena todas as etapas do rascunho atomicamente.',
      },
      handler: controller.reorderChecklistItems,
    });

    app.post('/v1/maintenance/checklists/:checklistId/submit', {
      preHandler: async (request) => app.authorize(request, 'maintenance.checklists.manage'),
      schema: {
        ...securedResponse,
        params: planningIdentifierParamsSchema,
        summary: 'Sela o conteúdo e o envia ao filtro técnico.',
      },
      handler: controller.submitChecklist,
    });

    app.post('/v1/maintenance/checklists/:checklistId/submit-configured', {
      preHandler: async (request) => app.authorize(request, 'maintenance.checklists.manage'),
      schema: {
        ...securedResponse,
        params: planningIdentifierParamsSchema,
        body: submitChecklistConfiguredBodySchema,
        summary: 'Sela o checklist e registra a rota nominal de validação.',
      },
      handler: controller.submitChecklistConfigured,
    });

    app.post('/v1/maintenance/checklists/:checklistId/review', {
      preHandler: async (request) => app.authorize(request, 'maintenance.checklists.review'),
      schema: {
        ...securedResponse,
        params: planningIdentifierParamsSchema,
        body: reviewChecklistBodySchema,
        summary: 'Registra o parecer imutável do filtro técnico.',
      },
      handler: controller.reviewChecklist,
    });

    app.post('/v1/maintenance/checklists/:checklistId/publish', {
      preHandler: async (request) => app.authorize(request, 'maintenance.checklists.publish'),
      schema: {
        ...securedResponse,
        params: planningIdentifierParamsSchema,
        summary: 'Publica uma revisão aprovada sem alterar versões anteriores.',
      },
      handler: controller.publishChecklist,
    });

    app.post('/v1/maintenance/checklists/:checklistId/revisions', {
      preHandler: async (request) => app.authorize(request, 'maintenance.checklists.manage'),
      schema: {
        ...securedResponse,
        params: planningIdentifierParamsSchema,
        summary: 'Clona a revisão finalizada em um novo rascunho.',
      },
      handler: controller.createChecklistRevision,
    });

    app.delete('/v1/maintenance/checklists/:checklistId', {
      preHandler: async (request) => app.authorize(request, 'maintenance.checklists.manage'),
      schema: {
        ...securedResponse,
        params: planningIdentifierParamsSchema,
        summary: 'Arquiva somente rascunhos sem histórico operacional.',
      },
      handler: controller.deleteChecklistDraft,
    });

    app.get('/v1/maintenance/plans', {
      preHandler: async (request) => app.authorize(request, 'maintenance.plans.read'),
      schema: {
        ...securedResponse,
        querystring: planListQuerySchema,
        summary: 'Pesquisa planos programados e acionados por condição ou ocorrência.',
      },
      handler: controller.listPlans,
    });

    app.post('/v1/maintenance/plans', {
      preHandler: async (request) => app.authorize(request, 'maintenance.plans.manage'),
      schema: {
        ...securedResponse,
        body: createPlanBodySchema,
        summary: 'Cria um plano vinculado a um checklist publicado.',
      },
      handler: controller.createPlan,
    });

    app.get('/v1/maintenance/plans/:planId', {
      preHandler: async (request) => app.authorize(request, 'maintenance.plans.read'),
      schema: {
        ...securedResponse,
        params: planningIdentifierParamsSchema,
        summary: 'Consulta o plano e todas as suas revisões.',
      },
      handler: controller.getPlan,
    });

    app.patch('/v1/maintenance/plans/:planId', {
      preHandler: async (request) => app.authorize(request, 'maintenance.plans.manage'),
      schema: {
        ...securedResponse,
        params: planningIdentifierParamsSchema,
        body: updatePlanBodySchema,
        summary: 'Altera exclusivamente a revisão editável de um plano.',
      },
      handler: controller.updatePlan,
    });

    app.post('/v1/maintenance/plans/:planId/publish', {
      preHandler: async (request) => app.authorize(request, 'maintenance.plans.publish'),
      schema: {
        ...securedResponse,
        params: planningIdentifierParamsSchema,
        summary: 'Publica o plano após validar checklist, ativo e disparo.',
      },
      handler: controller.publishPlan,
    });

    app.post('/v1/maintenance/plans/:planId/revisions', {
      preHandler: async (request) => app.authorize(request, 'maintenance.plans.manage'),
      schema: {
        ...securedResponse,
        params: planningIdentifierParamsSchema,
        summary: 'Clona um plano finalizado em uma revisão editável.',
      },
      handler: controller.createPlanRevision,
    });

    return Promise.resolve();
  };
}
