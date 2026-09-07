import type { FastifyRequest } from 'fastify';

import { AppError } from '../../core/errors/app-error.js';
import { successEnvelope } from '../../core/http/envelope.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { decodeAssetCursor, type CatalogService } from './catalog.service.js';
import type {
  AssetInput,
  ComponentInput,
  Criticality,
  LifecycleStatus,
  MaterialInput,
  OperationalStatus,
  ParameterDefinitionInput,
  ParameterSourceType,
  ParameterValueType,
  ReadingClassification,
  ReadingSource,
  RecordStatus,
  RequestAuditMetadata,
} from './catalog.types.js';

interface IdentifierParams {
  readonly plantId?: string;
  readonly sectorId?: string;
  readonly lineId?: string;
  readonly assetId?: string;
  readonly componentId?: string;
  readonly materialId?: string;
  readonly parameterId?: string;
}

interface CodeParams {
  readonly code: string;
}

interface AssetHistoryQuery {
  readonly componente_id?: string;
  readonly antes_de?: string;
  readonly limite?: number;
}

interface StructureQuery {
  readonly status?: RecordStatus;
}

interface PlantBody {
  readonly tag: string;
  readonly nome: string;
}

interface PlantPatch {
  readonly tag?: string;
  readonly nome?: string;
  readonly status?: RecordStatus;
}

interface SectorBody extends PlantBody {
  readonly planta_id: string;
}

interface SectorPatch extends PlantPatch {
  readonly planta_id?: string;
}

interface LineBody extends PlantBody {
  readonly setor_id: string;
}

interface LinePatch extends PlantPatch {
  readonly setor_id?: string;
}

interface AssetBody {
  readonly linha_id: string;
  readonly tag: string;
  readonly nome: string;
  readonly tipo: string;
  readonly criticidade: Criticality;
  readonly status_operacional: OperationalStatus;
  readonly status_ciclo_vida: LifecycleStatus;
  readonly saude_percentual: number | null;
  readonly horimetro_atual: number | null;
  readonly modo_horimetro: string | null;
  readonly fabricante: string | null;
  readonly modelo: string | null;
  readonly numero_serie: string | null;
  readonly localizacao_tecnica: string | null;
  readonly metadados: Readonly<Record<string, unknown>>;
}

interface AssetListQuery {
  readonly busca?: string;
  readonly planta_id?: string;
  readonly setor_id?: string;
  readonly linha_id?: string;
  readonly status_operacional?: OperationalStatus;
  readonly status_ciclo_vida?: LifecycleStatus;
  readonly limite?: number;
  readonly cursor?: string;
}

interface ComponentListQuery {
  readonly busca?: string;
  readonly ativo_id?: string;
  readonly limite?: number;
}

interface ComponentBody {
  readonly ativo_id: string;
  readonly tag: string;
  readonly nome: string;
  readonly tipo: string;
  readonly criticidade: Criticality;
  readonly status_operacional: OperationalStatus;
  readonly status_ciclo_vida: LifecycleStatus;
  readonly vida_util_horas: number | null;
  readonly vida_util_dias: number | null;
  readonly horas_acumuladas: number | null;
  readonly instalado_em: string | null;
  readonly fabricante: string | null;
  readonly modelo: string | null;
  readonly numero_serie: string | null;
  readonly localizacao_tecnica: string | null;
  readonly metadados: Readonly<Record<string, unknown>>;
}

interface ParameterBody {
  readonly ativo_id: string;
  readonly componente_id: string | null;
  readonly codigo: string;
  readonly nome: string;
  readonly unidade: string;
  readonly tipo_valor: ParameterValueType;
  readonly tipo_origem: ParameterSourceType;
  readonly descricao: string | null;
  readonly metadados: Readonly<Record<string, unknown>>;
}

interface ScopedReadingBody {
  readonly componente_id?: string | null;
  readonly parametro: string;
  readonly valor: number;
  readonly unidade?: string;
  readonly origem?: 'MANUAL';
  readonly chave_idempotencia: string;
}

