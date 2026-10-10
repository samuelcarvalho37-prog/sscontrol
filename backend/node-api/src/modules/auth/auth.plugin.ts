import fastifyPlugin from 'fastify-plugin';

import { AppError } from '../../core/errors/app-error.js';
import { AuthController } from './auth.controller.js';
import { createAuthRoutes } from './auth.routes.js';
import { AuthService } from './auth.service.js';

const ADMIN_FORBIDDEN_OPERATION_CAPABILITIES = new Set([
  'maintenance.occurrences.report',
  'maintenance.occurrences.triage',
  'maintenance.stops.manage',
  'maintenance.alerts.manage',
  'maintenance.work-orders.manage',
  'maintenance.work-orders.review',
  'maintenance.work-orders.release',
  'maintenance.actions.assign',
  'maintenance.executions.perform',
  'maintenance.checklists.manage',
  'maintenance.checklists.review',
  'maintenance.checklists.publish',
  'maintenance.plans.manage',
  'cmms.structure.manage',
  'cmms.assets.manage',
  'cmms.parameters.manage',
  'cmms.materials.manage',
  'cmms.readings.create',
]);

function tenantRequestContext(request: import('fastify').FastifyRequest) {
  const developmentTenantSlug = request.headers['x-vorqix-dev-tenant'];
  return {
    host: request.headers.host,
    ipAddress: request.ip,
    developmentTenantSlug:
      typeof developmentTenantSlug === 'string' ? developmentTenantSlug : undefined,
  };
}

export const authPlugin = fastifyPlugin(
  async (app) => {
    const service = new AuthService(app.environment, app.database);
    const controller = new AuthController(service);

    app.decorate('authenticate', async (request) => {
      const authorization = request.headers.authorization;
      const [scheme, token, extra] = authorization?.trim().split(/\s+/u) ?? [];

      if (scheme?.toLowerCase() !== 'bearer' || !token || extra) {
        throw new AppError({
          code: 'AUTH_BEARER_REQUIRED',
          message: 'Informe uma sessão Bearer válida.',
          statusCode: 401,
        });
      }

      request.auth = await service.authenticate(token, tenantRequestContext(request));
    });

    app.decorate('authorize', async (request, capability) => {
      await app.authenticate(request);

      const user = request.auth?.user;
      const adminOperationDenied =
        user?.roleType === 'ADMIN' && ADMIN_FORBIDDEN_OPERATION_CAPABILITIES.has(capability);

      if (!user?.capabilities.includes(capability) || adminOperationDenied) {
        throw new AppError({
          code: adminOperationDenied ? 'AUTH_ROLE_OPERATION_FORBIDDEN' : 'AUTH_CAPABILITY_REQUIRED',
          message: 'Seu perfil não possui permissão para esta operação.',
          statusCode: 403,
          details: { capability },
        });
      }
    });

    await app.register(createAuthRoutes(controller));
  },
  {
    name: 'fab-control-authentication',
  },
);
