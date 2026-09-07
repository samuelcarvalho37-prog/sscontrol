import type { PoolClient, QueryResultRow } from 'pg';

import type { ImportEntity } from './import-catalog.js';
import type { GovernanceAuditMetadata } from './governance.types.js';
import type { StagedImportRow, ValidateImportInput } from './import.types.js';

export interface ImportRow extends QueryResultRow {
  [column: string]: unknown;
  id: string;
}

interface CountRow extends QueryResultRow {
  count: string;
}

function requireRow<T extends QueryResultRow>(rows: readonly T[], message: string): T {
  const row = rows[0];
  if (!row) throw new Error(message);
  return row;
}

function table(entity: ImportEntity): string {
  const tables: Readonly<Record<ImportEntity, string>> = {
    plantas: 'cmms.plants',
    setores: 'cmms.sectors',
    linhas: 'cmms.lines',
    ativos: 'cmms.assets',
    componentes: 'cmms.components',
    materiais: 'cmms.materials',
  };
  return tables[entity];
}

export class ImportRepository {
  async listBatches(client: PoolClient, limit: number): Promise<readonly ImportRow[]> {
    const result = await client.query<ImportRow>(
      `SELECT * FROM governance.import_batches ORDER BY created_at DESC, id LIMIT $1`,
      [limit],
    );
    return result.rows;
  }

  async findBatch(client: PoolClient, batchId: string, lock = false): Promise<ImportRow | null> {
    const result = await client.query<ImportRow>(
      `SELECT * FROM governance.import_batches WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`,
      [batchId],
    );
    return result.rows[0] ?? null;
  }

  async listRecords(client: PoolClient, batchId: string): Promise<readonly ImportRow[]> {
    const result = await client.query<ImportRow>(
      `SELECT * FROM governance.import_records
       WHERE import_batch_id=$1 ORDER BY source_row_number, id`,
      [batchId],
    );
    return result.rows;
  }

