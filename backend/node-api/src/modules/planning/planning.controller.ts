import type { FastifyRequest } from 'fastify';

import { AppError } from '../../core/errors/app-error.js';
import { successEnvelope } from '../../core/http/envelope.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { PlanningService } from './planning.service.js';
import type {
  ChecklistResponseType,
  ChecklistVersionStatus,
  Criticality,
  LifecycleStatus,
  PlanType,
  ReviewDecision,
  SignaturePolicy,
  StopMode,
  TriggerType,
} from './planning.types.js';

interface IdentifierParams {
  readonly checklistId?: string;
  readonly itemId?: string;
  readonly planId?: string;
}

interface ChecklistListQuery {
  readonly busca?: string;
  readonly status?: ChecklistVersionStatus;
  readonly ativo_id?: string;
  readonly limite?: number;
}

interface ChecklistBody {
  readonly codigo: string;
  readonly nome: string;
  readonly ativo_id: string;
  readonly componente_id: string | null;
  readonly tipo: string;
  readonly criticidade: Criticality;
  readonly area_tecnica_id: string | null;
  readonly cargo_tecnico_id: string | null;
  readonly politica_assinatura: SignaturePolicy;
  readonly assinaturas_exigidas: number;
  readonly segregacao_exigida: boolean;
  readonly orientacao_gestor: string | null;
  readonly requisitos_seguranca: readonly string[];
}

interface ChecklistPatchBody {
  readonly codigo?: string;
  readonly nome?: string;
  readonly status_ciclo_vida?: LifecycleStatus;
  readonly criticidade?: Criticality;
  readonly area_tecnica_id?: string | null;
  readonly cargo_tecnico_id?: string | null;
  readonly politica_assinatura?: SignaturePolicy;
  readonly assinaturas_exigidas?: number;
  readonly segregacao_exigida?: boolean;
  readonly orientacao_gestor?: string | null;
  readonly requisitos_seguranca?: readonly string[];
}

interface ChecklistItemBody {
  readonly titulo: string;
  readonly instrucao: string | null;
  readonly tipo_resposta: ChecklistResponseType;
  readonly categoria: string;
  readonly obrigatoria: boolean;
  readonly exige_evidencia: boolean;
  readonly minimo_fotos: number;
  readonly bloqueia_conclusao: boolean;
  readonly parametro_id: string | null;
  readonly valor_esperado: string | null;
  readonly valor_minimo: number | null;
  readonly valor_maximo: number | null;
  readonly unidade: string | null;
  readonly opcoes: readonly string[];
  readonly regra_validacao: string | null;
  readonly peso: number;
}

interface ChecklistAggregateItemBody extends ChecklistItemBody {
  readonly id: string | null;
  readonly parametro_nome: string | null;
}

interface ChecklistAggregateBody {
  readonly checklist_id: string | null;
  readonly analise_tecnica_origem_id: string | null;
  readonly checklist: ChecklistBody;
  readonly itens: readonly ChecklistAggregateItemBody[];
}

interface ReorderBody {
  readonly itens_ids: readonly string[];
}

interface ReviewBody {
  readonly decisao: ReviewDecision;
  readonly justificativa: string;
}

interface SubmitChecklistConfiguredBody {
  readonly politica_assinatura: SignaturePolicy;
  readonly comentario: string;
  readonly exige_segregacao: boolean;
  readonly responsavel_atual_id: string | null;
  readonly usuarios_validadores: readonly string[];
}

interface PlanListQuery {
  readonly busca?: string;
  readonly status?: ChecklistVersionStatus;
  readonly ativo_id?: string;
  readonly tipo?: PlanType;
  readonly limite?: number;
}

interface PlanBody {
  readonly codigo: string;
  readonly nome: string;
  readonly ativo_id: string;
  readonly componente_id: string | null;
  readonly tipo: PlanType;
  readonly checklist_versao_id: string;
  readonly criticidade: Criticality;
  readonly tipo_disparo: TriggerType;
  readonly valor_disparo: number | null;
  readonly unidade_disparo: string | null;
  readonly recorrencia_dias: number | null;
  readonly duracao_estimada_minutos: number | null;
  readonly exige_loto: boolean;
  readonly exige_evidencia: boolean;
  readonly maximo_sessoes: number | null;
  readonly modo_parada: StopMode;
  readonly analise_tecnica: Readonly<Record<string, unknown>>;
  readonly area_tecnica_id: string | null;
}

