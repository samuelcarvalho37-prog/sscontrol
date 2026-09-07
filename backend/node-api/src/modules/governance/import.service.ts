import { createHash, randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import { AppError } from '../../core/errors/app-error.js';
import type { Database } from '../../infrastructure/database/database.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import {
  IMPORT_MAX_CELL_CHARACTERS,
  IMPORT_MAX_ROWS,
  importModel,
  importModels,
  type ImportEntity,
  type ImportField,
  type ImportModel,
} from './import-catalog.js';
import { ImportRepository, type ImportRow } from './import.repository.js';
import type {
  ImportAuditContext,
  ImportRowInput,
  StagedImportRow,
  ValidateImportInput,
} from './import.types.js';

type JsonObject = Readonly<Record<string, unknown>>;

function error(code: string, message: string, statusCode: number, details?: unknown): AppError {
  return new AppError({ code, message, statusCode, details });
}

function normalizedHeader(value: string): string {
  return value
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/gu, '')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .replaceAll(/[^a-z0-9]+/gu, '_')
    .replaceAll(/^_+|_+$/gu, '');
}

function normalizedText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim().replaceAll(/\s+/gu, ' ');
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw error('IMPORT_CELL_TYPE_INVALID', 'A célula contém um tipo de dado não aceito.', 422);
}

function nullableText(value: unknown): string | null {
  const normalized = normalizedText(value);
  return normalized.length > 0 ? normalized : null;
}

function requiredText(value: unknown, field: string): string {
  const normalized = normalizedText(value);
  if (!normalized) throw error('IMPORT_REQUIRED_VALUE', `Preencha o campo ${field}.`, 422);
  return normalized;
}

function numberValue(value: unknown, field: string, fallback: number | null): number | null {
  const normalized = normalizedText(value).replace(',', '.');
  if (!normalized) return fallback;
  const result = Number(normalized);
  if (!Number.isFinite(result) || result < 0) {
    throw error('IMPORT_NUMBER_INVALID', `${field} deve ser um número maior ou igual a zero.`, 422);
  }
  return result;
}

function integerValue(value: unknown, field: string, fallback: number | null): number | null {
  const result = numberValue(value, field, fallback);
  if (result !== null && !Number.isSafeInteger(result)) {
    throw error('IMPORT_INTEGER_INVALID', `${field} deve ser um número inteiro.`, 422);
  }
  return result;
}

function statusValue(value: unknown): 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' {
  const status = normalizedText(value).toUpperCase() || 'ATIVO';
  const statuses: Readonly<Record<string, 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'>> = {
    ATIVO: 'ACTIVE',
    ACTIVE: 'ACTIVE',
    SIM: 'ACTIVE',
    INATIVO: 'INACTIVE',
    INACTIVE: 'INACTIVE',
    NAO: 'INACTIVE',
    NÃO: 'INACTIVE',
    ARQUIVADO: 'ARCHIVED',
    ARCHIVED: 'ARCHIVED',
  };
  const mapped = statuses[status];
  if (!mapped) throw error('IMPORT_STATUS_INVALID', `Status inválido: ${status}.`, 422);
  return mapped;
}

function operationalStatus(value: unknown): string {
  const status = normalizedText(value).toUpperCase() || 'OPERANDO';
  const statuses: Readonly<Record<string, string>> = {
    OPERANDO: 'OPERATING',
    OPERATING: 'OPERATING',
    PARADO: 'STOPPED',
    STOPPED: 'STOPPED',
    INSPECAO: 'INSPECTION',
    INSPEÇÃO: 'INSPECTION',
    INSPECTION: 'INSPECTION',
    MANUTENCAO_PROGRAMADA: 'MAINTENANCE_PLANNED',
    MANUTENÇÃO_PROGRAMADA: 'MAINTENANCE_PLANNED',
    MAINTENANCE_PLANNED: 'MAINTENANCE_PLANNED',
    MANUTENCAO_NAO_PROGRAMADA: 'MAINTENANCE_UNPLANNED',
    MANUTENÇÃO_NÃO_PROGRAMADA: 'MAINTENANCE_UNPLANNED',
    MAINTENANCE_UNPLANNED: 'MAINTENANCE_UNPLANNED',
    INATIVO: 'UNAVAILABLE',
    INDISPONIVEL: 'UNAVAILABLE',
    INDISPONÍVEL: 'UNAVAILABLE',
    UNAVAILABLE: 'UNAVAILABLE',
  };
  const mapped = statuses[status];
  if (!mapped)
    throw error('IMPORT_STATUS_INVALID', `Situação operacional inválida: ${status}.`, 422);
  return mapped;
}

