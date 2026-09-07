import fastifyPlugin from 'fastify-plugin';

import { AdminController } from './admin.controller.js';
import { createAdminRoutes } from './admin.routes.js';
import { AdminService } from './admin.service.js';

export const adminPlugin = fastifyPlugin(
  async (app) => {
    const controller = new AdminController(new AdminService(app.environment, app.database));
    await app.register(createAdminRoutes(controller));
  },
  { name: 'fab-control-administration', dependencies: ['fab-control-authentication'] },
);
