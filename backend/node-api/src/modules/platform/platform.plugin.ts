import {
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { Readable } from 'node:stream';

import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import fastifyPlugin from 'fastify-plugin';

import { AppError } from '../../core/errors/app-error.js';
import { successEnvelope } from '../../core/http/envelope.js';
import { readAllCapabilityTelemetry } from '../admin/integrity-telemetry.js';
import { PasswordService } from '../auth/password.service.js';
import { ObjectStorageError, type StoredObject } from '../../infrastructure/storage/object-storage.js';

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
          code: Type.String({ minLength: 0, maxLength: 6 }),
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
      let codeValid = app.environment.nodeEnv === 'development';
      if (passwordValid && !codeValid) {
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

  app.post('/v1/platform/tenants', {
    preHandler: async (request) => { await authenticatePlatform(request); },
    schema: { body: Type.Object({
      display_name: Type.String({ minLength: 2, maxLength: 120 }),
      legal_name: Type.String({ minLength: 2, maxLength: 160 }),
      tax_identifier: Type.Optional(Type.String({ maxLength: 32 })),
      slug: Type.String({ minLength: 3, maxLength: 80, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }),
      environment: Type.Union([Type.Literal('DEVELOPMENT'), Type.Literal('HOMOLOGATION'), Type.Literal('PRODUCTION')]),
      plan_id: Type.Optional(Type.String({ format: 'uuid' })),
      monthly_price: Type.Optional(Type.Number({ minimum: 0, maximum: 100000000 })),
      discount_percent: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
      implementation_days: Type.Optional(Type.Integer({ minimum: 0, maximum: 3650 })),
      feature_codes: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 100 })),
    }, { additionalProperties: false }) },
    handler: async (request) => {
      const identity = await authenticatePlatform(request);
      const result = await app.database.query<{ tenant_id: string; subscription_id: string | null }>(
        'SELECT * FROM platform.create_console_tenant($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [identity.operatorId, request.body.display_name, request.body.legal_name,
          request.body.tax_identifier ?? null, request.body.slug, request.body.environment,
          request.body.plan_id ?? null, request.body.monthly_price ?? 0, request.body.discount_percent ?? 0,
          request.body.implementation_days ?? 0, request.body.feature_codes ?? [], request.id],
      );
      const created = result.rows[0];
      if (!created) throw new Error('A criação não retornou os identificadores da empresa.');
      return successEnvelope(request, 'platform.tenants.create', {
        tenant_id: created.tenant_id,
        subscription_id: created.subscription_id,
      });
    },
  });

  app.post('/v1/platform/tenants/:tenantId/initial-admin', {
    preHandler: async (request) => { await authenticatePlatform(request); },
    schema: {
      params: Type.Object({ tenantId: Type.String({ format: 'uuid' }) }),
      body: Type.Object({
        name: Type.String({ minLength: 3, maxLength: 160 }),
        employee_number: Type.String({ minLength: 3, maxLength: 40, pattern: '^[A-Za-z0-9._-]+$' }),
        email: Type.String({ minLength: 5, maxLength: 254, format: 'email' }),
      }, { additionalProperties: false }),
    },
    handler: async (request, reply) => {
      const identity = await authenticatePlatform(request);
      const login = request.body.employee_number.trim().toUpperCase();
      const temporaryPassword = `${randomBytes(24).toString('base64url')}Aa1!`;
      const passwordHash = await passwords.hash(temporaryPassword);
      const result = await app.database.query<{ user_id: string }>(
        'SELECT platform.create_console_tenant_initial_admin($1,$2,$3,$4,$5,$6,$7) AS user_id',
        [identity.operatorId, request.params.tenantId, request.body.name.trim(), login,
          request.body.email.trim().toLowerCase(), passwordHash, request.id],
      );
      const userId = result.rows[0]?.user_id;
      if (!userId) throw new Error('A criação não retornou o identificador do usuário.');
      reply.header('Cache-Control', 'no-store');
      return successEnvelope(request, 'platform.tenants.initial-admin.create', {
        user_id: userId,
        login,
        temporary_password: temporaryPassword,
      });
    },
  });

  app.get('/v1/platform/plans', {
    preHandler: async (request) => { await authenticatePlatform(request); },
    handler: async (request) => {
      const result = await app.database.query('SELECT * FROM platform.list_console_plans()');
      return successEnvelope(request, 'platform.plans.list', { items: result.rows });
    },
  });

  app.get('/v1/platform/features', {
    preHandler: async (request) => { await authenticatePlatform(request); },
    handler: async (request) => {
      const result = await app.database.query('SELECT * FROM platform.list_console_features()');
      return successEnvelope(request, 'platform.features.list', { items: result.rows });
    },
  });

  app.put('/v1/platform/plans/:planId', {
    preHandler: async (request) => { await authenticatePlatform(request); },
    schema: {
      params: Type.Object({ planId: Type.String({ format: 'uuid' }) }),
      body: Type.Object({
        code: Type.String({ minLength: 2, maxLength: 40 }),
        name: Type.String({ minLength: 2, maxLength: 100 }),
        description: Type.String({ maxLength: 1000 }),
        status: Type.Union([Type.Literal('DRAFT'), Type.Literal('ACTIVE'), Type.Literal('RETIRED')]),
        monthly_price: Type.Number({ minimum: 0, maximum: 100000000 }),
        feature_codes: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 100 }),
      }, { additionalProperties: false }),
    },
    handler: async (request) => {
      const identity = await authenticatePlatform(request);
      const result = await app.database.query<{ plan_id: string }>(
        'SELECT platform.save_console_plan($1,$2,$3,$4,$5,$6,$7,$8,$9) AS plan_id',
        [identity.operatorId, request.params.planId, request.body.code, request.body.name,
          request.body.description, request.body.status, request.body.monthly_price,
          request.body.feature_codes, request.id],
      );
      return successEnvelope(request, 'platform.plans.save', { plan_id: result.rows[0]?.plan_id });
    },
  });

  app.post('/v1/platform/plans', {
    preHandler: async (request) => { await authenticatePlatform(request); },
    schema: { body: Type.Object({
      code: Type.String({ minLength: 2, maxLength: 40 }),
      name: Type.String({ minLength: 2, maxLength: 100 }),
      description: Type.String({ maxLength: 1000 }),
      status: Type.Union([Type.Literal('DRAFT'), Type.Literal('ACTIVE'), Type.Literal('RETIRED')]),
      monthly_price: Type.Number({ minimum: 0, maximum: 100000000 }),
      feature_codes: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 100 }),
    }, { additionalProperties: false }) },
    handler: async (request) => {
      const identity = await authenticatePlatform(request);
      const result = await app.database.query<{ plan_id: string }>(
        'SELECT platform.save_console_plan($1,NULL,$2,$3,$4,$5,$6,$7,$8) AS plan_id',
        [identity.operatorId, request.body.code, request.body.name, request.body.description,
          request.body.status, request.body.monthly_price, request.body.feature_codes, request.id],
      );
      return successEnvelope(request, 'platform.plans.save', { plan_id: result.rows[0]?.plan_id });
    },
  });

  app.patch('/v1/platform/tenants/:tenantId/subscription', {
    preHandler: async (request) => { await authenticatePlatform(request); },
    schema: {
      params: Type.Object({ tenantId: Type.String({ format: 'uuid' }) }),
      body: Type.Object({
        plan_id: Type.String({ format: 'uuid' }),
        status: Type.Union(['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED'].map((value) => Type.Literal(value))),
        monthly_price: Type.Number({ minimum: 0, maximum: 100000000 }),
        discount_percent: Type.Number({ minimum: 0, maximum: 100 }),
        implementation_days: Type.Integer({ minimum: 0, maximum: 3650 }),
        feature_codes: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 100 }),
      }, { additionalProperties: false }),
    },
    handler: async (request) => {
      const identity = await authenticatePlatform(request);
      const result = await app.database.query<{ subscription_id: string }>(
        'SELECT platform.update_console_tenant_subscription($1,$2,$3,$4,$5,$6,$7,$8,$9) AS subscription_id',
        [identity.operatorId, request.params.tenantId, request.body.plan_id, request.body.status,
          request.body.monthly_price, request.body.discount_percent,
          request.body.implementation_days, request.body.feature_codes, request.id],
      );
      return successEnvelope(request, 'platform.tenants.subscription.update', {
        subscription_id: result.rows[0]?.subscription_id,
      });
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
      const attachmentResult = await app.database.query<{
        support_request_id: string; object_id: string; original_name: string; media_type: string;
      }>('SELECT * FROM platform.list_console_support_attachments()');
      const attachments = new Map<string, Array<{ object_id: string; original_name: string; media_type: string }>>();
      for (const item of attachmentResult.rows) {
        const current = attachments.get(item.support_request_id) ?? [];
        current.push({ object_id: item.object_id, original_name: item.original_name, media_type: item.media_type });
        attachments.set(item.support_request_id, current);
      }
      return successEnvelope(request, 'platform.support.list', {
        items: result.rows.map((item) => ({ ...item, attachments: attachments.get(String(item.request_id)) ?? [] })),
      });
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
          scheduled_at: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
          service_mode: Type.Optional(Type.Union([Type.Literal('REMOTE'), Type.Literal('ONSITE')])),
        },
        { additionalProperties: false },
      ),
    },
    handler: async (request) => {
      const identity = await authenticatePlatform(request);
      const result = await app.database.query<{ updated: boolean }>(
        'SELECT platform.update_console_support_request($1,$2,$3,$4,$5,$6) AS updated',
        [identity.operatorId, request.params.requestId, request.body.status,
          request.body.scheduled_at ?? null, request.body.service_mode ?? 'REMOTE', request.id],
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
    bodyLimit: app.environment.storage.maxEvidenceBytes * 3 + 32_768,
    handler: async (request) => {
      const auth = request.auth;
      if (!auth)
        throw new AppError({
          code: 'AUTH_CONTEXT_MISSING',
          message: 'A sessão da empresa não está disponível.',
          statusCode: 401,
        });
      const fields: Record<string, string> = {};
      const uploads: Array<{ filename: string; mimetype: string; buffer: Buffer }> = [];
      for await (const part of request.parts({ limits: {
        fields: 4, files: 3, parts: 7, fieldSize: 4_096,
        fileSize: app.environment.storage.maxEvidenceBytes + 1,
      } })) {
        if (part.type === 'file') {
          if (part.fieldname !== 'screenshots')
            throw new AppError({ code: 'SUPPORT_FILE_FIELD_INVALID', message: 'Use o campo de captura de tela para anexar imagens.', statusCode: 400 });
          const buffer = await part.toBuffer();
          if (part.file.truncated || buffer.byteLength > app.environment.storage.maxEvidenceBytes)
            throw new AppError({ code: 'FILE_TOO_LARGE', message: 'Uma captura excede o tamanho máximo permitido.', statusCode: 413 });
          uploads.push({ filename: part.filename, mimetype: part.mimetype, buffer });
        } else {
          if (!['topic', 'module', 'summary', 'technical_context'].includes(part.fieldname) || typeof part.value !== 'string')
            throw new AppError({ code: 'SUPPORT_FIELD_INVALID', message: 'O formulário do chamado contém um campo inválido.', statusCode: 400 });
          if (fields[part.fieldname] !== undefined)
            throw new AppError({ code: 'SUPPORT_FIELD_DUPLICATED', message: 'O formulário do chamado contém um campo duplicado.', statusCode: 400 });
          fields[part.fieldname] = part.value;
        }
      }
      const topics = ['ERRO', 'DESEMPENHO', 'ACESSO', 'CONFIGURACAO', 'OUTRO'];
      const topic = fields.topic?.trim() ?? '';
      const moduleName = fields.module?.trim() ?? '';
      const summary = fields.summary?.trim() ?? '';
      const context = fields.technical_context?.trim() ?? '';
      if (!topics.includes(topic) || moduleName.length < 2 || moduleName.length > 100 || summary.length < 4 || summary.length > 160 || context.length < 4 || context.length > 4000 || uploads.length < 1)
        throw new AppError({ code: 'SUPPORT_REQUEST_INVALID', message: 'Preencha os dados do chamado e anexe ao menos uma captura de tela.', statusCode: 400 });

      const storedObjects: StoredObject[] = [];
      try {
        for (const upload of uploads) {
          storedObjects.push(await app.objectStorage.storeEvidence({
            tenantId: auth.user.tenantId, originalName: upload.filename,
            mediaType: upload.mimetype, stream: Readable.from(upload.buffer),
          }));
        }
        const requestId = await app.database.withTransaction(
          { tenantId: auth.user.tenantId, userId: auth.user.id },
          async (client) => {
            const created = await client.query<{ id: string }>(
              'SELECT platform.create_support_request($1,$2,$3,$4,$5,$6,$7,$8,$9) AS id',
              [auth.user.tenantId, auth.user.id, topic, moduleName, summary, context, request.id, null, 'REMOTE'],
            );
            const id = created.rows[0]?.id;
            if (!id) throw new Error('A API não retornou o identificador do chamado.');
            for (const object of storedObjects) {
              await client.query(
                `INSERT INTO platform.storage_objects
                 (id,tenant_id,provider,bucket,object_key,original_name,media_type,byte_size,checksum_sha256,status,metadata,created_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'AVAILABLE',$10::jsonb,$11)`,
                [object.id, auth.user.tenantId, object.provider, object.bucket, object.objectKey,
                  object.originalName, object.mediaType, object.byteSize, object.checksumSha256,
                  JSON.stringify({ visibility: 'PRIVATE', purpose: 'PLATFORM_SUPPORT_SCREENSHOT' }), auth.user.id],
              );
              await client.query(
                `INSERT INTO platform.support_request_attachments (tenant_id,support_request_id,storage_object_id)
                 VALUES ($1,$2,$3)`, [auth.user.tenantId, id, object.id],
              );
            }
            return id;
          },
        );
        return successEnvelope(request, 'platform.support.create', { id: requestId, status: 'OPEN' });
      } catch (cause) {
        await Promise.all(storedObjects.map((object) => app.objectStorage.remove(object).catch(() => undefined)));
        if (cause instanceof ObjectStorageError)
          throw new AppError({ code: cause.code, message: cause.message, statusCode: cause.code === 'FILE_TOO_LARGE' ? 413 : 400 });
        throw cause;
      }
    },
  });

  app.get('/v1/platform/support-attachments/:objectId', {
    preHandler: async (request) => { await authenticatePlatform(request); },
    schema: { params: Type.Object({ objectId: Type.String({ format: 'uuid' }) }) },
    handler: async (request, reply) => {
      const result = await app.database.query<{
        provider: string; bucket: string; object_key: string; media_type: string;
        byte_size: number; checksum_sha256: string;
      }>('SELECT * FROM platform.lookup_support_attachment($1)', [request.params.objectId]);
      const object = result.rows[0];
      if (!object) throw new AppError({ code: 'SUPPORT_ATTACHMENT_NOT_FOUND', message: 'A captura não foi encontrada.', statusCode: 404 });
      const stream = app.objectStorage.open({ provider: object.provider, bucket: object.bucket, objectKey: object.object_key });
      return reply.header('Cache-Control', 'private, no-store, max-age=0')
        .header('Content-Type', object.media_type).header('Content-Length', String(object.byte_size))
        .header('ETag', `"sha256-${object.checksum_sha256}"`).header('X-Content-Type-Options', 'nosniff').send(stream);
    },
  });

  app.get('/v1/platform/my-support-requests', {
    preHandler: async (request) => { await app.authenticate(request); },
    handler: async (request) => {
      const auth = request.auth;
      if (!auth) throw new AppError({ code: 'AUTH_CONTEXT_MISSING', message: 'A sessão da empresa não está disponível.', statusCode: 401 });
      const result = await app.database.withTransaction(
        { tenantId: auth.user.tenantId, userId: auth.user.id, readOnly: true },
        (client) => client.query(
          `SELECT request.id AS request_id,request.topic,request.module,request.summary,request.status,
                  request.created_at,request.updated_at,request.scheduled_at,request.service_mode,
                  COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'object_id',object.id,'original_name',object.original_name,'media_type',object.media_type
                  ) ORDER BY attachment.created_at)
                  FROM platform.support_request_attachments attachment
                  JOIN platform.storage_objects object ON object.tenant_id=attachment.tenant_id
                    AND object.id=attachment.storage_object_id
                  WHERE attachment.tenant_id=request.tenant_id
                    AND attachment.support_request_id=request.id
                    AND object.status='AVAILABLE' AND object.deleted_at IS NULL),'[]'::jsonb) AS attachments
           FROM platform.support_requests request WHERE request.tenant_id=platform.current_tenant_id()
           ORDER BY request.created_at DESC LIMIT 100`,
        ),
      );
      return successEnvelope(request, 'platform.support.mine', { items: result.rows });
    },
  });

  app.get('/v1/platform/my-support-attachments/:objectId', {
    preHandler: async (request) => { await app.authenticate(request); },
    schema: { params: Type.Object({ objectId: Type.String({ format: 'uuid' }) }) },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) throw new AppError({ code: 'AUTH_CONTEXT_MISSING', message: 'A sessão da empresa não está disponível.', statusCode: 401 });
      const result = await app.database.withTransaction(
        { tenantId: auth.user.tenantId, userId: auth.user.id, readOnly: true },
        (client) => client.query<{
          provider: string; bucket: string; object_key: string; media_type: string; byte_size: number; checksum_sha256: string;
        }>(`SELECT object.provider,object.bucket,object.object_key,object.media_type,object.byte_size,object.checksum_sha256
            FROM platform.support_request_attachments attachment
            JOIN platform.storage_objects object ON object.tenant_id=attachment.tenant_id AND object.id=attachment.storage_object_id
            WHERE attachment.tenant_id=platform.current_tenant_id() AND object.id=$1
              AND object.status='AVAILABLE' AND object.deleted_at IS NULL LIMIT 1`, [request.params.objectId]),
      );
      const object = result.rows[0];
      if (!object) throw new AppError({ code: 'SUPPORT_ATTACHMENT_NOT_FOUND', message: 'A captura não foi encontrada.', statusCode: 404 });
      const stream = app.objectStorage.open({ provider: object.provider, bucket: object.bucket, objectKey: object.object_key });
      return reply.header('Cache-Control', 'private, no-store, max-age=0')
        .header('Content-Type', object.media_type).header('Content-Length', String(object.byte_size))
        .header('ETag', `"sha256-${object.checksum_sha256}"`).header('X-Content-Type-Options', 'nosniff').send(stream);
    },
  });
  return Promise.resolve();
};

export const platformPlugin = fastifyPlugin(platformRoutes, {
  name: 'vorqix-platform-console',
  dependencies: ['fab-control-authentication'],
});
