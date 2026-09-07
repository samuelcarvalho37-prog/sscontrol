import fastifyPlugin from 'fastify-plugin';

import { AppError } from '../../core/errors/app-error.js';
import { AuthController } from './auth.controller.js';
import { createAuthRoutes } from './auth.routes.js';
import { AuthService } from './auth.service.js';

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

      request.auth = await service.authenticate(token);
    });

    app.decorate('authorize', async (request, capability) => {
      await app.authenticate(request);

      if (!request.auth?.user.capabilities.includes(capability)) {
        throw new AppError({
          code: 'AUTH_CAPABILITY_REQUIRED',
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
