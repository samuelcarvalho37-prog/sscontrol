import { randomUUID } from 'node:crypto';

import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { loadEnvironment, type Environment } from './config/environment.js';
import { createDatabase, type Database } from './infrastructure/database/database.js';
import { LocalObjectStorage, type ObjectStorage } from './infrastructure/storage/object-storage.js';
import { authPlugin } from './modules/auth/auth.plugin.js';
import { adminPlugin } from './modules/admin/admin.plugin.js';
import { catalogPlugin } from './modules/catalog/catalog.plugin.js';
import { governancePlugin } from './modules/governance/governance.plugin.js';
import { monitoringPlugin } from './modules/monitoring/monitoring.plugin.js';
import { operationsPlugin } from './modules/operations/operations.plugin.js';
import { planningPlugin } from './modules/planning/planning.plugin.js';
import { systemRoutes } from './modules/system/system.routes.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerSecurityPlugins } from './plugins/security.js';

export interface BuildAppOptions {
  readonly environment?: Environment;
  readonly database?: Database;
  readonly objectStorage?: ObjectStorage;
  readonly logger?: NonNullable<FastifyServerOptions['logger']>;
}

function loggerOptions(environment: Environment): NonNullable<FastifyServerOptions['logger']> {
  if (environment.nodeEnv === 'test') return false;

  return {
    level: environment.logLevel,
    redact: {
      censor: '[REDACTED]',
      paths: [
        'req.headers.authorization',
        'req.body.password',
        'req.body.senha',
        'req.body.nova_senha',
        'req.body.change_token',
        'res.headers.set-cookie',
      ],
    },
    serializers: {
      req(request) {
        return {
          id: request.id,
          method: request.method,
          remoteAddress: request.ip,
          url: request.url,
        };
      },
    },
  };
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const environment = options.environment ?? loadEnvironment();
  const logger = options.logger ?? loggerOptions(environment);
  const app = Fastify({
    bodyLimit: environment.bodyLimitBytes,
    genReqId: () => randomUUID(),
    logger,
    logController: new LogController({
      disableRequestLogging: environment.nodeEnv === 'test',
      requestIdLogLabel: 'traceId',
    }),
    requestIdHeader: 'x-request-id',
    trustProxy: environment.trustProxy,
  });
  const ownsDatabase = options.database === undefined;
  const database = options.database ?? createDatabase(environment, app.log);
  const objectStorage =
    options.objectStorage ??
    new LocalObjectStorage(environment.storage.localRoot, environment.storage.maxEvidenceBytes);

  app.decorate('environment', environment);
  app.decorate('database', database);
  app.decorate('objectStorage', objectStorage);
  app.decorateRequest('startedAt', 0n);
  app.decorateRequest('auth', null);
  app.addHook('onRequest', (request, _reply, done) => {
    request.startedAt = process.hrtime.bigint();
    done();
  });

  await registerSecurityPlugins(app, environment);
  registerErrorHandler(app);
  await app.register(systemRoutes);
  await app.register(authPlugin);
  await app.register(adminPlugin);
  await app.register(catalogPlugin);
  await app.register(governancePlugin);
  await app.register(planningPlugin);
  await app.register(operationsPlugin);
  await app.register(monitoringPlugin);

  if (ownsDatabase) {
    app.addHook('onClose', async () => {
      await database.close();
    });
  }

  return app;
}
