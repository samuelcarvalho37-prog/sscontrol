import { requiredIntentCapabilities } from './capability-intents.js';
import { routeCapability } from './capability-catalog.js';
import fastifyPlugin from 'fastify-plugin';

import { AppError } from '../../core/errors/app-error.js';
import { AuthController } from './auth.controller.js';
import { createAuthRoutes } from './auth.routes.js';
import { AuthService } from './auth.service.js';

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
      let required = routeCapability(request.method, request.routeOptions.url ?? request.url.split('?')[0] ?? '', capability);
      if (request.method === 'POST' && request.routeOptions.url === '/v1/maintenance/checklists/save') {
        const body = request.body as {checklist_id?: string | null};
        required = routeCapability(body.checklist_id ? 'PATCH' : 'POST', body.checklist_id ? '/v1/maintenance/checklists/:checklistId' : '/v1/maintenance/checklists', capability);
      }
      request.requestedCapability = required;

      const user = request.auth?.user;

      let requiredActions = [required];
      const route = request.routeOptions.url ?? '';
      if (user && request.method === 'PATCH') {
        const intents = await app.database.withTransaction({tenantId:user.tenantId,userId:user.id,readOnly:true},client => requiredIntentCapabilities(client,request.method,route,request.body,request.params));
        if (intents.length) requiredActions = intents;
      }
      if (route === '/v1/pcm/tracking') requiredActions.push('workspace.tracking.open');
      if (route === '/v1/shared/resolve-code') requiredActions.push(routeCapability('GET','/v1/cmms/qr-context/:code','cmms.assets.read'));
      if (!user || requiredActions.some(action => !user.capabilities.includes(action))) {
        throw new AppError({
          code: 'AUTH_CAPABILITY_REQUIRED',
          message: 'Seu perfil não possui permissão para esta operação.',
          statusCode: 403,
          details: { capability: required },
        });
      }
    });

    await app.register(createAuthRoutes(controller));
  },
  {
    name: 'fab-control-authentication',
  },
);
