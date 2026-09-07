import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Pool, PoolClient } from 'pg';

import { deterministicUuid, optionalText } from './legacy-values.js';
import {
  ensureTenantRoles,
  linkUserTechnicalAssignments,
  loadAsset,
  loadComponent,
  loadLine,
  loadMaterial,
  loadPlant,
  loadSector,
  loadTechnicalArea,
  loadTechnicalRole,
  loadUser,
} from './load-foundation.js';
import {
  loadAuditEvent,
  loadConfigEntry,
  loadConfigurationDraft,
  loadConfigurationVersion,
  loadDocumentRevision,
  loadImportBatch,
  loadImportRecord,
  loadLegacyQuarantine,
  loadTechnicalDocument,
  linkConfigurationVersionReferences,
} from './load-governance.js';
import {
  finalizeOperationalStatuses,
  loadEvidence,
  loadExecution,
  loadExecutionChecklistItem,
  loadMaterialUsage,
  loadWorkOrder,
  loadWorkOrderAction,
} from './load-operations-core.js';
import {
  finalizeObservabilityStatuses,
  loadArchivedSession,
  loadEquipmentStop,
  loadHistoryEvent,
  loadMaintenanceStop,
  loadOccurrence,
  loadParameterReading,
  loadProductionEntry,
  loadShift,
  loadTelemetry,
} from './load-operations-observability.js';
import {
  finalizePlanningStatuses,
  loadChecklistAudit,
  loadChecklistItemType,
  loadChecklistReview,
  loadChecklistValidationRule,
  loadMaintenancePlan,
  loadPlanItem,
  loadPlanTriggerState,
} from './load-planning.js';
import {
  ensureDefaultServiceCalendar,
  linkWorkflowReferences,
  loadDemandEvent,
  loadNotification,
  loadSlaPolicy,
  loadTechnicalAnalysis,
  loadTechnicalDemand,
  loadTechnicalSignature,
} from './load-workflow.js';
import type { LoadedTarget, MigrationLoadContext, RowLoader } from './loader-context.js';
import {
  MigrationRepository,
  type MigrationEnvironment,
  type MigrationMode,
} from './migration-repository.js';
import { sourceSheetContracts } from './source-contract.js';
import {
  captureSourceSnapshot,
  type SourceRowSnapshot,
  type SourceWorkbookSnapshot,
} from './source-snapshot.js';
import {
  hasBlockingIssues,
  validateSourceSnapshot,
  type MigrationValidationIssue,
} from './source-validation.js';

interface OrderedLoader {
  readonly sourceName: string;
  readonly loader: RowLoader | null;
  readonly reason?: string;
}

