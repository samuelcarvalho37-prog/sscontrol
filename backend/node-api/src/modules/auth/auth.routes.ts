import { type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';

import type { Environment } from '../../config/environment.js';
import type { AuthController } from './auth.controller.js';
import {
  emptyBodySchema,
  firstAccessBodySchema,
  loginBodySchema,
  maintenanceExchangeBodySchema,
  recoveryBodySchema,
  successEnvelopeSchema,
} from './auth.schemas.js';

export type AuthRateLimitTarget = 'login' | 'firstAccess' | 'recovery' | 'maintenance';

export function authRateLimitConfig(environment: Environment, target: AuthRateLimitTarget) {
  const limit = environment.auth.rateLimit[target];
  return {
    max: limit.max,
    timeWindow: limit.windowSeconds * 1_000,
  };
}

export function createAuthRoutes(controller: AuthController): FastifyPluginAsyncTypebox {
  return (app) => {
    app.post('/v1/auth/login', {
      config: {
        rateLimit: {
          ...authRateLimitConfig(app.environment, 'login'),
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
          ...authRateLimitConfig(app.environment, 'firstAccess'),
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
          ...authRateLimitConfig(app.environment, 'recovery'),
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
          ...authRateLimitConfig(app.environment, 'maintenance'),
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
