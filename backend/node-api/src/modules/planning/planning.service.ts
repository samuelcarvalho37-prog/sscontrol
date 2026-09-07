import { createHash, randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import { AppError } from '../../core/errors/app-error.js';
import type { Database } from '../../infrastructure/database/database.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import {
  PlanningRepository,
  type PlanningRow,
  type ReviewProgressRow,
  type ValidatorContextRow,
} from './planning.repository.js';
import type {
  ChecklistAggregateInput,
  ChecklistInput,
  ChecklistItemInput,
  ChecklistListQuery,
  ChecklistPatch,
  ChecklistSubmissionRoute,
  MaintenancePlanInput,
  MaintenancePlanPatch,
  PlanListQuery,
  RequestAuditMetadata,
  ReviewDecision,
  SignaturePolicy,
} from './planning.types.js';

function notFound(entity: string): AppError {
  return new AppError({
    code: 'RESOURCE_NOT_FOUND',
    message: `${entity} não encontrado(a).`,
    statusCode: 404,
  });
}

function conflict(code: string, message: string, details?: unknown): AppError {
  return new AppError({ code, message, statusCode: 409, details });
}

function invalid(code: string, message: string, details?: unknown): AppError {
  return new AppError({ code, message, statusCode: 422, details });
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

function normalizeNullableText(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().replace(/\s+/gu, ' ');
  return normalized.length > 0 ? normalized : null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

function hashPayload(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)), 'utf8')
    .digest('hex');
}

function text(row: PlanningRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`Campo ${key} ausente no contrato do banco.`);
  return value;
}

function integer(row: PlanningRow, key: string): number {
  const value = Number(row[key]);
  if (!Number.isInteger(value)) throw new Error(`Campo ${key} inválido no contrato do banco.`);
  return value;
}

function isActiveAsset(context: PlanningRow): boolean {
  return (
    context.ativo_status === 'ACTIVE' &&
    (context.componente_id === null || context.componente_status === 'ACTIVE')
  );
}

function checklistSignaturePolicy(input: ChecklistInput | ChecklistPatch): {
  readonly policy: SignaturePolicy | undefined;
  readonly required: number | undefined;
  readonly areaId: string | null | undefined;
} {
  return {
    policy: input.signaturePolicy,
    required: input.requiredSignatures,
    areaId: input.technicalAreaId,
  };
}

function validateSignaturePolicy(input: ChecklistInput | ChecklistPatch): void {
  const { policy, required, areaId } = checklistSignaturePolicy(input);
  if (policy === undefined || required === undefined) return;
  if (required === 0) return;

  const fixedRequirements: Partial<Record<SignaturePolicy, number>> = {
    QUALIDADE: 1,
    SEGURANCA: 1,
    QUALIDADE_OU_SEGURANCA: 1,
    QUALIDADE_E_SEGURANCA: 2,
  };
  const fixed = fixedRequirements[policy];
  if (fixed !== undefined && required !== fixed) {
    throw invalid(
      'CHECKLIST_SIGNATURE_POLICY_INVALID',
      `A política ${policy} exige exatamente ${fixed} assinatura(s).`,
    );
  }
  if (policy === 'PERSONALIZADA' && (!areaId || required < 1 || required > 10)) {
    throw invalid(
      'CHECKLIST_CUSTOM_SIGNATURE_POLICY_INVALID',
      'A política personalizada exige uma área técnica e de 1 a 10 assinaturas.',
    );
  }
}

function normalizeChecklistInput(input: ChecklistInput): ChecklistInput {
  const normalized: ChecklistInput = {
    ...input,
    code: normalizeCode(input.code),
    name: normalizeText(input.name),
    checklistType: normalizeCode(input.checklistType),
    managerGuidance: normalizeNullableText(input.managerGuidance),
    safetyRequirements: input.safetyRequirements
      .map(normalizeText)
      .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index),
  };
  validateSignaturePolicy(normalized);
  return normalized;
}

function normalizeItem(input: ChecklistItemInput): ChecklistItemInput {
  const options = input.options
    .map(normalizeText)
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
  const item: ChecklistItemInput = {
    ...input,
    title: normalizeText(input.title),
    instruction: normalizeNullableText(input.instruction),
    category: normalizeCode(input.category),
    expectedValue: normalizeNullableText(input.expectedValue),
    unit: normalizeNullableText(input.unit),
    options,
    validationRuleCode: input.validationRuleCode ? normalizeCode(input.validationRuleCode) : null,
  };

  if (
    item.minimumValue !== null &&
    item.maximumValue !== null &&
    item.minimumValue > item.maximumValue
  ) {
    throw invalid('CHECKLIST_ITEM_RANGE_INVALID', 'O limite mínimo não pode superar o máximo.');
  }
  if (item.responseTypeCode === 'SELECAO' && options.length < 2) {
    throw invalid(
      'CHECKLIST_ITEM_OPTIONS_REQUIRED',
      'Uma lista de opções deve possuir pelo menos duas alternativas distintas.',
    );
  }
  if (item.responseTypeCode !== 'SELECAO' && options.length > 0) {
    throw invalid(
      'CHECKLIST_ITEM_OPTIONS_NOT_SUPPORTED',
      'Somente o tipo Lista de opções aceita alternativas cadastradas.',
    );
  }
  const parameterType =
    item.responseTypeCode === 'PARAMETRO' || item.responseTypeCode === 'LEITURA_OPERACIONAL';
  if (parameterType && item.parameterDefinitionId === null) {
    throw invalid(
      'CHECKLIST_ITEM_PARAMETER_REQUIRED',
      'Parâmetros e leituras operacionais devem apontar para uma definição técnica.',
    );
  }
  if (!parameterType && item.parameterDefinitionId !== null) {
    throw invalid(
      'CHECKLIST_ITEM_PARAMETER_NOT_SUPPORTED',
      'Este tipo de resposta não aceita um parâmetro técnico vinculado.',
    );
  }
  if (
    item.responseTypeCode === 'EVIDENCIA' &&
    (!item.evidenceRequired || item.minimumEvidencePhotos < 1)
  ) {
    throw invalid(
      'CHECKLIST_ITEM_EVIDENCE_REQUIRED',
      'Uma etapa de evidência deve exigir ao menos uma foto.',
    );
  }
  if (item.minimumEvidencePhotos > 0 && !item.evidenceRequired) {
    throw invalid(
      'CHECKLIST_ITEM_EVIDENCE_COUNT_INVALID',
      'A quantidade mínima de fotos só pode ser informada quando a evidência é obrigatória.',
    );
  }
  return item;
}

