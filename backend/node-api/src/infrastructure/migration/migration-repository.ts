import type { Pool, PoolClient } from 'pg';

import type { MigrationValidationIssue } from './source-validation.js';
import type { SourceWorkbookSnapshot } from './source-snapshot.js';

export type MigrationMode = 'DRY_RUN' | 'FULL' | 'DELTA' | 'RECONCILIATION_ONLY';
export type MigrationEnvironment = 'DEVELOPMENT' | 'HOMOLOGATION' | 'PRODUCTION';

export interface CreateMigrationRunInput {
  readonly tenantId: string;
  readonly environment: MigrationEnvironment;
  readonly sourceRelease: string;
  readonly targetSchemaVersion: string;
  readonly sourceSnapshotHashSha256: string;
  readonly mode: MigrationMode;
  readonly initiatedBy: string;
}

export interface RowResultInput {
  readonly sourceName: string;
  readonly sourceRowNumber: number;
  readonly legacyId: string | null;
  readonly status: 'MIGRATED' | 'UNCHANGED' | 'QUARANTINED' | 'FAILED' | 'SKIPPED';
  readonly targetSchema?: string;
  readonly targetTable?: string;
  readonly targetId?: string;
  readonly sourceHashSha256: string;
  readonly errorCode?: string;
  readonly errorDetail?: string;
}

export class MigrationRepository {
  constructor(private readonly pool: Pool) {}

