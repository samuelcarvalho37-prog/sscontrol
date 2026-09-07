import { type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';

import type { AuthController } from './auth.controller.js';
import {
  emptyBodySchema,
  firstAccessBodySchema,
  loginBodySchema,
  maintenanceExchangeBodySchema,
  recoveryBodySchema,
  successEnvelopeSchema,
} from './auth.schemas.js';

export function createAuthRoutes(controller: AuthController): FastifyPluginAsyncTypebox {
  return (app) => {
    app.post('/v1/auth/login', {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
      schema: {
        body: loginBodySchema,
        response: { 200: successEnvelopeSchema },
        tags: ['Authentication'],
        summary: 'Autentica por matrícula e senha.',
      },
      handler: controller.login,
    });

    app.post('/v1/auth/first-access', {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '5 minutes',
        },
      },
      schema: {
        body: firstAccessBodySchema,
        response: { 200: successEnvelopeSchema },
        tags: ['Authentication'],
        summary: 'Conclui o primeiro acesso e substitui a senha temporária.',
      },
      handler: controller.completeFirstAccess,
    });

    app.post('/v1/auth/recovery', {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '10 minutes',
        },
      },
      schema: {
        body: recoveryBodySchema,
        response: { 200: successEnvelopeSchema },
        tags: ['Authentication'],
        summary: 'Registra uma solicitação segura de recuperação.',
      },
      handler: controller.requestRecovery,
    });

    app.post('/v1/auth/maintenance/exchange', {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
        },
      },
      schema: {
        body: maintenanceExchangeBodySchema,
        response: { 200: successEnvelopeSchema },
        tags: ['Authentication'],
        summary: 'Troca um código de manutenção de uso único por uma sessão interna limitada.',
      },
      handler: controller.exchangeMaintenanceAccess,
    });

    app.post('/v1/auth/logout', {
      preHandler: async (request) => app.authenticate(request),
      schema: {
        body: emptyBodySchema,
        response: { 200: successEnvelopeSchema },
        security: [{ bearerAuth: [] }],
        tags: ['Authentication'],
        summary: 'Revoga a sessão atual.',
      },
      handler: controller.logout,
    });

    app.get('/v1/auth/session', {
      preHandler: async (request) => app.authenticate(request),
      schema: {
        response: { 200: successEnvelopeSchema },
        security: [{ bearerAuth: [] }],
        tags: ['Authentication'],
        summary: 'Consulta a identidade e as capacidades da sessão.',
      },
      handler: controller.session,
    });

    return Promise.resolve();
  };
}
