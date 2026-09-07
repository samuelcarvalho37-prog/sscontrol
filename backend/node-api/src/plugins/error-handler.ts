import type { FastifyError, FastifyInstance } from 'fastify';

import { AppError, normalizeError } from '../core/errors/app-error.js';
import { elapsedMilliseconds, type ApiErrorEnvelope } from '../core/http/envelope.js';

function validationError(error: unknown): AppError | null {
  if (!(error instanceof Error) || !('validation' in error) || !Array.isArray(error.validation)) {
    return null;
  }

  const fastifyError = error as FastifyError;
  const validation = fastifyError.validation;
  if (!validation) return null;

  return new AppError({
    code: 'REQUEST_VALIDATION_FAILED',
    message: 'A requisição contém campos inválidos.',
    statusCode: 400,
    details: validation.map((item) => ({
      instancePath: item.instancePath,
      message: item.message,
    })),
    cause: fastifyError,
  });
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    const envelope: ApiErrorEnvelope = {
      ok: false,
      action: request.routeOptions.url ?? request.url,
      elapsed_ms: elapsedMilliseconds(request),
      trace_id: request.id,
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'Rota não encontrada.',
      },
    };
    return reply.status(404).send(envelope);
  });

  app.setErrorHandler((error, request, reply) => {
    const normalizedError = validationError(error) ?? normalizeError(error);
    const message = normalizedError.expose
      ? normalizedError.message
      : 'Não foi possível concluir a operação.';
    const details =
      normalizedError.expose && normalizedError.details !== undefined
        ? normalizedError.details
        : undefined;

    if (normalizedError.statusCode >= 500) {
      request.log.error(
        {
          err: normalizedError,
          code: normalizedError.code,
          traceId: request.id,
        },
        'Falha não tratada na API.',
      );
    } else {
      request.log.warn(
        {
          code: normalizedError.code,
          traceId: request.id,
        },
        'Requisição rejeitada pela API.',
      );
    }

    const envelope: ApiErrorEnvelope = {
      ok: false,
      action: request.routeOptions.url ?? request.url,
      elapsed_ms: elapsedMilliseconds(request),
      trace_id: request.id,
      error: {
        code: normalizedError.code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    };

    return reply.status(normalizedError.statusCode).send(envelope);
  });
}
