import type { FastifyRequest } from 'fastify';

import { AppError } from '../../core/errors/app-error.js';
import { successEnvelope } from '../../core/http/envelope.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { ImportService } from './import.service.js';
import type { ImportAuditContext, ImportRowInput } from './import.types.js';

interface BatchParams {
  readonly batchId: string;
}

interface ListQuery {
  readonly limite?: number;
}

interface ValidateBody {
  readonly tipo: string;
  readonly arquivo_nome: string;
  readonly aba_nome: string;
  readonly cabecalhos: readonly string[];
  readonly linhas: readonly Readonly<Record<string, string | number | boolean | null>>[];
}

interface ConfirmBody {
  readonly validacao_hash: string;
}

interface RollbackBody {
  readonly motivo: string;
}

function user(request: FastifyRequest): AuthenticatedUser {
  if (request.auth) return request.auth.user;
  throw new AppError({
    code: 'AUTH_CONTEXT_MISSING',
    message: 'A identidade da sessão não está disponível.',
    statusCode: 401,
  });
}

function audit(request: FastifyRequest): ImportAuditContext {
  const authenticated = user(request);
  const userAgent = request.headers['user-agent'];
  return {
    traceId: request.id,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 2_048) : null,
    ipAddress: request.ip,
    roleSnapshot:
      authenticated.roles.length > 0 ? authenticated.roles.join(',') : authenticated.profile,
  };
}

function rows(input: ValidateBody['linhas']): readonly ImportRowInput[] {
  return input.map((row, index) => {
    const line = row.__linha;
    if (typeof line !== 'number' || !Number.isSafeInteger(line) || line < 2) {
      throw new AppError({
        code: 'IMPORT_SOURCE_ROW_INVALID',
        message: `A linha importada ${index + 1} não possui numeração válida.`,
        statusCode: 400,
      });
    }
    return row as ImportRowInput;
  });
}

export class ImportController {
  constructor(private readonly service: ImportService) {}

  catalog = (request: FastifyRequest) =>
    successEnvelope(request, 'admin.imports.catalog', this.service.catalog());

  list = async (request: FastifyRequest<{ Querystring: ListQuery }>) =>
    successEnvelope(
      request,
      'admin.imports.list',
      await this.service.listBatches(user(request), request.query.limite ?? 50),
    );

  detail = async (request: FastifyRequest<{ Params: BatchParams }>) =>
    successEnvelope(
      request,
      'admin.imports.detail',
      await this.service.batchDetail(user(request), request.params.batchId),
    );

  validate = async (request: FastifyRequest<{ Body: ValidateBody }>) =>
    successEnvelope(
      request,
      'admin.imports.validate',
      await this.service.validate(
        user(request),
        {
          type: request.body.tipo,
          fileName: request.body.arquivo_nome,
          sheetName: request.body.aba_nome,
          headers: request.body.cabecalhos,
          rows: rows(request.body.linhas),
        },
        audit(request),
      ),
    );

  confirm = async (request: FastifyRequest<{ Params: BatchParams; Body: ConfirmBody }>) =>
    successEnvelope(
      request,
      'admin.imports.confirm',
      await this.service.confirm(
        user(request),
        request.params.batchId,
        request.body.validacao_hash,
        audit(request),
      ),
    );

  rollback = async (request: FastifyRequest<{ Params: BatchParams; Body: RollbackBody }>) =>
    successEnvelope(
      request,
      'admin.imports.rollback',
      await this.service.rollback(
        user(request),
        request.params.batchId,
        request.body.motivo,
        audit(request),
      ),
    );
}
