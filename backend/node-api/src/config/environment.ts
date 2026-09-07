import { z } from 'zod';

const booleanFromString = z.enum(['true', 'false']).transform((value) => value === 'true');

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3333),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    TRUST_PROXY: booleanFromString.default(false),
    BODY_LIMIT_BYTES: z.coerce.number().int().min(16_384).max(10_485_760).default(1_048_576),
    CORS_ALLOWED_ORIGINS: z.string().default(''),
    OPENAPI_ENABLED: booleanFromString.default(false),
    STORAGE_LOCAL_ROOT: z.string().min(1).default('./var/private-storage'),
    STORAGE_MAX_EVIDENCE_BYTES: z.coerce
      .number()
      .int()
      .min(65_536)
      .max(10_485_760)
      .default(6_291_456),

    DATABASE_URL: z
      .string()
      .min(1)
      .refine(
        (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
        'DATABASE_URL deve usar o protocolo postgresql://.',
      ),
    DATABASE_SSL_MODE: z.enum(['disable', 'verify-full']).default('disable'),
    DATABASE_SSL_CA_BASE64: z.string().optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
    DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(5_000),
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
    MIGRATION_DATABASE_URL: z
      .string()
      .refine(
        (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
        'MIGRATION_DATABASE_URL deve usar o protocolo postgresql://.',
      )
      .optional(),

    DEFAULT_TENANT_ID: z.uuid(),
    APP_ENVIRONMENT: z.enum(['DEVELOPMENT', 'HOMOLOGATION', 'PRODUCTION']),
    APP_RELEASE_VERSION: z.string().min(1),
    API_VERSION: z.string().min(1),
    SCHEMA_VERSION: z.string().min(1),
    CONTRACT_VERSION: z.string().min(1),
    FRONTEND_VERSION: z.string().min(1),

    AUTH_SESSION_HOURS: z.coerce.number().int().min(1).max(24).default(8),
    AUTH_FIRST_ACCESS_MINUTES: z.coerce.number().int().min(5).max(60).default(15),
    AUTH_MAINTENANCE_SESSION_MINUTES: z.coerce.number().int().min(5).max(60).default(30),
    AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
    AUTH_LOCK_MINUTES: z.coerce.number().int().min(1).max(1_440).default(15),
    AUTH_RECOVERY_COOLDOWN_MINUTES: z.coerce.number().int().min(1).max(1_440).default(10),
    AUTH_PASSWORD_PEPPER: z.string().min(32).max(1_024),
    AUTH_RECOVERY_HMAC_SECRET: z.string().min(32).max(1_024),
    AUTH_MAINTENANCE_HMAC_SECRET: z.string().min(32).max(1_024),
    MIGRATIONS_DIRECTORY: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === 'production' && value.DATABASE_SSL_MODE !== 'verify-full') {
      context.addIssue({
        code: 'custom',
        message: 'Produção exige DATABASE_SSL_MODE=verify-full.',
        path: ['DATABASE_SSL_MODE'],
      });
    }

    if (value.NODE_ENV === 'production' && value.CORS_ALLOWED_ORIGINS.trim() === '') {
      context.addIssue({
        code: 'custom',
        message: 'Produção exige uma lista explícita de origens CORS.',
        path: ['CORS_ALLOWED_ORIGINS'],
      });
    }
  });