function validatePlanTrigger(input: MaintenancePlanInput | MaintenancePlanPatch): void {
  if (input.triggerType === 'PERIODICITY' && input.recurrenceDays == null) {
    throw invalid('PLAN_RECURRENCE_REQUIRED', 'Informe a recorrência para o plano periódico.');
  }
  if (
    input.triggerType === 'HOUR_METER' &&
    (input.triggerValue == null || input.triggerUnit == null || input.triggerUnit.trim() === '')
  ) {
    throw invalid(
      'PLAN_HOUR_METER_TRIGGER_INVALID',
      'Informe valor e unidade para o disparo por horímetro.',
    );
  }
}

function normalizePlanInput(input: MaintenancePlanInput): MaintenancePlanInput {
  const normalized: MaintenancePlanInput = {
    ...input,
    code: normalizeCode(input.code),
    name: normalizeText(input.name),
    triggerUnit: normalizeNullableText(input.triggerUnit),
  };
  validatePlanTrigger(normalized);
  return normalized;
}

function reviewRoleSnapshot(context: ValidatorContextRow): string {
  return [context.area_code, context.role_code].filter(Boolean).join(':');
}

function canReviewPolicy(
  policy: SignaturePolicy,
  targetAreaId: string | null,
  context: ValidatorContextRow,
): boolean {
  if (!context.can_sign) return false;
  if (policy === 'QUALIDADE') return context.area_code === 'QUALITY';
  if (policy === 'SEGURANCA') return context.area_code === 'SAFETY';
  if (policy === 'QUALIDADE_OU_SEGURANCA' || policy === 'QUALIDADE_E_SEGURANCA') {
    return context.area_code === 'QUALITY' || context.area_code === 'SAFETY';
  }
  return targetAreaId !== null && context.area_id === targetAreaId;
}

function approvalReached(
  policy: SignaturePolicy,
  required: number,
  progress: ReviewProgressRow,
): boolean {
  if (policy === 'QUALIDADE') return progress.quality_approved;
  if (policy === 'SEGURANCA') return progress.safety_approved;
  if (policy === 'QUALIDADE_OU_SEGURANCA') {
    return progress.quality_approved || progress.safety_approved;
  }
  if (policy === 'QUALIDADE_E_SEGURANCA') {
    return progress.quality_approved && progress.safety_approved;
  }
  return progress.approved_count >= required;
}

export class PlanningService {
  private readonly repository = new PlanningRepository();

  constructor(private readonly database: Database) {}

