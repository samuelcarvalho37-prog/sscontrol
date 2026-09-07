import { createHash, randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import { AppError } from '../../core/errors/app-error.js';
import type { Database } from '../../infrastructure/database/database.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CatalogRepository, type CatalogRow } from './catalog.repository.js';
import type {
  AssetInput,
  AssetListQuery,
  ComponentInput,
  ComponentListQuery,
  MaterialInput,
  MaterialListQuery,
  ParameterDefinitionInput,
  ParameterPolicyInput,
  ParameterReadingInput,
  ReadingListQuery,
  RecordStatus,
  RequestAuditMetadata,
} from './catalog.types.js';

interface StructurePatch {
  readonly tag?: string;
  readonly name?: string;
  readonly status?: RecordStatus;
}

interface SectorPatch extends StructurePatch {
  readonly plantId?: string;
}

interface LinePatch extends StructurePatch {
  readonly sectorId?: string;
}

interface ParameterPatch {
  readonly code?: string;
  readonly name?: string;
  readonly unit?: string;
  readonly valueType?: ParameterDefinitionInput['valueType'];
  readonly sourceType?: ParameterDefinitionInput['sourceType'];
  readonly description?: string | null;
  readonly status?: 'ACTIVE' | 'INACTIVE' | 'RETIRED';
  readonly metadata?: Readonly<Record<string, unknown>>;
}

interface AssetCursor {
  readonly createdAt: string;
  readonly id: string;
}

function notFound(entity: string): AppError {
  return new AppError({
    code: 'RESOURCE_NOT_FOUND',
    message: `${entity} não encontrado(a).`,
    statusCode: 404,
  });
}

function conflict(code: string, message: string, details?: unknown): AppError {
  return new AppError({ code, message, statusCode: 409, details });
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

function text(row: CatalogRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`Campo ${key} ausente no contrato do banco.`);
  return value;
}

function nullableText(row: CatalogRow, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`Campo ${key} inválido no contrato do banco.`);
  return value;
}

function nullableNumber(row: CatalogRow, key: string): number | null {
  const value = row[key];
  if (value === null) return null;
  const converted = Number(value);
  if (!Number.isFinite(converted)) throw new Error(`Campo ${key} inválido no contrato do banco.`);
  return converted;
}

function nullableDate(row: CatalogRow, key: string): Date | null {
  const value = row[key];
  if (value === null) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(value);
  throw new Error(`Campo ${key} inválido no contrato do banco.`);
}

function objectValue(row: CatalogRow, key: string): Readonly<Record<string, unknown>> {
  const value = row[key];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return {};
}

function encodeCursor(row: { readonly created_at: Date; readonly id: string }): string {
  return Buffer.from(
    JSON.stringify({ createdAt: row.created_at.toISOString(), id: row.id } satisfies AssetCursor),
    'utf8',
  ).toString('base64url');
}

export function decodeAssetCursor(cursor: string | undefined): {
  readonly createdAt: Date | null;
  readonly id: string | null;
} {
  if (!cursor) return { createdAt: null, id: null };

  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') throw new Error('cursor');
    const candidate = parsed as Partial<AssetCursor>;
    const createdAt = new Date(candidate.createdAt ?? '');
    if (
      Number.isNaN(createdAt.getTime()) ||
      typeof candidate.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        candidate.id,
      )
    ) {
      throw new Error('cursor');
    }
    return { createdAt, id: candidate.id };
  } catch {
    throw new AppError({
      code: 'INVALID_CURSOR',
      message: 'O cursor de paginação é inválido.',
      statusCode: 400,
    });
  }
}

export class CatalogService {
  private readonly repository = new CatalogRepository();

  constructor(private readonly database: Database) {}