interface MaterialBody {
  readonly sku: string;
  readonly nome: string;
  readonly unidade: string;
  readonly estoque_atual: number;
  readonly estoque_minimo: number;
  readonly status: RecordStatus;
}

interface MaterialQuery {
  readonly busca?: string;
  readonly status?: RecordStatus;
  readonly abaixo_minimo?: boolean;
  readonly limite?: number;
  readonly cursor?: string;
}

interface ParameterPatch {
  readonly codigo?: string;
  readonly nome?: string;
  readonly unidade?: string;
  readonly tipo_valor?: ParameterValueType;
  readonly tipo_origem?: ParameterSourceType;
  readonly descricao?: string | null;
  readonly status?: 'ACTIVE' | 'INACTIVE' | 'RETIRED';
  readonly metadados?: Readonly<Record<string, unknown>>;
}

interface PolicyBody {
  readonly alerta_minimo: number | null;
  readonly alerta_maximo: number | null;
  readonly critico_minimo: number | null;
  readonly critico_maximo: number | null;
  readonly regra_validacao: Readonly<Record<string, unknown>>;
}

interface ReadingBody {
  readonly valor_numerico?: number | null;
  readonly valor_texto?: string | null;
  readonly valor_booleano?: boolean | null;
  readonly origem: ReadingSource;
  readonly entidade_origem_tipo?: string | null;
  readonly entidade_origem_id?: string | null;
  readonly registrado_em?: string;
  readonly valor_bruto?: string | null;
  readonly chave_idempotencia: string;
  readonly metadados?: Readonly<Record<string, unknown>>;
}

interface ReadingQuery {
  readonly limite?: number;
  readonly antes_de?: string;
  readonly classificacao?: ReadingClassification;
}

function user(request: FastifyRequest): AuthenticatedUser {
  if (request.auth) return request.auth.user;
  throw new AppError({
    code: 'AUTH_CONTEXT_MISSING',
    message: 'A identidade da sessão não está disponível.',
    statusCode: 401,
  });
}

function requiredIdentifier(params: IdentifierParams, key: keyof IdentifierParams): string {
  const value = params[key];
  if (value) return value;

  throw new AppError({
    code: 'REQUEST_IDENTIFIER_MISSING',
    message: 'O identificador obrigatÃ³rio da rota nÃ£o foi informado.',
    statusCode: 400,
  });
}

function auditMetadata(request: FastifyRequest): RequestAuditMetadata {
  const authenticatedUser = user(request);
  const userAgent = request.headers['user-agent'];
  return {
    traceId: request.id,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 2_048) : null,
    ipAddress: request.ip,
    roleSnapshot: authenticatedUser.roles.join(',') || authenticatedUser.profile,
  };
}

function assetInput(body: AssetBody): AssetInput {
  return {
    lineId: body.linha_id,
    tag: body.tag,
    name: body.nome,
    assetType: body.tipo,
    criticality: body.criticidade,
    operationalStatus: body.status_operacional,
    lifecycleStatus: body.status_ciclo_vida,
    healthPercent: body.saude_percentual,
    currentHourMeter: body.horimetro_atual,
    hourMeterMode: body.modo_horimetro,
    manufacturer: body.fabricante,
    model: body.modelo,
    serialNumber: body.numero_serie,
    technicalLocation: body.localizacao_tecnica,
    metadata: body.metadados,
  };
}

function componentInput(body: ComponentBody): ComponentInput {
  return {
    assetId: body.ativo_id,
    tag: body.tag,
    name: body.nome,
    componentType: body.tipo,
    criticality: body.criticidade,
    operationalStatus: body.status_operacional,
    lifecycleStatus: body.status_ciclo_vida,
    usefulLifeHours: body.vida_util_horas,
    usefulLifeDays: body.vida_util_dias,
    accumulatedHours: body.horas_acumuladas,
    installedAt: body.instalado_em ? new Date(body.instalado_em) : null,
    manufacturer: body.fabricante,
    model: body.modelo,
    serialNumber: body.numero_serie,
    technicalLocation: body.localizacao_tecnica,
    metadata: body.metadados,
  };
}

