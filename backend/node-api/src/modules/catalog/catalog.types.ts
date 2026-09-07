export type RecordStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type Criticality = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type OperationalStatus =
  | 'OPERATING'
  | 'STOPPED'
  | 'INSPECTION'
  | 'MAINTENANCE_PLANNED'
  | 'MAINTENANCE_UNPLANNED'
  | 'UNAVAILABLE';
export type LifecycleStatus = 'ACTIVE' | 'INACTIVE' | 'DECOMMISSIONED' | 'ARCHIVED';
export type ParameterValueType = 'DECIMAL' | 'INTEGER' | 'BOOLEAN' | 'TEXT';
export type ParameterSourceType = 'MANUAL' | 'CHECKLIST' | 'SENSOR' | 'IMPORT';
export type ReadingSource = 'MANUAL' | 'CHECKLIST' | 'SENSOR' | 'IMPORT';
export type ReadingClassification =
  | 'NORMAL'
  | 'WARNING_LOW'
  | 'WARNING_HIGH'
  | 'CRITICAL_LOW'
  | 'CRITICAL_HIGH'
  | 'UNCLASSIFIED';

export interface RequestAuditMetadata {
  readonly traceId: string;
  readonly userAgent: string | null;
  readonly ipAddress: string;
  readonly roleSnapshot: string;
}

export interface PlantInput {
  readonly tag: string;
  readonly name: string;
}

export interface SectorInput extends PlantInput {
  readonly plantId: string;
}

export interface LineInput extends PlantInput {
  readonly sectorId: string;
}

export interface AssetInput {
  readonly lineId: string;
  readonly tag: string;
  readonly name: string;
  readonly assetType: string;
  readonly criticality: Criticality;
  readonly operationalStatus: OperationalStatus;
  readonly lifecycleStatus: LifecycleStatus;
  readonly healthPercent: number | null;
  readonly currentHourMeter: number | null;
  readonly hourMeterMode: string | null;
  readonly manufacturer: string | null;
  readonly model: string | null;
  readonly serialNumber: string | null;
  readonly technicalLocation: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ComponentInput {
  readonly assetId: string;
  readonly tag: string;
  readonly name: string;
  readonly componentType: string;
  readonly criticality: Criticality;
  readonly operationalStatus: OperationalStatus;
  readonly lifecycleStatus: LifecycleStatus;
  readonly usefulLifeHours: number | null;
  readonly usefulLifeDays: number | null;
  readonly accumulatedHours: number | null;
  readonly installedAt: Date | null;
  readonly manufacturer: string | null;
  readonly model: string | null;
  readonly serialNumber: string | null;
  readonly technicalLocation: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface MaterialInput {
  readonly sku: string;
  readonly name: string;
  readonly unit: string;
  readonly currentStock: number;
  readonly minimumStock: number;
  readonly status: RecordStatus;
}

export interface MaterialListQuery {
  readonly search: string;
  readonly status: RecordStatus | null;
  readonly belowMinimum: boolean | null;
  readonly limit: number;
  readonly cursorCreatedAt: Date | null;
  readonly cursorId: string | null;
}

export interface ParameterDefinitionInput {
  readonly assetId: string;
  readonly componentId: string | null;
  readonly code: string;
  readonly name: string;
  readonly unit: string;
  readonly valueType: ParameterValueType;
  readonly sourceType: ParameterSourceType;
  readonly description: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ParameterPolicyInput {
  readonly warningMin: number | null;
  readonly warningMax: number | null;
  readonly criticalMin: number | null;
  readonly criticalMax: number | null;
  readonly validationRule: Readonly<Record<string, unknown>>;
}

export interface ParameterReadingInput {
  readonly numericValue: number | null;
  readonly textValue: string | null;
  readonly booleanValue: boolean | null;
  readonly source: ReadingSource;
  readonly sourceEntityType: string | null;
  readonly sourceEntityId: string | null;
  readonly recordedAt: Date;
  readonly rawValue: string | null;
  readonly idempotencyKey: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface AssetListQuery {
  readonly search: string;
  readonly plantId: string | null;
  readonly sectorId: string | null;
  readonly lineId: string | null;
  readonly operationalStatus: OperationalStatus | null;
  readonly lifecycleStatus: LifecycleStatus | null;
  readonly limit: number;
  readonly cursorCreatedAt: Date | null;
  readonly cursorId: string | null;
}

export interface ComponentListQuery {
  readonly search: string;
  readonly assetId: string | null;
  readonly limit: number;
}

export interface ReadingListQuery {
  readonly limit: number;
  readonly before: Date | null;
  readonly classification: ReadingClassification | null;
}