interface PlanPatchBody {
  readonly codigo?: string;
  readonly nome?: string;
  readonly status_ciclo_vida?: LifecycleStatus;
  readonly checklist_versao_id?: string;
  readonly criticidade?: Criticality;
  readonly tipo_disparo?: TriggerType;
  readonly valor_disparo?: number | null;
  readonly unidade_disparo?: string | null;
  readonly recorrencia_dias?: number | null;
  readonly duracao_estimada_minutos?: number | null;
  readonly exige_loto?: boolean;
  readonly exige_evidencia?: boolean;
  readonly maximo_sessoes?: number | null;
  readonly modo_parada?: StopMode;
  readonly analise_tecnica?: Readonly<Record<string, unknown>>;
  readonly area_tecnica_id?: string | null;
}

function user(request: FastifyRequest): AuthenticatedUser {
  const authenticated = request.auth?.user;
  if (!authenticated) {
    throw new AppError({
      code: 'AUTH_CONTEXT_MISSING',
      message: 'A sessão autenticada não está disponível.',
      statusCode: 401,
    });
  }
  return authenticated;
}

function requiredIdentifier(params: IdentifierParams, key: keyof IdentifierParams): string {
  const value = params[key];
  if (!value) {
    throw new AppError({
      code: 'ROUTE_IDENTIFIER_MISSING',
      message: 'O identificador obrigatório não foi informado.',
      statusCode: 400,
    });
  }
  return value;
}

function auditMetadata(request: FastifyRequest) {
  const authenticated = user(request);
  return {
    traceId: request.id,
    userAgent: request.headers['user-agent'] ?? null,
    ipAddress: request.ip,
    roleSnapshot: authenticated.roles.join(',') || authenticated.profile,
  };
}

function checklistItem(body: ChecklistItemBody) {
  return {
    title: body.titulo,
    instruction: body.instrucao,
    responseTypeCode: body.tipo_resposta,
    category: body.categoria,
    required: body.obrigatoria,
    evidenceRequired: body.exige_evidencia,
    minimumEvidencePhotos: body.minimo_fotos,
    blocksCompletion: body.bloqueia_conclusao,
    parameterDefinitionId: body.parametro_id,
    expectedValue: body.valor_esperado,
    minimumValue: body.valor_minimo,
    maximumValue: body.valor_maximo,
    unit: body.unidade,
    options: body.opcoes,
    validationRuleCode: body.regra_validacao,
    weight: body.peso,
  };
}

export class PlanningController {
  constructor(private readonly service: PlanningService) {}

  listItemTypes = async (request: FastifyRequest) =>
    successEnvelope(
      request,
      'maintenance.checklist-item-types.list',
      await this.service.listItemTypes(user(request)),
    );

  listChecklists = async (request: FastifyRequest<{ Querystring: ChecklistListQuery }>) =>
    successEnvelope(
      request,
      'maintenance.checklists.list',
      await this.service.listChecklists(user(request), {
        search: request.query.busca?.trim() ?? '',
        status: request.query.status ?? null,
        assetId: request.query.ativo_id ?? null,
        limit: request.query.limite ?? 50,
      }),
    );

  getChecklist = async (request: FastifyRequest<{ Params: IdentifierParams }>) =>
    successEnvelope(
      request,
      'maintenance.checklists.get',
      await this.service.getChecklist(
        user(request),
        requiredIdentifier(request.params, 'checklistId'),
      ),
    );