function parameterInput(body: ParameterBody): ParameterDefinitionInput {
  return {
    assetId: body.ativo_id,
    componentId: body.componente_id,
    code: body.codigo,
    name: body.nome,
    unit: body.unidade,
    valueType: body.tipo_valor,
    sourceType: body.tipo_origem,
    description: body.descricao,
    metadata: body.metadados,
  };
}

function materialInput(body: MaterialBody): MaterialInput {
  return {
    sku: body.sku,
    name: body.nome,
    unit: body.unidade,
    currentStock: body.estoque_atual,
    minimumStock: body.estoque_minimo,
    status: body.status,
  };
}

export class CatalogController {
  constructor(private readonly service: CatalogService) {}

  structure = async (request: FastifyRequest<{ Querystring: StructureQuery }>) =>
    successEnvelope(
      request,
      'cmms.structure.list',
      await this.service.structure(user(request), request.query.status ?? null),
    );

  createPlant = async (request: FastifyRequest<{ Body: PlantBody }>) =>
    successEnvelope(
      request,
      'cmms.plants.create',
      await this.service.createPlant(
        user(request),
        { tag: request.body.tag, name: request.body.nome },
        auditMetadata(request),
      ),
    );

  updatePlant = async (request: FastifyRequest<{ Params: IdentifierParams; Body: PlantPatch }>) =>
    successEnvelope(
      request,
      'cmms.plants.update',
      await this.service.updatePlant(
        user(request),
        requiredIdentifier(request.params, 'plantId'),
        {
          ...(request.body.tag === undefined ? {} : { tag: request.body.tag }),
          ...(request.body.nome === undefined ? {} : { name: request.body.nome }),
          ...(request.body.status === undefined ? {} : { status: request.body.status }),
        },
        auditMetadata(request),
      ),
    );

  createSector = async (request: FastifyRequest<{ Body: SectorBody }>) =>
    successEnvelope(
      request,
      'cmms.sectors.create',
      await this.service.createSector(
        user(request),
        {
          plantId: request.body.planta_id,
          tag: request.body.tag,
          name: request.body.nome,
        },
        auditMetadata(request),
      ),
    );

  updateSector = async (request: FastifyRequest<{ Params: IdentifierParams; Body: SectorPatch }>) =>
    successEnvelope(
      request,
      'cmms.sectors.update',
      await this.service.updateSector(
        user(request),
        requiredIdentifier(request.params, 'sectorId'),
        {
          ...(request.body.planta_id === undefined ? {} : { plantId: request.body.planta_id }),
          ...(request.body.tag === undefined ? {} : { tag: request.body.tag }),
          ...(request.body.nome === undefined ? {} : { name: request.body.nome }),
          ...(request.body.status === undefined ? {} : { status: request.body.status }),
        },
        auditMetadata(request),
      ),
    );

  createLine = async (request: FastifyRequest<{ Body: LineBody }>) =>
    successEnvelope(
      request,
      'cmms.lines.create',
      await this.service.createLine(
        user(request),
        {
          sectorId: request.body.setor_id,
          tag: request.body.tag,
          name: request.body.nome,
        },
        auditMetadata(request),
      ),
    );

  updateLine = async (request: FastifyRequest<{ Params: IdentifierParams; Body: LinePatch }>) =>
    successEnvelope(
      request,
      'cmms.lines.update',
      await this.service.updateLine(
        user(request),
        requiredIdentifier(request.params, 'lineId'),
        {
          ...(request.body.setor_id === undefined ? {} : { sectorId: request.body.setor_id }),
          ...(request.body.tag === undefined ? {} : { tag: request.body.tag }),
          ...(request.body.nome === undefined ? {} : { name: request.body.nome }),
          ...(request.body.status === undefined ? {} : { status: request.body.status }),
        },
        auditMetadata(request),
      ),
    );

  listAssets = async (request: FastifyRequest<{ Querystring: AssetListQuery }>) => {
    const cursor = decodeAssetCursor(request.query.cursor);
    return successEnvelope(
      request,
      'cmms.assets.list',
      await this.service.listAssets(user(request), {
        search: request.query.busca?.trim() ?? '',
        plantId: request.query.planta_id ?? null,
        sectorId: request.query.setor_id ?? null,
        lineId: request.query.linha_id ?? null,
        operationalStatus: request.query.status_operacional ?? null,
        lifecycleStatus: request.query.status_ciclo_vida ?? null,
        limit: request.query.limite ?? 30,
        cursorCreatedAt: cursor.createdAt,
        cursorId: cursor.id,
      }),
    );
  };