const orderedLoaders: readonly OrderedLoader[] = [
  { sourceName: 'config', loader: loadConfigEntry },
  { sourceName: 'usuarios', loader: loadUser },
  { sourceName: 'areas_tecnicas', loader: loadTechnicalArea },
  { sourceName: 'cargos_tecnicos', loader: loadTechnicalRole },
  { sourceName: 'plantas', loader: loadPlant },
  { sourceName: 'setores', loader: loadSector },
  { sourceName: 'linhas', loader: loadLine },
  { sourceName: 'ativos', loader: loadAsset },
  { sourceName: 'componentes', loader: loadComponent },
  { sourceName: 'materiais', loader: loadMaterial },
  { sourceName: 'checklist_tipos_item', loader: loadChecklistItemType },
  { sourceName: 'checklist_validacao_regras', loader: loadChecklistValidationRule },
  { sourceName: 'planos_manutencao', loader: loadMaintenancePlan },
  { sourceName: 'plano_itens', loader: loadPlanItem },
  { sourceName: 'checklist_modelo_validacoes', loader: loadChecklistReview },
  { sourceName: 'modelo_checklist_auditoria', loader: loadChecklistAudit },
  { sourceName: 'parametros', loader: loadParameterReading },
  { sourceName: 'demandas_tecnicas', loader: loadTechnicalDemand },
  { sourceName: 'assinaturas_tecnicas', loader: loadTechnicalSignature },
  { sourceName: 'ordens_servico', loader: loadWorkOrder },
  { sourceName: 'os_acoes', loader: loadWorkOrderAction },
  { sourceName: 'execucoes', loader: loadExecution },
  { sourceName: 'checklist_execucao', loader: loadExecutionChecklistItem },
  { sourceName: 'evidencias', loader: loadEvidence },
  { sourceName: 'materiais_uso', loader: loadMaterialUsage },
  { sourceName: 'paradas_equipamento', loader: loadEquipmentStop },
  { sourceName: 'paradas_manutencao', loader: loadMaintenanceStop },
  { sourceName: 'ocorrencias_operacionais', loader: loadOccurrence },
  { sourceName: 'turnos', loader: loadShift },
  { sourceName: 'apontamentos_producao', loader: loadProductionEntry },
  { sourceName: 'sessoes', loader: loadArchivedSession },
  { sourceName: 'telemetria_sessoes', loader: loadTelemetry },
  { sourceName: 'historico', loader: loadHistoryEvent },
  { sourceName: 'demanda_tramitacoes', loader: loadDemandEvent },
  { sourceName: 'analises_tecnicas', loader: loadTechnicalAnalysis },
  { sourceName: 'notificacoes', loader: loadNotification },
  { sourceName: 'sla_politicas', loader: loadSlaPolicy },
  { sourceName: 'plano_controle', loader: loadPlanTriggerState },
  { sourceName: 'configuracao_versoes', loader: loadConfigurationVersion },
  { sourceName: 'configuracao_rascunhos', loader: loadConfigurationDraft },
  { sourceName: 'importacao_lotes', loader: loadImportBatch },
  { sourceName: 'importacao_registros', loader: loadImportRecord },
  { sourceName: 'documentos_tecnicos', loader: loadTechnicalDocument },
  { sourceName: 'documento_revisoes', loader: loadDocumentRevision },
  { sourceName: 'legado_quarentena', loader: loadLegacyQuarantine },
  { sourceName: 'audit_log', loader: loadAuditEvent },
  {
    sourceName: 'execucao_locks',
    loader: null,
    reason: 'Locks transitórios não são reativados; o snapshot imutável preserva a auditoria.',
  },
  {
    sourceName: 'dashboard_cache',
    loader: null,
    reason: 'Cache derivado é regenerado pelo backend Node após o cutover.',
  },
];

export interface MigrationExecutionInput {
  readonly source: string;
  readonly tenantId: string;
  readonly environment: MigrationEnvironment;
  readonly sourceRelease: string;
  readonly targetSchemaVersion: string;
  readonly initiatedBy: string;
  readonly mode: MigrationMode;
  readonly timeZone?: string;
  readonly reportPath?: string;
}

export interface MigrationExecutionReport {
  readonly runId: string | null;
  readonly status: 'VALID' | 'COMPLETED' | 'FAILED';
  readonly mode: MigrationMode;
  readonly source: string;
  readonly sourceHashSha256: string;
  readonly sourceRows: number;
  readonly migratedRows: number;
  readonly skippedRows: number;
  readonly validationIssues: readonly MigrationValidationIssue[];
  readonly reconciliations: readonly {
    readonly sourceName: string;
    readonly sourceRows: number;
    readonly processedRows: number;
    readonly passed: boolean;
  }[];
  readonly error?: string;
}

function sourceDisplayName(snapshot: SourceWorkbookSnapshot): string {
  const config = snapshot.sheets.find((candidate) => candidate.name === 'config');
  const company = config?.rows.find((row) => {
    const key = row.legacyId?.toUpperCase();
    return key === 'EMPRESA_NOME' || key === 'COMPANY_NAME' || key === 'NOME_EMPRESA';
  });
  return optionalText(company?.payload.valor) ?? 'Fab Control - Migração';
}