  createChecklist = async (request: FastifyRequest<{ Body: ChecklistBody }>) =>
    successEnvelope(
      request,
      'maintenance.checklists.create',
      await this.service.createChecklist(
        user(request),
        {
          code: request.body.codigo,
          name: request.body.nome,
          assetId: request.body.ativo_id,
          componentId: request.body.componente_id,
          checklistType: request.body.tipo,
          criticality: request.body.criticidade,
          technicalAreaId: request.body.area_tecnica_id,
          technicalRoleId: request.body.cargo_tecnico_id,
          signaturePolicy: request.body.politica_assinatura,
          requiredSignatures: request.body.assinaturas_exigidas,
          segregationRequired: request.body.segregacao_exigida,
          managerGuidance: request.body.orientacao_gestor,
          safetyRequirements: request.body.requisitos_seguranca,
        },
        auditMetadata(request),
      ),
    );

  saveChecklistAggregate = async (request: FastifyRequest<{ Body: ChecklistAggregateBody }>) => {
    const body = request.body;
    const checklist = body.checklist;
    return successEnvelope(
      request,
      'maintenance.checklists.aggregate.save',
      await this.service.saveChecklistAggregate(
        user(request),
        {
          checklistId: body.checklist_id,
          sourceTechnicalAnalysisId: body.analise_tecnica_origem_id,
          checklist: {
            code: checklist.codigo,
            name: checklist.nome,
            assetId: checklist.ativo_id,
            componentId: checklist.componente_id,
            checklistType: checklist.tipo,
            criticality: checklist.criticidade,
            technicalAreaId: checklist.area_tecnica_id,
            technicalRoleId: checklist.cargo_tecnico_id,
            signaturePolicy: checklist.politica_assinatura,
            requiredSignatures: checklist.assinaturas_exigidas,
            segregationRequired: checklist.segregacao_exigida,
            managerGuidance: checklist.orientacao_gestor,
            safetyRequirements: checklist.requisitos_seguranca,
          },
          items: body.itens.map((item) => ({
            ...checklistItem(item),
            id: item.id,
            parameterName: item.parametro_nome,
          })),
        },
        auditMetadata(request),
      ),
    );
  };

  updateChecklist = async (
    request: FastifyRequest<{ Params: IdentifierParams; Body: ChecklistPatchBody }>,
  ) => {
    const body = request.body;
    return successEnvelope(
      request,
      'maintenance.checklists.update',
      await this.service.updateChecklist(
        user(request),
        requiredIdentifier(request.params, 'checklistId'),
        {
          ...(body.codigo === undefined ? {} : { code: body.codigo }),
          ...(body.nome === undefined ? {} : { name: body.nome }),
          ...(body.status_ciclo_vida === undefined
            ? {}
            : { lifecycleStatus: body.status_ciclo_vida }),
          ...(body.criticidade === undefined ? {} : { criticality: body.criticidade }),
          ...(body.area_tecnica_id === undefined ? {} : { technicalAreaId: body.area_tecnica_id }),
          ...(body.cargo_tecnico_id === undefined
            ? {}
            : { technicalRoleId: body.cargo_tecnico_id }),
          ...(body.politica_assinatura === undefined
            ? {}
            : { signaturePolicy: body.politica_assinatura }),
          ...(body.assinaturas_exigidas === undefined
            ? {}
            : { requiredSignatures: body.assinaturas_exigidas }),
          ...(body.segregacao_exigida === undefined
            ? {}
            : { segregationRequired: body.segregacao_exigida }),
          ...(body.orientacao_gestor === undefined
            ? {}
            : { managerGuidance: body.orientacao_gestor }),
          ...(body.requisitos_seguranca === undefined
            ? {}
            : { safetyRequirements: body.requisitos_seguranca }),
        },
        auditMetadata(request),
      ),
    );
  };

  addChecklistItem = async (
    request: FastifyRequest<{ Params: IdentifierParams; Body: ChecklistItemBody }>,
  ) =>
    successEnvelope(
      request,
      'maintenance.checklists.items.create',
      await this.service.addChecklistItem(
        user(request),
        requiredIdentifier(request.params, 'checklistId'),
        checklistItem(request.body),
        auditMetadata(request),
      ),
    );

