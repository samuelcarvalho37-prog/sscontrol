export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AlertSeverity = 'INFO' | Severity;
export type StopStatus =
  | 'OPEN'
  | 'WAITING_MAINTENANCE'
  | 'IN_MAINTENANCE'
  | 'WAITING_OPERATIONAL_RETURN'
  | 'COMPLETED'
  | 'CANCELLED';

export interface RequestAuditMetadata {
  readonly traceId: string;
  readonly userAgent: string | null;
  readonly ipAddress: string;
  readonly roleSnapshot: string;
}

export interface PageQuery {
  readonly search: string;
  readonly limit: number;
}

export interface OccurrenceListQuery extends PageQuery {
  readonly status: string | null;
  readonly treatmentStatus: string | null;
  readonly severity: Severity | null;
  readonly assetId: string | null;
}

export interface CreateOccurrenceInput {
  readonly assetId: string;
  readonly componentId: string | null;
  readonly occurrenceType: string;
  readonly title: string;
  readonly description: string;
  readonly severity: Severity;
  readonly equipmentStopped: boolean;
  readonly stopType: string | null;
  readonly stopReason: string | null;
  readonly occurredAt: string | null;
}

export interface TechnicalAnalysisInput {
  readonly title: string;
  readonly diagnosis: string;
  readonly risk: string;
  readonly probableCause: string | null;
  readonly recommendation: string;
  readonly recommendsChecklist: boolean;
  readonly recommendsWorkOrder: boolean;
  readonly priority: Severity;
  readonly report: Readonly<Record<string, unknown>>;
}

export type ParameterActionRequestType = 'INSPECTION' | 'CHECKLIST' | 'LIMIT_ADJUSTMENT';

export interface ParameterActionRequestInput {
  readonly readingId: string;
  readonly requestType: ParameterActionRequestType;
  readonly priority: Severity | null;
  readonly observation: string | null;
  readonly probableCause: string | null;
  readonly risk: string | null;
  readonly proposedMinimum: number | null;
  readonly proposedMaximum: number | null;
}

export interface StopListQuery extends PageQuery {
  readonly status: StopStatus | null;
  readonly assetId: string | null;
  readonly openedOnly: boolean;
}

export interface CreateStopInput {
  readonly assetId: string;
  readonly componentId: string | null;
  readonly origin: string;
  readonly stopType: string;
  readonly reason: string;
  readonly startedAt: string;
  readonly returnToleranceMinutes: number;
}

export interface TransitionStopInput {
  readonly status: StopStatus;
  readonly returnCategory: string | null;
  readonly divergenceJustification: string | null;
}

export interface AlertListQuery extends PageQuery {
  readonly status: string | null;
  readonly severity: AlertSeverity | null;
  readonly assetId: string | null;
}

export interface NotificationListQuery extends PageQuery {
  readonly unreadOnly: boolean;
  readonly priority: AlertSeverity | null;
  readonly context: string | null;
}

export interface AnalyticsQuery {
  readonly assetId: string | null;
  readonly startAt: string;
  readonly endAt: string;
  readonly rankingLimit: number;
}