  getAsset = async (request: FastifyRequest<{ Params: IdentifierParams }>) =>
    successEnvelope(
      request,
      'cmms.assets.get',
      await this.service.getAsset(user(request), requiredIdentifier(request.params, 'assetId')),
    );

  resolveCode = async (request: FastifyRequest<{ Params: CodeParams }>) =>
    successEnvelope(
      request,
      'cmms.assets.resolve-code',
      await this.service.resolveCode(user(request), request.params.code),
    );

  getQrContext = async (request: FastifyRequest<{ Params: CodeParams }>) =>
    successEnvelope(
      request,
      'cmms.qr-context.get',
      await this.service.getQrContext(user(request), request.params.code),
    );

  getAssetHistory = async (
    request: FastifyRequest<{ Params: IdentifierParams; Querystring: AssetHistoryQuery }>,
  ) =>
    successEnvelope(
      request,
      'cmms.assets.history.list',
      await this.service.getAssetHistoryPage(
        user(request),
        requiredIdentifier(request.params, 'assetId'),
        request.query.componente_id ?? null,
        request.query.antes_de ? new Date(request.query.antes_de) : null,
        request.query.limite ?? 20,
      ),
    );

  createAsset = async (request: FastifyRequest<{ Body: AssetBody }>) =>
    successEnvelope(
      request,
      'cmms.assets.create',
      await this.service.createAsset(
        user(request),
        assetInput(request.body),
        auditMetadata(request),
      ),
    );

  updateAsset = async (
    request: FastifyRequest<{ Params: IdentifierParams; Body: Partial<AssetBody> }>,
  ) =>
    successEnvelope(
      request,
      'cmms.assets.update',
      await this.service.updateAsset(
        user(request),
        requiredIdentifier(request.params, 'assetId'),
        {
          ...(request.body.linha_id === undefined ? {} : { lineId: request.body.linha_id }),
          ...(request.body.tag === undefined ? {} : { tag: request.body.tag }),
          ...(request.body.nome === undefined ? {} : { name: request.body.nome }),
          ...(request.body.tipo === undefined ? {} : { assetType: request.body.tipo }),
          ...(request.body.criticidade === undefined
            ? {}
            : { criticality: request.body.criticidade }),
          ...(request.body.status_operacional === undefined
            ? {}
            : { operationalStatus: request.body.status_operacional }),
          ...(request.body.status_ciclo_vida === undefined
            ? {}
            : { lifecycleStatus: request.body.status_ciclo_vida }),
          ...(request.body.saude_percentual === undefined
            ? {}
            : { healthPercent: request.body.saude_percentual }),
          ...(request.body.horimetro_atual === undefined
            ? {}
            : { currentHourMeter: request.body.horimetro_atual }),
          ...(request.body.modo_horimetro === undefined
            ? {}
            : { hourMeterMode: request.body.modo_horimetro }),
          ...(request.body.fabricante === undefined
            ? {}
            : { manufacturer: request.body.fabricante }),
          ...(request.body.modelo === undefined ? {} : { model: request.body.modelo }),
          ...(request.body.numero_serie === undefined
            ? {}
            : { serialNumber: request.body.numero_serie }),
          ...(request.body.localizacao_tecnica === undefined
            ? {}
            : { technicalLocation: request.body.localizacao_tecnica }),
          ...(request.body.metadados === undefined ? {} : { metadata: request.body.metadados }),
        },
        auditMetadata(request),
      ),
    );

  listComponents = async (request: FastifyRequest<{ Params: IdentifierParams }>) =>
    successEnvelope(
      request,
      'cmms.components.list',
      await this.service.listComponents(
        user(request),
        requiredIdentifier(request.params, 'assetId'),
      ),
    );