  updateChecklistItem = async (
    request: FastifyRequest<{ Params: IdentifierParams; Body: ChecklistItemBody }>,
  ) =>
    successEnvelope(
      request,
      'maintenance.checklists.items.update',
      await this.service.updateChecklistItem(
        user(request),
        requiredIdentifier(request.params, 'checklistId'),
        requiredIdentifier(request.params, 'itemId'),
        checklistItem(request.body),
        auditMetadata(request),
      ),
    );

  deleteChecklistItem = async (request: FastifyRequest<{ Params: IdentifierParams }>) =>
    successEnvelope(
      request,
      'maintenance.checklists.items.delete',
      await this.service.deleteChecklistItem(
        user(request),
        requiredIdentifier(request.params, 'checklistId'),
        requiredIdentifier(request.params, 'itemId'),
        auditMetadata(request),
      ),
    );

  reorderChecklistItems = async (
    request: FastifyRequest<{ Params: IdentifierParams; Body: ReorderBody }>,
  ) =>
    successEnvelope(
      request,
      'maintenance.checklists.items.reorder',
      await this.service.reorderChecklistItems(
        user(request),
        requiredIdentifier(request.params, 'checklistId'),
        request.body.itens_ids,
        auditMetadata(request),
      ),
    );

  submitChecklist = async (request: FastifyRequest<{ Params: IdentifierParams }>) =>
    successEnvelope(
      request,
      'maintenance.checklists.submit',
      await this.service.submitChecklist(
        user(request),
        requiredIdentifier(request.params, 'checklistId'),
        auditMetadata(request),
      ),
    );

  submitChecklistConfigured = async (
    request: FastifyRequest<{
      Params: IdentifierParams;
      Body: SubmitChecklistConfiguredBody;
    }>,
  ) =>
    successEnvelope(
      request,
      'maintenance.checklists.submit-configured',
      await this.service.submitChecklistConfigured(
        user(request),
        requiredIdentifier(request.params, 'checklistId'),
        {
          signaturePolicy: request.body.politica_assinatura,
          managerGuidance: request.body.comentario,
          segregationRequired: request.body.exige_segregacao,
          responsibleUserId: request.body.responsavel_atual_id,
          validatorUserIds: request.body.usuarios_validadores,
        },
        auditMetadata(request),
      ),
    );

  reviewChecklist = async (
    request: FastifyRequest<{ Params: IdentifierParams; Body: ReviewBody }>,
  ) =>
    successEnvelope(
      request,
      'maintenance.checklists.review',
      await this.service.reviewChecklist(
        user(request),
        requiredIdentifier(request.params, 'checklistId'),
        request.body.decisao,
        request.body.justificativa,
        auditMetadata(request),
      ),
    );

  publishChecklist = async (request: FastifyRequest<{ Params: IdentifierParams }>) =>
    successEnvelope(
      request,
      'maintenance.checklists.publish',
      await this.service.publishChecklist(
        user(request),
        requiredIdentifier(request.params, 'checklistId'),
        auditMetadata(request),
      ),
    );

  createChecklistRevision = async (request: FastifyRequest<{ Params: IdentifierParams }>) =>
    successEnvelope(
      request,
      'maintenance.checklists.revisions.create',
      await this.service.createChecklistRevision(
        user(request),
        requiredIdentifier(request.params, 'checklistId'),
        auditMetadata(request),
      ),
    );

  deleteChecklistDraft = async (request: FastifyRequest<{ Params: IdentifierParams }>) =>
    successEnvelope(
      request,
      'maintenance.checklists.delete',
      await this.service.deleteChecklistDraft(
        user(request),
        requiredIdentifier(request.params, 'checklistId'),
        auditMetadata(request),
      ),
    );

  listPlans = async (request: FastifyRequest<{ Querystring: PlanListQuery }>) =>
    successEnvelope(
      request,
      'maintenance.plans.list',
      await this.service.listPlans(user(request), {
        search: request.query.busca?.trim() ?? '',
        status: request.query.status ?? null,
        assetId: request.query.ativo_id ?? null,
        planType: request.query.tipo ?? null,
        limit: request.query.limite ?? 50,
      }),
    );

