import type { FastifyReply, FastifyRequest } from 'fastify';

import { AppError } from '../../core/errors/app-error.js';
import { successEnvelope } from '../../core/http/envelope.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { BackupService } from './backup.service.js';
import type { GovernanceAuditMetadata } from './governance.types.js';

interface Params {
  readonly backupId: string;
}

interface ListQuery {
  readonly limite?: number;
}

interface CreateBody {
  readonly motivo: string;
  readonly confirmacao: string;
}

interface RestoreBody {
  readonly token: string;
  readonly confirmacao: string;
  readonly confirmacao_final: string;
  readonly motivo: string;
  readonly criar_backup_seguranca: true;
}

function user(request: FastifyRequest): AuthenticatedUser {
  if (request.auth) return request.auth.user;
  throw new AppError({
    code: 'AUTH_CONTEXT_MISSING',
    message: 'A identidade da sessão não está disponível.',
    statusCode: 401,
  });
}

function audit(request: FastifyRequest): GovernanceAuditMetadata {
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

function contentDisposition(fileName: string): string {
  const fallback = fileName.replaceAll(/[^\x20-\x7E]/gu, '_').replaceAll(/["\\]/gu, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export class BackupController {
  constructor(private readonly service: BackupService) {}

  list = async (request: FastifyRequest<{ Querystring: ListQuery }>) =>
    successEnvelope(
      request,
      'admin.backups.list',
      await this.service.list(user(request), request.query.limite ?? 100),
    );

  create = async (request: FastifyRequest<{ Body: CreateBody }>) =>
    successEnvelope(
      request,
      'admin.backups.create',
      await this.service.create(
        user(request),
        request.body.motivo,
        request.body.confirmacao,
        audit(request),
      ),
    );

  prepare = async (request: FastifyRequest<{ Params: Params }>) =>
    successEnvelope(
      request,
      'admin.backups.prepare',
      await this.service.prepare(user(request), request.params.backupId),
    );

  restore = async (request: FastifyRequest<{ Params: Params; Body: RestoreBody }>) =>
    successEnvelope(
      request,
      'admin.backups.restore',
      await this.service.restore(
        user(request),
        {
          token: request.body.token,
          backupId: request.params.backupId,
          challenge: request.body.confirmacao,
          finalConfirmation: request.body.confirmacao_final,
          reason: request.body.motivo,
          createSafetyBackup: request.body.criar_backup_seguranca,
        },
        audit(request),
      ),
    );

  download = async (request: FastifyRequest<{ Params: Params }>, reply: FastifyReply) => {
    const file = await this.service.openFile(user(request), request.params.backupId);
    return reply
      .header('content-type', 'application/gzip')
      .header('content-length', String(file.byteSize))
      .header('content-disposition', contentDisposition(file.fileName))
      .header('cache-control', 'private, no-store')
      .send(file.stream);
  };
}
