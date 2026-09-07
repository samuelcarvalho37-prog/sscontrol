import type { FastifyRequest } from 'fastify';

import { AppError } from '../../core/errors/app-error.js';
import { successEnvelope } from '../../core/http/envelope.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { MonitoringService } from './monitoring.service.js';
import type { AlertSeverity, Severity, StopStatus } from './monitoring.types.js';
import type { ParameterActionRequestType } from './monitoring.types.js';

interface Params {
  readonly occurrenceId?: string;
  readonly alertId?: string;
  readonly stopId?: string;
  readonly notificationId?: string;
}

interface OccurrenceQuery {
  readonly busca?: string;
  readonly status?: string;
  readonly tratamento_status?: string;
  readonly severidade?: Severity;
  readonly ativo_id?: string;
  readonly limite?: number;
}

interface OccurrenceBody {
  readonly ativo_id: string;
  readonly componente_id: string | null;
  readonly tipo: string;
  readonly titulo: string;
  readonly descricao: string;
  readonly severidade: Severity;
  readonly equipamento_parado: boolean;
  readonly tipo_parada: string | null;
  readonly motivo_parada: string | null;
  readonly ocorrida_em: string | null;
}

interface TechnicalAnalysisBody {
  readonly titulo: string;
  readonly diagnostico: string;
  readonly risco: string;
  readonly causa_provavel: string | null;
  readonly recomendacao: string;
  readonly recomenda_checklist: boolean;
  readonly recomenda_ordem_servico: boolean;
  readonly prioridade: Severity;
  readonly relatorio: Readonly<Record<string, unknown>>;
}

interface ParameterActionRequestBody {
  readonly leitura_id: string;
  readonly tipo_solicitacao: ParameterActionRequestType;
  readonly prioridade: Severity | null;
  readonly observacao: string | null;
  readonly causa_provavel: string | null;
  readonly risco: string | null;
  readonly limite_minimo_proposto: number | null;
  readonly limite_maximo_proposto: number | null;
}

interface StopQuery {
  readonly busca?: string;
  readonly status?: StopStatus;
  readonly ativo_id?: string;
  readonly somente_abertas?: boolean;
  readonly limite?: number;
}

interface StopBody {
  readonly ativo_id: string;
  readonly componente_id: string | null;
  readonly origem: string;
  readonly tipo: string;
  readonly motivo: string;
  readonly iniciada_em: string;
  readonly tolerancia_retorno_minutos: number;
}

interface StopTransitionBody {
  readonly status: StopStatus;
  readonly categoria_retorno: string | null;
  readonly justificativa_divergencia: string | null;
}

interface AlertQuery {
  readonly busca?: string;
  readonly status?: string;
  readonly severidade?: AlertSeverity;
  readonly ativo_id?: string;
  readonly limite?: number;
}

interface AlertOccurrenceBody {
  readonly titulo?: string;
  readonly descricao?: string;
  readonly equipamento_parado: boolean;
}

interface NotificationQuery {
  readonly busca?: string;
  readonly somente_nao_lidas?: boolean;
  readonly prioridade?: AlertSeverity;
  readonly contexto?: string;
  readonly limite?: number;
}

interface AnalyticsQuery {
  readonly ativo_id?: string;
  readonly inicio: string;
  readonly fim: string;
  readonly limite_ranking?: number;
}

function user(request: FastifyRequest): AuthenticatedUser {
  if (request.auth) return request.auth.user;
  throw new AppError({
    code: 'AUTH_CONTEXT_MISSING',
    message: 'A sessão autenticada não está disponível.',
    statusCode: 401,
  });
}

