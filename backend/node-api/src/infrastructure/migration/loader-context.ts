import type { PoolClient } from 'pg';

import { deterministicUuid, optionalText } from './legacy-values.js';
import type { MigrationRepository } from './migration-repository.js';
import type {
  SourceRowPayload,
  SourceRowSnapshot,
  SourceSheetSnapshot,
  SourceWorkbookSnapshot,
} from './source-snapshot.js';

export interface MigrationLoadContext {
  readonly client: PoolClient;
  readonly repository: MigrationRepository;
  readonly runId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly snapshot: SourceWorkbookSnapshot;
  readonly timeZone: string;
}

export interface LoadedTarget {
  readonly schema: string;
  readonly table: string;
  readonly id: string;
  readonly auxiliary?: readonly {
    readonly sourceName: string;
    readonly legacyId: string;
    readonly schema: string;
    readonly table: string;
    readonly id: string;
  }[];
}

export type RowLoader = (
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
) => Promise<LoadedTarget | null>;

export function sheet(snapshot: SourceWorkbookSnapshot, sourceName: string): SourceSheetSnapshot {
  const found = snapshot.sheets.find((candidate) => candidate.name === sourceName);
  if (!found) {
    throw new Error(`Aba não localizada no snapshot: ${sourceName}.`);
  }
  return found;
}

export function targetId(
  context: MigrationLoadContext,
  sourceName: string,
  legacyId: string,
): string {
  return deterministicUuid(context.tenantId, sourceName, legacyId);
}

export function requiredLegacyId(row: SourceRowSnapshot): string {
  if (!row.legacyId) {
    throw new Error('Identificador legado ausente em uma linha aprovada no pré-voo.');
  }
  return row.legacyId;
}

export function referenceId(
  context: MigrationLoadContext,
  sourceName: string,
  value: SourceRowPayload[string] | undefined,
  field: string,
  optional = false,
): string | null {
  const legacyId = optionalText(value);
  if (legacyId === null && optional) return null;
  if (legacyId === null) {
    throw new Error(`Referência obrigatória ausente: ${field}.`);
  }
  return targetId(context, sourceName, legacyId);
}
