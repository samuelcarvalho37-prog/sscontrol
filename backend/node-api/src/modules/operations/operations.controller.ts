import type { FastifyReply, FastifyRequest } from 'fastify';

import { AppError } from '../../core/errors/app-error.js';
import { successEnvelope } from '../../core/http/envelope.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { OperationsService } from './operations.service.js';
import type {
  EvidenceType,
  ExecutionStopMode,
  Priority,
  SignaturePolicy,
} from './operations.types.js';

interface Params {
  readonly workOrderId?: string;
  readonly demandId?: string;
  readonly actionId?: string;
  readonly executionId?: string;
  readonly itemId?: string;
  readonly objectId?: string;
}
interface WorkOrderQuery {
  readonly busca?: string;
  readonly status?: string;
  readonly ativo_id?: string;
  readonly limite?: number;
}
interface TechnicalDemandQuery {
  readonly busca?: string;
  readonly status?: string;
  readonly limite?: number;
}
interface MaintenanceActionQuery {
  readonly busca?: string;
  readonly status?: string;
  readonly ativo_id?: string;
  readonly limite?: number;
}
interface WorkOrderBody {
  readonly plano_versao_id: string;
  readonly tipo_origem: string;
  readonly entidade_origem_id: string | null;
  readonly tipo_trabalho: string;
  readonly titulo: string;
  readonly descricao: string;
  readonly prioridade: Priority;
  readonly responsavel_id: string | null;
  readonly programada_para: string | null;
  readonly analise_tecnica: Readonly<Record<string, unknown>>;
}
interface WorkOrderCorrectionBody {
  readonly titulo: string;
  readonly descricao: string;
  readonly prioridade: Priority;
  readonly responsavel_id: string | null;
  readonly programada_para: string | null;
  readonly analise_tecnica: Readonly<Record<string, unknown>>;
}
interface SubmitBody {
  readonly politica_assinatura: SignaturePolicy;
  readonly assinaturas_exigidas: number;
  readonly primeira_resposta_ate: string | null;
  readonly resolucao_ate: string | null;
}
interface SignatureBody {
  readonly declaracao: string;
  readonly significado: string;
}
interface ChangesBody {
  readonly motivo: string;
}
interface ResponseBody {
  readonly resposta_texto: string | null;
  readonly resposta_numero: number | null;
  readonly resposta_booleano: boolean | null;
  readonly resposta_opcao: string | null;
  readonly observacao: string | null;
  readonly nao_aplicavel: boolean;
}
interface BatchResponseBody {
  readonly itens: readonly {
    readonly item_id: string;
    readonly resposta: string | null;
    readonly valor: number | null;
    readonly observacao: string | null;
  }[];
}
interface EvidenceBody {
  readonly objeto_armazenamento_id: string;
  readonly tipo: EvidenceType;
  readonly observacao: string | null;
  readonly capturada_em: string | null;
}
interface StartBody {
  readonly modo_parada: ExecutionStopMode;
}
interface CompleteBody {
  readonly resultado: string;
  readonly observacao: string | null;
  readonly modo_parada: ExecutionStopMode;
}
interface ActionReviewBody {
  readonly decisao: 'APPROVE' | 'REJECT';
  readonly comentario: string;
}

function user(request: FastifyRequest): AuthenticatedUser {
  if (request.auth) return request.auth.user;
  throw new AppError({
    code: 'AUTH_CONTEXT_MISSING',
    message: 'A sessão autenticada não está disponível.',
    statusCode: 401,
  });
}

function id(params: Params, key: keyof Params): string {
  const value = params[key];
  if (value) return value;
  throw new AppError({
    code: 'ROUTE_IDENTIFIER_MISSING',
    message: 'Identificador obrigatório ausente.',
    statusCode: 400,
  });
}

function audit(request: FastifyRequest) {
  const authenticated = user(request);
  const agent = request.headers['user-agent'];
  return {
    traceId: request.id,
    ipAddress: request.ip,
    userAgent: typeof agent === 'string' ? agent.slice(0, 2_048) : null,
    roleSnapshot: authenticated.roles.join(',') || authenticated.profile,
  };
}