  async structure(user: AuthenticatedUser, status: RecordStatus | null) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const plants = await this.repository.listPlants(client, status);
        const sectors = await this.repository.listSectors(client, status);
        const lines = await this.repository.listLines(client, status);
        return {
          plantas: plants.map((plant) => ({
            ...plant,
            setores: sectors
              .filter((sector) => sector.planta_id === plant.id)
              .map((sector) => ({
                ...sector,
                linhas: lines.filter((line) => line.setor_id === sector.id),
              })),
          })),
          totais: {
            plantas: plants.length,
            setores: sectors.length,
            linhas: lines.length,
          },
        };
      },
    );
  }

  async createPlant(
    user: AuthenticatedUser,
    input: { readonly tag: string; readonly name: string },
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const created = await this.repository.createPlant(
          client,
          user.tenantId,
          randomUUID(),
          normalizeCode(input.tag),
          normalizeName(input.name),
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CMMS_PLANT_CREATED',
          'PLANT',
          created.id,
          null,
          created,
        );
        return created;
      },
    );
  }

  async updatePlant(
    user: AuthenticatedUser,
    plantId: string,
    patch: StructurePatch,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const current = await this.repository.findPlant(client, plantId, true);
        if (!current) throw notFound('Planta');
        const status = patch.status ?? (text(current, 'status') as RecordStatus);
        if (
          status !== 'ACTIVE' &&
          (await this.repository.countActiveSectors(client, plantId)) > 0
        ) {
          throw conflict(
            'STRUCTURE_HAS_ACTIVE_CHILDREN',
            'Desative ou arquive os setores ativos antes de alterar a planta.',
          );
        }
        const updated = await this.repository.updatePlant(
          client,
          plantId,
          patch.tag ? normalizeCode(patch.tag) : text(current, 'tag'),
          patch.name ? normalizeName(patch.name) : text(current, 'nome'),
          status,
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CMMS_PLANT_UPDATED',
          'PLANT',
          plantId,
          current,
          updated,
        );
        return updated;
      },
    );
  }

  async createSector(
    user: AuthenticatedUser,
    input: { readonly plantId: string; readonly tag: string; readonly name: string },
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        await this.requireActivePlant(client, input.plantId);
        const created = await this.repository.createSector(
          client,
          user.tenantId,
          randomUUID(),
          input.plantId,
          normalizeCode(input.tag),
          normalizeName(input.name),
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CMMS_SECTOR_CREATED',
          'SECTOR',
          created.id,
          null,
          created,
        );
        return created;
      },
    );
  }

  async updateSector(
    user: AuthenticatedUser,
    sectorId: string,
    patch: SectorPatch,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const current = await this.repository.findSector(client, sectorId, true);
        if (!current) throw notFound('Setor');
        const plantId = patch.plantId ?? text(current, 'planta_id');
        await this.requireActivePlant(client, plantId);
        const status = patch.status ?? (text(current, 'status') as RecordStatus);
        if (status !== 'ACTIVE' && (await this.repository.countActiveLines(client, sectorId)) > 0) {
          throw conflict(
            'STRUCTURE_HAS_ACTIVE_CHILDREN',
            'Desative ou arquive as linhas ativas antes de alterar o setor.',
          );
        }
        const updated = await this.repository.updateSector(
          client,
          sectorId,
          plantId,
          patch.tag ? normalizeCode(patch.tag) : text(current, 'tag'),
          patch.name ? normalizeName(patch.name) : text(current, 'nome'),
          status,
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CMMS_SECTOR_UPDATED',
          'SECTOR',
          sectorId,
          current,
          updated,
        );
        return updated;
      },
    );
  }

  async createLine(
    user: AuthenticatedUser,
    input: { readonly sectorId: string; readonly tag: string; readonly name: string },
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        await this.requireActiveSector(client, input.sectorId);
        const created = await this.repository.createLine(
          client,
          user.tenantId,
          randomUUID(),
          input.sectorId,
          normalizeCode(input.tag),
          normalizeName(input.name),
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CMMS_LINE_CREATED',
          'LINE',
          created.id,
          null,
          created,
        );
        return created;
      },
    );
  }

  async updateLine(
    user: AuthenticatedUser,
    lineId: string,
    patch: LinePatch,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const current = await this.repository.findLine(client, lineId, true);
        if (!current) throw notFound('Linha');
        const sectorId = patch.sectorId ?? text(current, 'setor_id');
        await this.requireActiveSector(client, sectorId);
        const status = patch.status ?? (text(current, 'status') as RecordStatus);
        if (status !== 'ACTIVE' && (await this.repository.countActiveAssets(client, lineId)) > 0) {
          throw conflict(
            'STRUCTURE_HAS_ACTIVE_CHILDREN',
            'Desative ou descomissione os ativos antes de alterar a linha.',
          );
        }
        const updated = await this.repository.updateLine(
          client,
          lineId,
          sectorId,
          patch.tag ? normalizeCode(patch.tag) : text(current, 'tag'),
          patch.name ? normalizeName(patch.name) : text(current, 'nome'),
          status,
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CMMS_LINE_UPDATED',
          'LINE',
          lineId,
          current,
          updated,
        );
        return updated;
      },
    );
  }

  async listAssets(user: AuthenticatedUser, query: AssetListQuery) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const rows = await this.repository.listAssets(client, query);
        const hasMore = rows.length > query.limit;
        const items = hasMore ? rows.slice(0, query.limit) : rows;
        const last = items.at(-1);
        return {
          itens: items,
          proximo_cursor: hasMore && last ? encodeCursor(last) : null,
          limite: query.limit,
        };
      },
    );
  }

  async getAsset(user: AuthenticatedUser, assetId: string) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const asset = await this.repository.findAsset(client, assetId);
        if (!asset) throw notFound('Ativo');
        const components = await this.repository.listComponents(client, assetId);
        const parameters = await this.repository.getAssetParameters(client, assetId);
        const alerts = await this.repository.getAssetAlerts(client, assetId);
        const history = await this.repository.getAssetHistory(client, assetId);
        return {
          ativo: asset,
          componentes: components,
          parametros: parameters,
          alertas_abertos: alerts,
          historico: history,
        };
      },
    );
  }

  async resolveCode(user: AuthenticatedUser, code: string) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const resolved = await this.repository.resolveCode(client, code.trim());
        if (!resolved) throw notFound('Código técnico');
        return resolved;
      },
    );
  }

  async getQrContext(user: AuthenticatedUser, code: string) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const resolved = await this.repository.resolveCode(client, code.trim());
        if (!resolved) throw notFound('Código técnico');

        const assetId = text(resolved, 'ativo_id');
        const componentId = nullableText(resolved, 'componente_id');
        const asset = await this.repository.findAsset(client, assetId);
        if (!asset) throw notFound('Ativo');
        const component = componentId
          ? await this.repository.findComponent(client, componentId)
          : null;

        // Uma transação usa uma conexão; consultas concorrentes no mesmo client não são seguras.
        const components = await this.repository.listComponents(client, assetId);
        const parameters = await this.repository.getAssetParameters(client, assetId);
        const actions = await this.repository.getQrPendingActions(
          client,
          assetId,
          componentId,
          user.id,
        );
        const historyRows = await this.repository.getAssetHistoryPage(
          client,
          assetId,
          componentId,
          null,
          4,
        );
        const stop = await this.repository.getQrOpenStop(client, assetId);
        const occurrences = await this.repository.getQrOpenOccurrences(
          client,
          assetId,
          componentId,
        );

        const history = historyRows.slice(0, 4);
        const hasMoreHistory = historyRows.length > 4;
        const lastHistory = history.at(-1);
        const activeParameters = parameters.filter((parameter) =>
          componentId
            ? nullableText(parameter, 'componente_id') === componentId
            : nullableText(parameter, 'componente_id') === null,
        );

        return {
          encontrado: true,
          tipo_contexto: text(resolved, 'tipo_registro'),
          ativo: asset,
          componente: component,
          componentes: components,
          acoes_pendentes: actions,
          proxima_acao: actions[0] ?? null,
          historico_recente: history,
          historico_paginacao: {
            proximo_cursor:
              hasMoreHistory && lastHistory
                ? lastHistory.criado_em instanceof Date
                  ? lastHistory.criado_em.toISOString()
                  : String(lastHistory.criado_em)
                : null,
            possui_mais: hasMoreHistory,
            limite: 4,
          },
          parametros_atuais: activeParameters,
          parada_ativa: stop,
          ocorrencias_abertas: occurrences,
          saude: {
            percentual: nullableNumber(asset, 'saude_percentual'),
            status: stop ? 'PARADO' : text(asset, 'status_operacional'),
            acoes_abertas: actions.length,
            ocorrencias_abertas: occurrences.length,
          },
          servidor_em: new Date().toISOString(),
        };
      },
    );
  }

  async getAssetHistoryPage(
    user: AuthenticatedUser,
    assetId: string,
    componentId: string | null,
    before: Date | null,
    limit: number,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        if (!(await this.repository.findAsset(client, assetId))) throw notFound('Ativo');
        if (componentId) {
          const component = await this.repository.findComponent(client, componentId);
          if (!component || text(component, 'ativo_id') !== assetId) {
            throw notFound('Componente do ativo');
          }
        }
        const rows = await this.repository.getAssetHistoryPage(
          client,
          assetId,
          componentId,
          before,
          limit,
        );
        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;
        const last = items.at(-1);
        return {
          itens: items,
          ativo_id: assetId,
          componente_id: componentId,
          proximo_cursor:
            hasMore && last
              ? last.criado_em instanceof Date
                ? last.criado_em.toISOString()
                : String(last.criado_em)
              : null,
          possui_mais: hasMore,
          limite: limit,
          linhas_consultadas: items.length,
        };
      },
    );
  }

  async createAsset(user: AuthenticatedUser, input: AssetInput, audit: RequestAuditMetadata) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        await this.requireActiveLine(client, input.lineId);
        const id = randomUUID();
        const normalized = this.normalizeAsset(input);
        const created = await this.repository.createAsset(
          client,
          user.tenantId,
          id,
          `fabcontrol://asset/${id}`,
          normalized,
        );
        await this.repository.writeHistory(
          client,
          user.tenantId,
          user.id,
          audit.roleSnapshot,
          id,
          null,
          'ASSET_CREATED',
          `Ativo ${normalized.tag} cadastrado.`,
          { criticality: normalized.criticality, operationalStatus: normalized.operationalStatus },
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CMMS_ASSET_CREATED',
          'ASSET',
          id,
          null,
          created,
        );
        return created;
      },
    );
  }

  async updateAsset(
    user: AuthenticatedUser,
    assetId: string,
    patch: Partial<AssetInput>,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const current = await this.repository.findAsset(client, assetId, true);
        if (!current) throw notFound('Ativo');
        const merged = this.mergeAsset(current, patch);
        await this.requireActiveLine(client, merged.lineId);
        if (
          ['DECOMMISSIONED', 'ARCHIVED'].includes(merged.lifecycleStatus) &&
          (await this.repository.countActiveComponents(client, assetId)) > 0
        ) {
          throw conflict(
            'ASSET_HAS_ACTIVE_COMPONENTS',
            'Desative ou descomissione os componentes antes de encerrar o ciclo do ativo.',
          );
        }
        const updated = await this.repository.updateAsset(client, assetId, merged);
        await this.repository.writeHistory(
          client,
          user.tenantId,
          user.id,
          audit.roleSnapshot,
          assetId,
          null,
          'ASSET_UPDATED',
          `Ativo ${merged.tag} atualizado.`,
          {
            previousOperationalStatus: current.status_operacional,
            operationalStatus: merged.operationalStatus,
            previousLifecycleStatus: current.status_ciclo_vida,
            lifecycleStatus: merged.lifecycleStatus,
          },
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CMMS_ASSET_UPDATED',
          'ASSET',
          assetId,
          current,
          updated,
        );
        return updated;
      },
    );
  }

  async listComponents(user: AuthenticatedUser, assetId: string) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        if (!(await this.repository.findAsset(client, assetId))) throw notFound('Ativo');
        return { itens: await this.repository.listComponents(client, assetId) };
      },
    );
  }

  async listAllComponents(user: AuthenticatedUser, query: ComponentListQuery) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => ({
        itens: await this.repository.listAllComponents(client, query),
        limite: query.limit,
      }),
    );
  }

  async createComponent(
    user: AuthenticatedUser,
    input: ComponentInput,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        await this.requireActiveAsset(client, input.assetId);
        const id = randomUUID();
        const normalized = this.normalizeComponent(input);
        const created = await this.repository.createComponent(
          client,
          user.tenantId,
          id,
          `fabcontrol://component/${id}`,
          normalized,
        );
        await this.repository.writeHistory(
          client,
          user.tenantId,
          user.id,
          audit.roleSnapshot,
          input.assetId,
          id,
          'COMPONENT_CREATED',
          `Componente ${normalized.tag} cadastrado.`,
          { componentType: normalized.componentType },
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CMMS_COMPONENT_CREATED',
          'COMPONENT',
          id,
          null,
          created,
        );
        return created;
      },
    );
  }

  async updateComponent(
    user: AuthenticatedUser,
    componentId: string,
    patch: Partial<ComponentInput>,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const current = await this.repository.findComponent(client, componentId, true);
        if (!current) throw notFound('Componente');
        const merged = this.mergeComponent(current, patch);
        await this.requireActiveAsset(client, merged.assetId);
        const updated = await this.repository.updateComponent(client, componentId, merged);
        await this.repository.writeHistory(
          client,
          user.tenantId,
          user.id,
          audit.roleSnapshot,
          merged.assetId,
          componentId,
          'COMPONENT_UPDATED',
          `Componente ${merged.tag} atualizado.`,
          {
            previousOperationalStatus: current.status_operacional,
            operationalStatus: merged.operationalStatus,
          },
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CMMS_COMPONENT_UPDATED',
          'COMPONENT',
          componentId,
          current,
          updated,
        );
        return updated;
      },
    );
  }

  async listMaterials(user: AuthenticatedUser, query: MaterialListQuery) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const rows = await this.repository.listMaterials(client, query);
        const hasNextPage = rows.length > query.limit;
        const items = rows.slice(0, query.limit);
        const last = items.at(-1);
        return {
          itens: items,
          paginacao: {
            limite: query.limit,
            possui_proxima: hasNextPage,
            proximo_cursor: hasNextPage && last ? encodeCursor(last) : null,
          },
        };
      },
    );
  }

  async createMaterial(user: AuthenticatedUser, input: MaterialInput, audit: RequestAuditMetadata) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const normalized = this.normalizeMaterial(input);
        const id = randomUUID();
        const created = await this.repository.createMaterial(client, user.tenantId, id, normalized);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CMMS_MATERIAL_CREATED',
          'MATERIAL',
          id,
          null,
          created,
        );
        return created;
      },
    );
  }

  async updateMaterial(
    user: AuthenticatedUser,
    materialId: string,
    patch: Partial<MaterialInput>,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const current = await this.repository.findMaterial(client, materialId, true);
        if (!current) throw notFound('Material');
        const merged = this.mergeMaterial(current, patch);
        const updated = await this.repository.updateMaterial(client, materialId, merged);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CMMS_MATERIAL_UPDATED',
          'MATERIAL',
          materialId,
          current,
          updated,
        );
        return updated;
      },
    );
  }

  async createParameter(
    user: AuthenticatedUser,
    input: ParameterDefinitionInput,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        await this.requireActiveAsset(client, input.assetId);
        if (input.componentId) {
          const component = await this.repository.findComponent(client, input.componentId);
          if (!component) throw notFound('Componente');
          if (text(component, 'ativo_id') !== input.assetId) {
            throw conflict(
              'COMPONENT_ASSET_MISMATCH',
              'O componente não pertence ao ativo informado.',
            );
          }
        }
        const normalized = this.normalizeParameter(input);
        const created = await this.repository.createParameter(
          client,
          user.tenantId,
          randomUUID(),
          normalized,
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CMMS_PARAMETER_CREATED',
          'PARAMETER_DEFINITION',
          created.id,
          null,
          created,
        );
        return created;
      },
    );
  }

  async updateParameter(
    user: AuthenticatedUser,
    parameterId: string,
    patch: ParameterPatch,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const current = await this.repository.findParameter(client, parameterId, true);
        if (!current) throw notFound('Parâmetro');
        const merged: ParameterDefinitionInput & { readonly status: string } = {
          assetId: text(current, 'ativo_id'),
          componentId: nullableText(current, 'componente_id'),
          code: normalizeCode(patch.code ?? text(current, 'codigo')),
          name: normalizeName(patch.name ?? text(current, 'nome')),
          unit: (patch.unit ?? text(current, 'unidade')).trim(),
          valueType:
            patch.valueType ??
            (text(current, 'tipo_valor') as ParameterDefinitionInput['valueType']),
          sourceType:
            patch.sourceType ??
            (text(current, 'tipo_origem') as ParameterDefinitionInput['sourceType']),
          description:
            patch.description === undefined
              ? nullableText(current, 'descricao')
              : patch.description,
          status: patch.status ?? text(current, 'status'),
          metadata: patch.metadata ?? objectValue(current, 'metadados'),
        };
        const updated = await this.repository.updateParameter(client, parameterId, merged);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CMMS_PARAMETER_UPDATED',
          'PARAMETER_DEFINITION',
          parameterId,
          current,
          updated,
        );
        return updated;
      },
    );
  }

  async publishPolicy(
    user: AuthenticatedUser,
    parameterId: string,
    input: ParameterPolicyInput,
    audit: RequestAuditMetadata,
  ) {
    this.validatePolicy(input);
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const parameter = await this.repository.getParameterContext(client, parameterId, true);
        if (!parameter) throw notFound('Parâmetro');
        if (!['DECIMAL', 'INTEGER'].includes(parameter.value_type)) {
          throw new AppError({
            code: 'PARAMETER_POLICY_NOT_NUMERIC',
            message: 'Somente parâmetros numéricos aceitam limites mínimo e máximo.',
            statusCode: 422,
          });
        }
        const contentHash = createHash('sha256')
          .update(
            JSON.stringify({
              parameterId,
              warningMin: input.warningMin,
              warningMax: input.warningMax,
              criticalMin: input.criticalMin,
              criticalMax: input.criticalMax,
              validationRule: input.validationRule,
            }),
            'utf8',
          )
          .digest('hex');
        const created = await this.repository.publishPolicy(
          client,
          user.tenantId,
          parameter,
          user.id,
          contentHash,
          input,
        );
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'CMMS_PARAMETER_POLICY_PUBLISHED',
          'PARAMETER_POLICY',
          created.id,
          null,
          created,
        );
        return created;
      },
    );
  }

  async createReading(
    user: AuthenticatedUser,
    parameterId: string,
    input: ParameterReadingInput,
    audit: RequestAuditMetadata,
  ) {
    if (input.recordedAt.getTime() > Date.now() + 5 * 60_000) {
      throw new AppError({
        code: 'READING_FROM_FUTURE',
        message: 'A data da leitura não pode estar mais de cinco minutos no futuro.',
        statusCode: 422,
      });
    }
    if ((input.sourceEntityType === null) !== (input.sourceEntityId === null)) {
      throw new AppError({
        code: 'READING_SOURCE_INCOMPLETE',
        message: 'Tipo e identificador da origem devem ser informados juntos.',
        statusCode: 422,
      });
    }
    const suppliedValues = [input.numericValue, input.textValue, input.booleanValue].filter(
      (value) => value !== null,
    );
    if (suppliedValues.length !== 1) {
      throw new AppError({
        code: 'READING_VALUE_REQUIRED',
        message: 'Informe exatamente um valor compatível com o parâmetro.',
        statusCode: 422,
      });
    }

    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const parameter = await this.repository.getParameterContext(client, parameterId);
        if (!parameter) throw notFound('Parâmetro');
        const result = await this.repository.createReading(
          client,
          user.tenantId,
          user.id,
          parameter,
          input,
        );
        if (result.created) {
          await this.repository.createOrRefreshParameterAlert(
            client,
            user.tenantId,
            parameter,
            result.reading,
          );
          await this.repository.writeHistory(
            client,
            user.tenantId,
            user.id,
            audit.roleSnapshot,
            parameter.asset_id,
            parameter.component_id,
            'PARAMETER_READING_RECORDED',
            `Leitura registrada para ${parameter.code}.`,
            {
              classification: result.reading.classificacao,
              parameterId,
              readingId: result.reading.id,
            },
          );
          await this.repository.writeAudit(
            client,
            user.tenantId,
            user.id,
            audit,
            'CMMS_PARAMETER_READING_RECORDED',
            'PARAMETER_READING',
            result.reading.id,
            null,
            result.reading,
          );
        }
        return { ...result.reading, criada: result.created };
      },
    );
  }

  async createScopedReading(
    user: AuthenticatedUser,
    assetId: string,
    componentId: string | null,
    parameterCodeOrName: string,
    numericValue: number,
    idempotencyKey: string,
    audit: RequestAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const asset = await this.repository.findAsset(client, assetId);
        if (!asset) throw notFound('Ativo');
        if (componentId) {
          const component = await this.repository.findComponent(client, componentId);
          if (!component || text(component, 'ativo_id') !== assetId) {
            throw notFound('Componente do ativo');
          }
        }
        const parameter = await this.repository.findParameterByAssetScope(
          client,
          assetId,
          componentId,
          parameterCodeOrName.trim(),
        );
        if (!parameter) throw notFound('Parâmetro técnico do ativo');
        if (!['DECIMAL', 'INTEGER'].includes(parameter.value_type)) {
          throw conflict(
            'PARAMETER_NOT_NUMERIC',
            'O parâmetro selecionado não aceita uma leitura numérica.',
          );
        }
        const result = await this.repository.createReading(
          client,
          user.tenantId,
          user.id,
          parameter,
          {
            numericValue,
            textValue: null,
            booleanValue: null,
            source: 'MANUAL',
            sourceEntityType: componentId ? 'COMPONENT' : 'ASSET',
            sourceEntityId: componentId ?? assetId,
            recordedAt: new Date(),
            rawValue: String(numericValue),
            idempotencyKey,
            metadata: { channel: 'QR' },
          },
        );
        if (result.created) {
          await this.repository.createOrRefreshParameterAlert(
            client,
            user.tenantId,
            parameter,
            result.reading,
          );
          await this.repository.writeHistory(
            client,
            user.tenantId,
            user.id,
            audit.roleSnapshot,
            assetId,
            componentId,
            'PARAMETER_READING_RECORDED',
            `Leitura registrada para ${parameter.code}.`,
            {
              classification: result.reading.classificacao,
              parameterId: parameter.id,
              readingId: result.reading.id,
              channel: 'QR',
            },
          );
          await this.repository.writeAudit(
            client,
            user.tenantId,
            user.id,
            audit,
            'CMMS_PARAMETER_READING_RECORDED',
            'PARAMETER_READING',
            result.reading.id,
            null,
            result.reading,
          );
        }
        return {
          salva: true,
          criada: result.created,
          parametro: {
            ...result.reading,
            ativo_id: assetId,
            componente_id: componentId,
            parametro: parameter.name,
            codigo: parameter.code,
          },
        };
      },
    );
  }

  async listReadings(user: AuthenticatedUser, parameterId: string, query: ReadingListQuery) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        if (!(await this.repository.findParameter(client, parameterId))) {
          throw notFound('Parâmetro');
        }
        return { itens: await this.repository.listReadings(client, parameterId, query) };
      },
    );
  }

  private async requireActivePlant(client: PoolClient, plantId: string): Promise<void> {
    const plant = await this.repository.findPlant(client, plantId);
    if (!plant) throw notFound('Planta');
    if (plant.status !== 'ACTIVE') {
      throw conflict('PARENT_RESOURCE_INACTIVE', 'A planta informada não está ativa.');
    }
  }

  private async requireActiveSector(client: PoolClient, sectorId: string): Promise<void> {
    const sector = await this.repository.findSector(client, sectorId);
    if (!sector) throw notFound('Setor');
    if (sector.status !== 'ACTIVE') {
      throw conflict('PARENT_RESOURCE_INACTIVE', 'O setor informado não está ativo.');
    }
  }

  private async requireActiveLine(client: PoolClient, lineId: string): Promise<void> {
    const line = await this.repository.findLine(client, lineId);
    if (!line) throw notFound('Linha');
    if (line.status !== 'ACTIVE') {
      throw conflict('PARENT_RESOURCE_INACTIVE', 'A linha informada não está ativa.');
    }
  }

  private async requireActiveAsset(client: PoolClient, assetId: string): Promise<CatalogRow> {
    const asset = await this.repository.findAsset(client, assetId);
    if (!asset) throw notFound('Ativo');
    if (asset.status_ciclo_vida !== 'ACTIVE') {
      throw conflict('PARENT_RESOURCE_INACTIVE', 'O ativo informado não está ativo.');
    }
    return asset;
  }

  private normalizeAsset(input: AssetInput): AssetInput {
    return {
      ...input,
      tag: normalizeCode(input.tag),
      name: normalizeName(input.name),
      assetType: normalizeCode(input.assetType),
      hourMeterMode: input.hourMeterMode?.trim().toUpperCase() ?? null,
      manufacturer: input.manufacturer?.trim() ?? null,
      model: input.model?.trim() ?? null,
      serialNumber: input.serialNumber?.trim() ?? null,
      technicalLocation: input.technicalLocation?.trim() ?? null,
    };
  }

  private mergeAsset(current: CatalogRow, patch: Partial<AssetInput>): AssetInput {
    return this.normalizeAsset({
      lineId: patch.lineId ?? text(current, 'linha_id'),
      tag: patch.tag ?? text(current, 'tag'),
      name: patch.name ?? text(current, 'nome'),
      assetType: patch.assetType ?? text(current, 'tipo'),
      criticality: patch.criticality ?? (text(current, 'criticidade') as AssetInput['criticality']),
      operationalStatus:
        patch.operationalStatus ??
        (text(current, 'status_operacional') as AssetInput['operationalStatus']),
      lifecycleStatus:
        patch.lifecycleStatus ??
        (text(current, 'status_ciclo_vida') as AssetInput['lifecycleStatus']),
      healthPercent:
        patch.healthPercent === undefined
          ? nullableNumber(current, 'saude_percentual')
          : patch.healthPercent,
      currentHourMeter:
        patch.currentHourMeter === undefined
          ? nullableNumber(current, 'horimetro_atual')
          : patch.currentHourMeter,
      hourMeterMode:
        patch.hourMeterMode === undefined
          ? nullableText(current, 'modo_horimetro')
          : patch.hourMeterMode,
      manufacturer:
        patch.manufacturer === undefined ? nullableText(current, 'fabricante') : patch.manufacturer,
      model: patch.model === undefined ? nullableText(current, 'modelo') : patch.model,
      serialNumber:
        patch.serialNumber === undefined
          ? nullableText(current, 'numero_serie')
          : patch.serialNumber,
      technicalLocation:
        patch.technicalLocation === undefined
          ? nullableText(current, 'localizacao_tecnica')
          : patch.technicalLocation,
      metadata: patch.metadata ?? objectValue(current, 'metadados'),
    });
  }

  private normalizeComponent(input: ComponentInput): ComponentInput {
    return {
      ...input,
      tag: normalizeCode(input.tag),
      name: normalizeName(input.name),
      componentType: normalizeCode(input.componentType),
      manufacturer: input.manufacturer?.trim() ?? null,
      model: input.model?.trim() ?? null,
      serialNumber: input.serialNumber?.trim() ?? null,
      technicalLocation: input.technicalLocation?.trim() ?? null,
    };
  }

  private mergeComponent(current: CatalogRow, patch: Partial<ComponentInput>): ComponentInput {
    return this.normalizeComponent({
      assetId: patch.assetId ?? text(current, 'ativo_id'),
      tag: patch.tag ?? text(current, 'tag'),
      name: patch.name ?? text(current, 'nome'),
      componentType: patch.componentType ?? text(current, 'tipo'),
      criticality:
        patch.criticality ?? (text(current, 'criticidade') as ComponentInput['criticality']),
      operationalStatus:
        patch.operationalStatus ??
        (text(current, 'status_operacional') as ComponentInput['operationalStatus']),
      lifecycleStatus:
        patch.lifecycleStatus ??
        (text(current, 'status_ciclo_vida') as ComponentInput['lifecycleStatus']),
      usefulLifeHours:
        patch.usefulLifeHours === undefined
          ? nullableNumber(current, 'vida_util_horas')
          : patch.usefulLifeHours,
      usefulLifeDays:
        patch.usefulLifeDays === undefined
          ? nullableNumber(current, 'vida_util_dias')
          : patch.usefulLifeDays,
      accumulatedHours:
        patch.accumulatedHours === undefined
          ? nullableNumber(current, 'horas_acumuladas')
          : patch.accumulatedHours,
      installedAt:
        patch.installedAt === undefined ? nullableDate(current, 'instalado_em') : patch.installedAt,
      manufacturer:
        patch.manufacturer === undefined ? nullableText(current, 'fabricante') : patch.manufacturer,
      model: patch.model === undefined ? nullableText(current, 'modelo') : patch.model,
      serialNumber:
        patch.serialNumber === undefined
          ? nullableText(current, 'numero_serie')
          : patch.serialNumber,
      technicalLocation:
        patch.technicalLocation === undefined
          ? nullableText(current, 'localizacao_tecnica')
          : patch.technicalLocation,
      metadata: patch.metadata ?? objectValue(current, 'metadados'),
    });
  }

  private normalizeMaterial(input: MaterialInput): MaterialInput {
    return {
      ...input,
      sku: normalizeCode(input.sku),
      name: normalizeName(input.name),
      unit: input.unit.trim().toUpperCase(),
    };
  }

  private mergeMaterial(current: CatalogRow, patch: Partial<MaterialInput>): MaterialInput {
    return this.normalizeMaterial({
      sku: patch.sku ?? text(current, 'sku'),
      name: patch.name ?? text(current, 'nome'),
      unit: patch.unit ?? text(current, 'unidade'),
      currentStock: patch.currentStock ?? nullableNumber(current, 'estoque_atual') ?? 0,
      minimumStock: patch.minimumStock ?? nullableNumber(current, 'estoque_minimo') ?? 0,
      status: patch.status ?? (text(current, 'status') as MaterialInput['status']),
    });
  }

  private normalizeParameter(input: ParameterDefinitionInput): ParameterDefinitionInput {
    return {
      ...input,
      code: normalizeCode(input.code),
      name: normalizeName(input.name),
      unit: input.unit.trim(),
      description: input.description?.trim() ?? null,
    };
  }

  private validatePolicy(input: ParameterPolicyInput): void {
    const { criticalMin, warningMin, warningMax, criticalMax } = input;
    const invalid =
      (criticalMin !== null && warningMin !== null && criticalMin > warningMin) ||
      (warningMin !== null && warningMax !== null && warningMin > warningMax) ||
      (warningMax !== null && criticalMax !== null && warningMax > criticalMax);
    if (invalid) {
      throw new AppError({
        code: 'PARAMETER_POLICY_INVALID_RANGE',
        message:
          'Os limites devem respeitar a ordem: crítico mínimo, alerta mínimo, alerta máximo e crítico máximo.',
        statusCode: 422,
      });
    }
  }
}

export type { LinePatch, ParameterPatch, SectorPatch, StructurePatch };
