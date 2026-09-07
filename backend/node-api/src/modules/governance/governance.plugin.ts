import fastifyPlugin from 'fastify-plugin';

import { GovernanceController } from './governance.controller.js';
import { BackupController } from './backup.controller.js';
import { BackupService } from './backup.service.js';
import { createGovernanceRoutes } from './governance.routes.js';
import { GovernanceService } from './governance.service.js';
import { ImportController } from './import.controller.js';
import { ImportService } from './import.service.js';

export const governancePlugin = fastifyPlugin(
  async (app) => {
    const service = new GovernanceService(app.database, app.objectStorage);
    const controller = new GovernanceController(service);
    const importController = new ImportController(new ImportService(app.database));
    const backupController = new BackupController(
      new BackupService(app.database, app.objectStorage, app.environment),
    );
    await app.register(createGovernanceRoutes(controller, importController, backupController));
  },
  {
    name: 'fab-control-governance',
    dependencies: ['fab-control-authentication'],
  },
);