  getPlan = async (request: FastifyRequest<{ Params: IdentifierParams }>) =>
    successEnvelope(
      request,
      'maintenance.plans.get',
      await this.service.getPlan(user(request), requiredIdentifier(request.params, 'planId')),
    );

  createPlan = async (request: FastifyRequest<{ Body: PlanBody }>) =>
    successEnvelope(
      request,
      'maintenance.plans.create',
      await this.service.createPlan(
        user(request),
        {
          code: request.body.codigo,
          name: request.body.nome,
          assetId: request.body.ativo_id,
          componentId: request.body.componente_id,
          planType: request.body.tipo,
          checklistTemplateVersionId: request.body.checklist_versao_id,
          criticality: request.body.criticidade,
          triggerType: request.body.tipo_disparo,
          triggerValue: request.body.valor_disparo,
          triggerUnit: request.body.unidade_disparo,
          recurrenceDays: request.body.recorrencia_dias,
          estimatedDurationMinutes: request.body.duracao_estimada_minutos,
          lockoutRequired: request.body.exige_loto,
          evidenceRequired: request.body.exige_evidencia,
          maximumSessions: request.body.maximo_sessoes,
          stopMode: request.body.modo_parada,
          technicalAnalysis: request.body.analise_tecnica,
          technicalAreaId: request.body.area_tecnica_id,
        },
        auditMetadata(request),
      ),
    );

  updatePlan = async (
    request: FastifyRequest<{ Params: IdentifierParams; Body: PlanPatchBody }>,
  ) => {
    const body = request.body;
    return successEnvelope(
      request,
      'maintenance.plans.update',
      await this.service.updatePlan(
        user(request),
        requiredIdentifier(request.params, 'planId'),
        {
          ...(body.codigo === undefined ? {} : { code: body.codigo }),
          ...(body.nome === undefined ? {} : { name: body.nome }),
          ...(body.status_ciclo_vida === undefined
            ? {}
            : { lifecycleStatus: body.status_ciclo_vida }),
          ...(body.checklist_versao_id === undefined
            ? {}
            : { checklistTemplateVersionId: body.checklist_versao_id }),
          ...(body.criticidade === undefined ? {} : { criticality: body.criticidade }),
          ...(body.tipo_disparo === undefined ? {} : { triggerType: body.tipo_disparo }),
          ...(body.valor_disparo === undefined ? {} : { triggerValue: body.valor_disparo }),
          ...(body.unidade_disparo === undefined ? {} : { triggerUnit: body.unidade_disparo }),
          ...(body.recorrencia_dias === undefined ? {} : { recurrenceDays: body.recorrencia_dias }),
          ...(body.duracao_estimada_minutos === undefined
            ? {}
            : { estimatedDurationMinutes: body.duracao_estimada_minutos }),
          ...(body.exige_loto === undefined ? {} : { lockoutRequired: body.exige_loto }),
          ...(body.exige_evidencia === undefined ? {} : { evidenceRequired: body.exige_evidencia }),
          ...(body.maximo_sessoes === undefined ? {} : { maximumSessions: body.maximo_sessoes }),
          ...(body.modo_parada === undefined ? {} : { stopMode: body.modo_parada }),
          ...(body.analise_tecnica === undefined
            ? {}
            : { technicalAnalysis: body.analise_tecnica }),
          ...(body.area_tecnica_id === undefined ? {} : { technicalAreaId: body.area_tecnica_id }),
        },
        auditMetadata(request),
      ),
    );
  };

  publishPlan = async (request: FastifyRequest<{ Params: IdentifierParams }>) =>
    successEnvelope(
      request,
      'maintenance.plans.publish',
      await this.service.publishPlan(
        user(request),
        requiredIdentifier(request.params, 'planId'),
        auditMetadata(request),
      ),
    );

  createPlanRevision = async (request: FastifyRequest<{ Params: IdentifierParams }>) =>
    successEnvelope(
      request,
      'maintenance.plans.revisions.create',
      await this.service.createPlanRevision(
        user(request),
        requiredIdentifier(request.params, 'planId'),
        auditMetadata(request),
      ),
    );
}