  listAllComponents = async (request: FastifyRequest<{ Querystring: ComponentListQuery }>) =>
    successEnvelope(
      request,
      'cmms.components.list',
      await this.service.listAllComponents(user(request), {
        search: request.query.busca?.trim() ?? '',
        assetId: request.query.ativo_id ?? null,
        limit: request.query.limite ?? 100,
      }),
    );

  createComponent = async (request: FastifyRequest<{ Body: ComponentBody }>) =>
    successEnvelope(
      request,
      'cmms.components.create',
      await this.service.createComponent(
        user(request),
        componentInput(request.body),
        auditMetadata(request),
      ),
    );

  updateComponent = async (
    request: FastifyRequest<{ Params: IdentifierParams; Body: Partial<ComponentBody> }>,
  ) => {
    const body = request.body;
    return successEnvelope(
      request,
      'cmms.components.update',
      await this.service.updateComponent(
        user(request),
        requiredIdentifier(request.params, 'componentId'),
        {
          ...(body.ativo_id === undefined ? {} : { assetId: body.ativo_id }),
          ...(body.tag === undefined ? {} : { tag: body.tag }),
          ...(body.nome === undefined ? {} : { name: body.nome }),
          ...(body.tipo === undefined ? {} : { componentType: body.tipo }),
          ...(body.criticidade === undefined ? {} : { criticality: body.criticidade }),
          ...(body.status_operacional === undefined
            ? {}
            : { operationalStatus: body.status_operacional }),
          ...(body.status_ciclo_vida === undefined
            ? {}
            : { lifecycleStatus: body.status_ciclo_vida }),
          ...(body.vida_util_horas === undefined ? {} : { usefulLifeHours: body.vida_util_horas }),
          ...(body.vida_util_dias === undefined ? {} : { usefulLifeDays: body.vida_util_dias }),
          ...(body.horas_acumuladas === undefined
            ? {}
            : { accumulatedHours: body.horas_acumuladas }),
          ...(body.instalado_em === undefined
            ? {}
            : { installedAt: body.instalado_em ? new Date(body.instalado_em) : null }),
          ...(body.fabricante === undefined ? {} : { manufacturer: body.fabricante }),
          ...(body.modelo === undefined ? {} : { model: body.modelo }),
          ...(body.numero_serie === undefined ? {} : { serialNumber: body.numero_serie }),
          ...(body.localizacao_tecnica === undefined
            ? {}
            : { technicalLocation: body.localizacao_tecnica }),
          ...(body.metadados === undefined ? {} : { metadata: body.metadados }),
        },
        auditMetadata(request),
      ),
    );
  };

  listMaterials = async (request: FastifyRequest<{ Querystring: MaterialQuery }>) => {
    const cursor = decodeAssetCursor(request.query.cursor);
    return successEnvelope(
      request,
      'cmms.materials.list',
      await this.service.listMaterials(user(request), {
        search: request.query.busca?.trim() ?? '',
        status: request.query.status ?? null,
        belowMinimum: request.query.abaixo_minimo ?? null,
        limit: request.query.limite ?? 50,
        cursorCreatedAt: cursor.createdAt,
        cursorId: cursor.id,
      }),
    );
  };

  createMaterial = async (request: FastifyRequest<{ Body: MaterialBody }>) =>
    successEnvelope(
      request,
      'cmms.materials.create',
      await this.service.createMaterial(
        user(request),
        materialInput(request.body),
        auditMetadata(request),
      ),
    );

  updateMaterial = async (
    request: FastifyRequest<{ Params: IdentifierParams; Body: Partial<MaterialBody> }>,
  ) => {
    const body = request.body;
    return successEnvelope(
      request,
      'cmms.materials.update',
      await this.service.updateMaterial(
        user(request),
        requiredIdentifier(request.params, 'materialId'),
        {
          ...(body.sku === undefined ? {} : { sku: body.sku }),
          ...(body.nome === undefined ? {} : { name: body.nome }),
          ...(body.unidade === undefined ? {} : { unit: body.unidade }),
          ...(body.estoque_atual === undefined ? {} : { currentStock: body.estoque_atual }),
          ...(body.estoque_minimo === undefined ? {} : { minimumStock: body.estoque_minimo }),
          ...(body.status === undefined ? {} : { status: body.status }),
        },
        auditMetadata(request),
      ),
    );
  };