  async listItemTypes(user: AuthenticatedUser) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => ({ tipos: await this.repository.listItemTypes(client) }),
    );
  }

  async listChecklists(user: AuthenticatedUser, query: ChecklistListQuery) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => ({
        itens: await this.repository.listChecklists(client, query),
        limite: query.limit,
      }),
    );
  }

  async getChecklist(user: AuthenticatedUser, checklistId: string) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const detail = await this.repository.getChecklistDetail(client, checklistId);
        if (!detail) throw notFound('Checklist');
        return detail;
      },
    );
  }

  async createChecklist(
    user: AuthenticatedUser,
    input: ChecklistInput,
    audit: RequestAuditMetadata,
  ) {
    const normalized = normalizeChecklistInput(input);
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        await this.requireActiveAssetContext(client, normalized.assetId, normalized.componentId);
        await this.requireTechnicalScope(
          client,
          normalized.technicalAreaId,
          normalized.technicalRoleId,
        );
        const checklistId = randomUUID();
        const versionId = randomUUID();
        await this.repository.createChecklist(
          client,
          user.tenantId,
          checklistId,
          versionId,
          user.id,
          normalized,
          hashPayload({ checklist: normalized, items: [] }),
        );
        const detail = await this.requiredChecklistDetail(client, checklistId);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CHECKLIST_TEMPLATE_CREATED',
          'CHECKLIST_TEMPLATE',
          checklistId,
          null,
          detail,
        );
        return detail;
      },
    );
  }

  async updateChecklist(
    user: AuthenticatedUser,
    checklistId: string,
    patch: ChecklistPatch,
    audit: RequestAuditMetadata,
  ) {
    if (patch.signaturePolicy !== undefined || patch.requiredSignatures !== undefined) {
      if (patch.signaturePolicy === undefined || patch.requiredSignatures === undefined) {
        throw invalid(
          'CHECKLIST_SIGNATURE_PATCH_INCOMPLETE',
          'Altere a política e a quantidade de assinaturas na mesma operação.',
        );
      }
      validateSignaturePolicy(patch);
    }
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const template = await this.repository.findChecklistTemplate(client, checklistId, true);
        if (!template) throw notFound('Checklist');
        const version = await this.repository.findEditableChecklistVersion(
          client,
          checklistId,
          true,
        );
        if (!version) {
          throw conflict(
            'CHECKLIST_REVISION_NOT_EDITABLE',
            'Crie uma nova revisão antes de alterar um checklist submetido ou publicado.',
          );
        }
        const areaId =
          patch.technicalAreaId === undefined
            ? (version.technical_area_id as string | null)
            : patch.technicalAreaId;
        const roleId =
          patch.technicalRoleId === undefined
            ? (version.technical_role_id as string | null)
            : patch.technicalRoleId;
        await this.requireTechnicalScope(client, areaId, roleId);
        const before = await this.requiredChecklistDetail(client, checklistId);
        const normalizedPatch: ChecklistPatch = {
          ...patch,
          ...(patch.code === undefined ? {} : { code: normalizeCode(patch.code) }),
          ...(patch.name === undefined ? {} : { name: normalizeText(patch.name) }),
          ...(patch.managerGuidance === undefined
            ? {}
            : { managerGuidance: normalizeNullableText(patch.managerGuidance) }),
          ...(patch.safetyRequirements === undefined
            ? {}
            : {
                safetyRequirements: patch.safetyRequirements
                  .map(normalizeText)
                  .filter(
                    (value, index, values) => value.length > 0 && values.indexOf(value) === index,
                  ),
              }),
        };
        await this.repository.updateChecklist(
          client,
          checklistId,
          text(version, 'id'),
          normalizedPatch,
          template,
          version,
        );
        const after = await this.requiredChecklistDetail(client, checklistId);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CHECKLIST_TEMPLATE_UPDATED',
          'CHECKLIST_TEMPLATE',
          checklistId,
          before,
          after,
        );
        return after;
      },
    );
  }

  async saveChecklistAggregate(
    user: AuthenticatedUser,
    input: ChecklistAggregateInput,
    audit: RequestAuditMetadata,
  ) {
    if (input.items.length > 500) {
      throw invalid(
        'CHECKLIST_ITEM_LIMIT_EXCEEDED',
        'Um checklist pode possuir no máximo 500 etapas.',
      );
    }
    const informedIds = input.items.flatMap((item) => (item.id ? [item.id] : []));
    if (new Set(informedIds).size !== informedIds.length) {
      throw invalid('CHECKLIST_ITEM_ID_DUPLICATED', 'Existem etapas repetidas no checklist.');
    }
    const checklist = normalizeChecklistInput(input.checklist);

    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        await this.requireActiveAssetContext(client, checklist.assetId, checklist.componentId);
        await this.requireTechnicalScope(
          client,
          checklist.technicalAreaId,
          checklist.technicalRoleId,
        );

        const checklistId = input.checklistId ?? randomUUID();
        let versionId: string;
        let before: PlanningRow | null = null;
        if (input.checklistId) {
          const template = await this.repository.findChecklistTemplate(client, checklistId, true);
          if (!template) throw notFound('Checklist');
          const editable = await this.repository.findEditableChecklistVersion(
            client,
            checklistId,
            true,
          );
          if (!editable) {
            throw conflict(
              'CHECKLIST_REVISION_NOT_EDITABLE',
              'Crie uma nova revisão antes de alterar um checklist submetido ou publicado.',
            );
          }
          versionId = text(editable, 'id');
          before = await this.requiredChecklistDetail(client, checklistId);
          await this.repository.updateChecklistAggregate(client, checklistId, versionId, checklist);
        } else {
          versionId = randomUUID();
          await this.repository.createChecklist(
            client,
            user.tenantId,
            checklistId,
            versionId,
            user.id,
            checklist,
            hashPayload({ checklist, items: [] }),
          );
        }

        const template = await this.repository.findChecklistTemplate(client, checklistId, true);
        if (!template) throw notFound('Checklist');
        const normalizedItems: { id: string; input: ChecklistItemInput }[] = [];
        for (const [index, aggregateItem] of input.items.entries()) {
          const responseType = aggregateItem.responseTypeCode;
          const parameterType =
            responseType === 'PARAMETRO' || responseType === 'LEITURA_OPERACIONAL';
          let parameterId = aggregateItem.parameterDefinitionId;
          let unit = aggregateItem.unit;
          if (parameterType && parameterId === null) {
            const parameterName = normalizeNullableText(aggregateItem.parameterName);
            if (!parameterName) {
              throw invalid(
                'CHECKLIST_ITEM_PARAMETER_NAME_REQUIRED',
                `Informe o parâmetro técnico da etapa ${index + 1}.`,
              );
            }
            const existing = await this.repository.findParameterByName(
              client,
              checklist.assetId,
              checklist.componentId,
              parameterName,
            );
            if (existing) {
              parameterId = text(existing, 'id');
              unit = unit ?? text(existing, 'unit');
            } else {
              const normalizedUnit = normalizeNullableText(unit);
              if (!normalizedUnit) {
                throw invalid(
                  'CHECKLIST_ITEM_PARAMETER_UNIT_REQUIRED',
                  `Informe a unidade do parâmetro da etapa ${index + 1}.`,
                );
              }
              const slug = parameterName
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/gu, '')
                .replace(/[^a-zA-Z0-9]+/gu, '-')
                .replace(/^-+|-+$/gu, '')
                .slice(0, 45)
                .toUpperCase();
              const created = await this.repository.createChecklistParameter(
                client,
                user.tenantId,
                checklist.assetId,
                checklist.componentId,
                `CHK-${slug || 'PARAMETRO'}-${randomUUID().slice(0, 8).toUpperCase()}`,
                parameterName,
                normalizedUnit,
              );
              parameterId = text(created, 'id');
              unit = text(created, 'unit');
            }
          }
          const normalizedItem = normalizeItem({
            ...aggregateItem,
            parameterDefinitionId: parameterType ? parameterId : null,
            unit,
          });
          await this.validateItemParameter(client, template, normalizedItem);
          normalizedItems.push({
            id: aggregateItem.id ?? randomUUID(),
            input: normalizedItem,
          });
        }

        await this.repository.replaceChecklistItems(
          client,
          user.tenantId,
          versionId,
          normalizedItems,
        );
        if (
          input.sourceTechnicalAnalysisId &&
          !(await this.repository.acceptTechnicalAnalysisAsChecklist(
            client,
            input.sourceTechnicalAnalysisId,
            checklistId,
          ))
        ) {
          throw conflict(
            'TECHNICAL_ANALYSIS_CONVERSION_INVALID',
            'A análise técnica já foi tratada ou não está disponível para conversão.',
          );
        }
        const contentHash = await this.checklistContentHash(client, checklistId, versionId);
        const editable = await this.repository.findEditableChecklistVersion(client, checklistId);
        if (!editable)
          throw conflict('CHECKLIST_REVISION_NOT_EDITABLE', 'A revisão deixou de ser editável.');
        await this.repository.updateChecklistVersionStatus(
          client,
          versionId,
          text(editable, 'status') as 'DRAFT' | 'CHANGES_REQUESTED',
          contentHash,
        );
        const after = await this.requiredChecklistDetail(client, checklistId);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          before ? 'CHECKLIST_AGGREGATE_UPDATED' : 'CHECKLIST_AGGREGATE_CREATED',
          'CHECKLIST_TEMPLATE',
          checklistId,
          before,
          after,
        );
        return after;
      },
    );
  }

  async deleteChecklistDraft(
    user: AuthenticatedUser,
    checklistId: string,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const before = await this.repository.getChecklistDetail(client, checklistId);
        if (!before) throw notFound('Checklist');
        if (!(await this.repository.softDeleteChecklistDraft(client, checklistId))) {
          throw conflict(
            'CHECKLIST_DELETE_PROTECTED',
            'Somente rascunhos sem histórico operacional podem ser excluídos.',
          );
        }
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CHECKLIST_DRAFT_ARCHIVED',
          'CHECKLIST_TEMPLATE',
          checklistId,
          before,
          { deleted: true },
        );
        return { deleted: true, checklist_id: checklistId };
      },
    );
  }

  async addChecklistItem(
    user: AuthenticatedUser,
    checklistId: string,
    input: ChecklistItemInput,
    audit: RequestAuditMetadata,
  ) {
    const normalized = normalizeItem(input);
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const template = await this.repository.findChecklistTemplate(client, checklistId, true);
        if (!template) throw notFound('Checklist');
        const version = await this.requireEditableChecklistVersion(client, checklistId);
        await this.validateItemParameter(client, template, normalized);
        const created = await this.repository.insertChecklistItem(
          client,
          user.tenantId,
          text(version, 'id'),
          randomUUID(),
          normalized,
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CHECKLIST_ITEM_CREATED',
          'CHECKLIST_ITEM',
          text(created, 'id'),
          null,
          created,
        );
        return this.requiredChecklistDetail(client, checklistId);
      },
    );
  }

  async updateChecklistItem(
    user: AuthenticatedUser,
    checklistId: string,
    itemId: string,
    input: ChecklistItemInput,
    audit: RequestAuditMetadata,
  ) {
    const normalized = normalizeItem(input);
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const template = await this.repository.findChecklistTemplate(client, checklistId, true);
        if (!template) throw notFound('Checklist');
        const version = await this.requireEditableChecklistVersion(client, checklistId);
        await this.validateItemParameter(client, template, normalized);
        const updated = await this.repository.updateChecklistItem(
          client,
          text(version, 'id'),
          itemId,
          normalized,
        );
        if (!updated) throw notFound('Etapa do checklist');
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CHECKLIST_ITEM_UPDATED',
          'CHECKLIST_ITEM',
          itemId,
          null,
          { checklist_id: checklistId, item_id: itemId },
        );
        return this.requiredChecklistDetail(client, checklistId);
      },
    );
  }

  async deleteChecklistItem(
    user: AuthenticatedUser,
    checklistId: string,
    itemId: string,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const version = await this.requireEditableChecklistVersion(client, checklistId);
        const deleted = await this.repository.deleteChecklistItem(
          client,
          text(version, 'id'),
          itemId,
        );
        if (!deleted) throw notFound('Etapa do checklist');
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CHECKLIST_ITEM_DELETED',
          'CHECKLIST_ITEM',
          itemId,
          null,
          { checklist_id: checklistId, item_id: itemId },
        );
        return this.requiredChecklistDetail(client, checklistId);
      },
    );
  }

  async reorderChecklistItems(
    user: AuthenticatedUser,
    checklistId: string,
    orderedIds: readonly string[],
    audit: RequestAuditMetadata,
  ) {
    if (new Set(orderedIds).size !== orderedIds.length) {
      throw invalid('CHECKLIST_ITEM_ORDER_INVALID', 'A ordenação contém etapas repetidas.');
    }
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const version = await this.requireEditableChecklistVersion(client, checklistId);
        const reordered = await this.repository.reorderChecklistItems(
          client,
          text(version, 'id'),
          orderedIds,
        );
        if (!reordered) {
          throw invalid(
            'CHECKLIST_ITEM_ORDER_INCOMPLETE',
            'A ordenação deve conter todas as etapas da revisão exatamente uma vez.',
          );
        }
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CHECKLIST_ITEMS_REORDERED',
          'CHECKLIST_TEMPLATE',
          checklistId,
          null,
          { ordem: orderedIds },
        );
        return this.requiredChecklistDetail(client, checklistId);
      },
    );
  }

  async submitChecklist(user: AuthenticatedUser, checklistId: string, audit: RequestAuditMetadata) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const version = await this.requireEditableChecklistVersion(client, checklistId);
        const versionId = text(version, 'id');
        if ((await this.repository.countActiveChecklistItems(client, versionId)) === 0) {
          throw invalid(
            'CHECKLIST_WITHOUT_ITEMS',
            'Adicione ao menos uma etapa ativa antes de enviar o checklist.',
          );
        }
        if (integer(version, 'required_signatures') > 0 && version.manager_guidance === null) {
          throw invalid(
            'CHECKLIST_MANAGER_GUIDANCE_REQUIRED',
            'Explique ao filtro técnico o objetivo e os pontos que precisam ser validados.',
          );
        }
        const contentHash = await this.checklistContentHash(client, checklistId, versionId);
        const status = integer(version, 'required_signatures') === 0 ? 'APPROVED' : 'IN_REVIEW';
        await this.repository.updateChecklistVersionStatus(client, versionId, status, contentHash);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CHECKLIST_SUBMITTED',
          'CHECKLIST_TEMPLATE_VERSION',
          versionId,
          version,
          { status, content_hash_sha256: contentHash },
        );
        if (status === 'IN_REVIEW') {
          await this.notifyChecklistValidation(
            client,
            user,
            checklistId,
            versionId,
            contentHash,
            text(version, 'signature_policy') as SignaturePolicy,
            typeof version.manager_guidance === 'string'
              ? normalizeNullableText(version.manager_guidance)
              : null,
          );
        }
        return this.requiredChecklistDetail(client, checklistId);
      },
    );
  }

  async submitChecklistConfigured(
    user: AuthenticatedUser,
    checklistId: string,
    route: ChecklistSubmissionRoute,
    audit: RequestAuditMetadata,
  ) {
    const guidance = normalizeText(route.managerGuidance);
    const validatorUserIds = [...new Set(route.validatorUserIds.filter(Boolean))];
    if (validatorUserIds.length !== route.validatorUserIds.length) {
      throw invalid(
        'CHECKLIST_VALIDATOR_DUPLICATED',
        'A rota de validação contém pessoas repetidas.',
      );
    }
    if (route.responsibleUserId && !validatorUserIds.includes(route.responsibleUserId)) {
      validatorUserIds.push(route.responsibleUserId);
    }

    const fixedRequirements: Readonly<Partial<Record<SignaturePolicy, number>>> = {
      QUALIDADE: 1,
      SEGURANCA: 1,
      QUALIDADE_OU_SEGURANCA: 1,
      QUALIDADE_E_SEGURANCA: 2,
    };
    const requiredSignatures =
      fixedRequirements[route.signaturePolicy] ?? Math.max(1, validatorUserIds.length);
    if (route.signaturePolicy === 'PERSONALIZADA' && validatorUserIds.length === 0) {
      throw invalid(
        'CHECKLIST_CUSTOM_VALIDATOR_REQUIRED',
        'Selecione ao menos uma pessoa autorizada para a validação personalizada.',
      );
    }

    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const version = await this.requireEditableChecklistVersion(client, checklistId);
        const versionId = text(version, 'id');
        if ((await this.repository.countActiveChecklistItems(client, versionId)) === 0) {
          throw invalid(
            'CHECKLIST_WITHOUT_ITEMS',
            'Adicione ao menos uma etapa ativa antes de enviar o checklist.',
          );
        }

        let technicalAreaId = version.technical_area_id as string | null;
        let technicalRoleId = version.technical_role_id as string | null;
        for (const validatorUserId of validatorUserIds) {
          const assignment = await this.repository.validatorAssignment(client, validatorUserId);
          if (assignment?.can_sign !== true) {
            throw invalid(
              'CHECKLIST_VALIDATOR_NOT_AUTHORIZED',
              'Uma das pessoas selecionadas não possui atribuição técnica ativa com permissão de assinatura.',
              { usuario_id: validatorUserId },
            );
          }
          if (validatorUserId === route.responsibleUserId || technicalAreaId === null) {
            technicalAreaId = text(assignment, 'area_id');
            technicalRoleId = (assignment.role_id as string | null) ?? null;
          }
        }
        if (route.signaturePolicy === 'PERSONALIZADA' && technicalAreaId === null) {
          throw invalid(
            'CHECKLIST_CUSTOM_VALIDATION_SCOPE_REQUIRED',
            'A pessoa selecionada precisa possuir uma área técnica ativa.',
          );
        }

        await this.repository.updateChecklistSubmissionRoute(client, versionId, {
          technicalAreaId,
          technicalRoleId,
          signaturePolicy: route.signaturePolicy,
          requiredSignatures,
          segregationRequired: route.segregationRequired,
          managerGuidance: guidance,
        });
        await this.repository.replaceChecklistValidatorUsers(
          client,
          user.tenantId,
          versionId,
          user.id,
          validatorUserIds,
        );
        const contentHash = await this.checklistContentHash(client, checklistId, versionId);
        await this.repository.updateChecklistVersionStatus(
          client,
          versionId,
          'IN_REVIEW',
          contentHash,
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CHECKLIST_SUBMITTED_WITH_ROUTE',
          'CHECKLIST_TEMPLATE_VERSION',
          versionId,
          version,
          {
            status: 'IN_REVIEW',
            politica_assinatura: route.signaturePolicy,
            assinaturas_exigidas: requiredSignatures,
            responsavel_atual_id: route.responsibleUserId,
            usuarios_validadores: validatorUserIds,
            hash_conteudo: contentHash,
          },
        );
        await this.notifyChecklistValidation(
          client,
          user,
          checklistId,
          versionId,
          contentHash,
          route.signaturePolicy,
          guidance,
        );
        return this.requiredChecklistDetail(client, checklistId);
      },
    );
  }

  async reviewChecklist(
    user: AuthenticatedUser,
    checklistId: string,
    decision: ReviewDecision,
    justification: string,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const version = await this.repository.findLatestChecklistVersion(client, checklistId, true);
        if (!version) throw notFound('Revisão do checklist');
        if (version.status !== 'IN_REVIEW') {
          throw conflict(
            'CHECKLIST_NOT_IN_REVIEW',
            'Somente uma revisão em análise aceita uma decisão técnica.',
          );
        }
        const context = await this.repository.getValidatorContext(client, user.id);
        const policy = text(version, 'signature_policy') as SignaturePolicy;
        const targetAreaId = version.technical_area_id as string | null;
        const versionId = text(version, 'id');
        const selectedForRoute = await this.repository.checklistValidatorUserEligible(
          client,
          versionId,
          user.id,
        );
        if (!context || !selectedForRoute || !canReviewPolicy(policy, targetAreaId, context)) {
          throw new AppError({
            code: 'CHECKLIST_REVIEWER_NOT_ELIGIBLE',
            message: 'Seu perfil técnico não atende à política de validação deste checklist.',
            statusCode: 403,
          });
        }
        const normalizedJustification = normalizeText(justification);
        const contentHash = text(version, 'content_hash_sha256');
        await this.repository.insertChecklistReview(
          client,
          user.tenantId,
          versionId,
          decision,
          normalizedJustification,
          user.id,
          reviewRoleSnapshot(context),
          contentHash,
        );
        let nextStatus: 'IN_REVIEW' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED' = 'IN_REVIEW';
        if (decision === 'CHANGES_REQUESTED') nextStatus = 'CHANGES_REQUESTED';
        if (decision === 'REJECTED') nextStatus = 'REJECTED';
        if (decision === 'APPROVED') {
          const progress = await this.repository.reviewProgress(client, versionId);
          if (approvalReached(policy, integer(version, 'required_signatures'), progress)) {
            nextStatus = 'APPROVED';
          }
        }
        await this.repository.updateChecklistVersionStatus(
          client,
          versionId,
          nextStatus,
          contentHash,
        );
        if (nextStatus !== 'IN_REVIEW') {
          await this.repository.retractChecklistValidationNotifications(
            client,
            user.tenantId,
            versionId,
          );
        }
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CHECKLIST_REVIEW_RECORDED',
          'CHECKLIST_TEMPLATE_VERSION',
          versionId,
          version,
          { decisao: decision, status: nextStatus, hash_conteudo: contentHash },
        );
        return this.requiredChecklistDetail(client, checklistId);
      },
    );
  }

  async publishChecklist(
    user: AuthenticatedUser,
    checklistId: string,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const version = await this.repository.findLatestChecklistVersion(client, checklistId, true);
        if (!version) throw notFound('Revisão do checklist');
        if (version.status !== 'APPROVED') {
          throw conflict(
            'CHECKLIST_NOT_APPROVED',
            'Somente uma revisão aprovada pode ser publicada.',
          );
        }
        const versionId = text(version, 'id');
        const contentHash = await this.checklistContentHash(client, checklistId, versionId);
        if (contentHash !== text(version, 'content_hash_sha256')) {
          throw conflict(
            'CHECKLIST_CONTENT_CHANGED_AFTER_APPROVAL',
            'O conteúdo mudou após a validação. Submeta a revisão novamente.',
          );
        }
        await this.repository.supersedePublishedChecklist(client, checklistId, versionId);
        await this.repository.updateChecklistVersionStatus(
          client,
          versionId,
          'PUBLISHED',
          contentHash,
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CHECKLIST_PUBLISHED',
          'CHECKLIST_TEMPLATE_VERSION',
          versionId,
          version,
          { status: 'PUBLISHED', content_hash_sha256: contentHash },
        );
        return this.requiredChecklistDetail(client, checklistId);
      },
    );
  }

  async createChecklistRevision(
    user: AuthenticatedUser,
    checklistId: string,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const template = await this.repository.findChecklistTemplate(client, checklistId, true);
        if (!template) throw notFound('Checklist');
        const existingDraft = await this.repository.findEditableChecklistVersion(
          client,
          checklistId,
          true,
        );
        if (existingDraft) {
          throw conflict(
            'CHECKLIST_DRAFT_ALREADY_EXISTS',
            'Finalize ou descarte a revisão editável antes de criar outra.',
          );
        }
        const source = await this.repository.findLatestChecklistVersion(client, checklistId, true);
        if (!source || !['PUBLISHED', 'APPROVED', 'REJECTED'].includes(text(source, 'status'))) {
          throw conflict(
            'CHECKLIST_REVISION_SOURCE_INVALID',
            'A revisão anterior ainda não está em um estado que permita clonagem.',
          );
        }
        const versionId = randomUUID();
        await this.repository.createChecklistRevision(
          client,
          user.tenantId,
          checklistId,
          source,
          versionId,
          user.id,
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CHECKLIST_REVISION_CREATED',
          'CHECKLIST_TEMPLATE_VERSION',
          versionId,
          null,
          { checklist_id: checklistId, versao_origem_id: source.id },
        );
        return this.requiredChecklistDetail(client, checklistId);
      },
    );
  }

  async listPlans(user: AuthenticatedUser, query: PlanListQuery) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => ({
        itens: await this.repository.listPlans(client, query),
        limite: query.limit,
      }),
    );
  }

  async getPlan(user: AuthenticatedUser, planId: string) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const detail = await this.repository.getPlanDetail(client, planId);
        if (!detail) throw notFound('Plano de manutenção');
        return detail;
      },
    );
  }

  async createPlan(
    user: AuthenticatedUser,
    input: MaintenancePlanInput,
    audit: RequestAuditMetadata,
  ) {
    const normalized = normalizePlanInput(input);
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        await this.requireActiveAssetContext(client, normalized.assetId, normalized.componentId);
        await this.requireTechnicalScope(client, normalized.technicalAreaId, null);
        await this.requirePublishedChecklistForPlan(client, normalized);
        const planId = randomUUID();
        const versionId = randomUUID();
        const contentHash = hashPayload(normalized);
        await this.repository.createPlan(
          client,
          user.tenantId,
          planId,
          versionId,
          user.id,
          normalized,
          contentHash,
        );
        const detail = await this.requiredPlanDetail(client, planId);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'MAINTENANCE_PLAN_CREATED',
          'MAINTENANCE_PLAN',
          planId,
          null,
          detail,
        );
        return detail;
      },
    );
  }

  async updatePlan(
    user: AuthenticatedUser,
    planId: string,
    patch: MaintenancePlanPatch,
    audit: RequestAuditMetadata,
  ) {
    validatePlanTrigger(patch);
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const plan = await this.repository.findPlan(client, planId, true);
        if (!plan) throw notFound('Plano de manutenção');
        const version = await this.repository.findEditablePlanVersion(client, planId, true);
        if (!version) {
          if (
            patch.lifecycleStatus !== undefined &&
            Object.keys(patch).every((key) => key === 'lifecycleStatus')
          ) {
            const before = await this.requiredPlanDetail(client, planId);
            await this.repository.updatePlanLifecycleStatus(client, planId, patch.lifecycleStatus);
            const after = await this.requiredPlanDetail(client, planId);
            await this.repository.writeAudit(
              client,
              user.tenantId,
              user.id,
              audit,
              'MAINTENANCE_PLAN_LIFECYCLE_UPDATED',
              'MAINTENANCE_PLAN',
              planId,
              before,
              after,
            );
            return after;
          }
          throw conflict(
            'PLAN_REVISION_NOT_EDITABLE',
            'Crie uma nova revisão antes de alterar um plano publicado.',
          );
        }
        const checklistVersionId =
          patch.checklistTemplateVersionId ?? text(version, 'checklist_template_version_id');
        const areaId =
          patch.technicalAreaId === undefined
            ? (version.technical_area_id as string | null)
            : patch.technicalAreaId;
        await this.requireTechnicalScope(client, areaId, null);
        await this.requirePublishedChecklistForPlan(client, {
          assetId: text(plan, 'asset_id'),
          componentId: plan.component_id as string | null,
          checklistTemplateVersionId: checklistVersionId,
        });
        const normalizedPatch: MaintenancePlanPatch = {
          ...patch,
          ...(patch.code === undefined ? {} : { code: normalizeCode(patch.code) }),
          ...(patch.name === undefined ? {} : { name: normalizeText(patch.name) }),
          ...(patch.triggerUnit === undefined
            ? {}
            : { triggerUnit: normalizeNullableText(patch.triggerUnit) }),
        };
        const contentHash = hashPayload({
          ...version,
          ...normalizedPatch,
          plan_id: planId,
          checklist_template_version_id: checklistVersionId,
        });
        const before = await this.requiredPlanDetail(client, planId);
        await this.repository.updatePlan(
          client,
          planId,
          text(version, 'id'),
          normalizedPatch,
          plan,
          version,
          contentHash,
        );
        const after = await this.requiredPlanDetail(client, planId);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'MAINTENANCE_PLAN_UPDATED',
          'MAINTENANCE_PLAN',
          planId,
          before,
          after,
        );
        return after;
      },
    );
  }

  async publishPlan(user: AuthenticatedUser, planId: string, audit: RequestAuditMetadata) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const plan = await this.repository.findPlan(client, planId, true);
        if (!plan) throw notFound('Plano de manutenção');
        const version = await this.repository.findEditablePlanVersion(client, planId, true);
        if (!version) {
          throw conflict(
            'PLAN_REVISION_NOT_EDITABLE',
            'Não há uma revisão editável para publicar.',
          );
        }
        await this.requirePublishedChecklistForPlan(client, {
          assetId: text(plan, 'asset_id'),
          componentId: plan.component_id as string | null,
          checklistTemplateVersionId: text(version, 'checklist_template_version_id'),
        });
        const contentHash = hashPayload({ plan, version });
        await this.repository.publishPlanVersion(client, planId, text(version, 'id'), contentHash);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'MAINTENANCE_PLAN_PUBLISHED',
          'MAINTENANCE_PLAN_VERSION',
          text(version, 'id'),
          version,
          { status: 'PUBLISHED', content_hash_sha256: contentHash },
        );
        return this.requiredPlanDetail(client, planId);
      },
    );
  }

  async createPlanRevision(user: AuthenticatedUser, planId: string, audit: RequestAuditMetadata) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const plan = await this.repository.findPlan(client, planId, true);
        if (!plan) throw notFound('Plano de manutenção');
        if (await this.repository.findEditablePlanVersion(client, planId, true)) {
          throw conflict(
            'PLAN_DRAFT_ALREADY_EXISTS',
            'Finalize a revisão editável antes de criar outra.',
          );
        }
        const source = await this.repository.findLatestPlanVersion(client, planId, true);
        if (!source || !['PUBLISHED', 'REJECTED'].includes(text(source, 'status'))) {
          throw conflict(
            'PLAN_REVISION_SOURCE_INVALID',
            'A revisão anterior ainda não permite clonagem.',
          );
        }
        const versionId = randomUUID();
        await this.repository.createPlanRevision(
          client,
          user.tenantId,
          planId,
          source,
          versionId,
          user.id,
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'MAINTENANCE_PLAN_REVISION_CREATED',
          'MAINTENANCE_PLAN_VERSION',
          versionId,
          null,
          { plano_id: planId, versao_origem_id: source.id },
        );
        return this.requiredPlanDetail(client, planId);
      },
    );
  }

  private async requireActiveAssetContext(
    client: PoolClient,
    assetId: string,
    componentId: string | null,
  ): Promise<PlanningRow> {
    const context = await this.repository.findAssetContext(client, assetId, componentId);
    if (!context) {
      throw invalid(
        'ASSET_COMPONENT_CONTEXT_INVALID',
        'O ativo ou componente não pertence ao contexto informado.',
      );
    }
    if (!isActiveAsset(context)) {
      throw conflict(
        'ASSET_COMPONENT_CONTEXT_INACTIVE',
        'O ativo e o componente devem estar ativos para receber modelos e planos.',
      );
    }
    return context;
  }

  private async requireTechnicalScope(
    client: PoolClient,
    areaId: string | null,
    roleId: string | null,
  ): Promise<void> {
    if (!(await this.repository.technicalScopeExists(client, areaId, roleId))) {
      throw invalid(
        'TECHNICAL_SCOPE_INVALID',
        'A área ou o cargo técnico não existe, está inativo ou possui vínculo incorreto.',
      );
    }
  }

  private async requireEditableChecklistVersion(
    client: PoolClient,
    checklistId: string,
  ): Promise<PlanningRow> {
    const template = await this.repository.findChecklistTemplate(client, checklistId, true);
    if (!template) throw notFound('Checklist');
    const version = await this.repository.findEditableChecklistVersion(client, checklistId, true);
    if (!version) {
      throw conflict(
        'CHECKLIST_REVISION_NOT_EDITABLE',
        'Crie uma nova revisão antes de alterar um checklist submetido ou publicado.',
      );
    }
    return version;
  }

  private async validateItemParameter(
    client: PoolClient,
    template: PlanningRow,
    item: ChecklistItemInput,
  ): Promise<void> {
    if (item.parameterDefinitionId === null) return;
    const parameter = await this.repository.findParameter(
      client,
      item.parameterDefinitionId,
      text(template, 'asset_id'),
      template.component_id as string | null,
    );
    if (parameter?.status !== 'ACTIVE') {
      throw invalid(
        'CHECKLIST_PARAMETER_CONTEXT_INVALID',
        'O parâmetro não está ativo ou não pertence ao ativo/componente do checklist.',
      );
    }
    if (item.unit !== null && item.unit !== parameter.unit) {
      throw invalid(
        'CHECKLIST_PARAMETER_UNIT_MISMATCH',
        'A unidade da etapa difere da definição do parâmetro.',
        { unidade_esperada: parameter.unit },
      );
    }
  }

  private async checklistContentHash(
    client: PoolClient,
    checklistId: string,
    versionId: string,
  ): Promise<string> {
    const template = await this.repository.findChecklistTemplate(client, checklistId);
    const version = await this.repository.findLatestChecklistVersion(client, checklistId);
    if (template === null || version?.id !== versionId) throw notFound('Revisão do checklist');
    const items = await this.repository.listChecklistItems(client, versionId);
    return hashPayload({
      template: {
        code: template.code,
        name: template.name,
        asset_id: template.asset_id,
        component_id: template.component_id,
        checklist_type: template.checklist_type,
        criticality: template.criticality,
      },
      version: {
        revision: version.revision,
        technical_area_id: version.technical_area_id,
        technical_role_id: version.technical_role_id,
        signature_policy: version.signature_policy,
        required_signatures: version.required_signatures,
        segregation_required: version.segregation_required,
        manager_guidance: version.manager_guidance,
        safety_requirements: version.safety_requirements,
      },
      items,
    });
  }

  private async requirePublishedChecklistForPlan(
    client: PoolClient,
    input: {
      readonly assetId: string;
      readonly componentId: string | null;
      readonly checklistTemplateVersionId: string;
    },
  ): Promise<void> {
    const context = await this.repository.findPublishedChecklistContext(
      client,
      input.checklistTemplateVersionId,
    );
    if (
      context?.status !== 'PUBLISHED' ||
      integer(context, 'total_itens') < 1 ||
      context.asset_id !== input.assetId ||
      context.component_id !== input.componentId
    ) {
      throw invalid(
        'PLAN_CHECKLIST_CONTEXT_INVALID',
        'O plano exige um checklist publicado, executável e vinculado ao mesmo ativo/componente.',
      );
    }
  }

  private async requiredChecklistDetail(
    client: PoolClient,
    checklistId: string,
  ): Promise<PlanningRow> {
    const detail = await this.repository.getChecklistDetail(client, checklistId);
    if (!detail) throw notFound('Checklist');
    return detail;
  }

  private async notifyChecklistValidation(
    client: PoolClient,
    user: AuthenticatedUser,
    checklistId: string,
    versionId: string,
    contentHash: string,
    signaturePolicy: SignaturePolicy,
    managerGuidance: string | null,
  ): Promise<void> {
    const template = await this.repository.findChecklistTemplate(client, checklistId);
    if (!template) throw notFound('Checklist');

    const notificationId = await this.repository.createChecklistValidationNotification(
      client,
      user.tenantId,
      {
        checklistId,
        versionId,
        contentHash,
        title: `Validar checklist: ${text(template, 'name')}`,
        message:
          managerGuidance ??
          'Revise as etapas, os riscos, as evidências e os critérios de aceite desta versão.',
        priority: this.notificationPriority(template.criticality),
        signaturePolicy,
      },
    );
    const coverage = await this.repository.attachChecklistValidationRecipients(
      client,
      user.tenantId,
      notificationId,
      versionId,
      signaturePolicy,
    );
    const areas = new Set(coverage.areaCodes);
    const complete =
      signaturePolicy === 'QUALIDADE'
        ? areas.has('QUALITY')
        : signaturePolicy === 'SEGURANCA'
          ? areas.has('SAFETY')
          : signaturePolicy === 'QUALIDADE_OU_SEGURANCA'
            ? areas.has('QUALITY') || areas.has('SAFETY')
            : signaturePolicy === 'QUALIDADE_E_SEGURANCA'
              ? areas.has('QUALITY') && areas.has('SAFETY')
              : coverage.recipientCount > 0;
    if (!complete) {
      throw invalid(
        'CHECKLIST_VALIDATION_RECIPIENT_REQUIRED',
        'Não existe assinante ativo para atender à política de validação selecionada.',
        { politica_assinatura: signaturePolicy, areas_disponiveis: [...areas] },
      );
    }
  }

  private notificationPriority(value: unknown): 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (normalized === 'CRITICAL' || normalized === 'CRITICA' || normalized === 'CRÍTICA') {
      return 'CRITICAL';
    }
    if (normalized === 'HIGH' || normalized === 'ALTA') return 'HIGH';
    if (normalized === 'LOW' || normalized === 'BAIXA') return 'LOW';
    if (normalized === 'INFO') return 'INFO';
    return 'MEDIUM';
  }

  private async requiredPlanDetail(client: PoolClient, planId: string): Promise<PlanningRow> {
    const detail = await this.repository.getPlanDetail(client, planId);
    if (!detail) throw notFound('Plano de manutenção');
    return detail;
  }
}
