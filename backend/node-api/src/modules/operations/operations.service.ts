import { createHash, randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import { AppError } from '../../core/errors/app-error.js';
import type { Database } from '../../infrastructure/database/database.js';
import {
  ObjectStorageError,
  type ObjectStorage,
  type StoredObject,
  type StoredObjectReference,
} from '../../infrastructure/storage/object-storage.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { OperationsRepository, type OperationsRow } from './operations.repository.js';
import type {
  ActionReviewInput,
  CompletionInput,
  EvidenceInput,
  EvidenceUploadInput,
  ExecutionBatchItemInput,
  ExecutionStopMode,
  ExecutionResponseInput,
  MaintenanceActionListQuery,
  RequestAuditMetadata,
  ReviewSubmissionInput,
  SignatureInput,
  SignaturePolicy,
  TechnicalDemandListQuery,
  WorkOrderCorrectionInput,
  WorkOrderInput,
  WorkOrderListQuery,
} from './operations.types.js';

function error(code: string, message: string, statusCode: number, details?: unknown): AppError {
  return new AppError({ code, message, statusCode, ...(details === undefined ? {} : { details }) });
}

function text(row: OperationsRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Campo ${key} ausente.`);
  return value;
}

function nullableText(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash('sha256').update(stable(value), 'utf8').digest('hex');
}

function integer(row: OperationsRow, key: string): number {
  const value = row[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number.parseInt(value, 10);
  return 0;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return null;
}

function codeForWorkOrder(): string {
  const now = new Date();
  const timestamp = now
    .toISOString()
    .replaceAll(/[-:TZ.]/g, '')
    .slice(0, 14);
  return `OS-${timestamp}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function eligibleArea(policy: SignaturePolicy, areaCode: string): boolean {
  if (policy === 'QUALIDADE') return areaCode === 'QUALITY';
  if (policy === 'SEGURANCA') return areaCode === 'SAFETY';
  return areaCode === 'QUALITY' || areaCode === 'SAFETY';
}

function normalizedWorkOrder(input: WorkOrderInput): WorkOrderInput {
  return {
    ...input,
    originType: input.originType.trim().toUpperCase(),
    workType: input.workType.trim().toUpperCase(),
    title: input.title.trim(),
    description: input.description.trim(),
    scheduledFor: input.scheduledFor,
  };
}

function normalizedCorrection(input: WorkOrderCorrectionInput): WorkOrderCorrectionInput {
  return {
    ...input,
    title: input.title.trim(),
    description: input.description.trim(),
  };
}

function workOrderHash(
  id: string,
  code: string,
  input: WorkOrderInput,
  context: Readonly<Record<string, unknown>>,
): string {
  return hash({
    id,
    code,
    input,
    context: {
      assetId: context.asset_id,
      componentId: context.component_id,
      planVersionId: context.id,
      checklistVersionId: context.checklist_template_version_id,
    },
  });
}

export class OperationsService {
  private readonly repository = new OperationsRepository();

  constructor(
    private readonly database: Database,
    private readonly objectStorage: ObjectStorage,
  ) {}

  async listWorkOrders(user: AuthenticatedUser, query: WorkOrderListQuery) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => ({
        itens: await this.repository.listWorkOrders(client, query),
        limite: query.limit,
      }),
    );
  }

  async getTechnicalContext(user: AuthenticatedUser) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const assignments = await this.repository.listTechnicalAssignments(client, user.id);
        const catalog = await this.repository.listTechnicalAreasAndRoles(client);
        const primary = assignments[0];
        const canSign = assignments.some((assignment) => assignment.pode_assinar === true);
        const validationMode = assignments.some((assignment) => assignment.area_validacao === true);
        return {
          identidade: {
            usuario_id: user.id,
            nome: user.name,
            perfil: user.profile,
            area_id: typeof primary?.area_id === 'string' ? primary.area_id : '',
            area_nome: typeof primary?.area_nome === 'string' ? primary.area_nome : '',
            cargo_id: typeof primary?.cargo_id === 'string' ? primary.cargo_id : '',
            cargo_nome: typeof primary?.cargo_nome === 'string' ? primary.cargo_nome : '',
            pode_assinar: canSign,
            area_codigo: typeof primary?.area_codigo === 'string' ? primary.area_codigo : '',
            validador_padrao: validationMode,
            especialidades: assignments
              .map((assignment) => assignment.cargo_nome)
              .filter((value): value is string => typeof value === 'string'),
            escopo_ids: assignments
              .map((assignment) => assignment.area_id)
              .filter((value): value is string => typeof value === 'string'),
          },
          areas: catalog.areas,
          cargos: catalog.roles,
          pode_encaminhar: user.profile !== 'OPERADOR',
          pode_assinar: canSign,
          pode_validar: validationMode || user.profile === 'ADMIN',
          modo_trabalho: validationMode ? 'VALIDACAO' : 'ACOMPANHAMENTO',
          politicas_assinatura: [
            { codigo: 'QUALIDADE', nome: 'Qualidade', assinaturas: 1 },
            { codigo: 'SEGURANCA', nome: 'SeguranÃ§a', assinaturas: 1 },
            {
              codigo: 'QUALIDADE_OU_SEGURANCA',
              nome: 'Qualidade ou SeguranÃ§a',
              assinaturas: 1,
            },
            {
              codigo: 'QUALIDADE_E_SEGURANCA',
              nome: 'Qualidade e SeguranÃ§a',
              assinaturas: 2,
            },
          ],
        };
      },
    );
  }

  async listTechnicalDemands(user: AuthenticatedUser, query: TechnicalDemandListQuery) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const demands = await this.repository.listTechnicalDemands(
          client,
          user.id,
          user.profile === 'ADMIN',
          query,
        );
        return { total: demands.length, demandas: demands, limite: query.limit };
      },
    );
  }

  async assumeTechnicalDemand(
    user: AuthenticatedUser,
    demandId: string,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const assumed = await this.repository.assumeTechnicalDemand(client, demandId, user.id);
        if (!assumed) {
          const demand = await this.repository.findDemand(client, demandId);
          if (!demand) throw error('TECHNICAL_DEMAND_NOT_FOUND', 'Demanda nÃ£o encontrada.', 404);
          if (demand.current_responsible_id === user.id) {
            const visible = await this.repository.listTechnicalDemands(
              client,
              user.id,
              user.profile === 'ADMIN',
              { search: '', statuses: [], limit: 300 },
            );
            return {
              assumed: true,
              already_assumed: true,
              demanda: visible.find((row) => row.id === demandId),
            };
          }
          throw error(
            'TECHNICAL_DEMAND_NOT_ELIGIBLE',
            'A demanda nÃ£o estÃ¡ disponÃ­vel para o seu escopo tÃ©cnico.',
            409,
          );
        }
        await this.repository.appendDemandEvent(
          client,
          user.tenantId,
          demandId,
          'ASSUMED',
          user.id,
          null,
          null,
          hash({ demandId, userId: user.id, action: 'ASSUMED' }),
        );
        const visible = await this.repository.listTechnicalDemands(
          client,
          user.id,
          user.profile === 'ADMIN',
          { search: '', statuses: [], limit: 300 },
        );
        const demand = visible.find((row) => row.id === demandId);
        if (!demand) throw error('TECHNICAL_DEMAND_NOT_FOUND', 'Demanda nÃ£o encontrada.', 404);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'TECHNICAL_DEMAND_ASSUMED',
          'TECHNICAL_DEMAND',
          demandId,
          demand,
        );
        return { assumed: true, demanda: demand };
      },
    );
  }

  async getWorkOrder(user: AuthenticatedUser, workOrderId: string) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => this.requiredWorkOrderDetail(client, workOrderId),
    );
  }

  async createWorkOrder(
    user: AuthenticatedUser,
    rawInput: WorkOrderInput,
    audit: RequestAuditMetadata,
  ) {
    const input = normalizedWorkOrder(rawInput);
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const context = await this.repository.findPublishedPlanContext(client, input.planVersionId);
        if (
          context?.status !== 'PUBLISHED' ||
          context.checklist_status !== 'PUBLISHED' ||
          context.lifecycle_status !== 'ACTIVE' ||
          context.asset_status !== 'ACTIVE' ||
          integer(context, 'total_items') < 1
        ) {
          throw error(
            'WORK_ORDER_PLAN_NOT_EXECUTABLE',
            'A OS exige um plano ativo, publicado e vinculado a um checklist com etapas.',
            422,
          );
        }
        if (
          input.responsibleId &&
          !(await this.repository.activeUserExists(client, input.responsibleId))
        ) {
          throw error(
            'WORK_ORDER_RESPONSIBLE_INVALID',
            'O responsável informado não está ativo.',
            422,
          );
        }
        const id = randomUUID();
        const code = codeForWorkOrder();
        const contentHash = workOrderHash(id, code, input, context);
        await this.repository.createWorkOrder(
          client,
          user.tenantId,
          id,
          code,
          user.id,
          input,
          context,
          contentHash,
        );
        const detail = await this.requiredWorkOrderDetail(client, id);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'WORK_ORDER_CREATED',
          'WORK_ORDER',
          id,
          detail,
        );
        return detail;
      },
    );
  }

  async correctWorkOrder(
    user: AuthenticatedUser,
    workOrderId: string,
    rawInput: WorkOrderCorrectionInput,
    audit: RequestAuditMetadata,
  ) {
    const input = normalizedCorrection(rawInput);
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const workOrder = await this.repository.findWorkOrder(client, workOrderId, true);
        if (!workOrder)
          throw error('WORK_ORDER_NOT_FOUND', 'Ordem de serviço não encontrada.', 404);
        if (text(workOrder, 'status') !== 'CHANGES_REQUESTED') {
          throw error(
            'WORK_ORDER_CORRECTION_NOT_ALLOWED',
            'Somente uma OS devolvida pode ser corrigida por esta operação.',
            409,
          );
        }
        if (
          input.responsibleId &&
          !(await this.repository.activeUserExists(client, input.responsibleId))
        ) {
          throw error(
            'WORK_ORDER_RESPONSIBLE_INVALID',
            'O responsável informado não está ativo.',
            422,
          );
        }
        const context = await this.repository.findPublishedPlanContext(
          client,
          text(workOrder, 'maintenance_plan_version_id'),
        );
        if (!context) {
          throw error(
            'WORK_ORDER_PLAN_NOT_EXECUTABLE',
            'O plano vinculado à OS não está mais disponível.',
            409,
          );
        }
        const correctedWorkOrder: WorkOrderInput = {
          planVersionId: text(workOrder, 'maintenance_plan_version_id'),
          originType: text(workOrder, 'origin_type'),
          originEntityId: workOrder.origin_entity_id as string | null,
          workType: text(workOrder, 'work_type'),
          title: input.title,
          description: input.description,
          priority: input.priority,
          responsibleId: input.responsibleId,
          scheduledFor: input.scheduledFor,
          technicalAnalysis: input.technicalAnalysis,
        };
        const contentHash = workOrderHash(
          workOrderId,
          text(workOrder, 'code'),
          correctedWorkOrder,
          context,
        );
        if (contentHash === workOrder.content_hash_sha256) {
          throw error(
            'WORK_ORDER_CORRECTION_REQUIRED',
            'A correção deve alterar o conteúdo técnico antes do reenvio.',
            422,
          );
        }
        const previousDemandId = text(workOrder, 'technical_demand_id');
        await this.repository.correctWorkOrder(client, workOrderId, input, contentHash);
        const detail = await this.requiredWorkOrderDetail(client, workOrderId);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'WORK_ORDER_CORRECTED',
          'WORK_ORDER',
          workOrderId,
          { demanda_anterior_id: previousDemandId, ordem: detail },
        );
        return detail;
      },
    );
  }

  async submitForReview(
    user: AuthenticatedUser,
    workOrderId: string,
    input: ReviewSubmissionInput,
    audit: RequestAuditMetadata,
  ) {
    this.validateSignaturePolicy(input);
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const workOrder = await this.repository.findWorkOrder(client, workOrderId, true);
        if (!workOrder)
          throw error('WORK_ORDER_NOT_FOUND', 'Ordem de serviço não encontrada.', 404);
        if (!['DRAFT', 'CHANGES_REQUESTED'].includes(text(workOrder, 'status'))) {
          throw error(
            'WORK_ORDER_NOT_EDITABLE',
            'A OS não está disponível para envio à validação.',
            409,
          );
        }
        if (workOrder.technical_demand_id !== null) {
          throw error(
            'WORK_ORDER_REVIEW_ALREADY_CREATED',
            'A OS já possui uma demanda técnica vinculada.',
            409,
          );
        }
        const areas = await this.repository.findTechnicalAreas(client);
        const qualityArea = areas.find((area) => area.code === 'QUALITY');
        const safetyArea = areas.find((area) => area.code === 'SAFETY');
        if (!qualityArea || !safetyArea) {
          throw error(
            'VALIDATION_AREAS_NOT_CONFIGURED',
            'As áreas de Qualidade e Segurança devem estar ativas.',
            409,
          );
        }
        const demandId = randomUUID();
        await this.repository.createDemand(
          client,
          user.tenantId,
          demandId,
          workOrder,
          user.id,
          audit.roleSnapshot,
          input,
        );
        if (input.signaturePolicy === 'QUALIDADE') {
          await this.repository.createRequirement(
            client,
            user.tenantId,
            demandId,
            'QUALITY',
            qualityArea.id,
          );
        } else if (input.signaturePolicy === 'SEGURANCA') {
          await this.repository.createRequirement(
            client,
            user.tenantId,
            demandId,
            'SAFETY',
            safetyArea.id,
          );
        } else if (input.signaturePolicy === 'QUALIDADE_E_SEGURANCA') {
          await this.repository.createRequirement(
            client,
            user.tenantId,
            demandId,
            'QUALITY',
            qualityArea.id,
          );
          await this.repository.createRequirement(
            client,
            user.tenantId,
            demandId,
            'SAFETY',
            safetyArea.id,
          );
        }
        await this.repository.attachDemand(client, workOrderId, demandId);
        await this.repository.appendDemandEvent(
          client,
          user.tenantId,
          demandId,
          'SUBMITTED',
          user.id,
          null,
          null,
          text(workOrder, 'content_hash_sha256'),
        );
        const detail = await this.requiredWorkOrderDetail(client, workOrderId);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'WORK_ORDER_SUBMITTED',
          'WORK_ORDER',
          workOrderId,
          detail,
        );
        return detail;
      },
    );
  }

  async signDemand(
    user: AuthenticatedUser,
    demandId: string,
    input: SignatureInput,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const demand = await this.repository.findDemand(client, demandId, true);
        if (!demand)
          throw error('TECHNICAL_DEMAND_NOT_FOUND', 'Demanda técnica não encontrada.', 404);
        if (text(demand, 'status') !== 'AWAITING_SIGNATURE') {
          throw error(
            'TECHNICAL_DEMAND_NOT_SIGNABLE',
            'A demanda não aceita novas assinaturas.',
            409,
          );
        }
        const context = await this.repository.validatorContext(client, user.id);
        const areaCode = context ? text(context, 'area_code') : '';
        if (
          context?.can_sign !== true ||
          !eligibleArea(text(demand, 'signature_policy') as SignaturePolicy, areaCode)
        ) {
          throw error(
            'TECHNICAL_SIGNATURE_NOT_ALLOWED',
            'Seu vínculo técnico não atende à política de assinatura.',
            403,
          );
        }
        const requirement = await this.repository.matchingRequirement(
          client,
          demandId,
          text(context, 'technical_area_id'),
        );
        if (text(demand, 'signature_policy') !== 'QUALIDADE_OU_SEGURANCA' && !requirement) {
          throw error(
            'VALIDATOR_REQUIREMENT_NOT_FOUND',
            'Não existe requisito pendente para sua área técnica.',
            409,
          );
        }
        const declaration = input.declaration.trim();
        const meaning = input.meaning.trim();
        const signatureHash = hash({
          demandId,
          payload: demand.payload_hash_sha256,
          userId: user.id,
          areaId: context.technical_area_id,
          declaration,
          meaning,
          nonce: randomUUID(),
        });
        await this.repository.insertSignature(
          client,
          user.tenantId,
          demand,
          requirement?.id ?? null,
          user.id,
          audit.roleSnapshot,
          text(context, 'technical_area_id'),
          context.technical_role_id as string | null,
          meaning,
          declaration,
          signatureHash,
        );
        const state = await this.repository.demandApprovalState(client, demandId);
        const approved =
          integer(state, 'completed_signature_count') >=
            integer(state, 'required_signature_count') &&
          integer(state, 'pending_requirements') === 0;
        let releasedActionId: string | null = null;
        if (approved) {
          await this.repository.approveDemand(client, demandId, text(demand, 'entity_id'));
          const approvedWorkOrder = await this.repository.findWorkOrder(
            client,
            text(demand, 'entity_id'),
            true,
          );
          if (!approvedWorkOrder) {
            throw error('WORK_ORDER_NOT_FOUND', 'Ordem de serviço não encontrada.', 404);
          }
          releasedActionId = await this.repository.releaseWorkOrder(client, approvedWorkOrder);
        }
        await this.repository.appendDemandEvent(
          client,
          user.tenantId,
          demandId,
          'SIGNED',
          user.id,
          'APPROVED',
          null,
          signatureHash,
        );
        const detail = await this.requiredWorkOrderDetail(client, text(demand, 'entity_id'));
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'TECHNICAL_SIGNATURE_RECORDED',
          'TECHNICAL_DEMAND',
          demandId,
          {
            signature_hash: signatureHash,
            aprovada: approved,
            liberada_automaticamente: approved,
            acao_id: releasedActionId,
          },
        );
        return detail;
      },
    );
  }

  async requestChanges(
    user: AuthenticatedUser,
    demandId: string,
    reason: string,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const demand = await this.repository.findDemand(client, demandId, true);
        if (!demand)
          throw error('TECHNICAL_DEMAND_NOT_FOUND', 'Demanda técnica não encontrada.', 404);
        if (!['AWAITING_SIGNATURE', 'IN_TECHNICAL_REVIEW'].includes(text(demand, 'status'))) {
          throw error(
            'TECHNICAL_DEMAND_NOT_REVIEWABLE',
            'A demanda não aceita solicitação de ajustes.',
            409,
          );
        }
        const context = await this.repository.validatorContext(client, user.id);
        if (
          !context ||
          !eligibleArea(
            text(demand, 'signature_policy') as SignaturePolicy,
            text(context, 'area_code'),
          )
        ) {
          throw error(
            'TECHNICAL_REVIEW_NOT_ALLOWED',
            'Seu vínculo técnico não pode revisar esta demanda.',
            403,
          );
        }
        const normalizedReason = reason.trim();
        await this.repository.requestChanges(client, demandId, text(demand, 'entity_id'));
        await this.repository.appendDemandEvent(
          client,
          user.tenantId,
          demandId,
          'CHANGES_REQUESTED',
          user.id,
          'CHANGES_REQUESTED',
          normalizedReason,
          hash({ demandId, normalizedReason }),
        );
        const detail = await this.requiredWorkOrderDetail(client, text(demand, 'entity_id'));
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'WORK_ORDER_CHANGES_REQUESTED',
          'TECHNICAL_DEMAND',
          demandId,
          { motivo: normalizedReason },
        );
        return detail;
      },
    );
  }

  async releaseWorkOrder(
    user: AuthenticatedUser,
    workOrderId: string,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const workOrder = await this.repository.findWorkOrder(client, workOrderId, true);
        if (!workOrder)
          throw error('WORK_ORDER_NOT_FOUND', 'Ordem de serviço não encontrada.', 404);
        if (text(workOrder, 'status') !== 'APPROVED') {
          throw error(
            'WORK_ORDER_NOT_APPROVED',
            'Somente uma OS tecnicamente aprovada pode ser liberada.',
            409,
          );
        }
        const actionId = await this.repository.releaseWorkOrder(client, workOrder);
        const detail = await this.requiredWorkOrderDetail(client, workOrderId);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'WORK_ORDER_RELEASED',
          'WORK_ORDER',
          workOrderId,
          { acao_id: actionId, ordem: detail },
        );
        return detail;
      },
    );
  }

  async listOperatorActions(user: AuthenticatedUser, limit: number) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => ({
        itens: await this.repository.listOperatorActions(client, user.id, limit),
        limite: limit,
      }),
    );
  }

  async listMaintenanceActions(user: AuthenticatedUser, query: MaintenanceActionListQuery) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const actions = await this.repository.listMaintenanceActions(client, query);
        return { total: actions.length, acoes: actions, limite: query.limit };
      },
    );
  }

  async getMaintenanceAction(user: AuthenticatedUser, actionId: string) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const action = await this.repository.getOperatorActionDetail(client, actionId);
        if (!action) throw error('MAINTENANCE_ACTION_NOT_FOUND', 'AÃ§Ã£o nÃ£o encontrada.', 404);
        const executionId = typeof action.execucao_id === 'string' ? action.execucao_id : null;
        const execution = executionId
          ? await this.repository.getExecutionDetail(client, executionId)
          : null;
        return { acao: action, execucao: execution };
      },
    );
  }

  async getOperatorAction(user: AuthenticatedUser, actionId: string) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const action = await this.repository.getOperatorActionDetail(client, actionId);
        if (!action || !this.operatorCanSeeAction(action, user.id)) {
          throw error('OPERATOR_ACTION_NOT_FOUND', 'Ação operacional não encontrada.', 404);
        }
        const executionId = typeof action.execucao_id === 'string' ? action.execucao_id : null;
        const execution = executionId
          ? await this.requiredExecutionDetail(client, executionId)
          : null;
        return { acao: action, execucao: execution };
      },
    );
  }

  async startOperatorAction(
    user: AuthenticatedUser,
    actionId: string,
    stopMode: ExecutionStopMode,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const action = await this.repository.findAction(client, actionId, true);
        if (!action) {
          throw error('OPERATOR_ACTION_NOT_FOUND', 'Ação operacional não encontrada.', 404);
        }
        if (action.responsible_id !== null && action.responsible_id !== user.id) {
          throw error(
            'OPERATOR_ACTION_ASSIGNED_TO_ANOTHER_USER',
            'A ação está atribuída a outro usuário.',
            403,
          );
        }

        const actionStatus = text(action, 'status');
        let execution = await this.repository.findExecutionByAction(client, actionId, true);
        if (actionStatus === 'READY') {
          if (execution && !['COMPLETED', 'CANCELLED'].includes(text(execution, 'status'))) {
            throw error(
              'OPERATOR_ACTION_EXECUTION_CONFLICT',
              'A ação possui uma execução incompatível com seu estado atual.',
              409,
            );
          }
          const actionDetail = await this.repository.getOperatorActionDetail(client, actionId);
          const checklist = Array.isArray(actionDetail?.checklist_itens)
            ? actionDetail.checklist_itens
            : [];
          if (checklist.length === 0) {
            throw error(
              'OPERATOR_ACTION_WITHOUT_CHECKLIST',
              'A ação não pode ser iniciada sem checklist publicado e com etapas ativas.',
              422,
            );
          }
          const executionId = randomUUID();
          await this.repository.createExecution(
            client,
            user.tenantId,
            executionId,
            action,
            user.id,
          );
          execution = await this.repository.findExecution(client, executionId, true);
        } else if (actionStatus !== 'IN_PROGRESS') {
          throw error(
            'OPERATOR_ACTION_NOT_EXECUTABLE',
            'A ação não está disponível para início ou retomada.',
            409,
          );
        }

        if (!execution) {
          throw error(
            'OPERATOR_ACTION_EXECUTION_MISSING',
            'A ação em andamento não possui uma execução válida.',
            409,
          );
        }
        if (execution.operator_id !== user.id) {
          throw error(
            'EXECUTION_OWNERSHIP_REQUIRED',
            'Somente o Operador responsável pode retomar esta execução.',
            403,
          );
        }

        const executionStatus = text(execution, 'status');
        const alreadyStarted = executionStatus === 'IN_PROGRESS';
        if (executionStatus === 'OPEN') {
          await this.repository.startExecution(client, execution.id, stopMode);
        } else if (!alreadyStarted) {
          throw error(
            'EXECUTION_NOT_STARTABLE',
            'A execução não está em um estado que permita início ou retomada.',
            409,
          );
        }

        const detail = await this.requiredExecutionDetail(client, execution.id);
        if (!alreadyStarted) {
          await this.repository.writeAudit(
            client,
            user.tenantId,
            user.id,
            audit,
            'OPERATOR_ACTION_STARTED',
            'EXECUTION',
            execution.id,
            detail,
          );
        }
        return { iniciada: true, ja_iniciada: alreadyStarted, execucao: detail };
      },
    );
  }

  async saveOperatorResponses(
    user: AuthenticatedUser,
    actionId: string,
    inputs: readonly ExecutionBatchItemInput[],
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const { execution } = await this.ownedActionExecution(client, actionId, user.id, true);
        if (text(execution, 'status') !== 'IN_PROGRESS') {
          throw error(
            'EXECUTION_NOT_IN_PROGRESS',
            'Inicie a execução antes de responder o checklist.',
            409,
          );
        }
        const uniqueIds = new Set(inputs.map((item) => item.itemId));
        if (uniqueIds.size !== inputs.length) {
          throw error(
            'EXECUTION_BATCH_DUPLICATE_ITEM',
            'O mesmo item não pode aparecer duas vezes no lote.',
            422,
          );
        }

        const saved: Readonly<Record<string, unknown>>[] = [];
        for (const input of inputs) {
          const item = await this.repository.findExecutionItem(
            client,
            execution.id,
            input.itemId,
            true,
          );
          if (!item) {
            throw error(
              'EXECUTION_ITEM_NOT_FOUND',
              'Uma das etapas informadas não pertence à execução.',
              404,
              { item_id: input.itemId },
            );
          }
          const response = this.normalizeBatchResponse(item, input);
          const validation = this.validateResponse(item, response);
          await this.repository.answerExecutionItem(
            client,
            input.itemId,
            user.id,
            response,
            validation.status,
            validation.compliant,
            validation.message,
          );
          if (item.parameter_definition_id !== null && response.numberValue !== null) {
            await this.repository.insertParameterReading(
              client,
              user.tenantId,
              execution.id,
              item,
              user.id,
              response.numberValue,
              validation.classification,
            );
          }
          saved.push({
            item_id: input.itemId,
            status: validation.status,
            conforme: validation.compliant,
            mensagem_validacao: validation.message,
          });
        }

        const detail = await this.requiredExecutionDetail(client, execution.id);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'EXECUTION_RESPONSES_SAVED',
          'EXECUTION',
          execution.id,
          { quantidade: saved.length, itens: saved },
        );
        return {
          acao_id: actionId,
          execucao_id: execution.id,
          salvos: saved,
          quantidade_salva: saved.length,
          execucao: detail,
        };
      },
    );
  }

  async validateOperatorActionCompletion(user: AuthenticatedUser, actionId: string) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const { execution } = await this.ownedActionExecution(client, actionId, user.id, false);
        const blockers = await this.repository.blockingExecutionItems(client, execution.id);
        const detail = await this.requiredExecutionDetail(client, execution.id);
        return this.completionState(execution, blockers, detail);
      },
    );
  }

  async completeOperatorAction(
    user: AuthenticatedUser,
    actionId: string,
    input: CompletionInput,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const { execution } = await this.ownedActionExecution(client, actionId, user.id, true);
        if (text(execution, 'status') !== 'IN_PROGRESS') {
          throw error(
            'EXECUTION_NOT_IN_PROGRESS',
            'Somente uma execução em andamento pode ser concluída.',
            409,
          );
        }
        const blockers = await this.repository.blockingExecutionItems(client, execution.id);
        const state = this.completionState(
          execution,
          blockers,
          await this.requiredExecutionDetail(client, execution.id),
        );
        if (!state.pode_concluir) {
          throw error(
            'EXECUTION_HAS_BLOCKERS',
            'Respostas, evidências ou não conformidades ainda bloqueiam a conclusão.',
            409,
            state,
          );
        }
        await this.repository.completeExecution(client, execution, {
          ...input,
          result: input.result.trim(),
          observation: nullableText(input.observation),
        });
        const detail = await this.requiredExecutionDetail(client, execution.id);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'OPERATOR_ACTION_COMPLETED',
          'EXECUTION',
          execution.id,
          detail,
        );
        return { finalizada: true, acao_id: actionId, execucao: detail };
      },
    );
  }

  async reviewMaintenanceAction(
    user: AuthenticatedUser,
    actionId: string,
    input: ActionReviewInput,
    audit: RequestAuditMetadata,
  ) {
    const comment = input.comment.trim();
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const action = await this.repository.findAction(client, actionId, true);
        if (!action) {
          throw error('MAINTENANCE_ACTION_NOT_FOUND', 'Acao operacional nao encontrada.', 404);
        }
        const status = text(action, 'status');
        const terminalStatus = input.decision === 'APPROVE' ? 'COMPLETED' : 'READY';
        if (status === terminalStatus) {
          return {
            validated: true,
            already_validated: true,
            acao_id: actionId,
            decisao: input.decision === 'APPROVE' ? 'APROVAR' : 'REPROVAR',
            status: terminalStatus,
          };
        }
        if (status !== 'PENDING') {
          throw error(
            'MAINTENANCE_ACTION_NOT_AWAITING_REVIEW',
            `A acao nao esta aguardando validacao. Status atual: ${status}.`,
            409,
          );
        }
        const execution = await this.repository.findExecutionByAction(client, actionId, true);
        if (!execution || text(execution, 'status') !== 'COMPLETED') {
          throw error(
            'MAINTENANCE_ACTION_EXECUTION_INCOMPLETE',
            'A validacao exige uma execucao concluida e rastreavel.',
            409,
          );
        }
        const blockers = await this.repository.blockingExecutionItems(client, execution.id);
        const detail = await this.requiredExecutionDetail(client, execution.id);
        const completion = this.completionState(execution, blockers, detail);
        if (
          completion.respostas_pendentes > 0 ||
          completion.evidencias_pendentes > 0 ||
          completion.nao_conformes_bloqueantes > 0
        ) {
          throw error(
            'MAINTENANCE_ACTION_REVIEW_BLOCKED',
            'A execucao possui respostas ou evidencias obrigatorias pendentes.',
            409,
            completion,
          );
        }

        await this.repository.reviewCompletedAction(client, action, execution, input.decision);
        const result = {
          validated: true,
          already_validated: false,
          acao_id: actionId,
          execucao_id: execution.id,
          decisao: input.decision === 'APPROVE' ? 'APROVAR' : 'REPROVAR',
          status: terminalStatus,
          comentario: comment,
        };
        await this.repository.writeHistory(
          client,
          user.tenantId,
          action,
          execution.id,
          user.id,
          audit.roleSnapshot,
          input.decision === 'APPROVE' ? 'ACTION_REVIEW_APPROVED' : 'ACTION_REVIEW_REJECTED',
          input.decision === 'APPROVE'
            ? 'Execucao aprovada pelo filtro tecnico.'
            : 'Execucao devolvida para nova realizacao pelo Operador.',
          { comentario: comment, decisao: input.decision },
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          input.decision === 'APPROVE'
            ? 'MAINTENANCE_ACTION_REVIEW_APPROVED'
            : 'MAINTENANCE_ACTION_REVIEW_REJECTED',
          'WORK_ORDER_ACTION',
          actionId,
          result,
        );
        return result;
      },
    );
  }

  async assumeAction(user: AuthenticatedUser, actionId: string, audit: RequestAuditMetadata) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const action = await this.repository.findAction(client, actionId, true);
        if (!action)
          throw error('OPERATOR_ACTION_NOT_FOUND', 'Ação operacional não encontrada.', 404);
        if (text(action, 'status') !== 'READY')
          throw error('OPERATOR_ACTION_NOT_READY', 'A ação não está disponível para assumir.', 409);
        if (action.responsible_id !== null && action.responsible_id !== user.id) {
          throw error(
            'OPERATOR_ACTION_ASSIGNED_TO_ANOTHER_USER',
            'A ação está atribuída a outro usuário.',
            403,
          );
        }
        const executionId = randomUUID();
        await this.repository.createExecution(client, user.tenantId, executionId, action, user.id);
        const detail = await this.requiredExecutionDetail(client, executionId);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'EXECUTION_ASSUMED',
          'EXECUTION',
          executionId,
          detail,
        );
        return detail;
      },
    );
  }

  async getExecution(user: AuthenticatedUser, executionId: string) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const detail = await this.requiredExecutionDetail(client, executionId);
        if (user.profile === 'OPERADOR' && detail.operador_id !== user.id) {
          throw error('EXECUTION_NOT_FOUND', 'Execução não encontrada.', 404);
        }
        return detail;
      },
    );
  }

  async validateExecutionCompletion(user: AuthenticatedUser, executionId: string) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const execution = await this.repository.findExecution(client, executionId);
        if (!execution || (user.profile === 'OPERADOR' && execution.operator_id !== user.id)) {
          throw error('EXECUTION_NOT_FOUND', 'Execução não encontrada.', 404);
        }
        const blockers = await this.repository.blockingExecutionItems(client, executionId);
        const detail = await this.requiredExecutionDetail(client, executionId);
        return this.completionState(execution, blockers, detail);
      },
    );
  }

  async startExecution(
    user: AuthenticatedUser,
    executionId: string,
    stopMode: string,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const execution = await this.ownedExecution(client, executionId, user.id);
        if (text(execution, 'status') !== 'OPEN')
          throw error('EXECUTION_NOT_OPEN', 'A execução já foi iniciada ou encerrada.', 409);
        await this.repository.startExecution(client, executionId, stopMode);
        const detail = await this.requiredExecutionDetail(client, executionId);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'EXECUTION_STARTED',
          'EXECUTION',
          executionId,
          detail,
        );
        return detail;
      },
    );
  }

  async answerItem(
    user: AuthenticatedUser,
    executionId: string,
    itemId: string,
    input: ExecutionResponseInput,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const execution = await this.ownedExecution(client, executionId, user.id);
        if (text(execution, 'status') !== 'IN_PROGRESS')
          throw error(
            'EXECUTION_NOT_IN_PROGRESS',
            'Inicie a execução antes de responder o checklist.',
            409,
          );
        const item = await this.repository.findExecutionItem(client, executionId, itemId, true);
        if (!item)
          throw error('EXECUTION_ITEM_NOT_FOUND', 'Etapa da execução não encontrada.', 404);
        const validation = this.validateResponse(item, input);
        await this.repository.answerExecutionItem(
          client,
          itemId,
          user.id,
          input,
          validation.status,
          validation.compliant,
          validation.message,
        );
        if (item.parameter_definition_id !== null && input.numberValue !== null) {
          await this.repository.insertParameterReading(
            client,
            user.tenantId,
            executionId,
            item,
            user.id,
            input.numberValue,
            validation.classification,
          );
        }
        const detail = await this.requiredExecutionDetail(client, executionId);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'EXECUTION_ITEM_ANSWERED',
          'EXECUTION_CHECKLIST_ITEM',
          itemId,
          { status: validation.status, conforme: validation.compliant },
        );
        return detail;
      },
    );
  }

  async addEvidence(
    user: AuthenticatedUser,
    executionId: string,
    itemId: string,
    input: EvidenceInput,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const execution = await this.ownedExecution(client, executionId, user.id);
        if (text(execution, 'status') !== 'IN_PROGRESS')
          throw error(
            'EXECUTION_NOT_IN_PROGRESS',
            'A execução não aceita evidências neste estado.',
            409,
          );
        if (!(await this.repository.findExecutionItem(client, executionId, itemId, true))) {
          throw error('EXECUTION_ITEM_NOT_FOUND', 'Etapa da execução não encontrada.', 404);
        }
        if (!(await this.repository.storageObjectAvailable(client, input.storageObjectId))) {
          throw error(
            'EVIDENCE_OBJECT_NOT_AVAILABLE',
            'O arquivo não existe, não pertence ao tenant ou ainda não está disponível.',
            422,
          );
        }
        await this.repository.insertEvidence(
          client,
          user.tenantId,
          execution,
          itemId,
          user.id,
          input,
        );
        await this.repository.markEvidenceItemAnswered(client, itemId, user.id);
        const detail = await this.requiredExecutionDetail(client, executionId);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'EXECUTION_EVIDENCE_ADDED',
          'EXECUTION_CHECKLIST_ITEM',
          itemId,
          { objeto_armazenamento_id: input.storageObjectId, tipo: input.evidenceType },
        );
        return detail;
      },
    );
  }

  async addEvidenceFile(
    user: AuthenticatedUser,
    executionId: string,
    itemId: string,
    input: EvidenceUploadInput,
    audit: RequestAuditMetadata,
  ) {
    let stored: StoredObject;
    try {
      stored = await this.objectStorage.storeEvidence({
        tenantId: user.tenantId,
        originalName: input.originalName,
        mediaType: input.mediaType,
        stream: input.stream,
      });
    } catch (cause) {
      if (cause instanceof ObjectStorageError) {
        throw error(cause.code, cause.message, cause.code === 'FILE_TOO_LARGE' ? 413 : 422);
      }
      throw cause;
    }

    try {
      const detail = await this.database.withTransaction(
        { tenantId: user.tenantId, userId: user.id },
        async (client) => {
          const execution = await this.ownedExecution(client, executionId, user.id);
          if (text(execution, 'status') !== 'IN_PROGRESS') {
            throw error(
              'EXECUTION_NOT_IN_PROGRESS',
              'A execução não aceita evidências neste estado.',
              409,
            );
          }
          if (!(await this.repository.findExecutionItem(client, executionId, itemId, true))) {
            throw error('EXECUTION_ITEM_NOT_FOUND', 'Etapa da execução não encontrada.', 404);
          }

          await this.repository.insertStorageObject(client, user.tenantId, user.id, stored);
          await this.repository.insertEvidence(client, user.tenantId, execution, itemId, user.id, {
            storageObjectId: stored.id,
            evidenceType: stored.evidenceType,
            observation: nullableText(input.observation),
            capturedAt: input.capturedAt,
          });
          await this.repository.markEvidenceItemAnswered(client, itemId, user.id);
          const updated = await this.requiredExecutionDetail(client, executionId);
          await this.repository.writeAudit(
            client,
            user.tenantId,
            user.id,
            audit,
            'EXECUTION_EVIDENCE_UPLOADED',
            'EXECUTION_CHECKLIST_ITEM',
            itemId,
            {
              objeto_armazenamento_id: stored.id,
              tipo: stored.evidenceType,
              tamanho_bytes: stored.byteSize,
              checksum_sha256: stored.checksumSha256,
            },
          );
          return updated;
        },
      );
      return detail;
    } catch (cause) {
      await this.objectStorage.remove(stored).catch(() => undefined);
      throw cause;
    }
  }

  async openEvidenceFile(user: AuthenticatedUser, objectId: string) {
    const object = await this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const found = await this.repository.findEvidenceStorageObject(client, objectId);
        if (!found) throw error('EVIDENCE_FILE_NOT_FOUND', 'Evidência não encontrada.', 404);
        return found;
      },
    );
    const reference: StoredObjectReference = {
      provider: text(object, 'provider'),
      bucket: text(object, 'bucket'),
      objectKey: text(object, 'object_key'),
    };
    try {
      return {
        stream: this.objectStorage.open(reference),
        originalName: text(object, 'original_name'),
        mediaType: text(object, 'media_type'),
        byteSize: integer(object, 'byte_size'),
        checksumSha256: text(object, 'checksum_sha256'),
      };
    } catch (cause) {
      throw error(
        'EVIDENCE_FILE_UNAVAILABLE',
        'O conteúdo desta evidência não está disponível no armazenamento atual.',
        404,
        cause instanceof Error ? { reason: cause.message } : undefined,
      );
    }
  }

  async completeExecution(
    user: AuthenticatedUser,
    executionId: string,
    input: CompletionInput,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const execution = await this.ownedExecution(client, executionId, user.id);
        if (text(execution, 'status') !== 'IN_PROGRESS')
          throw error(
            'EXECUTION_NOT_IN_PROGRESS',
            'Somente uma execução em andamento pode ser concluída.',
            409,
          );
        const blockers = await this.repository.blockingExecutionItems(client, executionId);
        if (
          integer(blockers, 'pendentes') > 0 ||
          integer(blockers, 'evidencias_pendentes') > 0 ||
          integer(blockers, 'nao_conformes_bloqueantes') > 0
        ) {
          throw error(
            'EXECUTION_HAS_BLOCKERS',
            'Respostas, evidências ou não conformidades ainda bloqueiam a conclusão.',
            409,
            {
              respostas_pendentes: integer(blockers, 'pendentes'),
              evidencias_pendentes: integer(blockers, 'evidencias_pendentes'),
              nao_conformes_bloqueantes: integer(blockers, 'nao_conformes_bloqueantes'),
            },
          );
        }
        await this.repository.completeExecution(client, execution, {
          ...input,
          result: input.result.trim(),
          observation: nullableText(input.observation),
        });
        const detail = await this.requiredExecutionDetail(client, executionId);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'EXECUTION_COMPLETED',
          'EXECUTION',
          executionId,
          detail,
        );
        return detail;
      },
    );
  }

  private validateSignaturePolicy(input: ReviewSubmissionInput): void {
    const expected = input.signaturePolicy === 'QUALIDADE_E_SEGURANCA' ? 2 : 1;
    if (input.requiredSignatures !== expected) {
      throw error(
        'SIGNATURE_POLICY_COUNT_MISMATCH',
        `A política selecionada exige exatamente ${expected} assinatura(s).`,
        422,
      );
    }
    if (
      input.firstResponseDueAt &&
      input.resolutionDueAt &&
      new Date(input.resolutionDueAt) <= new Date(input.firstResponseDueAt)
    ) {
      throw error(
        'SLA_PERIOD_INVALID',
        'O prazo de resolução deve ser posterior ao prazo da primeira resposta.',
        422,
      );
    }
  }

  private validateResponse(
    item: OperationsRow,
    input: ExecutionResponseInput,
  ): {
    readonly status: 'ANSWERED' | 'NONCOMPLIANT' | 'NOT_APPLICABLE';
    readonly compliant: boolean | null;
    readonly message: string | null;
    readonly classification: string;
  } {
    if (input.notApplicable)
      return {
        status: 'NOT_APPLICABLE',
        compliant: true,
        message: null,
        classification: 'UNCLASSIFIED',
      };
    const type = text(item, 'response_type_code');
    if (type === 'EVIDENCIA')
      throw error(
        'EVIDENCE_ITEM_REQUIRES_FILE',
        'Esta etapa é respondida pelo envio de evidência.',
        422,
      );
    if (type === 'INSTRUCAO' || type === 'CONFIRMACAO') {
      if (input.booleanValue !== true)
        throw error(
          'BOOLEAN_CONFIRMATION_REQUIRED',
          'Confirme a leitura ou execução da etapa.',
          422,
        );
      return { status: 'ANSWERED', compliant: true, message: null, classification: 'UNCLASSIFIED' };
    }
    if (type === 'OK_NOK') {
      if (!input.optionValue || !['OK', 'NOK', 'NA'].includes(input.optionValue.toUpperCase()))
        throw error('OK_NOK_RESPONSE_INVALID', 'Responda OK, NOK ou NA.', 422);
      const compliant = input.optionValue.toUpperCase() !== 'NOK';
      return {
        status: compliant ? 'ANSWERED' : 'NONCOMPLIANT',
        compliant,
        message: compliant ? null : 'Condição não conforme registrada.',
        classification: 'UNCLASSIFIED',
      };
    }
    if (type === 'NUMERO' || type === 'PARAMETRO' || type === 'LEITURA_OPERACIONAL') {
      if (input.numberValue === null || !Number.isFinite(input.numberValue))
        throw error('NUMERIC_RESPONSE_REQUIRED', 'Informe uma leitura numérica válida.', 422);
      const minimum = numberOrNull(item.minimum_value_snapshot);
      const maximum = numberOrNull(item.maximum_value_snapshot);
      const below = minimum !== null && input.numberValue < minimum;
      const above = maximum !== null && input.numberValue > maximum;
      const compliant = !below && !above;
      return {
        status: compliant ? 'ANSWERED' : 'NONCOMPLIANT',
        compliant,
        message: below
          ? `Valor abaixo do mínimo ${minimum}.`
          : above
            ? `Valor acima do máximo ${maximum}.`
            : null,
        classification: below ? 'WARNING_LOW' : above ? 'WARNING_HIGH' : 'NORMAL',
      };
    }
    if (type === 'SELECAO') {
      const options = Array.isArray(item.options_snapshot) ? item.options_snapshot : [];
      if (!input.optionValue || !options.includes(input.optionValue))
        throw error('OPTION_RESPONSE_INVALID', 'Selecione uma das opções configuradas.', 422);
      return { status: 'ANSWERED', compliant: true, message: null, classification: 'UNCLASSIFIED' };
    }
    if (type === 'TEXTO') {
      if (!nullableText(input.textValue))
        throw error('TEXT_RESPONSE_REQUIRED', 'Informe a resposta da etapa.', 422);
      return { status: 'ANSWERED', compliant: true, message: null, classification: 'UNCLASSIFIED' };
    }
    throw error(
      'RESPONSE_TYPE_UNSUPPORTED',
      'O tipo de resposta não é suportado nesta execução.',
      422,
    );
  }

  private normalizeBatchResponse(
    item: OperationsRow,
    input: ExecutionBatchItemInput,
  ): ExecutionResponseInput {
    const type = text(item, 'response_type_code');
    const raw = nullableText(input.response);
    const normalized = raw
      ?.normalize('NFD')
      .replaceAll(/[\u0300-\u036f]/gu, '')
      .trim()
      .toUpperCase();
    const numeric = input.numericValue;
    return {
      textValue: type === 'TEXTO' ? raw : null,
      numberValue: ['NUMERO', 'PARAMETRO', 'LEITURA_OPERACIONAL'].includes(type) ? numeric : null,
      booleanValue: ['INSTRUCAO', 'CONFIRMACAO'].includes(type)
        ? ['SIM', 'LIDO', 'TRUE', 'OK', 'CONFIRMADO'].includes(normalized ?? '')
        : null,
      optionValue: ['OK_NOK', 'SELECAO'].includes(type)
        ? normalized === 'N/A' || normalized === 'NAO APLICAVEL'
          ? 'NA'
          : raw
        : null,
      observation: nullableText(input.observation),
      notApplicable: false,
    };
  }

  private async ownedExecution(
    client: PoolClient,
    executionId: string,
    userId: string,
  ): Promise<OperationsRow> {
    const execution = await this.repository.findExecution(client, executionId, true);
    if (!execution) throw error('EXECUTION_NOT_FOUND', 'Execução não encontrada.', 404);
    if (execution.operator_id !== userId)
      throw error(
        'EXECUTION_OWNERSHIP_REQUIRED',
        'Somente o Operador responsável pode alterar esta execução.',
        403,
      );
    return execution;
  }

  private operatorCanSeeAction(action: OperationsRow, userId: string): boolean {
    const status = typeof action.status === 'string' ? action.status : '';
    if (!['READY', 'IN_PROGRESS', 'BLOCKED'].includes(status)) return false;
    const responsibleId = typeof action.responsavel_id === 'string' ? action.responsavel_id : null;
    const operatorId = typeof action.operador_id === 'string' ? action.operador_id : null;
    return (
      (responsibleId === null || responsibleId === userId) &&
      (operatorId === null || operatorId === userId)
    );
  }

  private async ownedActionExecution(
    client: PoolClient,
    actionId: string,
    userId: string,
    lock: boolean,
  ): Promise<{ readonly action: OperationsRow; readonly execution: OperationsRow }> {
    const action = await this.repository.findAction(client, actionId, lock);
    if (!action) throw error('OPERATOR_ACTION_NOT_FOUND', 'Ação operacional não encontrada.', 404);
    const execution = await this.repository.findExecutionByAction(client, actionId, lock);
    if (execution?.operator_id !== userId) {
      throw error('EXECUTION_NOT_FOUND', 'Execução do Operador não encontrada.', 404);
    }
    return { action, execution };
  }

  private completionState(
    execution: OperationsRow,
    blockers: OperationsRow,
    detail: OperationsRow,
  ) {
    const items = Array.isArray(detail.itens) ? detail.itens : [];
    const pending = integer(blockers, 'pendentes');
    const missingEvidence = integer(blockers, 'evidencias_pendentes');
    const noncompliant = integer(blockers, 'nao_conformes_bloqueantes');
    return {
      execucao_id: execution.id,
      pode_concluir:
        text(execution, 'status') === 'IN_PROGRESS' &&
        pending === 0 &&
        missingEvidence === 0 &&
        noncompliant === 0,
      total: items.length,
      respondidos: items.filter((item) => {
        if (item === null || typeof item !== 'object') return false;
        const status = (item as Record<string, unknown>).status;
        return status === 'ANSWERED' || status === 'NOT_APPLICABLE';
      }).length,
      respostas_pendentes: pending,
      evidencias_pendentes: missingEvidence,
      nao_conformes_bloqueantes: noncompliant,
    };
  }

  private async requiredWorkOrderDetail(client: PoolClient, id: string): Promise<OperationsRow> {
    const detail = await this.repository.getWorkOrderDetail(client, id);
    if (!detail) throw error('WORK_ORDER_NOT_FOUND', 'Ordem de serviço não encontrada.', 404);
    return detail;
  }

  private async requiredExecutionDetail(client: PoolClient, id: string): Promise<OperationsRow> {
    const detail = await this.repository.getExecutionDetail(client, id);
    if (!detail) throw error('EXECUTION_NOT_FOUND', 'Execução não encontrada.', 404);
    return detail;
  }
}