async function bootstrapTenant(
  pool: Pool,
  snapshot: SourceWorkbookSnapshot,
  input: MigrationExecutionInput,
): Promise<string> {
  const actorId = deterministicUuid(input.tenantId, 'migration', 'actor');
  const displayName = sourceDisplayName(snapshot);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id','',true)`,
      [input.tenantId],
    );
    await client.query(
      `INSERT INTO platform.tenants
       (id,legacy_id,legal_name,display_name,slug,timezone,environment,status)
       VALUES ($1,$2,$3,$3,$4,$5,$6,'ACTIVE')
       ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name,
         legal_name=EXCLUDED.legal_name,timezone=EXCLUDED.timezone,
         environment=EXCLUDED.environment,status='ACTIVE',updated_at=clock_timestamp()`,
      [
        input.tenantId,
        `migration:${input.tenantId}`,
        displayName,
        `fab-control-${input.tenantId.slice(0, 8)}`,
        input.timeZone ?? 'America/Sao_Paulo',
        input.environment,
      ],
    );
    await client.query(
      `INSERT INTO iam.roles
       (id,tenant_id,legacy_id,code,name,description,role_type,protected,status)
       VALUES ($1,$2,'SYSTEM','SYSTEM','Sistema de migração','Identidade interna auditável.',
               'CUSTOM',true,'ACTIVE')
       ON CONFLICT (tenant_id,code) DO UPDATE SET status='ACTIVE',protected=true`,
      [deterministicUuid(input.tenantId, 'roles', 'SYSTEM'), input.tenantId],
    );
    await client.query(
      `INSERT INTO iam.users
       (id,tenant_id,legacy_id,employee_number,name,status,first_access_required,metadata)
       VALUES ($1,$2,'MIGRATION-SYSTEM','MIGRATION-SYSTEM','Migração automatizada','ACTIVE',false,
               '{"non_interactive":true}'::jsonb)
       ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET status='ACTIVE',updated_at=clock_timestamp()`,
      [actorId, input.tenantId],
    );
    await client.query(
      `INSERT INTO iam.user_roles (tenant_id,user_id,role_id,assigned_by)
       VALUES ($1,$2,$3,NULL) ON CONFLICT DO NOTHING`,
      [input.tenantId, actorId, deterministicUuid(input.tenantId, 'roles', 'SYSTEM')],
    );
    await client.query('COMMIT');
    return actorId;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function recordTarget(
  context: MigrationLoadContext,
  sourceName: string,
  row: SourceRowSnapshot,
  target: LoadedTarget,
): Promise<void> {
  if (row.legacyId) {
    if (target.table !== 'company_profiles') {
      await context.repository.recordIdMap(context.client, context.runId, {
        sourceName,
        legacyId: row.legacyId,
        targetSchema: target.schema,
        targetTable: target.table,
        targetId: target.id,
        sourceHashSha256: row.hashSha256,
      });
    }
    for (const auxiliary of target.auxiliary ?? []) {
      await context.repository.recordIdMap(context.client, context.runId, {
        sourceName: auxiliary.sourceName,
        legacyId: auxiliary.legacyId,
        targetSchema: auxiliary.schema,
        targetTable: auxiliary.table,
        targetId: auxiliary.id,
        sourceHashSha256: row.hashSha256,
      });
    }
  }
}

