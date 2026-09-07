import { Type } from '@fastify/type-provider-typebox';

const uuid = Type.String({ format: 'uuid' });
const shortCode = Type.String({ minLength: 1, maxLength: 80 });
const shortName = Type.String({ minLength: 1, maxLength: 160 });
const optionalText = Type.Union([Type.String({ maxLength: 500 }), Type.Null()]);
const metadata = Type.Record(Type.String({ maxLength: 120 }), Type.Unknown());

const recordStatus = Type.Union([
  Type.Literal('ACTIVE'),
  Type.Literal('INACTIVE'),
  Type.Literal('ARCHIVED'),
]);
const criticality = Type.Union([
  Type.Literal('LOW'),
  Type.Literal('MEDIUM'),
  Type.Literal('HIGH'),
  Type.Literal('CRITICAL'),
]);
const operationalStatus = Type.Union([
  Type.Literal('OPERATING'),
  Type.Literal('STOPPED'),
  Type.Literal('INSPECTION'),
  Type.Literal('MAINTENANCE_PLANNED'),
  Type.Literal('MAINTENANCE_UNPLANNED'),
  Type.Literal('UNAVAILABLE'),
]);
const lifecycleStatus = Type.Union([
  Type.Literal('ACTIVE'),
  Type.Literal('INACTIVE'),
  Type.Literal('DECOMMISSIONED'),
  Type.Literal('ARCHIVED'),
]);
const readingClassification = Type.Union([
  Type.Literal('NORMAL'),
  Type.Literal('WARNING_LOW'),
  Type.Literal('WARNING_HIGH'),
  Type.Literal('CRITICAL_LOW'),
  Type.Literal('CRITICAL_HIGH'),
  Type.Literal('UNCLASSIFIED'),
]);

export const identifierParamsSchema = Type.Object(
  {
    plantId: Type.Optional(uuid),
    sectorId: Type.Optional(uuid),
    lineId: Type.Optional(uuid),
    assetId: Type.Optional(uuid),
    componentId: Type.Optional(uuid),
    materialId: Type.Optional(uuid),
    parameterId: Type.Optional(uuid),
  },
  { additionalProperties: false },
);

export const codeParamsSchema = Type.Object(
  { code: Type.String({ minLength: 1, maxLength: 300 }) },
  { additionalProperties: false },
);

export const assetHistoryQuerySchema = Type.Object(
  {
    componente_id: Type.Optional(uuid),
    antes_de: Type.Optional(Type.String({ format: 'date-time' })),
    limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

export const structureQuerySchema = Type.Object(
  { status: Type.Optional(recordStatus) },
  { additionalProperties: false },
);

export const createPlantBodySchema = Type.Object(
  { tag: shortCode, nome: shortName },
  { additionalProperties: false },
);

export const updatePlantBodySchema = Type.Partial(
  Type.Object({ tag: shortCode, nome: shortName, status: recordStatus }),
  { additionalProperties: false, minProperties: 1 },
);

export const createSectorBodySchema = Type.Object(
  { planta_id: uuid, tag: shortCode, nome: shortName },
  { additionalProperties: false },
);

export const updateSectorBodySchema = Type.Partial(
  Type.Object({ planta_id: uuid, tag: shortCode, nome: shortName, status: recordStatus }),
  { additionalProperties: false, minProperties: 1 },
);

export const createLineBodySchema = Type.Object(
  { setor_id: uuid, tag: shortCode, nome: shortName },
  { additionalProperties: false },
);

export const updateLineBodySchema = Type.Partial(
  Type.Object({ setor_id: uuid, tag: shortCode, nome: shortName, status: recordStatus }),
  { additionalProperties: false, minProperties: 1 },
);

const assetFields = Type.Object({
  linha_id: uuid,
  tag: shortCode,
  nome: shortName,
  tipo: Type.String({ minLength: 1, maxLength: 100 }),
  criticidade: criticality,
  status_operacional: operationalStatus,
  status_ciclo_vida: lifecycleStatus,
  saude_percentual: Type.Union([Type.Number({ minimum: 0, maximum: 100 }), Type.Null()]),
  horimetro_atual: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  modo_horimetro: Type.Union([Type.String({ minLength: 1, maxLength: 40 }), Type.Null()]),
  fabricante: optionalText,
  modelo: optionalText,
  numero_serie: optionalText,
  localizacao_tecnica: optionalText,
  metadados: metadata,
});

export const createAssetBodySchema = assetFields;
export const updateAssetBodySchema = Type.Partial(assetFields, {
  additionalProperties: false,
  minProperties: 1,
});

export const listAssetsQuerySchema = Type.Object(
  {
    busca: Type.Optional(Type.String({ maxLength: 160 })),
    planta_id: Type.Optional(uuid),
    setor_id: Type.Optional(uuid),
    linha_id: Type.Optional(uuid),
    status_operacional: Type.Optional(operationalStatus),
    status_ciclo_vida: Type.Optional(lifecycleStatus),
    limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  },
  { additionalProperties: false },
);

export const listComponentsQuerySchema = Type.Object(
  {
    busca: Type.Optional(Type.String({ maxLength: 160 })),
    ativo_id: Type.Optional(uuid),
    limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 300 })),
  },
  { additionalProperties: false },
);

