import { loadEnvironment } from '../../config/environment.js';
import { normalizeError } from '../../core/errors/app-error.js';
import { migrateDatabase } from './migrator.js';

try {
  const environment = loadEnvironment();
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
    })}\n`,
  );
  process.exitCode = 1;
}