async function loadSheet(
  context: MigrationLoadContext,
  ordered: OrderedLoader,
  onRow: (row: SourceRowSnapshot) => void,
): Promise<{ readonly migrated: number; readonly skipped: number }> {
  const sourceSheet = context.snapshot.sheets.find(
    (candidate) => candidate.name === ordered.sourceName,
  );
  if (!sourceSheet) throw new Error(`Aba obrigatória ausente: ${ordered.sourceName}.`);
  let migrated = 0;
  let skipped = 0;
  for (const row of sourceSheet.rows) {
    onRow(row);
    if (!ordered.loader) {
      await context.repository.recordRowResult(context.client, context.runId, {
        sourceName: ordered.sourceName,
        sourceRowNumber: row.rowNumber,
        legacyId: row.legacyId,
        status: 'SKIPPED',
        sourceHashSha256: row.hashSha256,
        errorCode:
          sourceSheet.contract.handling === 'REGENERATE' ? 'DERIVED_CACHE' : 'TRANSIENT_STATE',
        ...(ordered.reason ? { errorDetail: ordered.reason } : {}),
      });
      skipped += 1;
      continue;
    }
    const target = await ordered.loader(context, row);
    if (!target) {
      await context.repository.recordRowResult(context.client, context.runId, {
        sourceName: ordered.sourceName,
        sourceRowNumber: row.rowNumber,
        legacyId: row.legacyId,
        status: 'SKIPPED',
        sourceHashSha256: row.hashSha256,
        errorCode: 'NO_TARGET',
      });
      skipped += 1;
      continue;
    }
    await recordTarget(context, ordered.sourceName, row, target);
    await context.repository.recordRowResult(context.client, context.runId, {
      sourceName: ordered.sourceName,
      sourceRowNumber: row.rowNumber,
      legacyId: row.legacyId,
      status: 'MIGRATED',
      targetSchema: target.schema,
      targetTable: target.table,
      targetId: target.id,
      sourceHashSha256: row.hashSha256,
    });
    migrated += 1;
  }
  return { migrated, skipped };
}

async function recordFilePointers(context: MigrationLoadContext): Promise<void> {
  for (const sourceName of ['evidencias', 'documento_revisoes'] as const) {
    const sourceSheet = context.snapshot.sheets.find((candidate) => candidate.name === sourceName);
    for (const row of sourceSheet?.rows ?? []) {
      const legacyId = row.legacyId ?? `${sourceName}:row-${row.rowNumber}`;
      const urlField = sourceName === 'evidencias' ? 'url' : 'arquivo_url';
      const nameField = sourceName === 'evidencias' ? 'nome_arquivo' : 'arquivo_nome';
      await context.client.query(
        `INSERT INTO migration.file_reconciliation
         (migration_run_id,source_name,legacy_id,source_file_id,source_url,file_name,mime_type,
          declared_size_bytes,status,detail,checked_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'NOT_APPLICABLE',$9::jsonb,clock_timestamp())
         ON CONFLICT (migration_run_id,source_name,legacy_id) DO UPDATE SET
           source_file_id=EXCLUDED.source_file_id,source_url=EXCLUDED.source_url,
           file_name=EXCLUDED.file_name,mime_type=EXCLUDED.mime_type,
           declared_size_bytes=EXCLUDED.declared_size_bytes,status=EXCLUDED.status,
           detail=EXCLUDED.detail,checked_at=EXCLUDED.checked_at`,
        [
          context.runId,
          sourceName,
          legacyId,
          optionalText(row.payload.arquivo_id),
          optionalText(row.payload[urlField]),
          optionalText(row.payload[nameField]),
          optionalText(row.payload.mime_type),
          optionalText(row.payload.tamanho_bytes),
          JSON.stringify({
            pointer_preserved: true,
            binary_migration_required_before_cutover: true,
            source_hash_sha256: row.hashSha256,
          }),
        ],
      );
    }
  }
}

