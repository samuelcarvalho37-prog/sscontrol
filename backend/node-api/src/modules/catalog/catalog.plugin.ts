import fastifyPlugin from 'fastify-plugin';

import { CatalogController } from './catalog.controller.js';
import { createCatalogRoutes } from './catalog.routes.js';
import { CatalogService } from './catalog.service.js';

export const catalogPlugin = fastifyPlugin(
  async (app) => {
    const service = new CatalogService(app.database);
    const controller = new CatalogController(service);
    await app.register(createCatalogRoutes(controller));
  },
  {
    name: 'fab-control-cmms-catalog',
    dependencies: ['fab-control-authentication'],
  },
);
