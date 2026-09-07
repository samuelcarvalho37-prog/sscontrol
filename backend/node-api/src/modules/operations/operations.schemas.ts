import { Type } from '@fastify/type-provider-typebox';

const uuid = Type.String({ format: 'uuid' });
const nullableUuid = Type.Union([Type.Null(), uuid]);
const nullableDateTime = Type.Union([Type.Null(), Type.String({ format: 'date-time' })]);
const nullableText = Type.Union([Type.Null(), Type.String({ maxLength: 4_000 })]);
const nullableNumber = Type.Union([Type.Null(), Type.Number()]);
const nullableBoolean = Type.Union([Type.Null(), Type.Boolean()]);

export const operationsIdentifierParamsSchema = Type.Object(
  {
    workOrderId: Type.Optional(uuid),
    demandId: Type.Optional(uuid),
    actionId: Type.Optional(uuid),
    executionId: Type.Optional(uuid),
    itemId: Type.Optional(uuid),
    objectId: Type.Optional(uuid),
  },
  { additionalProperties: false },
);

export const workOrderListQuerySchema = Type.Object(
  {
    busca: Type.Optional(Type.String({ maxLength: 160 })),
    status: Type.Optional(Type.String({ maxLength: 40 })),
    ativo_id: Type.Optional(uuid),
    limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

export const technicalDemandListQuerySchema = Type.Object(
  {
    busca: Type.Optional(Type.String({ maxLength: 160 })),
    status: Type.Optional(Type.String({ maxLength: 400 })),
    limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 300 })),
  },
  { additionalProperties: false },
);

export const maintenanceActionListQuerySchema = Type.Object(
  {
    busca: Type.Optional(Type.String({ maxLength: 160 })),
    status: Type.Optional(Type.String({ maxLength: 240 })),
    ativo_id: Type.Optional(uuid),
    limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 300 })),
  },
  { additionalProperties: false },
);

export const createWorkOrderBodySchema = Type.Object(
  {
    plano_versao_id: uuid,
    tipo_origem: Type.String({ minLength: 1, maxLength: 80 }),
    entidade_origem_id: nullableUuid,
    tipo_trabalho: Type.String({ minLength: 1, maxLength: 80 }),
    titulo: Type.String({ minLength: 3, maxLength: 240 }),
    descricao: Type.String({ minLength: 3, maxLength: 8_000 }),
    prioridade: Type.Union([
      Type.Literal('LOW'),
      Type.Literal('MEDIUM'),
      Type.Literal('HIGH'),
      Type.Literal('CRITICAL'),
    ]),
    responsavel_id: nullableUuid,
    programada_para: nullableDateTime,
    analise_tecnica: Type.Record(Type.String({ minLength: 1, maxLength: 120 }), Type.Unknown()),
  },
  { additionalProperties: false },
);

export const correctWorkOrderBodySchema = Type.Object(
  {
    titulo: Type.String({ minLength: 3, maxLength: 240 }),
    descricao: Type.String({ minLength: 3, maxLength: 8_000 }),
    prioridade: Type.Union([
      Type.Literal('LOW'),
      Type.Literal('MEDIUM'),
      Type.Literal('HIGH'),
      Type.Literal('CRITICAL'),
    ]),
    responsavel_id: nullableUuid,
    programada_para: nullableDateTime,
    analise_tecnica: Type.Record(Type.String({ minLength: 1, maxLength: 120 }), Type.Unknown()),
  },
  { additionalProperties: false },
);

export const submitReviewBodySchema = Type.Object(
  {
    politica_assinatura: Type.Union([
      Type.Literal('QUALIDADE_OU_SEGURANCA'),
      Type.Literal('QUALIDADE'),
      Type.Literal('SEGURANCA'),
      Type.Literal('QUALIDADE_E_SEGURANCA'),
    ]),
    assinaturas_exigidas: Type.Integer({ minimum: 1, maximum: 2 }),
    primeira_resposta_ate: nullableDateTime,
    resolucao_ate: nullableDateTime,
  },
  { additionalProperties: false },
);

export const signatureBodySchema = Type.Object(
  {
    declaracao: Type.String({ minLength: 10, maxLength: 2_000 }),
    significado: Type.String({ minLength: 3, maxLength: 240 }),
  },
  { additionalProperties: false },
);

export const requestChangesBodySchema = Type.Object(
  { motivo: Type.String({ minLength: 10, maxLength: 4_000 }) },
  { additionalProperties: false },
);

export const executionResponseBodySchema = Type.Object(
  {
    resposta_texto: nullableText,
    resposta_numero: nullableNumber,
    resposta_booleano: nullableBoolean,
    resposta_opcao: nullableText,
    observacao: nullableText,
    nao_aplicavel: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const executionBatchResponseBodySchema = Type.Object(
  {
    itens: Type.Array(
      Type.Object(
        {
          item_id: uuid,
          resposta: nullableText,
          valor: nullableNumber,
          observacao: nullableText,
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 200 },
    ),
  },
  { additionalProperties: false },
);

export const evidenceBodySchema = Type.Object(
  {
    objeto_armazenamento_id: uuid,
    tipo: Type.Union([
      Type.Literal('PHOTO'),
      Type.Literal('VIDEO'),
      Type.Literal('DOCUMENT'),
      Type.Literal('AUDIO'),
      Type.Literal('OTHER'),
    ]),
    observacao: nullableText,
    capturada_em: nullableDateTime,
  },
  { additionalProperties: false },
);

export const startExecutionBodySchema = Type.Object(
  {
    modo_parada: Type.Union([
      Type.Literal('NO_STOP'),
      Type.Literal('STOPPED'),
      Type.Literal('EXECUTOR_DECISION'),
    ]),
  },
  { additionalProperties: false },
);

export const completeExecutionBodySchema = Type.Object(
  {
    resultado: Type.String({ minLength: 3, maxLength: 2_000 }),
    observacao: nullableText,
    modo_parada: Type.Union([
      Type.Literal('NO_STOP'),
      Type.Literal('STOPPED'),
      Type.Literal('EXECUTOR_DECISION'),
    ]),
  },
  { additionalProperties: false },
);

export const actionReviewBodySchema = Type.Object(
  {
    decisao: Type.Union([Type.Literal('APPROVE'), Type.Literal('REJECT')]),
    comentario: Type.String({ minLength: 3, maxLength: 4_000 }),
  },
  { additionalProperties: false },
);