async function reconcile(
  client: PoolClient,
  repository: MigrationRepository,
  runId: string,
  snapshot: SourceWorkbookSnapshot,
): Promise<MigrationExecutionReport['reconciliations']> {
  const reconciliations: {
    sourceName: string;
    sourceRows: number;
    processedRows: number;
    passed: boolean;
  }[] = [];
  for (const sourceSheet of snapshot.sheets) {
    const result = await client.query<{ readonly count: string }>(
      `SELECT count(*)::text AS count FROM migration.row_results
       WHERE migration_run_id=$1 AND source_name=$2`,
      [runId, sourceSheet.name],
    );
    const processedRows = Number(result.rows[0]?.count ?? 0);
    const passed = processedRows === sourceSheet.rows.length;
    reconciliations.push({
      sourceName: sourceSheet.name,
      sourceRows: sourceSheet.rows.length,
      processedRows,
      passed,
    });
    await repository.recordReconciliation(client, runId, {
      code: 'SOURCE_ROW_COVERAGE',
      entityName: sourceSheet.name,
      sourceValue: String(sourceSheet.rows.length),
      targetValue: String(processedRows),
      passed,
      severity: passed ? 'INFO' : 'BLOCKER',
      detail: { handling: sourceSheet.contract.handling },
    });
  }
  return reconciliations;
}

async function writeReport(
  reportPath: string | undefined,
  report: MigrationExecutionReport,
): Promise<void> {
  if (!reportPath) return;
  await writeFile(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
  });
}

