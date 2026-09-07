import type { FastifyRequest } from 'fastify';

export interface ApiSuccessEnvelope<T> {
  readonly ok: true;
  readonly action: string;
  readonly elapsed_ms: number;
  readonly trace_id: string;
  readonly data: T;
}

export interface ApiErrorEnvelope {
  readonly ok: false;
  readonly action: string;
  readonly elapsed_ms: number;
  readonly trace_id: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };
}

export function elapsedMilliseconds(request: FastifyRequest): number {
  const elapsedNanoseconds = process.hrtime.bigint() - request.startedAt;
  return Math.max(0, Math.round(Number(elapsedNanoseconds) / 1_000_000));
}

export function successEnvelope<T>(
  request: FastifyRequest,
  action: string,
  data: T,
): ApiSuccessEnvelope<T> {
  return {
    ok: true,
    action,
    elapsed_ms: elapsedMilliseconds(request),
    trace_id: request.id,
    data,
  };
}
