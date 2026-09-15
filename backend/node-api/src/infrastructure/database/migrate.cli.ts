import { loadEnvironment } from '../../config/environment.js';
import { AppError, normalizeError } from '../../core/errors/app-error.js';
import { migrateDatabase } from './migrator.js';

interface ErrorWithCode extends Error {
  readonly code?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sanitizeDiagnostic(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/giu, '[connection-string-redacted]')
    .replace(/(password\s*(?:=|:)\s*)[^\s,;]+/giu, '$1[redacted]');
}

function rootCause(error: unknown): ErrorWithCode | undefined {
  const visited = new Set<unknown>();
  let current = error;
  let latest: ErrorWithCode | undefined;

  while (current instanceof Error && !visited.has(current)) {
    visited.add(current);
    latest = current as ErrorWithCode;
    current = 'cause' in current ? current.cause : undefined;
  }

  return latest;
}

function developmentDiagnostic(
  error: unknown,
  normalized: AppError,
  nodeEnv: 'development' | 'test' | 'production',
): Record<string, unknown> | undefined {
  if (nodeEnv !== 'development') return undefined;

  const details = isRecord(normalized.details) ? normalized.details : {};
  const cause = rootCause(error);
  return {
    stage: details.stage ?? 'unknown',
    migration: details.migration ?? null,
    connection: details.connection ?? null,
    sqlstate: cause?.code ?? null,
    cause: cause ? sanitizeDiagnostic(cause.message) : null,
  };
}

let nodeEnv: 'development' | 'test' | 'production' =
  process.env.NODE_ENV === 'production' ? 'production' : process.env.NODE_ENV === 'test' ? 'test' : 'development';

try {
  const environment = loadEnvironment();
  nodeEnv = environment.nodeEnv;
  const result = await migrateDatabase(environment);

  process.stdout.write(
    `${JSON.stringify({
      status: 'ok',
      applied: result.applied,
      current: result.current.at(-1) ?? null,
    })}\n`,
  );
} catch (error) {
  const normalizedError = normalizeError(error);
  process.stderr.write(
    `${JSON.stringify({
      status: 'error',
      code: normalizedError.code,
      message: normalizedError.message,
      diagnostic: developmentDiagnostic(error, normalizedError, nodeEnv),
    })}\n`,
  );
  process.exitCode = 1;
}
