import fastifyPlugin from 'fastify-plugin';

import { PlanningController } from './planning.controller.js';
import { createPlanningRoutes } from './planning.routes.js';
import { PlanningService } from './planning.service.js';

export const planningPlugin = fastifyPlugin(
  async (app) => {
    const service = new PlanningService(app.database);
    const controller = new PlanningController(service);
    await app.register(createPlanningRoutes(controller));
  },
  {
    name: 'fab-control-maintenance-planning',
    dependencies: ['fab-control-authentication'],
  },
);
