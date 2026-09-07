export interface AppErrorOptions {
  readonly code: string;
  readonly message: string;
  readonly statusCode: number;
  readonly details?: unknown;
  readonly expose?: boolean;
  readonly cause?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: unknown;
  readonly expose: boolean;

  constructor(options: AppErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = 'AppError';
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.details = options.details;
    this.expose = options.expose ?? options.statusCode < 500;
  }
}

interface PostgreSqlError extends Error {
  readonly code?: string;
  readonly constraint?: string;
  readonly detail?: string;
}

function isPostgreSqlError(error: unknown): error is PostgreSqlError {
  return error instanceof Error && 'code' in error;
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (isPostgreSqlError(error)) {
    if (error.code === '23505') {
      return new AppError({
        code: 'RESOURCE_CONFLICT',
        message: 'Já existe um registro com os mesmos dados.',
        statusCode: 409,
        details: error.constraint ? { constraint: error.constraint } : undefined,
        cause: error,
      });
    }

    if (error.code === '23503') {
      return new AppError({
        code: 'REFERENCE_CONFLICT',
        message: 'A operação viola um vínculo protegido.',
        statusCode: 409,
        details: error.constraint ? { constraint: error.constraint } : undefined,
        cause: error,
      });
    }

    if (error.code === '42501') {
      return new AppError({
        code: 'OPERATION_FORBIDDEN',
        message: 'O usuário não possui autorização técnica para concluir esta operação.',
        statusCode: 403,
        cause: error,
      });
    }

    if (error.code === '23514' || error.code === '22P02') {
      return new AppError({
        code: 'DATABASE_VALIDATION_FAILED',
        message: 'Os dados enviados não atendem ao contrato do banco.',
        statusCode: 422,
        details: error.constraint ? { constraint: error.constraint } : undefined,
        cause: error,
      });
    }
  }

  return new AppError({
    code: 'INTERNAL_ERROR',
    message: 'Não foi possível concluir a operação.',
    statusCode: 500,
    expose: false,
    cause: error,
  });
}
