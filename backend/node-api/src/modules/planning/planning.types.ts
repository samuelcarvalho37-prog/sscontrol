export type ChecklistVersionStatus =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'CHANGES_REQUESTED'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'SUPERSEDED'
  | 'REJECTED';

export type ChecklistResponseType =
  | 'CONFIRMACAO'
  | 'OK_NOK'
  | 'NUMERO'
  | 'PARAMETRO'
  | 'TEXTO'
  | 'SELECAO'
  | 'EVIDENCIA'
  | 'LEITURA_OPERACIONAL'
  | 'INSTRUCAO';

export type SignaturePolicy =
  | 'QUALIDADE_OU_SEGURANCA'
  | 'QUALIDADE'
  | 'SEGURANCA'
  | 'QUALIDADE_E_SEGURANCA'
  | 'PERSONALIZADA';

export type Criticality = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type LifecycleStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type PlanType =
  | 'PREVENTIVE'
  | 'PREDICTIVE'
  | 'INSPECTION'
  | 'LUBRICATION'
  | 'CORRECTIVE'
  | 'CONDITION_BASED';
export type TriggerType = 'PERIODICITY' | 'HOUR_METER' | 'CONDITION' | 'MANUAL' | 'OCCURRENCE';
export type StopMode = 'NO_STOP' | 'MANDATORY_STOP' | 'EXECUTOR_DECISION';
export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

export interface RequestAuditMetadata {
  readonly traceId: string;
  readonly userAgent: string | null;
  readonly ipAddress: string;
  readonly roleSnapshot: string;
}

export interface ChecklistInput {
  readonly code: string;
  readonly name: string;
  readonly assetId: string;
  readonly componentId: string | null;
  readonly checklistType: string;
  readonly criticality: Criticality;
  readonly technicalAreaId: string | null;
  readonly technicalRoleId: string | null;
  readonly signaturePolicy: SignaturePolicy;
  readonly requiredSignatures: number;
  readonly segregationRequired: boolean;
  readonly managerGuidance: string | null;
  readonly safetyRequirements: readonly string[];
}

export interface ChecklistPatch {
  readonly code?: string;
  readonly name?: string;
  readonly lifecycleStatus?: LifecycleStatus;
  readonly criticality?: Criticality;
  readonly technicalAreaId?: string | null;
  readonly technicalRoleId?: string | null;
  readonly signaturePolicy?: SignaturePolicy;
  readonly requiredSignatures?: number;
  readonly segregationRequired?: boolean;
  readonly managerGuidance?: string | null;
  readonly safetyRequirements?: readonly string[];
}

export interface ChecklistItemInput {
  readonly title: string;
  readonly instruction: string | null;
  readonly responseTypeCode: ChecklistResponseType;
  readonly category: string;
  readonly required: boolean;
  readonly evidenceRequired: boolean;
  readonly minimumEvidencePhotos: number;
  readonly blocksCompletion: boolean;
  readonly parameterDefinitionId: string | null;
  readonly expectedValue: string | null;
  readonly minimumValue: number | null;
  readonly maximumValue: number | null;
  readonly unit: string | null;
  readonly options: readonly string[];
  readonly validationRuleCode: string | null;
  readonly weight: number;
}

export interface ChecklistAggregateItemInput extends ChecklistItemInput {
  readonly id: string | null;
  readonly parameterName: string | null;
}

export interface ChecklistAggregateInput {
  readonly checklistId: string | null;
  readonly sourceTechnicalAnalysisId: string | null;
  readonly checklist: ChecklistInput;
  readonly items: readonly ChecklistAggregateItemInput[];
}

export interface ChecklistSubmissionRoute {
  readonly signaturePolicy: SignaturePolicy;
  readonly segregationRequired: boolean;
  readonly managerGuidance: string;
  readonly responsibleUserId: string | null;
  readonly validatorUserIds: readonly string[];
}

export interface ChecklistListQuery {
  readonly search: string;
  readonly status: ChecklistVersionStatus | null;
  readonly assetId: string | null;
  readonly limit: number;
}

export interface MaintenancePlanInput {
  readonly code: string;
  readonly name: string;
  readonly assetId: string;
  readonly componentId: string | null;
  readonly planType: PlanType;
  readonly checklistTemplateVersionId: string;
  readonly criticality: Criticality;
  readonly triggerType: TriggerType;
  readonly triggerValue: number | null;
  readonly triggerUnit: string | null;
  readonly recurrenceDays: number | null;
  readonly estimatedDurationMinutes: number | null;
  readonly lockoutRequired: boolean;
  readonly evidenceRequired: boolean;
  readonly maximumSessions: number | null;
  readonly stopMode: StopMode;
  readonly technicalAnalysis: Readonly<Record<string, unknown>>;
  readonly technicalAreaId: string | null;
}

export interface MaintenancePlanPatch {
  readonly code?: string;
  readonly name?: string;
  readonly lifecycleStatus?: LifecycleStatus;
  readonly checklistTemplateVersionId?: string;
  readonly criticality?: Criticality;
  readonly triggerType?: TriggerType;
  readonly triggerValue?: number | null;
  readonly triggerUnit?: string | null;
  readonly recurrenceDays?: number | null;
  readonly estimatedDurationMinutes?: number | null;
  readonly lockoutRequired?: boolean;
  readonly evidenceRequired?: boolean;
  readonly maximumSessions?: number | null;
  readonly stopMode?: StopMode;
  readonly technicalAnalysis?: Readonly<Record<string, unknown>>;
  readonly technicalAreaId?: string | null;
}

export interface PlanListQuery {
  readonly search: string;
  readonly status: ChecklistVersionStatus | null;
  readonly assetId: string | null;
  readonly planType: PlanType | null;
  readonly limit: number;
}