function identifier(params: Params, key: keyof Params): string {
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

export class MonitoringController {
  constructor(private readonly service: MonitoringService) {}

  listOccurrences = async (request: FastifyRequest<{ Querystring: OccurrenceQuery }>) =>
    successEnvelope(
      request,
      'maintenance.occurrences.list',
      await this.service.listOccurrences(user(request), {
        search: request.query.busca?.trim() ?? '',
        status: request.query.status ?? null,
        treatmentStatus: request.query.tratamento_status ?? null,
        severity: request.query.severidade ?? null,
        assetId: request.query.ativo_id ?? null,
        limit: request.query.limite ?? 50,
      }),
    );

  getOccurrence = async (request: FastifyRequest<{ Params: Params }>) =>
    successEnvelope(
      request,
      'maintenance.occurrences.get',
      await this.service.getOccurrence(user(request), identifier(request.params, 'occurrenceId')),
    );

  createOccurrence = async (request: FastifyRequest<{ Body: OccurrenceBody }>) =>
    successEnvelope(
      request,
      'maintenance.occurrences.create',
      await this.service.createOccurrence(
        user(request),
        {
          assetId: request.body.ativo_id,
          componentId: request.body.componente_id,
          occurrenceType: request.body.tipo,
          title: request.body.titulo,
          description: request.body.descricao,
          severity: request.body.severidade,
          equipmentStopped: request.body.equipamento_parado,
          stopType: request.body.tipo_parada,
          stopReason: request.body.motivo_parada,
          occurredAt: request.body.ocorrida_em,
        },
        audit(request),
      ),
    );

  createTechnicalAnalysis = async (
    request: FastifyRequest<{ Params: Params; Body: TechnicalAnalysisBody }>,
  ) =>
    successEnvelope(
      request,
      'maintenance.occurrences.technical-analysis.create',
      await this.service.createTechnicalAnalysis(
        user(request),
        identifier(request.params, 'occurrenceId'),
        {
          title: request.body.titulo,
          diagnosis: request.body.diagnostico,
          risk: request.body.risco,
          probableCause: request.body.causa_provavel,
          recommendation: request.body.recomendacao,
          recommendsChecklist: request.body.recomenda_checklist,
          recommendsWorkOrder: request.body.recomenda_ordem_servico,
          priority: request.body.prioridade,
          report: request.body.relatorio,
        },
        audit(request),
      ),
    );

  requestParameterAction = async (request: FastifyRequest<{ Body: ParameterActionRequestBody }>) =>
    successEnvelope(
      request,
      'monitoring.parameter-action.request',
      await this.service.requestParameterAction(
        user(request),
        {
          readingId: request.body.leitura_id,
          requestType: request.body.tipo_solicitacao,
          priority: request.body.prioridade,
          observation: request.body.observacao,
          probableCause: request.body.causa_provavel,
          risk: request.body.risco,
          proposedMinimum: request.body.limite_minimo_proposto,
          proposedMaximum: request.body.limite_maximo_proposto,
        },
        audit(request),
      ),
    );

  listStops = async (request: FastifyRequest<{ Querystring: StopQuery }>) =>
    successEnvelope(
      request,
      'maintenance.stops.list',
      await this.service.listStops(user(request), {
        search: request.query.busca?.trim() ?? '',
        status: request.query.status ?? null,
        assetId: request.query.ativo_id ?? null,
        openedOnly: request.query.somente_abertas ?? false,
        limit: request.query.limite ?? 50,
      }),
    );

  getStop = async (request: FastifyRequest<{ Params: Params }>) =>
    successEnvelope(
      request,
      'maintenance.stops.get',
      await this.service.getStop(user(request), identifier(request.params, 'stopId')),
    );

  createStopTreatment = async (request: FastifyRequest<{ Params: Params }>) =>
    successEnvelope(
      request,
      'maintenance.stops.treatment.create',
      await this.service.createStopTreatment(
        user(request),
        identifier(request.params, 'stopId'),
        audit(request),
      ),
    );

  createStop = async (request: FastifyRequest<{ Body: StopBody }>) =>
    successEnvelope(
      request,
      'maintenance.stops.create',
      await this.service.createStop(
        user(request),
        {
          assetId: request.body.ativo_id,
          componentId: request.body.componente_id,
          origin: request.body.origem,
          stopType: request.body.tipo,
          reason: request.body.motivo,
          startedAt: request.body.iniciada_em,
          returnToleranceMinutes: request.body.tolerancia_retorno_minutos,
        },
        audit(request),
      ),
    );

  transitionStop = async (request: FastifyRequest<{ Params: Params; Body: StopTransitionBody }>) =>
    successEnvelope(
      request,
      'maintenance.stops.transition',
      await this.service.transitionStop(
        user(request),
        identifier(request.params, 'stopId'),
        {
          status: request.body.status,
          returnCategory: request.body.categoria_retorno,
          divergenceJustification: request.body.justificativa_divergencia,
        },
        audit(request),
      ),
    );

  listAlerts = async (request: FastifyRequest<{ Querystring: AlertQuery }>) =>
    successEnvelope(
      request,
      'maintenance.alerts.list',
      await this.service.listAlerts(user(request), {
        search: request.query.busca?.trim() ?? '',
        status: request.query.status ?? null,
        severity: request.query.severidade ?? null,
        assetId: request.query.ativo_id ?? null,
        limit: request.query.limite ?? 50,
      }),
    );

  acknowledgeAlert = async (request: FastifyRequest<{ Params: Params }>) =>
    successEnvelope(
      request,
      'maintenance.alerts.acknowledge',
      await this.service.acknowledgeAlert(
        user(request),
        identifier(request.params, 'alertId'),
        audit(request),
      ),
    );

  createOccurrenceFromAlert = async (
    request: FastifyRequest<{ Params: Params; Body: AlertOccurrenceBody }>,
  ) =>
    successEnvelope(
      request,
      'maintenance.alerts.occurrence.create',
      await this.service.createOccurrenceFromAlert(
        user(request),
        identifier(request.params, 'alertId'),
        {
          ...(request.body.titulo === undefined ? {} : { title: request.body.titulo }),
          ...(request.body.descricao === undefined ? {} : { description: request.body.descricao }),
          equipmentStopped: request.body.equipamento_parado,
        },
        audit(request),
      ),
    );

  listNotifications = async (request: FastifyRequest<{ Querystring: NotificationQuery }>) =>
    successEnvelope(
      request,
      'workflow.notifications.list',
      await this.service.listNotifications(user(request), {
        search: request.query.busca?.trim() ?? '',
        unreadOnly: request.query.somente_nao_lidas ?? false,
        priority: request.query.prioridade ?? null,
        context: request.query.contexto ?? null,
        limit: request.query.limite ?? 50,
      }),
    );

  markNotificationRead = async (request: FastifyRequest<{ Params: Params }>) =>
    successEnvelope(
      request,
      'workflow.notifications.read',
      await this.service.markNotificationRead(
        user(request),
        identifier(request.params, 'notificationId'),
      ),
    );

  dismissNotification = async (request: FastifyRequest<{ Params: Params }>) =>
    successEnvelope(
      request,
      'workflow.notifications.dismiss',
      await this.service.dismissNotification(
        user(request),
        identifier(request.params, 'notificationId'),
      ),
    );

  markAllNotificationsRead = async (request: FastifyRequest) =>
    successEnvelope(
      request,
      'workflow.notifications.read-all',
      await this.service.markAllNotificationsRead(user(request)),
    );

  technicalSummary = async (request: FastifyRequest<{ Querystring: AnalyticsQuery }>) =>
    successEnvelope(
      request,
      'analytics.technical.summary',
      await this.service.technicalSummary(user(request), {
        assetId: request.query.ativo_id ?? null,
        startAt: request.query.inicio,
        endAt: request.query.fim,
        rankingLimit: request.query.limite_ranking ?? 10,
      }),
    );
}