  createParameter = async (request: FastifyRequest<{ Body: ParameterBody }>) =>
    successEnvelope(
      request,
      'cmms.parameters.create',
      await this.service.createParameter(
        user(request),
        parameterInput(request.body),
        auditMetadata(request),
      ),
    );

  updateParameter = async (
    request: FastifyRequest<{ Params: IdentifierParams; Body: ParameterPatch }>,
  ) =>
    successEnvelope(
      request,
      'cmms.parameters.update',
      await this.service.updateParameter(
        user(request),
        requiredIdentifier(request.params, 'parameterId'),
        {
          ...(request.body.codigo === undefined ? {} : { code: request.body.codigo }),
          ...(request.body.nome === undefined ? {} : { name: request.body.nome }),
          ...(request.body.unidade === undefined ? {} : { unit: request.body.unidade }),
          ...(request.body.tipo_valor === undefined ? {} : { valueType: request.body.tipo_valor }),
          ...(request.body.tipo_origem === undefined
            ? {}
            : { sourceType: request.body.tipo_origem }),
          ...(request.body.descricao === undefined ? {} : { description: request.body.descricao }),
          ...(request.body.status === undefined ? {} : { status: request.body.status }),
          ...(request.body.metadados === undefined ? {} : { metadata: request.body.metadados }),
        },
        auditMetadata(request),
      ),
    );

  publishPolicy = async (request: FastifyRequest<{ Params: IdentifierParams; Body: PolicyBody }>) =>
    successEnvelope(
      request,
      'cmms.parameters.publish-policy',
      await this.service.publishPolicy(
        user(request),
        requiredIdentifier(request.params, 'parameterId'),
        {
          warningMin: request.body.alerta_minimo,
          warningMax: request.body.alerta_maximo,
          criticalMin: request.body.critico_minimo,
          criticalMax: request.body.critico_maximo,
          validationRule: request.body.regra_validacao,
        },
        auditMetadata(request),
      ),
    );

  createReading = async (
    request: FastifyRequest<{ Params: IdentifierParams; Body: ReadingBody }>,
  ) =>
    successEnvelope(
      request,
      'cmms.parameters.create-reading',
      await this.service.createReading(
        user(request),
        requiredIdentifier(request.params, 'parameterId'),
        {
          numericValue: request.body.valor_numerico ?? null,
          textValue: request.body.valor_texto ?? null,
          booleanValue: request.body.valor_booleano ?? null,
          source: request.body.origem,
          sourceEntityType: request.body.entidade_origem_tipo ?? null,
          sourceEntityId: request.body.entidade_origem_id ?? null,
          recordedAt: request.body.registrado_em
            ? new Date(request.body.registrado_em)
            : new Date(),
          rawValue: request.body.valor_bruto ?? null,
          idempotencyKey: request.body.chave_idempotencia,
          metadata: request.body.metadados ?? {},
        },
        auditMetadata(request),
      ),
    );

  createScopedReading = async (
    request: FastifyRequest<{ Params: IdentifierParams; Body: ScopedReadingBody }>,
  ) =>
    successEnvelope(
      request,
      'cmms.assets.create-reading',
      await this.service.createScopedReading(
        user(request),
        requiredIdentifier(request.params, 'assetId'),
        request.body.componente_id ?? null,
        request.body.parametro,
        request.body.valor,
        request.body.chave_idempotencia,
        auditMetadata(request),
      ),
    );

  listReadings = async (
    request: FastifyRequest<{ Params: IdentifierParams; Querystring: ReadingQuery }>,
  ) =>
    successEnvelope(
      request,
      'cmms.parameters.list-readings',
      await this.service.listReadings(
        user(request),
        requiredIdentifier(request.params, 'parameterId'),
        {
          limit: request.query.limite ?? 100,
          before: request.query.antes_de ? new Date(request.query.antes_de) : null,
          classification: request.query.classificacao ?? null,
        },
      ),
    );
}