function criticality(value: unknown): string {
  const requested = normalizedText(value).toUpperCase() || 'MEDIA';
  const values: Readonly<Record<string, string>> = {
    BAIXA: 'LOW',
    LOW: 'LOW',
    MEDIA: 'MEDIUM',
    MÉDIA: 'MEDIUM',
    MEDIUM: 'MEDIUM',
    ALTA: 'HIGH',
    HIGH: 'HIGH',
    CRITICA: 'CRITICAL',
    CRÍTICA: 'CRITICAL',
    CRITICAL: 'CRITICAL',
  };
  const mapped = values[requested];
  if (!mapped)
    throw error('IMPORT_CRITICALITY_INVALID', `Criticidade inválida: ${requested}.`, 422);
  return mapped;
}

function dateValue(value: unknown): string | null {
  const requested = nullableText(value);
  if (!requested) return null;
  const parsed = new Date(requested.length === 10 ? `${requested}T00:00:00.000Z` : requested);
  if (Number.isNaN(parsed.getTime())) {
    throw error('IMPORT_DATE_INVALID', `Data inválida: ${requested}.`, 422);
  }
  return parsed.toISOString();
}

function stableSerialize(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(object[key])}`)
    .join(',')}}`;
}

function json(row: ImportRow, key: string): JsonObject | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Campo JSON ${key} inválido no contrato do banco.`);
  }
  return value as JsonObject;
}

function text(row: ImportRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`Campo ${key} ausente no contrato do banco.`);
  return value;
}

function integer(row: ImportRow, key: string): number {
  const result = Number(row[key]);
  if (!Number.isSafeInteger(result)) throw new Error(`Campo ${key} inválido no contrato do banco.`);
  return result;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  return '';
}

function optionalDatabaseText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function fieldLookup(model: ImportModel): ReadonlyMap<string, ImportField> {
  const result = new Map<string, ImportField>();
  for (const field of model.fields) {
    result.set(normalizedHeader(field.key), field);
    for (const alias of field.aliases) result.set(normalizedHeader(alias), field);
  }
  return result;
}

function canonicalRow(
  model: ImportModel,
  source: ImportRowInput,
): Readonly<Record<string, unknown>> {
  const lookup = fieldLookup(model);
  const result: Record<string, unknown> = {};
  for (const [sourceKey, value] of Object.entries(source)) {
    if (sourceKey === '__linha') continue;
    const field = lookup.get(normalizedHeader(sourceKey));
    if (field) result[field.key] = value;
  }
  return result;
}

function rowError(cause: unknown): { readonly codigo: string; readonly mensagem: string } {
  if (cause instanceof AppError) return { codigo: cause.code, mensagem: cause.message };
  return {
    codigo: 'IMPORT_ROW_INVALID',
    mensagem: cause instanceof Error ? cause.message : 'A linha não atende ao modelo.',
  };
}

function publicStatus(status: string): string {
  const statuses: Readonly<Record<string, string>> = {
    VALIDATED: 'VALIDADO',
    REJECTED: 'COM_ERROS',
    CONFIRMED: 'CONCLUIDO',
    ROLLED_BACK: 'REVERTIDO',
    FAILED: 'FALHOU',
    VALID: 'VALIDADO',
    INVALID: 'INVALIDO',
    APPLIED: 'APLICADO',
    ROLLED_BACK_RECORD: 'REVERTIDO',
  };
  return statuses[status] ?? status;
}

export class ImportService {
  private readonly repository = new ImportRepository();

  constructor(private readonly database: Database) {}

  catalog() {
    return {
      max_linhas: IMPORT_MAX_ROWS,
      modelos: importModels.map((model) => ({
        tipo: model.type,
        entidade: model.entity,
        grupo: model.group,
        nome: model.name,
        descricao: model.description,
        max_linhas: IMPORT_MAX_ROWS,
        campos: model.fields.map((field) => ({
          chave: field.key,
          rotulo: field.label,
          obrigatorio: field.required,
          exemplo: field.example,
        })),
      })),
    };
  }

  async listBatches(user: AuthenticatedUser, limit: number) {
    const batches = await this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      (client) => this.repository.listBatches(client, limit),
    );
    return { total: batches.length, lotes: batches.map((batch) => this.mapBatch(batch, [])) };
  }

  async batchDetail(user: AuthenticatedUser, batchId: string) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const batch = await this.repository.findBatch(client, batchId);
        if (!batch) throw error('IMPORT_BATCH_NOT_FOUND', 'Lote não encontrado.', 404);
        return this.mapBatch(batch, await this.repository.listRecords(client, batchId));
      },
    );
  }

  async validate(user: AuthenticatedUser, input: ValidateImportInput, audit: ImportAuditContext) {
    const model = importModel(input.type);
    if (!model) throw error('IMPORT_MODEL_INVALID', 'Modelo de importação inválido.', 400);
    if (input.rows.length === 0)
      throw error('IMPORT_ROWS_REQUIRED', 'Nenhuma linha preenchida.', 400);
    if (input.rows.length > IMPORT_MAX_ROWS) {
      throw error('IMPORT_ROWS_LIMIT', `O lote aceita no máximo ${IMPORT_MAX_ROWS} linhas.`, 413);
    }
    const lookup = fieldLookup(model);
    const canonicalHeaders = new Map<string, string>();
    const ignoredHeaders: string[] = [];
    for (const header of input.headers) {
      const field = lookup.get(normalizedHeader(header));
      if (!field) {
        ignoredHeaders.push(header);
        continue;
      }
      const existing = canonicalHeaders.get(field.key);
      if (existing) {
        throw error(
          'IMPORT_DUPLICATE_HEADER',
          `As colunas ${existing} e ${header} correspondem ao mesmo campo ${field.key}.`,
          400,
        );
      }
      canonicalHeaders.set(field.key, header);
    }
    const missing = model.fields
      .filter((field) => field.required && !canonicalHeaders.has(field.key))
      .map((field) => field.key);
    if (missing.length > 0) {
      throw error(
        'IMPORT_REQUIRED_HEADERS_MISSING',
        `Cabeçalhos obrigatórios ausentes: ${missing.join(', ')}.`,
        400,
      );
    }

    const batchId = randomUUID();
    await this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const rows: StagedImportRow[] = [];
        const entityIds = new Set<string>();
        for (const source of input.rows) {
          const rawData = Object.fromEntries(
            Object.entries(source).filter(([key]) => key !== '__linha'),
          );
          try {
            for (const value of Object.values(rawData)) {
              const content = normalizedText(value);
              if (content.length > IMPORT_MAX_CELL_CHARACTERS) {
                throw error(
                  'IMPORT_CELL_TOO_LONG',
                  `Uma célula excede ${IMPORT_MAX_CELL_CHARACTERS} caracteres.`,
                  422,
                );
              }
              if (/^[=+@]/u.test(content)) {
                throw error(
                  'IMPORT_FORMULA_BLOCKED',
                  'Fórmulas e comandos não são aceitos na importação.',
                  422,
                );
              }
            }
            const normalized = await this.normalizeEntity(
              client,
              model.entity,
              canonicalRow(model, source),
            );
            if (entityIds.has(String(normalized.data.id))) {
              throw error(
                'IMPORT_DUPLICATE_ID',
                `O cadastro ${String(normalized.data.id)} aparece mais de uma vez no lote.`,
                422,
              );
            }
            entityIds.add(String(normalized.data.id));
            rows.push({
              id: randomUUID(),
              sourceRowNumber: source.__linha,
              entity: model.entity,
              entityId: String(normalized.data.id),
              operation: normalized.operation,
              status: 'VALID',
              rawData,
              normalizedData: normalized.data,
              errors: [],
              beforeData: normalized.before,
            });
          } catch (cause) {
            rows.push({
              id: randomUUID(),
              sourceRowNumber: source.__linha,
              entity: model.entity,
              entityId: randomUUID(),
              operation: 'CRIAR',
              status: 'INVALID',
              rawData,
              normalizedData: null,
              errors: [rowError(cause)],
              beforeData: null,
            });
          }
        }
        const hash = createHash('sha256')
          .update(`FAB-IMPORT-PG-V1:${batchId}:${stableSerialize(rows)}`, 'utf8')
          .digest('hex');
        await this.repository.createBatch(
          client,
          user.tenantId,
          user.id,
          batchId,
          input,
          model.entity,
          hash,
          ignoredHeaders,
          rows,
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'ADMIN_IMPORT_VALIDATED',
          batchId,
          {
            tipo: input.type,
            total: rows.length,
            invalidas: rows.filter((row) => row.status === 'INVALID').length,
          },
        );
        return rows;
      },
    );
    return this.batchDetail(user, batchId);
  }

  async confirm(
    user: AuthenticatedUser,
    batchId: string,
    validationHash: string,
    audit: ImportAuditContext,
  ) {
    await this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        await this.repository.lockTenant(client, user.tenantId);
        const batch = await this.repository.findBatch(client, batchId, true);
        if (!batch) throw error('IMPORT_BATCH_NOT_FOUND', 'Lote não encontrado.', 404);
        if (text(batch, 'status') !== 'VALIDATED') {
          throw error(
            'IMPORT_BATCH_NOT_READY',
            'O lote precisa estar integralmente validado.',
            409,
          );
        }
        if (text(batch, 'validation_hash_sha256') !== validationHash) {
          throw error('IMPORT_VALIDATION_CHANGED', 'A assinatura da pré-análise não confere.', 409);
        }
        const records = await this.repository.listRecords(client, batchId);
        let created = 0;
        let updated = 0;
        for (const record of records) {
          if (text(record, 'status') !== 'VALID') {
            throw error('IMPORT_BATCH_NOT_READY', 'O lote contém uma linha não validada.', 409);
          }
          const entity = text(record, 'entity_type') as ImportEntity;
          const entityId = text(record, 'entity_id');
          const operation = text(record, 'operation');
          const normalized = json(record, 'normalized_data');
          if (!normalized) throw new Error('Registro validado sem conteúdo normalizado.');
          const current = await this.repository.currentEntity(client, entity, entityId, true);
          const before = json(record, 'before_data');
          if (stableSerialize(current) !== stableSerialize(before)) {
            throw error(
              'IMPORT_CONCURRENT_CHANGE',
              `O cadastro da linha ${integer(record, 'source_row_number')} mudou após a validação.`,
              409,
            );
          }
          const after = await this.repository.applyEntity(
            client,
            user.tenantId,
            entity,
            operation,
            normalized,
          );
          await this.repository.markRecordApplied(client, record.id, after);
          if (operation === 'CRIAR') created += 1;
          else updated += 1;
        }
        await this.repository.confirmBatch(client, batchId, user.id, created, updated);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'ADMIN_IMPORT_CONFIRMED',
          batchId,
          { criados: created, atualizados: updated },
        );
      },
    );
    return this.batchDetail(user, batchId);
  }

  async rollback(
    user: AuthenticatedUser,
    batchId: string,
    reason: string,
    audit: ImportAuditContext,
  ) {
    if (reason.trim().length < 8) {
      throw error(
        'IMPORT_ROLLBACK_REASON_REQUIRED',
        'Informe um motivo com ao menos 8 caracteres.',
        400,
      );
    }
    await this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        await this.repository.lockTenant(client, user.tenantId);
        const batch = await this.repository.findBatch(client, batchId, true);
        if (!batch) throw error('IMPORT_BATCH_NOT_FOUND', 'Lote não encontrado.', 404);
        if (text(batch, 'status') !== 'CONFIRMED') {
          throw error(
            'IMPORT_ROLLBACK_NOT_ALLOWED',
            'Somente lotes concluídos podem ser revertidos.',
            409,
          );
        }
        const records = [...(await this.repository.listRecords(client, batchId))].reverse();
        for (const record of records) {
          if (text(record, 'status') !== 'APPLIED') {
            throw error('IMPORT_ROLLBACK_NOT_ALLOWED', 'O lote contém registro não aplicado.', 409);
          }
          const entity = text(record, 'entity_type') as ImportEntity;
          const entityId = text(record, 'entity_id');
          const current = await this.repository.currentEntity(client, entity, entityId, true);
          const after = json(record, 'after_data');
          if (stableSerialize(current) !== stableSerialize(after)) {
            throw error(
              'IMPORT_ROLLBACK_DIVERGED',
              `O cadastro da linha ${integer(record, 'source_row_number')} foi alterado depois da importação.`,
              409,
            );
          }
          await this.repository.restoreEntity(
            client,
            entity,
            text(record, 'operation'),
            entityId,
            json(record, 'before_data'),
          );
          await this.repository.markRecordRolledBack(client, record.id);
        }
        await this.repository.rollbackBatch(
          client,
          batchId,
          user.id,
          records.length,
          reason.trim(),
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'ADMIN_IMPORT_ROLLED_BACK',
          batchId,
          { revertidos: records.length, motivo: reason.trim() },
        );
      },
    );
    return this.batchDetail(user, batchId);
  }

  private async normalizeEntity(
    client: PoolClient,
    entity: ImportEntity,
    source: Readonly<Record<string, unknown>>,
  ): Promise<{
    readonly operation: 'CRIAR' | 'ATUALIZAR';
    readonly data: JsonObject;
    readonly before: JsonObject | null;
  }> {
    const requestedId = nullableText(source.id);
    const naturalKey = requiredText(entity === 'materiais' ? source.sku : source.tag, 'código');
    const existing = await this.repository.findExisting(client, entity, requestedId, naturalKey);
    if (existing.length > 1) {
      throw error(
        'IMPORT_REFERENCE_AMBIGUOUS',
        `Mais de um cadastro corresponde a ${naturalKey}.`,
        422,
      );
    }
    const found = existing[0];
    const id =
      found?.id ??
      (requestedId && /^[0-9a-f-]{36}$/iu.test(requestedId) ? requestedId : randomUUID());
    const before = found ? json(found, 'snapshot') : null;
    const shared = { id };
    let data: JsonObject;
    if (entity === 'plantas') {
      data = {
        ...shared,
        tag: naturalKey.toUpperCase(),
        name: requiredText(source.nome, 'nome'),
        status: statusValue(source.status),
      };
    } else if (entity === 'setores') {
      data = {
        ...shared,
        plant_id: await this.reference(client, 'plantas', source.planta_id),
        tag: naturalKey.toUpperCase(),
        name: requiredText(source.nome, 'nome'),
        status: statusValue(source.status),
      };
    } else if (entity === 'linhas') {
      data = {
        ...shared,
        sector_id: await this.reference(client, 'setores', source.setor_id),
        tag: naturalKey.toUpperCase(),
        name: requiredText(source.nome, 'nome'),
        status: statusValue(source.status),
      };
    } else if (entity === 'ativos') {
      const tag = naturalKey.toUpperCase();
      data = {
        ...shared,
        line_id: await this.reference(client, 'linhas', source.linha_id),
        tag,
        qr_payload: `FABCTRL:ASSET:${id}`,
        name: requiredText(source.nome, 'nome'),
        asset_type: nullableText(source.tipo) ?? 'EQUIPAMENTO',
        criticality: criticality(source.criticidade),
        operational_status: operationalStatus(source.status),
        lifecycle_status: 'ACTIVE',
        health_percent: numberValue(source.saude_pct, 'Saúde', null),
        current_hour_meter: numberValue(source.horimetro_atual, 'Horímetro', null),
        manufacturer: nullableText(source.fabricante),
        model: nullableText(source.modelo),
        serial_number: nullableText(source.numero_serie),
        technical_location: nullableText(source.localizacao_tecnica),
        metadata: {},
      };
    } else if (entity === 'componentes') {
      const tag = naturalKey.toUpperCase();
      data = {
        ...shared,
        asset_id: await this.reference(client, 'ativos', source.ativo_id),
        tag,
        qr_payload: `FABCTRL:COMPONENT:${id}`,
        name: requiredText(source.nome, 'nome'),
        component_type: nullableText(source.tipo) ?? 'COMPONENTE',
        criticality: criticality(source.criticidade),
        operational_status: operationalStatus(source.status),
        lifecycle_status: 'ACTIVE',
        useful_life_hours: numberValue(source.vida_util_horas, 'Vida útil em horas', null),
        useful_life_days: integerValue(source.vida_util_dias, 'Vida útil em dias', null),
        accumulated_hours: numberValue(source.horas_acumuladas, 'Horas acumuladas', null),
        installed_at: dateValue(source.instalado_em),
        manufacturer: nullableText(source.fabricante),
        model: nullableText(source.modelo),
        serial_number: nullableText(source.numero_serie),
        technical_location: nullableText(source.localizacao_tecnica),
        metadata: {},
      };
    } else {
      data = {
        ...shared,
        sku: naturalKey.toUpperCase(),
        name: requiredText(source.nome, 'nome'),
        unit: nullableText(source.unidade) ?? 'un',
        current_stock: numberValue(source.estoque_atual, 'Estoque atual', 0),
        minimum_stock: numberValue(source.estoque_minimo, 'Estoque mínimo', 0),
        status: statusValue(source.status),
      };
    }
    return { operation: found ? 'ATUALIZAR' : 'CRIAR', data, before };
  }

  private async reference(
    client: PoolClient,
    entity: 'plantas' | 'setores' | 'linhas' | 'ativos',
    value: unknown,
  ): Promise<string> {
    const requested = requiredText(value, entity);
    const matches = await this.repository.resolveReference(client, entity, requested);
    if (matches.length === 0) {
      throw error('IMPORT_REFERENCE_INVALID', `Referência não encontrada: ${requested}.`, 422);
    }
    if (matches.length > 1) {
      throw error('IMPORT_REFERENCE_AMBIGUOUS', `Referência ambígua: ${requested}.`, 422);
    }
    const match = matches[0];
    if (!match) throw new Error('Referência resolvida sem identificador.');
    return match;
  }

  private mapBatch(batch: ImportRow, records: readonly ImportRow[]) {
    const result = json(batch, 'result') ?? {};
    return {
      id: batch.id,
      tipo: text(batch, 'import_type'),
      entidade: text(batch, 'entity_type'),
      arquivo_nome: text(batch, 'source_file_name'),
      aba_nome: optionalDatabaseText(batch.source_sheet_name),
      status: publicStatus(text(batch, 'status')),
      total_linhas: integer(batch, 'total_rows'),
      linhas_validas: integer(batch, 'valid_rows'),
      linhas_invalidas: integer(batch, 'invalid_rows'),
      validacao_hash: optionalDatabaseText(batch.validation_hash_sha256),
      cabecalhos: Array.isArray(batch.headers) ? batch.headers : [],
      cabecalhos_ignorados: Array.isArray(batch.ignored_headers) ? batch.ignored_headers : [],
      resultado: result,
      criado_por: text(batch, 'created_by'),
      criado_em: iso(batch.created_at),
      confirmado_por: optionalDatabaseText(batch.confirmed_by),
      confirmado_em: iso(batch.confirmed_at),
      rollback_por: optionalDatabaseText(batch.rolled_back_by),
      rollback_em: iso(batch.rolled_back_at),
      registros: records.map((record) => ({
        id: record.id,
        linha_numero: integer(record, 'source_row_number'),
        entidade: text(record, 'entity_type'),
        entidade_id: optionalDatabaseText(record.entity_id),
        operacao: optionalDatabaseText(record.operation),
        status: publicStatus(
          text(record, 'status') === 'ROLLED_BACK' ? 'ROLLED_BACK_RECORD' : text(record, 'status'),
        ),
        normalizado: json(record, 'normalized_data') ?? {},
        erros: Array.isArray(record.errors) ? record.errors : [],
      })),
    };
  }
}