export async function executeMigration(
  pool: Pool,
  input: MigrationExecutionInput,
): Promise<MigrationExecutionReport> {
  const snapshot = await captureSourceSnapshot(input.source);
  const issues = validateSourceSnapshot(snapshot);
  const sourceRows = snapshot.sheets.reduce(
    (total, sourceSheet) => total + sourceSheet.rows.length,
    0,
  );

  if (input.mode === 'DRY_RUN') {
    const report: MigrationExecutionReport = {
      runId: null,
      status: hasBlockingIssues(issues) ? 'FAILED' : 'VALID',
      mode: input.mode,
      source: snapshot.sourcePath,
      sourceHashSha256: snapshot.contentHashSha256,
      sourceRows,
      migratedRows: 0,
      skippedRows: 0,
      validationIssues: issues,
      reconciliations: [],
      ...(hasBlockingIssues(issues)
        ? { error: 'O pré-voo encontrou inconsistências bloqueantes.' }
        : {}),
    };
    await writeReport(input.reportPath, report);
    return report;
  }

  const actorId = await bootstrapTenant(pool, snapshot, input);
  const repository = new MigrationRepository(pool);
  const runId = await repository.createRun({
    tenantId: input.tenantId,
    environment: input.environment,
    sourceRelease: input.sourceRelease,
    targetSchemaVersion: input.targetSchemaVersion,
    sourceSnapshotHashSha256: snapshot.contentHashSha256,
    mode: input.mode,
    initiatedBy: input.initiatedBy,
  });
  await repository.stageSnapshot(runId, snapshot);
  await repository.recordValidationIssues(runId, issues);
  if (hasBlockingIssues(issues)) {
    await repository.setRunStatus(runId, 'FAILED', { reason: 'SOURCE_VALIDATION_FAILED' });
    const report: MigrationExecutionReport = {
      runId,
      status: 'FAILED',
      mode: input.mode,
      source: snapshot.sourcePath,
      sourceHashSha256: snapshot.contentHashSha256,
      sourceRows,
      migratedRows: 0,
      skippedRows: 0,
      validationIssues: issues,
      reconciliations: [],
      error: 'A carga foi bloqueada antes de alterar tabelas funcionais.',
    };
    await writeReport(input.reportPath, report);
    return report;
  }

  await repository.setRunStatus(runId, 'RUNNING');
  const client = await pool.connect();
  let activeSourceName = '';
  const active = { row: null as SourceRowSnapshot | null };
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)`,
      [input.tenantId, actorId],
    );
    const context: MigrationLoadContext = {
      client,
      repository,
      runId,
      tenantId: input.tenantId,
      actorId,
      snapshot,
      timeZone: input.timeZone ?? 'America/Sao_Paulo',
    };
    await ensureTenantRoles(context);
    await ensureDefaultServiceCalendar(context);
    let migratedRows = 0;
    let skippedRows = 0;
    for (const ordered of orderedLoaders) {
      activeSourceName = ordered.sourceName;
      if (ordered.sourceName === 'demandas_tecnicas') {
        await linkUserTechnicalAssignments(context);
      }
      if (ordered.sourceName === 'checklist_modelo_validacoes') {
        await finalizePlanningStatuses(context);
      }
      const result = await loadSheet(context, ordered, (row) => {
        active.row = row;
      });
      migratedRows += result.migrated;
      skippedRows += result.skipped;
    }
    await linkUserTechnicalAssignments(context);
    await linkWorkflowReferences(context);
    await linkConfigurationVersionReferences(context);
    await recordFilePointers(context);
    activeSourceName = '__finalize_operational_statuses__';
    active.row = null;
    await finalizeOperationalStatuses(context);
    activeSourceName = '__finalize_observability_statuses__';
    await finalizeObservabilityStatuses(context);
    const reconciliations = await reconcile(client, repository, runId, snapshot);
    if (reconciliations.some((item) => !item.passed)) {
      throw new Error('Reconciliação de cobertura falhou; a transação funcional será revertida.');
    }
    await client.query('COMMIT');
    await repository.setRunStatus(runId, 'COMPLETED', {
      source_rows: sourceRows,
      migrated_rows: migratedRows,
      skipped_rows: skippedRows,
      reconciliation_passed: true,
    });
    const report: MigrationExecutionReport = {
      runId,
      status: 'COMPLETED',
      mode: input.mode,
      source: snapshot.sourcePath,
      sourceHashSha256: snapshot.contentHashSha256,
      sourceRows,
      migratedRows,
      skippedRows,
      validationIssues: issues,
      reconciliations,
    };
    await writeReport(input.reportPath, report);
    return report;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (active.row) {
      await pool.query(
        `INSERT INTO migration.row_results
         (migration_run_id,source_name,source_row_number,legacy_id,status,source_hash_sha256,error_code,error_detail)
         VALUES ($1,$2,$3,$4,'FAILED',$5,'LOAD_FAILED',$6)
         ON CONFLICT (migration_run_id,source_name,source_row_number) DO UPDATE SET
           status='FAILED',error_code='LOAD_FAILED',error_detail=EXCLUDED.error_detail`,
        [
          runId,
          activeSourceName,
          active.row.rowNumber,
          active.row.legacyId,
          active.row.hashSha256,
          errorMessage(error),
        ],
      );
    }
    await repository.setRunStatus(runId, 'FAILED', {
      reason: 'TRANSACTION_ROLLED_BACK',
      source_name: activeSourceName,
      source_row: active.row?.rowNumber ?? null,
      error: errorMessage(error),
    });
    const report: MigrationExecutionReport = {
      runId,
      status: 'FAILED',
      mode: input.mode,
      source: snapshot.sourcePath,
      sourceHashSha256: snapshot.contentHashSha256,
      sourceRows,
      migratedRows: 0,
      skippedRows: 0,
      validationIssues: issues,
      reconciliations: [],
      error: errorMessage(error),
    };
    await writeReport(input.reportPath, report);
    return report;
  } finally {
    client.release();
  }
}

export function assertLoaderCoverage(): void {
  const expected = new Set(sourceSheetContracts.map((contract) => contract.name));
  const actual = new Set(orderedLoaders.map((entry) => entry.sourceName));
  const missing = [...expected].filter((name) => !actual.has(name));
  const unexpected = [...actual].filter((name) => !expected.has(name));
  if (missing.length > 0 || unexpected.length > 0 || actual.size !== orderedLoaders.length) {
    throw new Error(
      `Cobertura inválida dos loaders. Ausentes: ${missing.join(', ') || '-'}; extras/duplicados: ${unexpected.join(', ') || '-'}.`,
    );
  }
}
