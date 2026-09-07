import fastifyPlugin from 'fastify-plugin';

import { MonitoringController } from './monitoring.controller.js';
import { createMonitoringRoutes } from './monitoring.routes.js';
import { MonitoringService } from './monitoring.service.js';

export const monitoringPlugin = fastifyPlugin(
  async (app) => {
    const controller = new MonitoringController(new MonitoringService(app.database));
    await app.register(createMonitoringRoutes(controller));
  },
  { name: 'fab-control-monitoring', dependencies: ['fab-control-authentication'] },
);
