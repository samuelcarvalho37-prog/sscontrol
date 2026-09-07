import fastifyPlugin from 'fastify-plugin';

import { OperationsController } from './operations.controller.js';
import { createOperationsRoutes } from './operations.routes.js';
import { OperationsService } from './operations.service.js';

export const operationsPlugin = fastifyPlugin(
  async (app) => {
    const controller = new OperationsController(
      new OperationsService(app.database, app.objectStorage),
    );
    await app.register(createOperationsRoutes(controller));
  },
  { name: 'fab-control-operations', dependencies: ['fab-control-authentication'] },
);
