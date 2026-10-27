import {
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import fastifyPlugin from 'fastify-plugin';

import { AppError } from '../../core/errors/app-error.js';
import { successEnvelope } from '../../core/http/envelope.js';
import { readAllCapabilityTelemetry } from '../admin/integrity-telemetry.js';
import { PasswordService } from '../auth/password.service.js';

const SESSION_MINUTES = 30;
const AUTH_FAILURE = new AppError({
  code: 'PLATFORM_AUTH_INVALID',
  message: 'Credenciais inválidas ou código de verificação incorreto.',
  statusCode: 401,
});

interface OperatorRow {
  readonly operator_id: string;
  readonly login_name: string;
  readonly display_name: string;
  readonly password_hash: string;
  readonly totp_secret_ciphertext: string;
  readonly status: string;
  readonly failed_attempts: number;
  readonly locked_until: Date | null;
}

interface PlatformIdentity {
  readonly operatorId: string;
  readonly login: string;
  readonly name: string;
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function decryptTotpSecret(ciphertext: string, pepper: string): Buffer {
  const [version, ivText, tagText, bodyText] = ciphertext.split(':');
  if (version !== 'v1' || !ivText || !tagText || !bodyText)
    throw new Error('Segredo de segundo fator inválido.');
  const key = createHash('sha256').update(pepper, 'utf8').digest();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(bodyText, 'base64url')), decipher.final()]);
}

function verifyTotp(secret: Buffer, code: string, now = Date.now()): boolean {
  if (!/^\d{6}$/u.test(code)) return false;
  const supplied = Buffer.from(code, 'ascii');
  const counter = Math.floor(now / 30_000);
  for (const offset of [-1, 0, 1]) {
    const movingFactor = Buffer.alloc(8);
    movingFactor.writeBigUInt64BE(BigInt(counter + offset));
    const digest = createHmac('sha1', secret).update(movingFactor).digest();
    const index = (digest[digest.length - 1] ?? 0) & 0x0f;
    const binary = digest.readUInt32BE(index) & 0x7fffffff;
    const expected = Buffer.from(String(binary % 1_000_000).padStart(6, '0'), 'ascii');
    if (timingSafeEqual(expected, supplied)) return true;
  }
  return false;
}

function requestIp(request: { ip: string }): string | null {
  return request.ip && request.ip.length <= 45 ? request.ip : null;
}

function bearerToken(authorization: string | undefined): string {
  const [scheme, token, extra] = authorization?.trim().split(/\s+/u) ?? [];
  if (scheme?.toLowerCase() !== 'bearer' || !token || extra || !token.startsWith('vpx_')) {
    throw new AppError({
      code: 'PLATFORM_SESSION_REQUIRED',
      message: 'Entre novamente no console da plataforma.',
      statusCode: 401,
    });
  }
  return token;
}