function statuses(value: string | undefined): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}

function multipartText(fields: Readonly<Record<string, unknown>>, name: string): string | null {
  const field = fields[name];
  if (field === null || typeof field !== 'object' || !('value' in field)) return null;
  const value = (field as { readonly value?: unknown }).value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function contentDisposition(fileName: string): string {
  const fallback = fileName.replaceAll(/[^\x20-\x7e]/gu, '_').replaceAll(/["\\]/gu, '_');
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export class OperationsController {
  constructor(private readonly service: OperationsService) {}

  listWorkOrders = async (request: FastifyRequest<{ Querystring: WorkOrderQuery }>) =>
    successEnvelope(
      request,
      'maintenance.work-orders.list',
      await this.service.listWorkOrders(user(request), {
        search: request.query.busca?.trim() ?? '',
        status: request.query.status ?? null,
        assetId: request.query.ativo_id ?? null,
        limit: request.query.limite ?? 50,
      }),
    );

  getTechnicalContext = async (request: FastifyRequest) =>
    successEnvelope(
      request,
      'workflow.technical-context.get',
      await this.service.getTechnicalContext(user(request)),
    );

  listTechnicalDemands = async (request: FastifyRequest<{ Querystring: TechnicalDemandQuery }>) =>
    successEnvelope(
      request,
      'workflow.technical-demands.list',
      await this.service.listTechnicalDemands(user(request), {
        search: request.query.busca?.trim() ?? '',
        statuses: statuses(request.query.status),
        limit: request.query.limite ?? 100,
      }),
    );

  assumeTechnicalDemand = async (request: FastifyRequest<{ Params: Params }>) =>
    successEnvelope(
      request,
      'workflow.technical-demands.assume',
      await this.service.assumeTechnicalDemand(
        user(request),
        id(request.params, 'demandId'),
        audit(request),
      ),
    );

  listMaintenanceActions = async (
    request: FastifyRequest<{ Querystring: MaintenanceActionQuery }>,
  ) =>
    successEnvelope(
      request,
      'maintenance.actions.list',
      await this.service.listMaintenanceActions(user(request), {
        search: request.query.busca?.trim() ?? '',
        statuses: statuses(request.query.status),
        assetId: request.query.ativo_id ?? null,
        limit: request.query.limite ?? 100,
      }),
    );

  getMaintenanceAction = async (request: FastifyRequest<{ Params: Params }>) =>
    successEnvelope(
      request,
      'maintenance.actions.get',
      await this.service.getMaintenanceAction(user(request), id(request.params, 'actionId')),
    );

  getWorkOrder = async (request: FastifyRequest<{ Params: Params }>) =>
    successEnvelope(
      request,
      'maintenance.work-orders.get',
      await this.service.getWorkOrder(user(request), id(request.params, 'workOrderId')),
    );

  createWorkOrder = async (request: FastifyRequest<{ Body: WorkOrderBody }>) =>
    successEnvelope(
      request,
      'maintenance.work-orders.create',
      await this.service.createWorkOrder(
        user(request),
        {
          planVersionId: request.body.plano_versao_id,
          originType: request.body.tipo_origem,
          originEntityId: request.body.entidade_origem_id,
          workType: request.body.tipo_trabalho,
          title: request.body.titulo,
          description: request.body.descricao,
          priority: request.body.prioridade,
          responsibleId: request.body.responsavel_id,
          scheduledFor: request.body.programada_para,
          technicalAnalysis: request.body.analise_tecnica,
        },
        audit(request),
      ),
    );

  correctWorkOrder = async (
    request: FastifyRequest<{ Params: Params; Body: WorkOrderCorrectionBody }>,
  ) =>
    successEnvelope(
      request,
      'maintenance.work-orders.correct',
      await this.service.correctWorkOrder(
        user(request),
        id(request.params, 'workOrderId'),
        {
          title: request.body.titulo,
          description: request.body.descricao,
          priority: request.body.prioridade,
          responsibleId: request.body.responsavel_id,
          scheduledFor: request.body.programada_para,
          technicalAnalysis: request.body.analise_tecnica,
        },
        audit(request),
      ),
    );

  submitReview = async (request: FastifyRequest<{ Params: Params; Body: SubmitBody }>) =>
    successEnvelope(
      request,
      'maintenance.work-orders.submit-review',
      await this.service.submitForReview(
        user(request),
        id(request.params, 'workOrderId'),
        {
          signaturePolicy: request.body.politica_assinatura,
          requiredSignatures: request.body.assinaturas_exigidas,
          firstResponseDueAt: request.body.primeira_resposta_ate,
          resolutionDueAt: request.body.resolucao_ate,
        },
        audit(request),
      ),
    );

  signDemand = async (request: FastifyRequest<{ Params: Params; Body: SignatureBody }>) =>
    successEnvelope(
      request,
      'workflow.technical-demands.sign',
      await this.service.signDemand(
        user(request),
        id(request.params, 'demandId'),
        {
          declaration: request.body.declaracao,
          meaning: request.body.significado,
        },
        audit(request),
      ),
    );

  requestChanges = async (request: FastifyRequest<{ Params: Params; Body: ChangesBody }>) =>
    successEnvelope(
      request,
      'workflow.technical-demands.request-changes',
      await this.service.requestChanges(
        user(request),
        id(request.params, 'demandId'),
        request.body.motivo,
        audit(request),
      ),
    );

  releaseWorkOrder = async (request: FastifyRequest<{ Params: Params }>) =>
    successEnvelope(
      request,
      'maintenance.work-orders.release',
      await this.service.releaseWorkOrder(
        user(request),
        id(request.params, 'workOrderId'),
        audit(request),
      ),
    );

  listOperatorActions = async (
    request: FastifyRequest<{ Querystring: { readonly limite?: number } }>,
  ) =>
    successEnvelope(
      request,
      'maintenance.operator-actions.list',
      await this.service.listOperatorActions(user(request), request.query.limite ?? 50),
    );

  getOperatorAction = async (request: FastifyRequest<{ Params: Params }>) =>
    successEnvelope(
      request,
      'maintenance.operator-actions.get',
      await this.service.getOperatorAction(user(request), id(request.params, 'actionId')),
    );

  reviewMaintenanceAction = async (
    request: FastifyRequest<{ Params: Params; Body: ActionReviewBody }>,
  ) =>
    successEnvelope(
      request,
      'maintenance.actions.review',
      await this.service.reviewMaintenanceAction(
        user(request),
        id(request.params, 'actionId'),
        {
          decision: request.body.decisao,
          comment: request.body.comentario,
        },
        audit(request),
      ),
    );

  startOperatorAction = async (request: FastifyRequest<{ Params: Params; Body: StartBody }>) =>
    successEnvelope(
      request,
      'maintenance.operator-actions.start',
      await this.service.startOperatorAction(
        user(request),
        id(request.params, 'actionId'),
        request.body.modo_parada,
        audit(request),
      ),
    );

  saveOperatorResponses = async (
    request: FastifyRequest<{ Params: Params; Body: BatchResponseBody }>,
  ) =>
    successEnvelope(
      request,
      'maintenance.operator-actions.responses',
      await this.service.saveOperatorResponses(
        user(request),
        id(request.params, 'actionId'),
        request.body.itens.map((item) => ({
          itemId: item.item_id,
          response: item.resposta,
          numericValue: item.valor,
          observation: item.observacao,
        })),
        audit(request),
      ),
    );

  validateOperatorAction = async (request: FastifyRequest<{ Params: Params }>) =>
    successEnvelope(
      request,
      'maintenance.operator-actions.validation',
      await this.service.validateOperatorActionCompletion(
        user(request),
        id(request.params, 'actionId'),
      ),
    );

  completeOperatorAction = async (
    request: FastifyRequest<{ Params: Params; Body: CompleteBody }>,
  ) =>
    successEnvelope(
      request,
      'maintenance.operator-actions.complete',
      await this.service.completeOperatorAction(
        user(request),
        id(request.params, 'actionId'),
        {
          result: request.body.resultado,
          observation: request.body.observacao,
          stopMode: request.body.modo_parada,
        },
        audit(request),
      ),
    );

  assumeAction = async (request: FastifyRequest<{ Params: Params }>) =>
    successEnvelope(
      request,
      'maintenance.operator-actions.assume',
      await this.service.assumeAction(
        user(request),
        id(request.params, 'actionId'),
        audit(request),
      ),
    );

  getExecution = async (request: FastifyRequest<{ Params: Params }>) =>
    successEnvelope(
      request,
      'maintenance.executions.get',
      await this.service.getExecution(user(request), id(request.params, 'executionId')),
    );

  validateExecutionCompletion = async (request: FastifyRequest<{ Params: Params }>) =>
    successEnvelope(
      request,
      'maintenance.executions.validation',
      await this.service.validateExecutionCompletion(
        user(request),
        id(request.params, 'executionId'),
      ),
    );

  startExecution = async (request: FastifyRequest<{ Params: Params; Body: StartBody }>) =>
    successEnvelope(
      request,
      'maintenance.executions.start',
      await this.service.startExecution(
        user(request),
        id(request.params, 'executionId'),
        request.body.modo_parada,
        audit(request),
      ),
    );

  answerItem = async (request: FastifyRequest<{ Params: Params; Body: ResponseBody }>) =>
    successEnvelope(
      request,
      'maintenance.executions.items.answer',
      await this.service.answerItem(
        user(request),
        id(request.params, 'executionId'),
        id(request.params, 'itemId'),
        {
          textValue: request.body.resposta_texto,
          numberValue: request.body.resposta_numero,
          booleanValue: request.body.resposta_booleano,
          optionValue: request.body.resposta_opcao,
          observation: request.body.observacao,
          notApplicable: request.body.nao_aplicavel,
        },
        audit(request),
      ),
    );

  addEvidence = async (request: FastifyRequest<{ Params: Params; Body: EvidenceBody }>) =>
    successEnvelope(
      request,
      'maintenance.executions.items.evidence',
      await this.service.addEvidence(
        user(request),
        id(request.params, 'executionId'),
        id(request.params, 'itemId'),
        {
          storageObjectId: request.body.objeto_armazenamento_id,
          evidenceType: request.body.tipo,
          observation: request.body.observacao,
          capturedAt: request.body.capturada_em,
        },
        audit(request),
      ),
    );

  addEvidenceFile = async (request: FastifyRequest<{ Params: Params }>) => {
    const part = await request.file({
      limits: { fileSize: request.server.environment.storage.maxEvidenceBytes + 1, files: 1 },
    });
    if (!part) {
      throw new AppError({
        code: 'EVIDENCE_FILE_REQUIRED',
        message: 'Selecione uma foto para registrar a evidência.',
        statusCode: 400,
      });
    }

    const detail = await this.service.addEvidenceFile(
      user(request),
      id(request.params, 'executionId'),
      id(request.params, 'itemId'),
      {
        originalName: part.filename,
        mediaType: part.mimetype,
        stream: part.file,
        observation: multipartText(part.fields, 'observacao'),
        capturedAt: multipartText(part.fields, 'capturada_em'),
      },
      audit(request),
    );
    return successEnvelope(request, 'maintenance.executions.items.evidence.upload', detail);
  };

  openEvidenceFile = async (request: FastifyRequest<{ Params: Params }>, reply: FastifyReply) => {
    const file = await this.service.openEvidenceFile(user(request), id(request.params, 'objectId'));
    reply
      .header('Cache-Control', 'private, no-store, max-age=0')
      .header('Content-Disposition', contentDisposition(file.originalName))
      .header('Content-Length', String(file.byteSize))
      .header('Content-Type', file.mediaType)
      .header('ETag', `"sha256-${file.checksumSha256}"`)
      .header('X-Content-Type-Options', 'nosniff');
    return reply.send(file.stream);
  };

  completeExecution = async (request: FastifyRequest<{ Params: Params; Body: CompleteBody }>) =>
    successEnvelope(
      request,
      'maintenance.executions.complete',
      await this.service.completeExecution(
        user(request),
        id(request.params, 'executionId'),
        {
          result: request.body.resultado,
          observation: request.body.observacao,
          stopMode: request.body.modo_parada,
        },
        audit(request),
      ),
    );
}
