import type { ImportEntity } from './import-catalog.js';
import type { GovernanceAuditMetadata } from './governance.types.js';

export interface ImportRowInput {
  readonly [key: string]: string | number | boolean | null;
  readonly __linha: number;
}

export interface ValidateImportInput {
  readonly type: string;
  readonly fileName: string;
  readonly sheetName: string;
  readonly headers: readonly string[];
  readonly rows: readonly ImportRowInput[];
}

export interface StagedImportRow {
  readonly id: string;
  readonly sourceRowNumber: number;
  readonly entity: ImportEntity;
  readonly entityId: string;
  readonly operation: 'CRIAR' | 'ATUALIZAR';
  readonly status: 'VALID' | 'INVALID';
  readonly rawData: Readonly<Record<string, unknown>>;
  readonly normalizedData: Readonly<Record<string, unknown>> | null;
  readonly errors: readonly { readonly codigo: string; readonly mensagem: string }[];
  readonly beforeData: Readonly<Record<string, unknown>> | null;
}

export type ImportAuditContext = GovernanceAuditMetadata;