const platformRoutes: FastifyPluginAsyncTypebox = (app) => {
  const passwords = new PasswordService(app.environment.auth.passwordPepper);
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/v1/platform/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  async function authenticatePlatform(
    request: import('fastify').FastifyRequest,
  ): Promise<PlatformIdentity> {
    const token = bearerToken(request.headers.authorization);
    const result = await app.database.query<{
      session_id: string;
      operator_id: string;
      login_name: string;
      display_name: string;
      expires_at: Date;
    }>('SELECT * FROM platform.resolve_platform_session($1)', [tokenHash(token)]);
    const row = result.rows[0];
    if (!row)
      throw new AppError({
        code: 'PLATFORM_SESSION_EXPIRED',
        message: 'A sessão da plataforma expirou.',
        statusCode: 401,
      });
    return { operatorId: row.operator_id, login: row.login_name, name: row.display_name };
  }

  app.post('/v1/platform/auth/login', {
    config: { rateLimit: { max: 5, timeWindow: 60_000 } },
    schema: {
      body: Type.Object(
        {
          login: Type.String({ minLength: 3, maxLength: 120 }),
          password: Type.String({ minLength: 1, maxLength: 128 }),
          code: Type.String({ minLength: 6, maxLength: 6 }),
        },
        { additionalProperties: false },
      ),
    },
    handler: async (request, reply) => {
      const login = request.body.login.trim().toLowerCase();
      const result = await app.database.query<OperatorRow>(
        'SELECT * FROM platform.lookup_platform_operator($1)',
        [login],
      );
      const operator = result.rows[0];
      if (!operator) {
        await passwords.consumeDummyVerification(request.body.password);
        throw AUTH_FAILURE;
      }
      if (
        operator.status !== 'ACTIVE' ||
        (operator.locked_until && operator.locked_until.getTime() > Date.now())
      ) {
        throw AUTH_FAILURE;
      }
      const passwordValid = await passwords.verify(operator.password_hash, request.body.password);
      let codeValid = false;
      if (passwordValid) {
        try {
          codeValid = verifyTotp(
            decryptTotpSecret(operator.totp_secret_ciphertext, app.environment.auth.passwordPepper),
            request.body.code,
          );
        } catch {
          codeValid = false;
        }
      }
      const success = passwordValid && codeValid;
      await app.database.query('SELECT platform.record_platform_login($1,$2,$3::inet,$4)', [
        operator.operator_id,
        success,
        requestIp(request),
        request.id,
      ]);
      if (!success) throw AUTH_FAILURE;

      const token = `vpx_${randomBytes(32).toString('base64url')}`;
      const expiresAt = new Date(Date.now() + SESSION_MINUTES * 60_000);
      const userAgent = request.headers['user-agent'];
      await app.database.query(
        'SELECT * FROM platform.create_platform_session($1,$2,$3,$4::inet,$5)',
        [
          operator.operator_id,
          tokenHash(token),
          expiresAt.toISOString(),
          requestIp(request),
          typeof userAgent === 'string' ? userAgent : '',
        ],
      );
      reply.header('Cache-Control', 'no-store');
      return successEnvelope(request, 'platform.auth.login', {
        token,
        expires_at: expiresAt.toISOString(),
        operator: {
          id: operator.operator_id,
          login: operator.login_name,
          name: operator.display_name,
        },
      });
    },
  });

  app.post('/v1/platform/auth/logout', {
    preHandler: async (request) => {
      await authenticatePlatform(request);
    },
    handler: async (request) => {
      await app.database.query('SELECT platform.revoke_platform_session($1)', [
        tokenHash(bearerToken(request.headers.authorization)),
      ]);
      return successEnvelope(request, 'platform.auth.logout', { logged_out: true });
    },
  });

  app.get('/v1/platform/auth/session', {
    preHandler: async (request) => {
      await authenticatePlatform(request);
    },
    handler: async (request) =>
      successEnvelope(request, 'platform.auth.session', {
        operator: await authenticatePlatform(request),
      }),
  });

  app.get('/v1/platform/tenants', {
    preHandler: async (request) => {
      await authenticatePlatform(request);
    },
    handler: async (request, reply) => {
      const result = await app.database.query('SELECT * FROM platform.list_console_tenants()');
      reply.header('Cache-Control', 'no-store');
      return successEnvelope(request, 'platform.tenants.list', { items: result.rows });
    },
  });

  app.get('/v1/platform/telemetry', {
    preHandler: async (request) => {
      await authenticatePlatform(request);
    },
    handler: (request) =>
      successEnvelope(request, 'platform.telemetry.read', {
        window_minutes: 15,
        source: 'memória do processo da API; métricas de requisições autorizadas',
        tenants: readAllCapabilityTelemetry().map((entry) => ({
          tenant_id: entry.tenantId,
          modules: entry.modules,
        })),
      }),
  });

  app.get('/v1/platform/support-requests', {
    preHandler: async (request) => {
      await authenticatePlatform(request);
    },
    handler: async (request) => {
      const result = await app.database.query(
        'SELECT * FROM platform.list_console_support_requests()',
      );
      return successEnvelope(request, 'platform.support.list', { items: result.rows });
    },
  });

  app.patch('/v1/platform/support-requests/:requestId', {
    preHandler: async (request) => {
      await authenticatePlatform(request);
    },
    schema: {
      params: Type.Object({ requestId: Type.String({ format: 'uuid' }) }),
      body: Type.Object(
        {
          status: Type.Union([
            Type.Literal('IN_PROGRESS'),
            Type.Literal('WAITING_CUSTOMER'),
            Type.Literal('RESOLVED'),
            Type.Literal('CLOSED'),
          ]),
        },
        { additionalProperties: false },
      ),
    },
    handler: async (request) => {
      const identity = await authenticatePlatform(request);
      const result = await app.database.query<{ updated: boolean }>(
        'SELECT platform.update_console_support_request($1,$2,$3,$4) AS updated',
        [identity.operatorId, request.params.requestId, request.body.status, request.id],
      );
      if (result.rows[0]?.updated !== true)
        throw new AppError({
          code: 'PLATFORM_SUPPORT_REQUEST_NOT_FOUND',
          message: 'O chamado não foi encontrado.',
          statusCode: 404,
        });
      return successEnvelope(request, 'platform.support.update', { updated: true });
    },
  });

  app.post('/v1/platform/support-requests', {
    preHandler: async (request) => {
      await app.authenticate(request);
    },
    schema: {
      body: Type.Object(
        {
          topic: Type.Union([
            Type.Literal('ERRO'),
            Type.Literal('DESEMPENHO'),
            Type.Literal('ACESSO'),
            Type.Literal('CONFIGURACAO'),
            Type.Literal('OUTRO'),
          ]),
          module: Type.String({ minLength: 2, maxLength: 100 }),
          summary: Type.String({ minLength: 4, maxLength: 160 }),
          technical_context: Type.Optional(Type.String({ maxLength: 4000 })),
        },
        { additionalProperties: false },
      ),
    },
    handler: async (request) => {
      const auth = request.auth;
      if (!auth)
        throw new AppError({
          code: 'AUTH_CONTEXT_MISSING',
          message: 'A sessão da empresa não está disponível.',
          statusCode: 401,
        });
      const created = await app.database.withTransaction(
        { tenantId: auth.user.tenantId, userId: auth.user.id },
        async (client) =>
          client.query<{ id: string }>(
            'SELECT platform.create_support_request($1,$2,$3,$4,$5,$6,$7) AS id',
            [
              auth.user.tenantId,
              auth.user.id,
              request.body.topic,
              request.body.module.trim(),
              request.body.summary.trim(),
              request.body.technical_context?.trim() ?? '',
              request.id,
            ],
          ),
      );
      return successEnvelope(request, 'platform.support.create', {
        id: created.rows[0]?.id,
        status: 'OPEN',
      });
    },
  });
  return Promise.resolve();
};

export const platformPlugin = fastifyPlugin(platformRoutes, {
  name: 'vorqix-platform-console',
  dependencies: ['fab-control-authentication'],
});
