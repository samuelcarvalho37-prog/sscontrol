import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';

import type { Environment } from '../config/environment.js';
import { AppError } from '../core/errors/app-error.js';

export async function registerSecurityPlugins(
  app: FastifyInstance,
  environment: Environment,
): Promise<void> {
  await app.register(sensible);
  await app.register(multipart, {
    limits: {
      fieldNameSize: 80,
      fieldSize: 4_096,
      fields: 3,
      files: 1,
      parts: 4,
      fileSize: environment.storage.maxEvidenceBytes + 1,
    },
  });
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cors, {
    credentials: false,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (environment.corsAllowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(
        new AppError({
          code: 'CORS_ORIGIN_DENIED',
          message: 'A origem da requisição não está autorizada.',
          statusCode: 403,
        }),
        false,
      );
    },
  });
  await app.register(rateLimit, {
    allowList: ['127.0.0.1', '::1'],
    ban: 2,
    cache: 20_000,
    continueExceeding: false,
    hook: 'onRequest',
    max: 300,
    timeWindow: '1 minute',
  });

  if (environment.openApiEnabled) {
    await app.register(swagger, {
      openapi: {
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'opaque',
            },
          },
        },
        info: {
          title: 'Fab Control API',
          description: 'API transacional do Fab Control CMMS.',
          version: environment.release.api,
        },
        servers: [{ url: `http://${environment.host}:${environment.port}` }],
      },
    });
    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        deepLinking: false,
        docExpansion: 'list',
      },
      staticCSP: true,
    });
  }
}
