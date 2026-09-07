import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';

import { successEnvelopeSchema } from '../auth/auth.schemas.js';
import type { MonitoringController } from './monitoring.controller.js';
import {
  alertListQuerySchema,
  alertOccurrenceBodySchema,
  analyticsQuerySchema,
  createOccurrenceBodySchema,
  createStopBodySchema,
  monitoringIdentifierParamsSchema,
  notificationListQuerySchema,
  occurrenceListQuerySchema,
  parameterActionRequestBodySchema,
  stopListQuerySchema,
  technicalAnalysisBodySchema,
  transitionStopBodySchema,
} from './monitoring.schemas.js';

const secured = {
  response: { 200: successEnvelopeSchema },
  security: [{ bearerAuth: [] }],
  tags: ['Monitoring'],
};

export function createMonitoringRoutes(
  controller: MonitoringController,
): FastifyPluginAsyncTypebox {
  return (app) => {
    app.get('/v1/maintenance/occurrences', {
      preHandler: (request) => app.authorize(request, 'maintenance.occurrences.read'),
      schema: {
        ...secured,
        querystring: occurrenceListQuerySchema,
        summary: 'Consulta ocorrências operacionais.',
      },
      handler: controller.listOccurrences,
    });
    app.post('/v1/maintenance/occurrences', {
      preHandler: (request) => app.authorize(request, 'maintenance.occurrences.report'),
      schema: {
        ...secured,
        body: createOccurrenceBodySchema,
        summary: 'Registra uma ocorrência e, quando necessário, abre a parada.',
      },
      handler: controller.createOccurrence,
    });
    app.get('/v1/maintenance/occurrences/:occurrenceId', {
      preHandler: (request) => app.authorize(request, 'maintenance.occurrences.read'),
      schema: {
        ...secured,
        params: monitoringIdentifierParamsSchema,
        summary: 'Consulta ocorrência, parada e análise relacionadas.',
      },
      handler: controller.getOccurrence,
    });
    app.post('/v1/maintenance/occurrences/:occurrenceId/technical-analysis', {
      preHandler: (request) => app.authorize(request, 'maintenance.occurrences.triage'),
      schema: {
        ...secured,
        params: monitoringIdentifierParamsSchema,
        body: technicalAnalysisBodySchema,
        summary: 'Emite análise técnica permanente ao Administrador.',
      },
      handler: controller.createTechnicalAnalysis,
    });
    app.post('/v1/monitoring/parameter-action-requests', {
      preHandler: (request) => app.authorize(request, 'maintenance.occurrences.triage'),
      schema: {
        ...secured,
        body: parameterActionRequestBodySchema,
        summary: 'Converte uma leitura técnica em ocorrência e análise para o Administrador.',
      },
      handler: controller.requestParameterAction,
    });

    app.get('/v1/maintenance/stops', {
      preHandler: (request) => app.authorize(request, 'maintenance.stops.read'),
      schema: {
        ...secured,
        querystring: stopListQuerySchema,
        summary: 'Consulta paradas abertas e concluídas.',
      },
      handler: controller.listStops,
    });
    app.post('/v1/maintenance/stops', {
      preHandler: (request) => app.authorize(request, 'maintenance.stops.manage'),
      schema: {
        ...secured,
        body: createStopBodySchema,
        summary: 'Abre uma parada técnica rastreável.',
      },
      handler: controller.createStop,
    });
    app.get('/v1/maintenance/stops/:stopId', {
      preHandler: (request) => app.authorize(request, 'maintenance.stops.read'),
      schema: {
        ...secured,
        params: monitoringIdentifierParamsSchema,
        summary: 'Consulta uma parada técnica.',
      },
      handler: controller.getStop,
    });
    app.post('/v1/maintenance/stops/:stopId/transition', {
      preHandler: (request) => app.authorize(request, 'maintenance.stops.manage'),
      schema: {
        ...secured,
        params: monitoringIdentifierParamsSchema,
        body: transitionStopBodySchema,
        summary: 'Movimenta a parada até o retorno operacional.',
      },
      handler: controller.transitionStop,
    });
    app.post('/v1/maintenance/stops/:stopId/create-treatment', {
      preHandler: (request) => app.authorize(request, 'maintenance.occurrences.triage'),
      schema: {
        ...secured,
        params: monitoringIdentifierParamsSchema,
        summary: 'Abre de forma idempotente o tratamento de uma parada tÃ©cnica.',
      },
      handler: controller.createStopTreatment,
    });

    app.get('/v1/maintenance/alerts', {
      preHandler: (request) => app.authorize(request, 'maintenance.alerts.read'),
      schema: {
        ...secured,
        querystring: alertListQuerySchema,
        summary: 'Consulta alertas deduplicados.',
      },
      handler: controller.listAlerts,
    });
    app.post('/v1/maintenance/alerts/:alertId/acknowledge', {
      preHandler: (request) => app.authorize(request, 'maintenance.alerts.manage'),
      schema: {
        ...secured,
        params: monitoringIdentifierParamsSchema,
        summary: 'Confirma a ciência do alerta.',
      },
      handler: controller.acknowledgeAlert,
    });
    app.post('/v1/maintenance/alerts/:alertId/create-occurrence', {
      preHandler: (request) => app.authorize(request, 'maintenance.alerts.manage'),
      schema: {
        ...secured,
        params: monitoringIdentifierParamsSchema,
        body: alertOccurrenceBodySchema,
        summary: 'Transforma um alerta em ocorrência rastreável.',
      },
      handler: controller.createOccurrenceFromAlert,
    });

    app.get('/v1/notifications', {
      preHandler: (request) => app.authorize(request, 'workflow.notifications.read'),
      schema: {
        ...secured,
        querystring: notificationListQuerySchema,
        summary: 'Consulta a central operacional persistente.',
      },
      handler: controller.listNotifications,
    });
    app.patch('/v1/notifications/:notificationId/read', {
      preHandler: (request) => app.authorize(request, 'workflow.notifications.read'),
      schema: {
        ...secured,
        params: monitoringIdentifierParamsSchema,
        summary: 'Marca uma notificação como lida de forma persistente.',
      },
      handler: controller.markNotificationRead,
    });
    app.patch('/v1/notifications/:notificationId/dismiss', {
      preHandler: (request) => app.authorize(request, 'workflow.notifications.read'),
      schema: {
        ...secured,
        params: monitoringIdentifierParamsSchema,
        summary: 'Dispensa uma notificação para o usuário atual.',
      },
      handler: controller.dismissNotification,
    });
    app.post('/v1/notifications/read-all', {
      preHandler: (request) => app.authorize(request, 'workflow.notifications.read'),
      schema: { ...secured, summary: 'Marca todas as notificações visíveis como lidas.' },
      handler: controller.markAllNotificationsRead,
    });

    app.get('/v1/analytics/technical-summary', {
      preHandler: (request) => app.authorize(request, 'analytics.technical.read'),
      schema: {
        ...secured,
        querystring: analyticsQuerySchema,
        summary: 'Calcula indicadores técnicos e ranking sem estimar OEE.',
      },
      handler: controller.technicalSummary,
    });
    return Promise.resolve();
  };
}