  async createRun(input: CreateMigrationRunInput): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [input.tenantId]);
      const result = await client.query<{ readonly id: string }>(
        `INSERT INTO migration.runs
         (tenant_id, environment, source_release, target_schema_version,
          source_snapshot_hash_sha256, mode, status, initiated_by)
         VALUES ($1,$2,$3,$4,$5,$6,'CREATED',$7)
         RETURNING id`,
        [
          input.tenantId,
          input.environment,
          input.sourceRelease,
          input.targetSchemaVersion,
          input.sourceSnapshotHashSha256,
          input.mode,
          input.initiatedBy,
        ],
      );
      const created = result.rows[0];
      if (!created) throw new Error('O PostgreSQL não retornou o identificador da migração.');
      await client.query('COMMIT');
      return created.id;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async stageSnapshot(runId: string, snapshot: SourceWorkbookSnapshot): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const sheet of snapshot.sheets) {
        const sourceResult = await client.query<{ readonly id: string }>(
          `INSERT INTO migration.source_snapshots
           (migration_run_id, source_kind, source_name, source_identifier, row_count,
            header_hash_sha256, content_hash_sha256, captured_at, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
           RETURNING id`,
          [
            runId,
            snapshot.sourceKind,
            sheet.name,
            snapshot.sourcePath,
            sheet.rows.length,
            sheet.headerHashSha256,
            sheet.contentHashSha256,
            snapshot.capturedAt,
            JSON.stringify({
              headers: sheet.headers,
              extra_headers: sheet.extraHeaders,
              source_file_name: snapshot.sourceFileName,
              handling: sheet.contract.handling,
            }),
          ],
        );
        const createdSnapshot = sourceResult.rows[0];
        if (!createdSnapshot) throw new Error(`Snapshot da aba ${sheet.name} não foi criado.`);
        const sourceSnapshotId = createdSnapshot.id;
        for (const row of sheet.rows) {
          await client.query(
            `INSERT INTO migration.source_rows
             (migration_run_id, source_snapshot_id, source_name, source_row_number,
              legacy_id, source_hash_sha256, payload)
             VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
            [
              runId,
              sourceSnapshotId,
              sheet.name,
              row.rowNumber,
              row.legacyId,
              row.hashSha256,
              JSON.stringify(row.payload),
            ],
          );
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setRunStatus(
    runId: string,
    status: 'RUNNING' | 'VALIDATING' | 'COMPLETED' | 'FAILED' | 'CANCELLED',
    summary: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    await this.pool.query(
      `UPDATE migration.runs
       SET status=$2,
           started_at=CASE WHEN $2='RUNNING' AND started_at IS NULL THEN clock_timestamp() ELSE started_at END,
           completed_at=CASE WHEN $2 IN ('COMPLETED','FAILED','CANCELLED') THEN clock_timestamp() ELSE NULL END,
           summary=$3::jsonb
       WHERE id=$1`,
      [runId, status, JSON.stringify(summary)],
    );
  }

  async recordValidationIssues(
    runId: string,
    issues: readonly MigrationValidationIssue[],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [index, issue] of issues.entries()) {
        await client.query(
          `INSERT INTO migration.reconciliation_checks
           (migration_run_id, check_code, entity_name, source_value, target_value,
            passed, severity, detail)
           VALUES ($1,$2,$3,$4,NULL,false,$5,$6::jsonb)
           ON CONFLICT (migration_run_id,check_code,entity_name) DO UPDATE SET
             source_value=EXCLUDED.source_value,
             passed=EXCLUDED.passed,
             severity=EXCLUDED.severity,
             detail=EXCLUDED.detail,
             checked_at=clock_timestamp()`,
          [
            runId,
            issue.code,
            `${issue.sourceName}:${issue.rowNumber ?? 0}:${issue.field ?? '-'}:${index}`,
            issue.legacyId,
            issue.severity,
            JSON.stringify(issue),
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordRowResult(client: PoolClient, runId: string, input: RowResultInput): Promise<void> {
    await client.query(
      `INSERT INTO migration.row_results
       (migration_run_id,source_name,source_row_number,legacy_id,status,target_schema,
        target_table,target_id,source_hash_sha256,error_code,error_detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (migration_run_id,source_name,source_row_number) DO UPDATE SET
         legacy_id=EXCLUDED.legacy_id,
         status=EXCLUDED.status,
         target_schema=EXCLUDED.target_schema,
         target_table=EXCLUDED.target_table,
         target_id=EXCLUDED.target_id,
         source_hash_sha256=EXCLUDED.source_hash_sha256,
         error_code=EXCLUDED.error_code,
         error_detail=EXCLUDED.error_detail,
         occurred_at=clock_timestamp()`,
      [
        runId,
        input.sourceName,
        input.sourceRowNumber,
        input.legacyId,
        input.status,
        input.targetSchema ?? null,
        input.targetTable ?? null,
        input.targetId ?? null,
        input.sourceHashSha256,
        input.errorCode ?? null,
        input.errorDetail ?? null,
      ],
    );
  }

  async recordIdMap(
    client: PoolClient,
    runId: string,
    input: {
      readonly sourceName: string;
      readonly legacyId: string;
      readonly targetSchema: string;
      readonly targetTable: string;
      readonly targetId: string;
      readonly sourceHashSha256: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO migration.legacy_id_map
       (migration_run_id,source_name,legacy_id,target_schema,target_table,target_id,source_hash_sha256)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (migration_run_id,source_name,legacy_id) DO UPDATE SET
         target_schema=EXCLUDED.target_schema,
         target_table=EXCLUDED.target_table,
         target_id=EXCLUDED.target_id,
         source_hash_sha256=EXCLUDED.source_hash_sha256,
         migrated_at=clock_timestamp()`,
      [
        runId,
        input.sourceName,
        input.legacyId,
        input.targetSchema,
        input.targetTable,
        input.targetId,
        input.sourceHashSha256,
      ],
    );
  }

  async quarantine(
    client: PoolClient,
    runId: string,
    tenantId: string,
    input: {
      readonly sourceName: string;
      readonly sourceRowNumber: number;
      readonly legacyId: string | null;
      readonly reasonCode: string;
      readonly reasonDetail: string;
      readonly payload: Readonly<Record<string, unknown>>;
    },
  ): Promise<string> {
    const quarantineLegacyId = `${input.sourceName}:${input.legacyId ?? `row-${input.sourceRowNumber}`}`;
    const result = await client.query<{ readonly id: string }>(
      `INSERT INTO governance.legacy_quarantine
       (tenant_id,legacy_id,source_name,source_row,reason_code,reason_detail,payload,migration_run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
         source_name=EXCLUDED.source_name,
         source_row=EXCLUDED.source_row,
         reason_code=EXCLUDED.reason_code,
         reason_detail=EXCLUDED.reason_detail,
         payload=EXCLUDED.payload,
         migration_run_id=EXCLUDED.migration_run_id,
         quarantined_at=clock_timestamp(),
         resolved_at=NULL
       RETURNING id`,
      [
        tenantId,
        quarantineLegacyId,
        input.sourceName,
        String(input.sourceRowNumber),
        input.reasonCode,
        input.reasonDetail,
        JSON.stringify(input.payload),
        runId,
      ],
    );
    const quarantined = result.rows[0];
    if (!quarantined) throw new Error('A linha inválida não foi registrada na quarentena.');
    return quarantined.id;
  }

  async recordReconciliation(
    client: PoolClient,
    runId: string,
    input: {
      readonly code: string;
      readonly entityName: string;
      readonly sourceValue: string | null;
      readonly targetValue: string | null;
      readonly passed: boolean;
      readonly severity: 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKER';
      readonly detail: Readonly<Record<string, unknown>>;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO migration.reconciliation_checks
       (migration_run_id,check_code,entity_name,source_value,target_value,passed,severity,detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (migration_run_id,check_code,entity_name) DO UPDATE SET
         source_value=EXCLUDED.source_value,
         target_value=EXCLUDED.target_value,
         passed=EXCLUDED.passed,
         severity=EXCLUDED.severity,
         detail=EXCLUDED.detail,
         checked_at=clock_timestamp()`,
      [
        runId,
        input.code,
        input.entityName,
        input.sourceValue,
        input.targetValue,
        input.passed,
        input.severity,
        JSON.stringify(input.detail),
      ],
    );
  }
}
