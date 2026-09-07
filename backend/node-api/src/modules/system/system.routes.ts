import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';

import { SystemController } from './system.controller.js';
import { SystemService } from './system.service.js';

const emptyRequestSchema = {
  response: {
    200: Type.Object(
      {
        ok: Type.Literal(true),
        action: Type.String(),
        elapsed_ms: Type.Integer({ minimum: 0 }),
        trace_id: Type.String(),
        data: Type.Object({}, { additionalProperties: true }),
      },
      { additionalProperties: false },
    ),
  },
};

export const systemRoutes: FastifyPluginAsyncTypebox = (app) => {
  const controller = new SystemController(new SystemService(app.environment, app.database));

  app.get('/health/live', {
    schema: {
      ...emptyRequestSchema,
      tags: ['System'],
      summary: 'Confirma que o processo está vivo.',
    },
    handler: controller.liveness,
  });

  app.get('/health/ready', {
    schema: {
      ...emptyRequestSchema,
      tags: ['System'],
      summary: 'Confirma que a API e o PostgreSQL estão prontos.',
    },
    handler: controller.readiness,
  });

  app.get('/v1/bootstrap', {
    schema: {
      ...emptyRequestSchema,
      tags: ['System'],
      summary: 'Publica o contrato de inicialização sem dados sensíveis.',
    },
    handler: controller.bootstrap,
  });

  return Promise.resolve();
};
