import type { FastifyReply, FastifyRequest } from 'fastify';

import { AppError } from '../../core/errors/app-error.js';
import { successEnvelope } from '../../core/http/envelope.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { GovernanceService } from './governance.service.js';
import type {
  DocumentEntityType,
  DocumentMetadataInput,
  DocumentStatus,
  DocumentType,
  GovernanceAuditMetadata,
} from './governance.types.js';

interface Params {
  readonly documentId?: string;
  readonly objectId?: string;
}

interface ListQuery {
  readonly busca?: string;
  readonly status?: DocumentStatus;
  readonly tipo?: DocumentType;
  readonly limite?: number;
}

interface MetadataBody {
  readonly id?: string;
  readonly documento_id?: string;
  readonly codigo?: string;
  readonly titulo: string;
  readonly tipo: DocumentType;
  readonly entidade_tipo: DocumentEntityType;
  readonly entidade_id?: string | null;
  readonly status: DocumentStatus;
  readonly validade_em?: string | null;
  readonly responsavel_id?: string | null;
  readonly descricao?: string | null;
  readonly revisao?: string;
  readonly observacao?: string | null;
}

interface UploadBody {
  readonly dados: MetadataBody;
  readonly arquivo: {
    readonly nome: string;
    readonly mime_type: string;
    readonly base64: string;
  };
}

interface UpdateBody {
  readonly dados: MetadataBody;
}

function user(request: FastifyRequest): AuthenticatedUser {
  if (request.auth) return request.auth.user;
  throw new AppError({
    code: 'AUTH_CONTEXT_MISSING',
    message: 'A identidade da sessão não está disponível.',
    statusCode: 401,
  });
}

function id(params: Params, key: keyof Params): string {
  const value = params[key];
  if (value) return value;
  throw new AppError({
    code: 'REQUEST_IDENTIFIER_MISSING',
    message: 'O identificador obrigatório não foi informado.',
    statusCode: 400,
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

function metadata(
  body: MetadataBody,
  routeDocumentId: string | null = null,
): DocumentMetadataInput {
  const code = body.codigo?.trim() ?? '';
  const validUntil = body.validade_em?.trim() ?? '';
  const description = body.descricao?.trim() ?? '';
  const observation = body.observacao?.trim() ?? '';
  return {
    documentId: routeDocumentId ?? body.documento_id ?? body.id ?? null,
    code: code.length > 0 ? code : null,
    title: body.titulo.trim(),
    documentType: body.tipo,
    entityType: body.entidade_tipo,
    entityId: body.entidade_id ?? null,
    status: body.status,
    validUntil: validUntil.length > 0 ? validUntil : null,
    responsibleId: body.responsavel_id ?? null,
    description: description.length > 0 ? description : null,
    observation: observation.length > 0 ? observation : null,
  };
}

function contentDisposition(fileName: string): string {
  const fallback = fileName.replaceAll(/[^\x20-\x7E]/gu, '_').replaceAll(/["\\]/gu, '_');
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export class GovernanceController {
  constructor(private readonly service: GovernanceService) {}

  listDocuments = async (request: FastifyRequest<{ Querystring: ListQuery }>) =>
    successEnvelope(
      request,
      'admin.documents.list',
      await this.service.listDocuments(user(request), {
        search: request.query.busca ?? null,
        status: request.query.status ?? null,
        documentType: request.query.tipo ?? null,
      }),
    );

  documentDetail = async (request: FastifyRequest<{ Params: Params }>) =>
    successEnvelope(
      request,
      'admin.documents.detail',
      await this.service.documentDetail(user(request), id(request.params, 'documentId')),
    );

  uploadDocument = async (request: FastifyRequest<{ Body: UploadBody }>) =>
    successEnvelope(
      request,
      'admin.documents.upload',
      await this.service.saveDocument(
        user(request),
        metadata(request.body.dados),
        {
          originalName: request.body.arquivo.nome,
          mediaType: request.body.arquivo.mime_type,
          encodedData: request.body.arquivo.base64,
        },
        audit(request),
      ),
    );

  updateDocument = async (request: FastifyRequest<{ Params: Params; Body: UpdateBody }>) => {
    const documentId = id(request.params, 'documentId');
    return successEnvelope(
      request,
      'admin.documents.update',
      await this.service.updateDocument(
        user(request),
        documentId,
        metadata(request.body.dados, documentId),
        audit(request),
      ),
    );
  };

  openDocumentFile = async (request: FastifyRequest<{ Params: Params }>, reply: FastifyReply) => {
    const file = await this.service.openDocumentFile(user(request), id(request.params, 'objectId'));
    reply
      .header('Cache-Control', 'private, no-store, max-age=0')
      .header('Content-Disposition', contentDisposition(file.originalName))
      .header('Content-Length', String(file.byteSize))
      .header('Content-Type', file.mediaType)
      .header('ETag', `"sha256-${file.checksumSha256}"`)
      .header('X-Content-Type-Options', 'nosniff');
    return reply.send(file.stream);
  };
}
