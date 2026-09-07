import { Type } from '@fastify/type-provider-typebox';

const uuid = Type.String({ format: 'uuid' });
const nullableUuid = Type.Union([Type.Null(), uuid]);
const nullableText = Type.Union([Type.Null(), Type.String({ maxLength: 4_000 })]);
const nullableDateTime = Type.Union([Type.Null(), Type.String({ format: 'date-time' })]);
const severity = Type.Union([
  Type.Literal('LOW'),
  Type.Literal('MEDIUM'),
  Type.Literal('HIGH'),
  Type.Literal('CRITICAL'),
]);
const alertSeverity = Type.Union([Type.Literal('INFO'), severity]);
const stopStatus = Type.Union([
  Type.Literal('OPEN'),
  Type.Literal('WAITING_MAINTENANCE'),
  Type.Literal('IN_MAINTENANCE'),
  Type.Literal('WAITING_OPERATIONAL_RETURN'),
  Type.Literal('COMPLETED'),
  Type.Literal('CANCELLED'),
]);

export const monitoringIdentifierParamsSchema = Type.Object(
  {
    occurrenceId: Type.Optional(uuid),
    alertId: Type.Optional(uuid),
    stopId: Type.Optional(uuid),
    notificationId: Type.Optional(uuid),
  },
  { additionalProperties: false },
);

export const occurrenceListQuerySchema = Type.Object(
  {
    busca: Type.Optional(Type.String({ maxLength: 160 })),
    status: Type.Optional(Type.String({ maxLength: 40 })),
    tratamento_status: Type.Optional(Type.String({ maxLength: 40 })),
    severidade: Type.Optional(severity),
    ativo_id: Type.Optional(uuid),
    limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

export const createOccurrenceBodySchema = Type.Object(
  {
    ativo_id: uuid,
    componente_id: nullableUuid,
    tipo: Type.String({ minLength: 2, maxLength: 80 }),
    titulo: Type.String({ minLength: 3, maxLength: 240 }),
    descricao: Type.String({ minLength: 3, maxLength: 8_000 }),
    severidade: severity,
    equipamento_parado: Type.Boolean(),
    tipo_parada: nullableText,
    motivo_parada: nullableText,
    ocorrida_em: nullableDateTime,
  },
  { additionalProperties: false },
);

export const technicalAnalysisBodySchema = Type.Object(
  {
    titulo: Type.String({ minLength: 3, maxLength: 240 }),
    diagnostico: Type.String({ minLength: 10, maxLength: 8_000 }),
    risco: Type.String({ minLength: 3, maxLength: 4_000 }),
    causa_provavel: nullableText,
    recomendacao: Type.String({ minLength: 10, maxLength: 8_000 }),
    recomenda_checklist: Type.Boolean(),
    recomenda_ordem_servico: Type.Boolean(),
    prioridade: severity,
    relatorio: Type.Record(Type.String({ minLength: 1, maxLength: 120 }), Type.Unknown()),
  },
  { additionalProperties: false },
);

export const parameterActionRequestBodySchema = Type.Object(
  {
    leitura_id: uuid,
    tipo_solicitacao: Type.Union([
      Type.Literal('INSPECTION'),
      Type.Literal('CHECKLIST'),
      Type.Literal('LIMIT_ADJUSTMENT'),
    ]),
    prioridade: Type.Union([Type.Null(), severity]),
    observacao: nullableText,
    causa_provavel: nullableText,
    risco: nullableText,
    limite_minimo_proposto: Type.Union([Type.Null(), Type.Number()]),
    limite_maximo_proposto: Type.Union([Type.Null(), Type.Number()]),
  },
  { additionalProperties: false },
);

export const stopListQuerySchema = Type.Object(
  {
    busca: Type.Optional(Type.String({ maxLength: 160 })),
    status: Type.Optional(stopStatus),
    ativo_id: Type.Optional(uuid),
    somente_abertas: Type.Optional(Type.Boolean()),
    limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

export const createStopBodySchema = Type.Object(
  {
    ativo_id: uuid,
    componente_id: nullableUuid,
    origem: Type.String({ minLength: 2, maxLength: 80 }),
    tipo: Type.String({ minLength: 2, maxLength: 80 }),
    motivo: Type.String({ minLength: 3, maxLength: 4_000 }),
    iniciada_em: Type.String({ format: 'date-time' }),
    tolerancia_retorno_minutos: Type.Integer({ minimum: 0, maximum: 1_440 }),
  },
  { additionalProperties: false },
);

export const transitionStopBodySchema = Type.Object(
  {
    status: stopStatus,
    categoria_retorno: nullableText,
    justificativa_divergencia: nullableText,
  },
  { additionalProperties: false },
);

export const alertListQuerySchema = Type.Object(
  {
    busca: Type.Optional(Type.String({ maxLength: 160 })),
    status: Type.Optional(Type.String({ maxLength: 40 })),
    severidade: Type.Optional(alertSeverity),
    ativo_id: Type.Optional(uuid),
    limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

export const alertOccurrenceBodySchema = Type.Object(
  {
    titulo: Type.Optional(Type.String({ minLength: 3, maxLength: 240 })),
    descricao: Type.Optional(Type.String({ minLength: 3, maxLength: 8_000 })),
    equipamento_parado: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const notificationListQuerySchema = Type.Object(
  {
    busca: Type.Optional(Type.String({ maxLength: 160 })),
    somente_nao_lidas: Type.Optional(Type.Boolean()),
    prioridade: Type.Optional(alertSeverity),
    contexto: Type.Optional(Type.String({ maxLength: 80 })),
    limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

export const analyticsQuerySchema = Type.Object(
  {
    ativo_id: Type.Optional(uuid),
    inicio: Type.String({ format: 'date-time' }),
    fim: Type.String({ format: 'date-time' }),
    limite_ranking: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  },
  { additionalProperties: false },
);