const componentFields = Type.Object({
  ativo_id: uuid,
  tag: shortCode,
  nome: shortName,
  tipo: Type.String({ minLength: 1, maxLength: 100 }),
  criticidade: criticality,
  status_operacional: operationalStatus,
  status_ciclo_vida: lifecycleStatus,
  vida_util_horas: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  vida_util_dias: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  horas_acumuladas: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  instalado_em: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  fabricante: optionalText,
  modelo: optionalText,
  numero_serie: optionalText,
  localizacao_tecnica: optionalText,
  metadados: metadata,
});

export const createComponentBodySchema = componentFields;
export const updateComponentBodySchema = Type.Partial(componentFields, {
  additionalProperties: false,
  minProperties: 1,
});

const materialFields = Type.Object({
  sku: shortCode,
  nome: shortName,
  unidade: Type.String({ minLength: 1, maxLength: 30 }),
  estoque_atual: Type.Number({ minimum: 0 }),
  estoque_minimo: Type.Number({ minimum: 0 }),
  status: recordStatus,
});

export const createMaterialBodySchema = materialFields;
export const updateMaterialBodySchema = Type.Partial(materialFields, {
  additionalProperties: false,
  minProperties: 1,
});

export const listMaterialsQuerySchema = Type.Object(
  {
    busca: Type.Optional(Type.String({ maxLength: 160 })),
    status: Type.Optional(recordStatus),
    abaixo_minimo: Type.Optional(Type.Boolean()),
    limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  },
  { additionalProperties: false },
);

const parameterFields = Type.Object({
  ativo_id: uuid,
  componente_id: Type.Union([uuid, Type.Null()]),
  codigo: shortCode,
  nome: shortName,
  unidade: Type.String({ minLength: 1, maxLength: 30 }),
  tipo_valor: Type.Union([
    Type.Literal('DECIMAL'),
    Type.Literal('INTEGER'),
    Type.Literal('BOOLEAN'),
    Type.Literal('TEXT'),
  ]),
  tipo_origem: Type.Union([
    Type.Literal('MANUAL'),
    Type.Literal('CHECKLIST'),
    Type.Literal('SENSOR'),
    Type.Literal('IMPORT'),
  ]),
  descricao: optionalText,
  metadados: metadata,
});

export const createParameterBodySchema = parameterFields;
export const updateParameterBodySchema = Type.Object(
  {
    codigo: Type.Optional(shortCode),
    nome: Type.Optional(shortName),
    unidade: Type.Optional(Type.String({ minLength: 1, maxLength: 30 })),
    tipo_valor: Type.Optional(
      Type.Union([
        Type.Literal('DECIMAL'),
        Type.Literal('INTEGER'),
        Type.Literal('BOOLEAN'),
        Type.Literal('TEXT'),
      ]),
    ),
    tipo_origem: Type.Optional(
      Type.Union([
        Type.Literal('MANUAL'),
        Type.Literal('CHECKLIST'),
        Type.Literal('SENSOR'),
        Type.Literal('IMPORT'),
      ]),
    ),
    descricao: Type.Optional(optionalText),
    status: Type.Optional(
      Type.Union([Type.Literal('ACTIVE'), Type.Literal('INACTIVE'), Type.Literal('RETIRED')]),
    ),
    metadados: Type.Optional(metadata),
  },
  { additionalProperties: false, minProperties: 1 },
);

export const createPolicyBodySchema = Type.Object(
  {
    alerta_minimo: Type.Union([Type.Number(), Type.Null()]),
    alerta_maximo: Type.Union([Type.Number(), Type.Null()]),
    critico_minimo: Type.Union([Type.Number(), Type.Null()]),
    critico_maximo: Type.Union([Type.Number(), Type.Null()]),
    regra_validacao: metadata,
  },
  { additionalProperties: false },
);

export const createReadingBodySchema = Type.Object(
  {
    valor_numerico: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    valor_texto: Type.Optional(
      Type.Union([Type.String({ minLength: 1, maxLength: 2_000 }), Type.Null()]),
    ),
    valor_booleano: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
    origem: Type.Union([
      Type.Literal('MANUAL'),
      Type.Literal('CHECKLIST'),
      Type.Literal('SENSOR'),
      Type.Literal('IMPORT'),
    ]),
    entidade_origem_tipo: Type.Optional(
      Type.Union([Type.String({ minLength: 1, maxLength: 80 }), Type.Null()]),
    ),
    entidade_origem_id: Type.Optional(Type.Union([uuid, Type.Null()])),
    registrado_em: Type.Optional(Type.String({ format: 'date-time' })),
    valor_bruto: Type.Optional(
      Type.Union([Type.String({ minLength: 1, maxLength: 2_000 }), Type.Null()]),
    ),
    chave_idempotencia: Type.String({ minLength: 8, maxLength: 160 }),
    metadados: Type.Optional(metadata),
  },
  { additionalProperties: false },
);

export const createScopedReadingBodySchema = Type.Object(
  {
    componente_id: Type.Optional(Type.Union([uuid, Type.Null()])),
    parametro: Type.String({ minLength: 1, maxLength: 160 }),
    valor: Type.Number(),
    unidade: Type.Optional(Type.String({ maxLength: 40 })),
    origem: Type.Optional(Type.Literal('MANUAL')),
    chave_idempotencia: Type.String({ minLength: 8, maxLength: 160 }),
  },
  { additionalProperties: false },
);

export const listReadingsQuerySchema = Type.Object(
  {
    limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    antes_de: Type.Optional(Type.String({ format: 'date-time' })),
    classificacao: Type.Optional(readingClassification),
  },
  { additionalProperties: false },
);
