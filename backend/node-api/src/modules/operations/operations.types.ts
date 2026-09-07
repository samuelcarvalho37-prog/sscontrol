export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type SignaturePolicy =
  | 'QUALIDADE_OU_SEGURANCA'
  | 'QUALIDADE'
  | 'SEGURANCA'
  | 'QUALIDADE_E_SEGURANCA';
export type EvidenceType = 'PHOTO' | 'VIDEO' | 'DOCUMENT' | 'AUDIO' | 'OTHER';
export type ExecutionStopMode = 'NO_STOP' | 'STOPPED' | 'EXECUTOR_DECISION';

export interface RequestAuditMetadata {
  readonly traceId: string;
  readonly userAgent: string | null;
  readonly ipAddress: string;
  readonly roleSnapshot: string;
}

export interface WorkOrderInput {
  readonly planVersionId: string;
  readonly originType: string;
  readonly originEntityId: string | null;
  readonly workType: string;
  readonly title: string;
  readonly description: string;
  readonly priority: Priority;
  readonly responsibleId: string | null;
  readonly scheduledFor: string | null;
  readonly technicalAnalysis: Readonly<Record<string, unknown>>;
}

export interface WorkOrderCorrectionInput {
  readonly title: string;
  readonly description: string;
  readonly priority: Priority;
  readonly responsibleId: string | null;
  readonly scheduledFor: string | null;
  readonly technicalAnalysis: Readonly<Record<string, unknown>>;
}

export interface WorkOrderListQuery {
  readonly search: string;
  readonly status: string | null;
  readonly assetId: string | null;
  readonly limit: number;
}

export interface TechnicalDemandListQuery {
  readonly search: string;
  readonly statuses: readonly string[];
  readonly limit: number;
}

export interface MaintenanceActionListQuery {
  readonly search: string;
  readonly statuses: readonly string[];
  readonly assetId: string | null;
  readonly limit: number;
}

export interface ReviewSubmissionInput {
  readonly signaturePolicy: SignaturePolicy;
  readonly requiredSignatures: number;
  readonly firstResponseDueAt: string | null;
  readonly resolutionDueAt: string | null;
}

export interface SignatureInput {
  readonly declaration: string;
  readonly meaning: string;
}

export interface ExecutionResponseInput {
  readonly textValue: string | null;
  readonly numberValue: number | null;
  readonly booleanValue: boolean | null;
  readonly optionValue: string | null;
  readonly observation: string | null;
  readonly notApplicable: boolean;
}

export interface ExecutionBatchItemInput {
  readonly itemId: string;
  readonly response: string | null;
  readonly numericValue: number | null;
  readonly observation: string | null;
}

export interface EvidenceInput {
  readonly storageObjectId: string;
  readonly evidenceType: EvidenceType;
  readonly observation: string | null;
  readonly capturedAt: string | null;
}

export interface EvidenceUploadInput {
  readonly originalName: string;
  readonly mediaType: string;
  readonly stream: Readable;
  readonly observation: string | null;
  readonly capturedAt: string | null;
}

export interface CompletionInput {
  readonly result: string;
  readonly observation: string | null;
  readonly stopMode: ExecutionStopMode;
}

export interface ActionReviewInput {
  readonly decision: 'APPROVE' | 'REJECT';
  readonly comment: string;
}
import type { Readable } from 'node:stream';