export interface Environment {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  readonly trustProxy: boolean;
  readonly bodyLimitBytes: number;
  readonly corsAllowedOrigins: readonly string[];
  readonly openApiEnabled: boolean;
  readonly storage: {
    readonly localRoot: string;
    readonly maxEvidenceBytes: number;
  };
  readonly database: {
    readonly url: string;
    readonly sslMode: 'disable' | 'verify-full';
    readonly sslCa: string | undefined;
    readonly poolMax: number;
    readonly idleTimeoutMs: number;
    readonly connectionTimeoutMs: number;
    readonly statementTimeoutMs: number;
    readonly migrationUrl: string | undefined;
  };
  readonly release: {
    readonly environment: 'DEVELOPMENT' | 'HOMOLOGATION' | 'PRODUCTION';
    readonly app: string;
    readonly api: string;
    readonly schema: string;
    readonly contract: string;
    readonly frontend: string;
  };
  readonly defaultTenantId: string;
  readonly auth: {
    readonly sessionHours: number;
    readonly firstAccessMinutes: number;
    readonly maintenanceSessionMinutes: number;
    readonly maxFailedAttempts: number;
    readonly lockMinutes: number;
    readonly recoveryCooldownMinutes: number;
    readonly passwordPepper: string;
    readonly recoveryHmacSecret: string;
    readonly maintenanceHmacSecret: string;
  };
  readonly migrationsDirectory: string | undefined;
}

function decodeCertificate(encodedCertificate: string | undefined): string | undefined {
  if (!encodedCertificate) return undefined;

  try {
    return Buffer.from(encodedCertificate, 'base64').toString('utf8');
  } catch {
    throw new Error('DATABASE_SSL_CA_BASE64 não contém um certificado Base64 válido.');
  }
}

export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const parsed = environmentSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'ambiente'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Configuração de ambiente inválida: ${issues}`);
  }

  const value = parsed.data;
  const origins = value.CORS_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return Object.freeze({
    nodeEnv: value.NODE_ENV,
    host: value.HOST,
    port: value.PORT,
    logLevel: value.LOG_LEVEL,
    trustProxy: value.TRUST_PROXY,
    bodyLimitBytes: value.BODY_LIMIT_BYTES,
    corsAllowedOrigins: Object.freeze(origins),
    openApiEnabled: value.OPENAPI_ENABLED,
    storage: Object.freeze({
      localRoot: value.STORAGE_LOCAL_ROOT,
      maxEvidenceBytes: value.STORAGE_MAX_EVIDENCE_BYTES,
    }),
    database: Object.freeze({
      url: value.DATABASE_URL,
      sslMode: value.DATABASE_SSL_MODE,
      sslCa: decodeCertificate(value.DATABASE_SSL_CA_BASE64),
      poolMax: value.DATABASE_POOL_MAX,
      idleTimeoutMs: value.DATABASE_IDLE_TIMEOUT_MS,
      connectionTimeoutMs: value.DATABASE_CONNECTION_TIMEOUT_MS,
      statementTimeoutMs: value.DATABASE_STATEMENT_TIMEOUT_MS,
      migrationUrl: value.MIGRATION_DATABASE_URL,
    }),
    release: Object.freeze({
      environment: value.APP_ENVIRONMENT,
      app: value.APP_RELEASE_VERSION,
      api: value.API_VERSION,
      schema: value.SCHEMA_VERSION,
      contract: value.CONTRACT_VERSION,
      frontend: value.FRONTEND_VERSION,
    }),
    defaultTenantId: value.DEFAULT_TENANT_ID,
    auth: Object.freeze({
      sessionHours: value.AUTH_SESSION_HOURS,
      firstAccessMinutes: value.AUTH_FIRST_ACCESS_MINUTES,
      maintenanceSessionMinutes: value.AUTH_MAINTENANCE_SESSION_MINUTES,
      maxFailedAttempts: value.AUTH_MAX_FAILED_ATTEMPTS,
      lockMinutes: value.AUTH_LOCK_MINUTES,
      recoveryCooldownMinutes: value.AUTH_RECOVERY_COOLDOWN_MINUTES,
      passwordPepper: value.AUTH_PASSWORD_PEPPER,
      recoveryHmacSecret: value.AUTH_RECOVERY_HMAC_SECRET,
      maintenanceHmacSecret: value.AUTH_MAINTENANCE_HMAC_SECRET,
    }),
    migrationsDirectory: value.MIGRATIONS_DIRECTORY,
  });
}