  async createBatch(
    client: PoolClient,
    tenantId: string,
    userId: string,
    batchId: string,
    input: ValidateImportInput,
    entity: ImportEntity,
    validationHash: string,
    ignoredHeaders: readonly string[],
    rows: readonly StagedImportRow[],
  ): Promise<void> {
    const validRows = rows.filter((row) => row.status === 'VALID').length;
    const invalidRows = rows.length - validRows;
    await client.query(
      `INSERT INTO governance.import_batches (
         id,tenant_id,import_type,entity_type,source_file_name,source_sheet_name,status,
         total_rows,valid_rows,invalid_rows,validation_hash_sha256,headers,ignored_headers,
         result,created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        batchId,
        tenantId,
        input.type,
        entity,
        input.fileName,
        input.sheetName,
        invalidRows === 0 ? 'VALIDATED' : 'REJECTED',
        rows.length,
        validRows,
        invalidRows,
        validationHash,
        JSON.stringify(input.headers),
        JSON.stringify(ignoredHeaders),
        JSON.stringify({ validated_at: new Date().toISOString() }),
        userId,
      ],
    );
    for (const row of rows) {
      await client.query(
        `INSERT INTO governance.import_records (
           id,tenant_id,import_batch_id,source_row_number,entity_type,entity_id,
           operation,status,raw_data,normalized_data,errors,before_data
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          row.id,
          tenantId,
          batchId,
          row.sourceRowNumber,
          row.entity,
          row.entityId,
          row.operation,
          row.status,
          JSON.stringify(row.rawData),
          row.normalizedData ? JSON.stringify(row.normalizedData) : null,
          JSON.stringify(row.errors),
          row.beforeData ? JSON.stringify(row.beforeData) : null,
        ],
      );
    }
  }

  async resolveReference(
    client: PoolClient,
    entity: 'plantas' | 'setores' | 'linhas' | 'ativos',
    requested: string,
  ): Promise<readonly string[]> {
    const referenceTable = table(entity);
    const result = await client.query<{ id: string } & QueryResultRow>(
      `SELECT id FROM ${referenceTable}
       WHERE deleted_at IS NULL
         AND (id::text=$1 OR legacy_id=$1 OR upper(tag)=upper($1))
       ORDER BY id LIMIT 2`,
      [requested],
    );
    return result.rows.map((row) => row.id);
  }

  async findExisting(
    client: PoolClient,
    entity: ImportEntity,
    requestedId: string | null,
    naturalKey: string,
  ): Promise<readonly ImportRow[]> {
    const entityTable = table(entity);
    const key = entity === 'materiais' ? 'sku' : 'tag';
    const result = await client.query<ImportRow>(
      `SELECT id, to_jsonb(item.*) - 'tenant_id' AS snapshot
       FROM ${entityTable} item
       WHERE item.deleted_at IS NULL
         AND (($1::text IS NOT NULL AND (item.id::text=$1 OR item.legacy_id=$1))
              OR upper(item.${key})=upper($2))
       ORDER BY item.id LIMIT 2`,
      [requestedId, naturalKey],
    );
    return result.rows;
  }

  async currentEntity(
    client: PoolClient,
    entity: ImportEntity,
    entityId: string,
    lock = false,
  ): Promise<Readonly<Record<string, unknown>> | null> {
    const entityTable = table(entity);
    const result = await client.query<
      { snapshot: Readonly<Record<string, unknown>> } & QueryResultRow
    >(
      `SELECT to_jsonb(item.*) - 'tenant_id' AS snapshot
       FROM ${entityTable} item WHERE item.id=$1 ${lock ? 'FOR UPDATE' : ''}`,
      [entityId],
    );
    return result.rows[0]?.snapshot ?? null;
  }

  async applyEntity(
    client: PoolClient,
    tenantId: string,
    entity: ImportEntity,
    operation: string,
    data: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<Record<string, unknown>>> {
    const query = operation === 'CRIAR' ? this.insertQuery(entity) : this.updateQuery(entity);
    const values = [...this.entityValues(tenantId, entity, data, operation === 'CRIAR')];
    const result = await client.query<
      { snapshot: Readonly<Record<string, unknown>> } & QueryResultRow
    >(query, values);
    return requireRow(result.rows, 'O PostgreSQL não retornou o registro importado.').snapshot;
  }

  async restoreEntity(
    client: PoolClient,
    entity: ImportEntity,
    operation: string,
    entityId: string,
    beforeData: Readonly<Record<string, unknown>> | null,
  ): Promise<void> {
    if (operation === 'CRIAR') {
      await client.query(`DELETE FROM ${table(entity)} WHERE id=$1`, [entityId]);
      return;
    }
    if (!beforeData) throw new Error('Registro de atualização sem estado anterior.');
    await this.applyEntity(client, '', entity, 'ATUALIZAR', beforeData);
  }

  async markRecordApplied(
    client: PoolClient,
    recordId: string,
    afterData: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await client.query(
      `UPDATE governance.import_records SET status='APPLIED',after_data=$2,applied_at=clock_timestamp(),
       updated_at=clock_timestamp() WHERE id=$1`,
      [recordId, JSON.stringify(afterData)],
    );
  }

  async markRecordRolledBack(client: PoolClient, recordId: string): Promise<void> {
    await client.query(
      `UPDATE governance.import_records SET status='ROLLED_BACK',rolled_back_at=clock_timestamp(),
       updated_at=clock_timestamp() WHERE id=$1`,
      [recordId],
    );
  }

  async confirmBatch(
    client: PoolClient,
    batchId: string,
    userId: string,
    created: number,
    updated: number,
  ): Promise<void> {
    await client.query(
      `UPDATE governance.import_batches SET status='CONFIRMED',confirmed_by=$2,
       confirmed_at=clock_timestamp(),updated_at=clock_timestamp(),result=$3 WHERE id=$1`,
      [batchId, userId, JSON.stringify({ criados: created, atualizados: updated })],
    );
  }

  async rollbackBatch(
    client: PoolClient,
    batchId: string,
    userId: string,
    count: number,
    reason: string,
  ): Promise<void> {
    await client.query(
      `UPDATE governance.import_batches SET status='ROLLED_BACK',rolled_back_by=$2,
       rolled_back_at=clock_timestamp(),updated_at=clock_timestamp(),result=$3 WHERE id=$1`,
      [batchId, userId, JSON.stringify({ revertidos: count, motivo: reason })],
    );
  }

  async countRecords(client: PoolClient, batchId: string, status: string): Promise<number> {
    const result = await client.query<CountRow>(
      `SELECT count(*)::text AS count FROM governance.import_records
       WHERE import_batch_id=$1 AND status=$2`,
      [batchId, status],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async lockTenant(client: PoolClient, tenantId: string): Promise<void> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 9142026))`, [tenantId]);
  }

  async writeAudit(
    client: PoolClient,
    tenantId: string,
    userId: string,
    metadata: GovernanceAuditMetadata,
    action: string,
    entityId: string,
    afterData: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit.events (
         tenant_id,user_id,role_snapshot,action,entity_type,entity_id,after_data,
         redacted_fields,trace_id,source,user_agent,ip_address
       ) VALUES ($1,$2,$3,$4,'import_batch',$5,$6,ARRAY[]::text[],$7,'APPLICATION',$8,$9)`,
      [
        tenantId,
        userId,
        metadata.roleSnapshot,
        action,
        entityId,
        JSON.stringify(afterData),
        metadata.traceId,
        metadata.userAgent,
        metadata.ipAddress,
      ],
    );
  }

  private insertQuery(entity: ImportEntity): string {
    const queries: Readonly<Record<ImportEntity, string>> = {
      plantas: `INSERT INTO cmms.plants (id,tenant_id,tag,name,status)
        VALUES ($2,$1,$3,$4,$5) RETURNING to_jsonb(cmms.plants.*)-'tenant_id' AS snapshot`,
      setores: `INSERT INTO cmms.sectors (id,tenant_id,plant_id,tag,name,status)
        VALUES ($2,$1,$3,$4,$5,$6) RETURNING to_jsonb(cmms.sectors.*)-'tenant_id' AS snapshot`,
      linhas: `INSERT INTO cmms.lines (id,tenant_id,sector_id,tag,name,status)
        VALUES ($2,$1,$3,$4,$5,$6) RETURNING to_jsonb(cmms.lines.*)-'tenant_id' AS snapshot`,
      ativos: `INSERT INTO cmms.assets (
        id,tenant_id,line_id,tag,qr_payload,name,asset_type,criticality,operational_status,
        lifecycle_status,health_percent,current_hour_meter,manufacturer,model,serial_number,
        technical_location,metadata)
        VALUES ($2,$1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        RETURNING to_jsonb(cmms.assets.*)-'tenant_id' AS snapshot`,
      componentes: `INSERT INTO cmms.components (
        id,tenant_id,asset_id,tag,qr_payload,name,component_type,criticality,operational_status,
        lifecycle_status,useful_life_hours,useful_life_days,accumulated_hours,installed_at,
        manufacturer,model,serial_number,technical_location,metadata)
        VALUES ($2,$1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        RETURNING to_jsonb(cmms.components.*)-'tenant_id' AS snapshot`,
      materiais: `INSERT INTO cmms.materials (id,tenant_id,sku,name,unit,current_stock,minimum_stock,status)
        VALUES ($2,$1,$3,$4,$5,$6,$7,$8)
        RETURNING to_jsonb(cmms.materials.*)-'tenant_id' AS snapshot`,
    };
    return queries[entity];
  }

  private updateQuery(entity: ImportEntity): string {
    const queries: Readonly<Record<ImportEntity, string>> = {
      plantas: `UPDATE cmms.plants SET tag=$3,name=$4,status=$5,updated_at=clock_timestamp()
        WHERE id=$2 RETURNING to_jsonb(cmms.plants.*)-'tenant_id' AS snapshot`,
      setores: `UPDATE cmms.sectors SET plant_id=$3,tag=$4,name=$5,status=$6,updated_at=clock_timestamp()
        WHERE id=$2 RETURNING to_jsonb(cmms.sectors.*)-'tenant_id' AS snapshot`,
      linhas: `UPDATE cmms.lines SET sector_id=$3,tag=$4,name=$5,status=$6,updated_at=clock_timestamp()
        WHERE id=$2 RETURNING to_jsonb(cmms.lines.*)-'tenant_id' AS snapshot`,
      ativos: `UPDATE cmms.assets SET line_id=$3,tag=$4,qr_payload=$5,name=$6,asset_type=$7,
        criticality=$8,operational_status=$9,lifecycle_status=$10,health_percent=$11,
        current_hour_meter=$12,manufacturer=$13,model=$14,serial_number=$15,
        technical_location=$16,metadata=$17,updated_at=clock_timestamp()
        WHERE id=$2 RETURNING to_jsonb(cmms.assets.*)-'tenant_id' AS snapshot`,
      componentes: `UPDATE cmms.components SET asset_id=$3,tag=$4,qr_payload=$5,name=$6,
        component_type=$7,criticality=$8,operational_status=$9,lifecycle_status=$10,
        useful_life_hours=$11,useful_life_days=$12,accumulated_hours=$13,installed_at=$14,
        manufacturer=$15,model=$16,serial_number=$17,technical_location=$18,metadata=$19,
        updated_at=clock_timestamp() WHERE id=$2
        RETURNING to_jsonb(cmms.components.*)-'tenant_id' AS snapshot`,
      materiais: `UPDATE cmms.materials SET sku=$3,name=$4,unit=$5,current_stock=$6,
        minimum_stock=$7,status=$8,updated_at=clock_timestamp()
        WHERE id=$2 RETURNING to_jsonb(cmms.materials.*)-'tenant_id' AS snapshot`,
    };
    return queries[entity];
  }

  private entityValues(
    tenantId: string,
    entity: ImportEntity,
    data: Readonly<Record<string, unknown>>,
    includeTenant: boolean,
  ): readonly unknown[] {
    const prefix = [includeTenant ? tenantId : '', data.id];
    const values: Readonly<Record<ImportEntity, readonly unknown[]>> = {
      plantas: [...prefix, data.tag, data.name, data.status],
      setores: [...prefix, data.plant_id, data.tag, data.name, data.status],
      linhas: [...prefix, data.sector_id, data.tag, data.name, data.status],
      ativos: [
        ...prefix,
        data.line_id,
        data.tag,
        data.qr_payload,
        data.name,
        data.asset_type,
        data.criticality,
        data.operational_status,
        data.lifecycle_status,
        data.health_percent,
        data.current_hour_meter,
        data.manufacturer,
        data.model,
        data.serial_number,
        data.technical_location,
        JSON.stringify(data.metadata ?? {}),
      ],
      componentes: [
        ...prefix,
        data.asset_id,
        data.tag,
        data.qr_payload,
        data.name,
        data.component_type,
        data.criticality,
        data.operational_status,
        data.lifecycle_status,
        data.useful_life_hours,
        data.useful_life_days,
        data.accumulated_hours,
        data.installed_at,
        data.manufacturer,
        data.model,
        data.serial_number,
        data.technical_location,
        JSON.stringify(data.metadata ?? {}),
      ],
      materiais: [
        ...prefix,
        data.sku,
        data.name,
        data.unit,
        data.current_stock,
        data.minimum_stock,
        data.status,
      ],
    };
    return values[entity];
  }
}
