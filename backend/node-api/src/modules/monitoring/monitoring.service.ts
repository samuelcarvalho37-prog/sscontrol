import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import { AppError } from '../../core/errors/app-error.js';
import type { Database } from '../../infrastructure/database/database.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { MonitoringRepository, type MonitoringRow } from './monitoring.repository.js';
import type {
  AlertListQuery,
  AnalyticsQuery,
  CreateOccurrenceInput,
  CreateStopInput,
  NotificationListQuery,
  OccurrenceListQuery,
  ParameterActionRequestInput,
  RequestAuditMetadata,
  StopListQuery,
  StopStatus,
  TechnicalAnalysisInput,
  TransitionStopInput,
} from './monitoring.types.js';

function appError(code: string, message: string, statusCode: number, details?: unknown): AppError {
  return new AppError({ code, message, statusCode, ...(details === undefined ? {} : { details }) });
}

function text(row: MonitoringRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Campo ${key} ausente no contrato de monitoramento.`);
  }
  return value;
}

function dateTime(row: MonitoringRow, key: string): string {
  const value = row[key];
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string' && !Number.isNaN(new Date(value).getTime())) {
    return new Date(value).toISOString();
  }
  throw new Error(`Campo temporal ${key} ausente no contrato de monitoramento.`);
}

function nullableText(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().replace(/\s+/gu, ' ');
  return normalized.length > 0 ? normalized : null;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

function isoDate(value: string | null, fallback: Date): string {
  const date = value === null ? fallback : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw appError('INVALID_DATE_TIME', 'A data informada não é válida.', 422);
  }
  return date.toISOString();
}

function roleSnapshot(user: AuthenticatedUser): string {
  return user.roles.join(',') || user.profile;
}

const stopTransitions: Readonly<Record<StopStatus, readonly StopStatus[]>> = {
  OPEN: ['WAITING_MAINTENANCE', 'IN_MAINTENANCE', 'CANCELLED'],
  WAITING_MAINTENANCE: ['IN_MAINTENANCE', 'CANCELLED'],
  IN_MAINTENANCE: ['WAITING_OPERATIONAL_RETURN', 'CANCELLED'],
  WAITING_OPERATIONAL_RETURN: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export class MonitoringService {
  private readonly repository = new MonitoringRepository();

  constructor(private readonly database: Database) {}

  async listOccurrences(user: AuthenticatedUser, query: OccurrenceListQuery) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => ({
        itens: await this.repository.listOccurrences(client, query),
        limite: query.limit,
      }),
    );
  }

  async getOccurrence(user: AuthenticatedUser, occurrenceId: string) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => this.requiredOccurrenceDetail(client, occurrenceId),
    );
  }

  async createOccurrence(
    user: AuthenticatedUser,
    rawInput: CreateOccurrenceInput,
    audit: RequestAuditMetadata,
  ) {
    const input: CreateOccurrenceInput = {
      ...rawInput,
      occurrenceType: normalize(rawInput.occurrenceType).toUpperCase(),
      title: normalize(rawInput.title),
      description: rawInput.description.trim(),
      stopType: nullableText(rawInput.stopType)?.toUpperCase() ?? null,
      stopReason: nullableText(rawInput.stopReason),
      occurredAt: isoDate(rawInput.occurredAt, new Date()),
    };
    if (input.equipmentStopped && (!input.stopType || !input.stopReason)) {
      throw appError(
        'STOP_CONTEXT_REQUIRED',
        'Uma ocorrência com equipamento parado exige tipo e motivo da parada.',
        422,
      );
    }

    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        await this.requireActiveAssetContext(client, input.assetId, input.componentId);
        const occurrenceId = randomUUID();
        await this.repository.createOccurrence(
          client,
          user.tenantId,
          occurrenceId,
          user.id,
          roleSnapshot(user),
          input,
        );

        let stopId: string | null = null;
        if (input.equipmentStopped) {
          const existingStop = await this.repository.findOpenStopForAsset(
            client,
            input.assetId,
            true,
          );
          if (existingStop) {
            stopId = text(existingStop, 'id');
          } else {
            stopId = randomUUID();
            await this.repository.createStop(client, user.tenantId, stopId, user.id, {
              assetId: input.assetId,
              componentId: input.componentId,
              origin: 'OCCURRENCE',
              stopType: input.stopType ?? 'UNPLANNED',
              reason: input.stopReason ?? input.description,
              startedAt: input.occurredAt ?? new Date().toISOString(),
              returnToleranceMinutes: 10,
            });
          }
          await this.repository.attachStopToOccurrence(client, occurrenceId, stopId);
        }

        const detail = await this.requiredOccurrenceDetail(client, occurrenceId);
        await this.repository.writeHistory(
          client,
          user.tenantId,
          input.assetId,
          input.componentId,
          user.id,
          roleSnapshot(user),
          'OCCURRENCE_REPORTED',
          `Ocorrência registrada: ${input.title}`,
          { occurrenceId, stopId, severity: input.severity },
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'OPERATIONAL_OCCURRENCE_CREATED',
          'OPERATIONAL_OCCURRENCE',
          occurrenceId,
          detail,
        );
        await this.notifyRoles(client, user, {
          type: 'OCCURRENCE_REPORTED',
          title: input.title,
          message: input.description,
          entityType: 'OPERATIONAL_OCCURRENCE',
          entityId: occurrenceId,
          priority: input.severity,
          actionRoute: `/maintenance/occurrences/${occurrenceId}`,
          deduplicationKey: `occurrence:${occurrenceId}:reported`,
          roles: ['ADMIN', 'MANAGER'],
        });
        return detail;
      },
    );
  }

  async createTechnicalAnalysis(
    user: AuthenticatedUser,
    occurrenceId: string,
    rawInput: TechnicalAnalysisInput,
    audit: RequestAuditMetadata,
  ) {
    const input: TechnicalAnalysisInput = {
      ...rawInput,
      title: normalize(rawInput.title),
      diagnosis: rawInput.diagnosis.trim(),
      risk: rawInput.risk.trim(),
      probableCause: nullableText(rawInput.probableCause),
      recommendation: rawInput.recommendation.trim(),
    };
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const occurrence = await this.repository.findOccurrence(client, occurrenceId, true);
        if (!occurrence) {
          throw appError('OCCURRENCE_NOT_FOUND', 'Ocorrência não encontrada.', 404);
        }
        const status = text(occurrence, 'status');
        if (['RESOLVED', 'CLOSED', 'CANCELLED'].includes(status)) {
          throw appError(
            'OCCURRENCE_ALREADY_CLOSED',
            'A ocorrência encerrada não aceita uma nova análise.',
            409,
          );
        }
        if (occurrence.technical_analysis_id !== null) {
          throw appError(
            'TECHNICAL_ANALYSIS_ALREADY_EXISTS',
            'A ocorrência já possui análise técnica encaminhada.',
            409,
          );
        }
        const context = await this.repository.technicalContext(client, user.id);
        if (!context) {
          throw appError(
            'TECHNICAL_ASSIGNMENT_REQUIRED',
            'O usuário precisa de uma atribuição técnica ativa para emitir a análise.',
            403,
          );
        }
        const analysisId = randomUUID();
        await this.repository.createTechnicalAnalysis(
          client,
          user.tenantId,
          analysisId,
          occurrence,
          user.id,
          text(context, 'technical_area_id'),
          typeof context.technical_role_id === 'string' ? context.technical_role_id : null,
          input,
        );
        const detail = await this.requiredOccurrenceDetail(client, occurrenceId);
        await this.repository.writeHistory(
          client,
          user.tenantId,
          text(occurrence, 'asset_id'),
          typeof occurrence.component_id === 'string' ? occurrence.component_id : null,
          user.id,
          roleSnapshot(user),
          'TECHNICAL_ANALYSIS_SENT',
          `Análise técnica enviada ao Administrador: ${input.title}`,
          { occurrenceId, analysisId, recommendsChecklist: input.recommendsChecklist },
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'TECHNICAL_ANALYSIS_SENT_TO_ADMIN',
          'TECHNICAL_ANALYSIS',
          analysisId,
          detail,
        );
        await this.notifyRoles(client, user, {
          type: 'TECHNICAL_ANALYSIS_SENT',
          title: input.title,
          message: input.recommendation,
          entityType: 'TECHNICAL_ANALYSIS',
          entityId: analysisId,
          priority: input.priority,
          actionRoute: `/workflow/technical-analyses/${analysisId}`,
          deduplicationKey: `technical-analysis:${analysisId}:sent`,
          roles: ['ADMIN'],
        });
        return detail;
      },
    );
  }

  async requestParameterAction(
    user: AuthenticatedUser,
    rawInput: ParameterActionRequestInput,
    audit: RequestAuditMetadata,
  ) {
    const input: ParameterActionRequestInput = {
      ...rawInput,
      observation: nullableText(rawInput.observation),
      probableCause: nullableText(rawInput.probableCause),
      risk: nullableText(rawInput.risk),
    };
    if (
      input.requestType === 'LIMIT_ADJUSTMENT' &&
      input.proposedMinimum === null &&
      input.proposedMaximum === null
    ) {
      throw appError(
        'PROPOSED_LIMIT_REQUIRED',
        'Informe ao menos um limite proposto para solicitar a revisão da faixa.',
        422,
      );
    }
    if (
      input.proposedMinimum !== null &&
      input.proposedMaximum !== null &&
      input.proposedMinimum > input.proposedMaximum
    ) {
      throw appError(
        'PROPOSED_LIMIT_RANGE_INVALID',
        'O limite mínimo proposto não pode ser maior que o limite máximo.',
        422,
      );
    }

    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const reading = await this.repository.findParameterReadingContext(
          client,
          input.readingId,
          true,
        );
        if (!reading) {
          throw appError(
            'PARAMETER_READING_NOT_FOUND',
            'A leitura selecionada não foi encontrada.',
            404,
          );
        }
        if (reading.asset_status !== 'ACTIVE' || reading.parameter_status !== 'ACTIVE') {
          throw appError(
            'PARAMETER_CONTEXT_NOT_ACTIVE',
            'O ativo ou o parâmetro da leitura não está ativo.',
            409,
          );
        }
        if (reading.component_id !== null && reading.component_status !== 'ACTIVE') {
          throw appError(
            'PARAMETER_COMPONENT_NOT_ACTIVE',
            'O componente da leitura não está ativo.',
            409,
          );
        }

        const previous = await this.repository.findParameterActionRequest(
          client,
          input.readingId,
          input.requestType,
        );
        if (previous) {
          const occurrenceId = text(previous, 'id');
          const detail = await this.requiredOccurrenceDetail(client, occurrenceId);
          return {
            requested: true,
            already_requested: true,
            tipo_solicitacao: input.requestType,
            status_parametro: this.parameterStatus(reading.classification),
            ocorrencia: detail,
            analise: {
              id: text(previous, 'technical_analysis_id'),
              status: 'SENT_TO_ADMIN',
            },
          };
        }

        const context = await this.repository.technicalContext(client, user.id);
        if (!context) {
          throw appError(
            'TECHNICAL_ASSIGNMENT_REQUIRED',
            'O usuário precisa de uma atribuição técnica ativa para solicitar a ação.',
            403,
          );
        }
        const classification = this.parameterStatus(reading.classification);
        const priority = input.priority ?? (classification === 'NORMAL' ? 'MEDIUM' : 'HIGH');
        const labels = {
          INSPECTION: 'Solicitar inspeção',
          CHECKLIST: 'Solicitar checklist',
          LIMIT_ADJUSTMENT: 'Revisar limites',
        } as const;
        const requestLabel = labels[input.requestType];
        const parameterName = text(reading, 'parameter_name');
        const assetLabel = `${text(reading, 'asset_tag')} · ${text(reading, 'asset_name')}`;
        const value = this.parameterValue(reading);
        const unit = typeof reading.unit === 'string' ? reading.unit : '';
        const valueLabel = `${value}${unit ? ` ${unit}` : ''}`;
        const minimum = reading.warning_min ?? reading.critical_min ?? null;
        const maximum = reading.warning_max ?? reading.critical_max ?? null;
        const range = [
          minimum === null ? null : `mínimo ${this.parameterLimit(minimum)}`,
          maximum === null ? null : `máximo ${this.parameterLimit(maximum)}`,
        ].filter((item): item is string => item !== null);
        const description =
          input.observation ??
          `A leitura de ${parameterName} em ${valueLabel} requer avaliação administrativa.`;
        const recommendation =
          input.requestType === 'CHECKLIST'
            ? 'Criar um checklist de inspeção para confirmar a causa, registrar evidências e validar o retorno à faixa esperada.'
            : input.requestType === 'INSPECTION'
              ? 'Programar uma inspeção técnica para confirmar a condição e definir o tratamento.'
              : 'Revisar tecnicamente os limites propostos antes de alterar a configuração mestre.';
        const probableCause =
          input.probableCause ?? 'A confirmar por inspeção técnica no equipamento.';
        const risk =
          input.risk ??
          (classification === 'NORMAL'
            ? 'A tendência deve ser confirmada antes de qualquer alteração operacional.'
            : 'A leitura fora da faixa pode indicar degradação ou condição operacional insegura.');

        const occurrenceId = randomUUID();
        await this.repository.createOccurrence(
          client,
          user.tenantId,
          occurrenceId,
          user.id,
          roleSnapshot(user),
          {
            assetId: text(reading, 'asset_id'),
            componentId: typeof reading.component_id === 'string' ? reading.component_id : null,
            occurrenceType: 'TECHNICAL_PARAMETER',
            title: `${requestLabel}: ${parameterName} - ${text(reading, 'asset_tag')}`,
            description,
            severity: priority,
            equipmentStopped: false,
            stopType: null,
            stopReason: null,
            occurredAt: dateTime(reading, 'recorded_at'),
          },
        );
        const occurrence = await this.repository.findOccurrence(client, occurrenceId, true);
        if (!occurrence) throw new Error('A ocorrência técnica criada não foi encontrada.');

        const analysisId = randomUUID();
        const report = {
          situacao: `${parameterName} em ${valueLabel} no ativo ${assetLabel}.`,
          causa_provavel: probableCause,
          resultado_esperado:
            'Confirmar a causa e restabelecer ou validar a faixa operacional segura.',
          riscos: [{ tipo: priority, titulo: 'Parâmetro técnico', descricao: risk }],
          seguranca: [
            'Confirmar a identificação do ativo e a condição segura da área.',
            'Usar instrumento compatível e calibrado para repetir a medição.',
            'Interromper a operação se a leitura representar risco imediato.',
          ],
          nrs: ['NR-12'],
          ferramentas: [{ tipo: 'MEDICAO', nome: `Instrumento compatível com ${parameterName}` }],
          etapas: [
            {
              ordem: 1,
              titulo: 'Confirmar a leitura',
              descricao: 'Repetir a medição e registrar data, condição operacional e evidência.',
            },
            {
              ordem: 2,
              titulo: 'Inspecionar a causa',
              descricao: 'Verificar o componente e os fatores que podem alterar o parâmetro.',
            },
            {
              ordem: 3,
              titulo: 'Definir o tratamento',
              descricao: 'Corrigir, monitorar ou revisar a faixa após avaliação técnica.',
            },
            {
              ordem: 4,
              titulo: 'Validar o resultado',
              descricao: 'Registrar a leitura final e confirmar a condição segura.',
            },
          ],
          evidencias_requeridas: [
            'Leitura inicial',
            'Condição encontrada',
            'Leitura após o tratamento',
          ],
          criterio_aceite: 'Parâmetro confirmado em faixa aprovada e condição segura documentada.',
          parametro_contexto: {
            leitura_id: input.readingId,
            ativo_id: reading.asset_id,
            componente_id: reading.component_id,
            parametro: parameterName,
            valor: value,
            unidade: unit,
            limite_min: minimum,
            limite_max: maximum,
            limite_min_proposto: input.proposedMinimum,
            limite_max_proposto: input.proposedMaximum,
            status: classification,
            registrado_por: reading.recorded_by,
            registrado_em: dateTime(reading, 'recorded_at'),
            tipo_solicitacao: input.requestType,
          },
        };
        await this.repository.createTechnicalAnalysis(
          client,
          user.tenantId,
          analysisId,
          occurrence,
          user.id,
          text(context, 'technical_area_id'),
          typeof context.technical_role_id === 'string' ? context.technical_role_id : null,
          {
            title: `${requestLabel}: ${parameterName} - ${text(reading, 'asset_tag')}`,
            diagnosis: `${parameterName} registrou ${valueLabel}${
              range.length > 0
                ? ` (faixa configurada: ${range.join(', ')}).`
                : ' sem faixa configurada.'
            }`,
            risk,
            probableCause,
            recommendation,
            recommendsChecklist: input.requestType === 'CHECKLIST',
            recommendsWorkOrder: input.requestType === 'INSPECTION',
            priority,
            report,
          },
        );
        const detail = await this.requiredOccurrenceDetail(client, occurrenceId);
        await this.repository.writeHistory(
          client,
          user.tenantId,
          text(reading, 'asset_id'),
          typeof reading.component_id === 'string' ? reading.component_id : null,
          user.id,
          roleSnapshot(user),
          'PARAMETER_ACTION_REQUESTED',
          `${requestLabel}: ${parameterName} em ${valueLabel}.`,
          { readingId: input.readingId, occurrenceId, analysisId, requestType: input.requestType },
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'PARAMETER_ACTION_REQUESTED',
          'TECHNICAL_ANALYSIS',
          analysisId,
          detail,
        );
        await this.notifyRoles(client, user, {
          type: 'PARAMETER_ACTION_REQUESTED',
          title: `${requestLabel}: ${parameterName}`,
          message: description,
          entityType: 'TECHNICAL_ANALYSIS',
          entityId: analysisId,
          priority,
          actionRoute: `/workflow/technical-analyses/${analysisId}`,
          deduplicationKey: `parameter-reading:${input.readingId}:${input.requestType}`,
          roles: ['ADMIN'],
        });
        return {
          requested: true,
          already_requested: false,
          tipo_solicitacao: input.requestType,
          status_parametro: classification,
          ocorrencia: detail,
          analise: { id: analysisId, status: 'SENT_TO_ADMIN' },
        };
      },
    );
  }

  async listStops(user: AuthenticatedUser, query: StopListQuery) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => ({
        itens: await this.repository.listStops(client, query),
        limite: query.limit,
      }),
    );
  }

  async getStop(user: AuthenticatedUser, stopId: string) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => this.requiredStopDetail(client, stopId),
    );
  }

  async createStopTreatment(user: AuthenticatedUser, stopId: string, audit: RequestAuditMetadata) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const stop = await this.repository.findStop(client, stopId, true);
        if (!stop) throw appError('STOP_NOT_FOUND', 'Parada nÃ£o encontrada.', 404);

        const currentStatus = text(stop, 'status');
        if (['COMPLETED', 'CANCELLED'].includes(currentStatus)) {
          throw appError(
            'STOP_ALREADY_CLOSED',
            'Uma parada encerrada nÃ£o aceita um novo tratamento.',
            409,
          );
        }

        const existing = await this.repository.findOccurrenceByStop(client, stopId);
        if (existing) {
          return {
            created: false,
            already_exists: true,
            parada_id: stopId,
            occurrence: await this.requiredOccurrenceDetail(client, text(existing, 'id')),
          };
        }

        const occurrenceId = randomUUID();
        const reason = text(stop, 'reason');
        await this.repository.createOccurrence(
          client,
          user.tenantId,
          occurrenceId,
          user.id,
          roleSnapshot(user),
          {
            assetId: text(stop, 'asset_id'),
            componentId: typeof stop.component_id === 'string' ? stop.component_id : null,
            occurrenceType: 'EQUIPMENT_STOP_TREATMENT',
            title: 'Tratar parada tÃ©cnica',
            description: reason,
            severity: 'CRITICAL',
            equipmentStopped: true,
            stopType: text(stop, 'stop_type'),
            stopReason: reason,
            occurredAt: dateTime(stop, 'started_at'),
          },
        );
        await this.repository.attachStopToOccurrence(client, occurrenceId, stopId);
        const occurrence = await this.requiredOccurrenceDetail(client, occurrenceId);
        await this.repository.writeHistory(
          client,
          user.tenantId,
          text(stop, 'asset_id'),
          typeof stop.component_id === 'string' ? stop.component_id : null,
          user.id,
          roleSnapshot(user),
          'STOP_TREATMENT_STARTED',
          'Tratamento tÃ©cnico iniciado a partir da parada aberta.',
          { stopId, occurrenceId },
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'STOP_TREATMENT_CREATED',
          'OPERATIONAL_OCCURRENCE',
          occurrenceId,
          occurrence,
        );
        await this.notifyRoles(client, user, {
          type: 'STOP_TREATMENT_STARTED',
          title: 'Parada em tratamento',
          message: reason,
          entityType: 'OPERATIONAL_OCCURRENCE',
          entityId: occurrenceId,
          priority: 'CRITICAL',
          actionRoute: `/maintenance/occurrences/${occurrenceId}`,
          deduplicationKey: `equipment-stop:${stopId}:treatment`,
          roles: ['ADMIN', 'MANAGER'],
        });
        return {
          created: true,
          already_exists: false,
          parada_id: stopId,
          occurrence,
        };
      },
    );
  }

  async createStop(
    user: AuthenticatedUser,
    rawInput: CreateStopInput,
    audit: RequestAuditMetadata,
  ) {
    const input: CreateStopInput = {
      ...rawInput,
      origin: normalize(rawInput.origin).toUpperCase(),
      stopType: normalize(rawInput.stopType).toUpperCase(),
      reason: rawInput.reason.trim(),
      startedAt: isoDate(rawInput.startedAt, new Date()),
    };
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        await this.requireActiveAssetContext(client, input.assetId, input.componentId);
        const existing = await this.repository.findOpenStopForAsset(client, input.assetId, true);
        if (existing) {
          const detail = await this.requiredStopDetail(client, String(existing.id));
          return { ...detail, ja_aberta: true };
        }
        const stopId = randomUUID();
        await this.repository.createStop(client, user.tenantId, stopId, user.id, input);
        const detail = await this.requiredStopDetail(client, stopId);
        await this.repository.writeHistory(
          client,
          user.tenantId,
          input.assetId,
          input.componentId,
          user.id,
          roleSnapshot(user),
          'EQUIPMENT_STOP_OPENED',
          `Parada técnica aberta: ${input.reason}`,
          { stopId, origin: input.origin, stopType: input.stopType },
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'EQUIPMENT_STOP_CREATED',
          'EQUIPMENT_STOP',
          stopId,
          detail,
        );
        await this.notifyRoles(client, user, {
          type: 'EQUIPMENT_STOP_OPENED',
          title: 'Equipamento indisponível',
          message: input.reason,
          entityType: 'EQUIPMENT_STOP',
          entityId: stopId,
          priority: 'CRITICAL',
          actionRoute: `/maintenance/stops/${stopId}`,
          deduplicationKey: `equipment-stop:${stopId}:opened`,
          roles: ['ADMIN', 'MANAGER'],
        });
        return detail;
      },
    );
  }

  async transitionStop(
    user: AuthenticatedUser,
    stopId: string,
    rawInput: TransitionStopInput,
    audit: RequestAuditMetadata,
  ) {
    const input: TransitionStopInput = {
      ...rawInput,
      returnCategory: nullableText(rawInput.returnCategory)?.toUpperCase() ?? null,
      divergenceJustification: nullableText(rawInput.divergenceJustification),
    };
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const stop = await this.repository.findStop(client, stopId, true);
        if (!stop) throw appError('STOP_NOT_FOUND', 'Parada não encontrada.', 404);
        const current = text(stop, 'status') as StopStatus;
        if (!stopTransitions[current].includes(input.status)) {
          throw appError(
            'INVALID_STOP_TRANSITION',
            `A transição ${current} → ${input.status} não é permitida.`,
            409,
          );
        }
        if (input.status === 'COMPLETED' && !input.returnCategory) {
          throw appError(
            'RETURN_CATEGORY_REQUIRED',
            'A conclusão da parada exige a categoria do retorno operacional.',
            422,
          );
        }
        await this.repository.transitionStop(client, stopId, user.id, input);
        if (input.status === 'COMPLETED') {
          await this.repository.resolveEntitiesLinkedToStop(client, stopId, user.id);
        }
        const detail = await this.requiredStopDetail(client, stopId);
        await this.repository.writeHistory(
          client,
          user.tenantId,
          text(stop, 'asset_id'),
          typeof stop.component_id === 'string' ? stop.component_id : null,
          user.id,
          roleSnapshot(user),
          'EQUIPMENT_STOP_TRANSITIONED',
          `Parada técnica movimentada de ${current} para ${input.status}.`,
          { stopId, previousStatus: current, status: input.status },
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'EQUIPMENT_STOP_TRANSITIONED',
          'EQUIPMENT_STOP',
          stopId,
          detail,
        );
        if (input.status === 'COMPLETED') {
          await this.notifyRoles(client, user, {
            type: 'EQUIPMENT_RETURNED_TO_OPERATION',
            title: 'Equipamento liberado para operação',
            message: `A parada ${stopId} foi concluída com retorno operacional confirmado.`,
            entityType: 'EQUIPMENT_STOP',
            entityId: stopId,
            priority: 'INFO',
            actionRoute: `/maintenance/stops/${stopId}`,
            deduplicationKey: `equipment-stop:${stopId}:completed`,
            roles: ['ADMIN', 'MANAGER'],
          });
        }
        return detail;
      },
    );
  }

  async listAlerts(user: AuthenticatedUser, query: AlertListQuery) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => ({
        itens: await this.repository.listAlerts(client, query),
        limite: query.limit,
      }),
    );
  }

  async acknowledgeAlert(user: AuthenticatedUser, alertId: string, audit: RequestAuditMetadata) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const alert = await this.repository.findAlert(client, alertId, true);
        if (!alert) throw appError('ALERT_NOT_FOUND', 'Alerta não encontrado.', 404);
        if (text(alert, 'status') !== 'OPEN') {
          throw appError('ALERT_NOT_OPEN', 'Somente um alerta aberto pode ser reconhecido.', 409);
        }
        await this.repository.acknowledgeAlert(client, alertId, user.id);
        const after = await this.repository.findAlert(client, alertId);
        if (!after) throw appError('ALERT_NOT_FOUND', 'Alerta não encontrado.', 404);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'OPERATIONAL_ALERT_ACKNOWLEDGED',
          'OPERATIONAL_ALERT',
          alertId,
          after,
        );
        return after;
      },
    );
  }

  async createOccurrenceFromAlert(
    user: AuthenticatedUser,
    alertId: string,
    input: {
      readonly title?: string;
      readonly description?: string;
      readonly equipmentStopped: boolean;
    },
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const alert = await this.repository.findAlert(client, alertId, true);
        if (!alert) throw appError('ALERT_NOT_FOUND', 'Alerta não encontrado.', 404);
        if (alert.occurrence_id !== null) {
          throw appError(
            'ALERT_ALREADY_LINKED',
            'O alerta já está vinculado a uma ocorrência.',
            409,
            { occurrenceId: alert.occurrence_id },
          );
        }
        if (['RESOLVED', 'DISMISSED'].includes(text(alert, 'status'))) {
          throw appError(
            'ALERT_ALREADY_CLOSED',
            'O alerta encerrado não pode gerar ocorrência.',
            409,
          );
        }
        const occurrenceId = randomUUID();
        const occurrenceInput: CreateOccurrenceInput = {
          assetId: text(alert, 'asset_id'),
          componentId: typeof alert.component_id === 'string' ? alert.component_id : null,
          occurrenceType: `ALERT_${text(alert, 'alert_type')}`,
          title: normalize(input.title ?? text(alert, 'title')),
          description: (input.description ?? text(alert, 'message')).trim(),
          severity:
            text(alert, 'severity') === 'INFO'
              ? 'LOW'
              : (text(alert, 'severity') as CreateOccurrenceInput['severity']),
          equipmentStopped: input.equipmentStopped,
          stopType: input.equipmentStopped ? 'TECHNICAL_ALERT' : null,
          stopReason: input.equipmentStopped ? text(alert, 'message') : null,
          occurredAt: dateTime(alert, 'first_detected_at'),
        };
        await this.repository.createOccurrence(
          client,
          user.tenantId,
          occurrenceId,
          user.id,
          roleSnapshot(user),
          occurrenceInput,
        );
        let stopId: string | null = null;
        if (input.equipmentStopped) {
          const existing = await this.repository.findOpenStopForAsset(
            client,
            occurrenceInput.assetId,
            true,
          );
          if (existing) {
            stopId = text(existing, 'id');
          } else {
            stopId = randomUUID();
            await this.repository.createStop(client, user.tenantId, stopId, user.id, {
              assetId: occurrenceInput.assetId,
              componentId: occurrenceInput.componentId,
              origin: 'ALERT',
              stopType: 'TECHNICAL_ALERT',
              reason: occurrenceInput.stopReason ?? occurrenceInput.description,
              startedAt: occurrenceInput.occurredAt ?? new Date().toISOString(),
              returnToleranceMinutes: 10,
            });
          }
          await this.repository.attachStopToOccurrence(client, occurrenceId, stopId);
        }
        await this.repository.linkAlertOccurrence(client, alertId, occurrenceId, stopId);
        const detail = await this.requiredOccurrenceDetail(client, occurrenceId);
        await this.repository.writeHistory(
          client,
          user.tenantId,
          occurrenceInput.assetId,
          occurrenceInput.componentId,
          user.id,
          roleSnapshot(user),
          'ALERT_CONVERTED_TO_OCCURRENCE',
          `Alerta convertido em ocorrência: ${occurrenceInput.title}`,
          { alertId, occurrenceId, stopId },
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'OPERATIONAL_ALERT_CONVERTED',
          'OPERATIONAL_ALERT',
          alertId,
          detail,
        );
        await this.notifyRoles(client, user, {
          type: 'ALERT_CONVERTED_TO_OCCURRENCE',
          title: occurrenceInput.title,
          message: occurrenceInput.description,
          entityType: 'OPERATIONAL_OCCURRENCE',
          entityId: occurrenceId,
          priority: occurrenceInput.severity,
          actionRoute: `/maintenance/occurrences/${occurrenceId}`,
          deduplicationKey: `alert:${alertId}:occurrence`,
          roles: ['ADMIN', 'MANAGER'],
        });
        return detail;
      },
    );
  }

  async listNotifications(user: AuthenticatedUser, query: NotificationListQuery) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => ({
        itens: await this.repository.listNotifications(client, user.id, query),
        contadores: await this.repository.notificationCounters(client, user.id),
        limite: query.limit,
      }),
    );
  }

  async markNotificationRead(user: AuthenticatedUser, notificationId: string) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const updated = await this.repository.markNotificationRead(client, notificationId, user.id);
        if (!updated) {
          throw appError(
            'NOTIFICATION_NOT_FOUND',
            'Notificação não encontrada para o usuário.',
            404,
          );
        }
        return { notificacao_id: notificationId, lida: true };
      },
    );
  }

  async dismissNotification(user: AuthenticatedUser, notificationId: string) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const updated = await this.repository.dismissNotification(client, notificationId, user.id);
        if (!updated) {
          throw appError(
            'NOTIFICATION_NOT_FOUND',
            'Notificação não encontrada para o usuário.',
            404,
          );
        }
        return { notificacao_id: notificationId, dispensada: true };
      },
    );
  }

  async markAllNotificationsRead(user: AuthenticatedUser) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => ({
        atualizadas: await this.repository.markAllNotificationsRead(client, user.id),
      }),
    );
  }

  async technicalSummary(user: AuthenticatedUser, query: AnalyticsQuery) {
    const start = new Date(query.startAt);
    const end = new Date(query.endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
      throw appError('INVALID_ANALYTICS_PERIOD', 'O período dos indicadores é inválido.', 422);
    }
    const maximumWindowMs = 5 * 366 * 24 * 60 * 60 * 1_000;
    if (end.getTime() - start.getTime() > maximumWindowMs) {
      throw appError('ANALYTICS_PERIOD_TOO_LONG', 'O período máximo é de cinco anos.', 422);
    }
    const normalizedQuery = { ...query, startAt: start.toISOString(), endAt: end.toISOString() };
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        if (query.assetId) await this.requireActiveAssetContext(client, query.assetId, null);
        return {
          periodo: { inicio: normalizedQuery.startAt, fim: normalizedQuery.endAt },
          resumo: await this.repository.technicalSummary(client, normalizedQuery),
          ranking_ativos: await this.repository.assetRanking(client, normalizedQuery),
        };
      },
    );
  }

  private async requireActiveAssetContext(
    client: PoolClient,
    assetId: string,
    componentId: string | null,
  ): Promise<MonitoringRow> {
    const context = await this.repository.findAssetContext(client, assetId, componentId);
    if (context?.asset_lifecycle_status !== 'ACTIVE') {
      throw appError('ASSET_NOT_ACTIVE', 'O ativo informado não existe ou não está ativo.', 422);
    }
    if (componentId && context.component_id !== componentId) {
      throw appError(
        'COMPONENT_ASSET_MISMATCH',
        'O componente informado não pertence ao ativo selecionado.',
        422,
      );
    }
    if (componentId && context.component_lifecycle_status !== 'ACTIVE') {
      throw appError('COMPONENT_NOT_ACTIVE', 'O componente informado não está ativo.', 422);
    }
    return context;
  }

  private async requiredOccurrenceDetail(
    client: PoolClient,
    occurrenceId: string,
  ): Promise<MonitoringRow> {
    const detail = await this.repository.getOccurrenceDetail(client, occurrenceId);
    if (!detail) throw appError('OCCURRENCE_NOT_FOUND', 'Ocorrência não encontrada.', 404);
    return detail;
  }

  private async requiredStopDetail(client: PoolClient, stopId: string): Promise<MonitoringRow> {
    const detail = await this.repository.getStopDetail(client, stopId);
    if (!detail) throw appError('STOP_NOT_FOUND', 'Parada não encontrada.', 404);
    return detail;
  }

  private parameterStatus(value: unknown): string {
    const classification = typeof value === 'string' ? value : 'UNCLASSIFIED';
    if (classification.endsWith('_HIGH')) return 'ACIMA_LIMITE';
    if (classification.endsWith('_LOW')) return 'ABAIXO_LIMITE';
    return classification === 'NORMAL' ? 'NORMAL' : 'SEM_FAIXA';
  }

  private parameterValue(reading: MonitoringRow): string | number | boolean {
    if (reading.numeric_value !== null && reading.numeric_value !== undefined) {
      const numeric = Number(reading.numeric_value);
      if (Number.isFinite(numeric)) return numeric;
    }
    if (typeof reading.text_value === 'string') return reading.text_value;
    if (typeof reading.boolean_value === 'boolean') return reading.boolean_value;
    throw new Error('A leitura técnica não contém um valor válido.');
  }

  private parameterLimit(value: unknown): string | number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') return value;
    throw new Error('A política do parâmetro contém um limite inválido.');
  }

  private async notifyRoles(
    client: PoolClient,
    user: AuthenticatedUser,
    input: {
      readonly type: string;
      readonly title: string;
      readonly message: string;
      readonly entityType: string;
      readonly entityId: string;
      readonly priority: string;
      readonly actionRoute: string;
      readonly deduplicationKey: string;
      readonly roles: readonly string[];
    },
  ): Promise<void> {
    const notificationId = await this.repository.createNotification(client, user.tenantId, {
      type: input.type,
      title: input.title,
      message: input.message,
      entityType: input.entityType,
      entityId: input.entityId,
      priority: input.priority,
      actionRoute: input.actionRoute,
      actionPayload: { entityType: input.entityType, entityId: input.entityId },
      audience: { roleTypes: input.roles },
      deduplicationKey: input.deduplicationKey,
    });
    await this.repository.attachNotificationToRoleTypes(
      client,
      user.tenantId,
      notificationId,
      input.roles,
      user.id,
    );
  }
}
