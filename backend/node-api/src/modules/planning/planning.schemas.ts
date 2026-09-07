import { Type } from '@fastify/type-provider-typebox';

const uuid = Type.String({ format: 'uuid' });
const shortCode = Type.String({ minLength: 1, maxLength: 80 });
const shortName = Type.String({ minLength: 1, maxLength: 200 });
const nullableText = Type.Union([Type.Null(), Type.String({ maxLength: 2_000 })]);
const nullableNumber = Type.Union([Type.Null(), Type.Number()]);
const metadata = Type.Record(Type.String({ minLength: 1, maxLength: 120 }), Type.Unknown());

const versionStatus = Type.Union([
  Type.Literal('DRAFT'),
  Type.Literal('IN_REVIEW'),
  Type.Literal('CHANGES_REQUESTED'),
  Type.Literal('APPROVED'),
  Type.Literal('PUBLISHED'),
  Type.Literal('SUPERSEDED'),
  Type.Literal('REJECTED'),
]);
const criticality = Type.Union([
  Type.Literal('LOW'),
  Type.Literal('MEDIUM'),
  Type.Literal('HIGH'),
  Type.Literal('CRITICAL'),
]);
const lifecycleStatus = Type.Union([
  Type.Literal('ACTIVE'),
  Type.Literal('INACTIVE'),
  Type.Literal('ARCHIVED'),
]);
const signaturePolicy = Type.Union([
  Type.Literal('QUALIDADE_OU_SEGURANCA'),
  Type.Literal('QUALIDADE'),
  Type.Literal('SEGURANCA'),
  Type.Literal('QUALIDADE_E_SEGURANCA'),
  Type.Literal('PERSONALIZADA'),
]);
const responseType = Type.Union([
  Type.Literal('CONFIRMACAO'),
  Type.Literal('OK_NOK'),
  Type.Literal('NUMERO'),
  Type.Literal('PARAMETRO'),
  Type.Literal('TEXTO'),
  Type.Literal('SELECAO'),
  Type.Literal('EVIDENCIA'),
  Type.Literal('LEITURA_OPERACIONAL'),
  Type.Literal('INSTRUCAO'),
]);
const planType = Type.Union([
  Type.Literal('PREVENTIVE'),
  Type.Literal('PREDICTIVE'),
  Type.Literal('INSPECTION'),
  Type.Literal('LUBRICATION'),
  Type.Literal('CORRECTIVE'),
  Type.Literal('CONDITION_BASED'),
]);
const triggerType = Type.Union([
  Type.Literal('PERIODICITY'),
  Type.Literal('HOUR_METER'),
  Type.Literal('CONDITION'),
  Type.Literal('MANUAL'),
  Type.Literal('OCCURRENCE'),
]);
const stopMode = Type.Union([
  Type.Literal('NO_STOP'),
  Type.Literal('MANDATORY_STOP'),
  Type.Literal('EXECUTOR_DECISION'),
]);

export const planningIdentifierParamsSchema = Type.Object(
  {
    checklistId: Type.Optional(uuid),
    itemId: Type.Optional(uuid),
    planId: Type.Optional(uuid),
  },
  { additionalProperties: false },
);

export const checklistListQuerySchema = Type.Object(
  {
    busca: Type.Optional(Type.String({ maxLength: 160 })),
    status: Type.Optional(versionStatus),
    ativo_id: Type.Optional(uuid),
    limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

const checklistFields = Type.Object({
  codigo: shortCode,
  nome: shortName,
  ativo_id: uuid,
  componente_id: Type.Union([Type.Null(), uuid]),
  tipo: Type.String({ minLength: 1, maxLength: 80 }),
  criticidade: criticality,
  area_tecnica_id: Type.Union([Type.Null(), uuid]),
  cargo_tecnico_id: Type.Union([Type.Null(), uuid]),
  politica_assinatura: signaturePolicy,
  assinaturas_exigidas: Type.Integer({ minimum: 0, maximum: 10 }),
  segregacao_exigida: Type.Boolean(),
  orientacao_gestor: nullableText,
  requisitos_seguranca: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), {
    maxItems: 50,
  }),
});

export const createChecklistBodySchema = checklistFields;
export const updateChecklistBodySchema = Type.Partial(
  Type.Object({
    codigo: shortCode,
    nome: shortName,
    status_ciclo_vida: lifecycleStatus,
    criticidade: criticality,
    area_tecnica_id: Type.Union([Type.Null(), uuid]),
    cargo_tecnico_id: Type.Union([Type.Null(), uuid]),
    politica_assinatura: signaturePolicy,
    assinaturas_exigidas: Type.Integer({ minimum: 0, maximum: 10 }),
    segregacao_exigida: Type.Boolean(),
    orientacao_gestor: nullableText,
    requisitos_seguranca: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), {
      maxItems: 50,
    }),
  }),
  { additionalProperties: false, minProperties: 1 },
);

const checklistItemFields = {
  titulo: Type.String({ minLength: 1, maxLength: 300 }),
  instrucao: nullableText,
  tipo_resposta: responseType,
  categoria: Type.String({ minLength: 1, maxLength: 50 }),
  obrigatoria: Type.Boolean(),
  exige_evidencia: Type.Boolean(),
  minimo_fotos: Type.Integer({ minimum: 0, maximum: 20 }),
  bloqueia_conclusao: Type.Boolean(),
  parametro_id: Type.Union([Type.Null(), uuid]),
  valor_esperado: nullableText,
  valor_minimo: nullableNumber,
  valor_maximo: nullableNumber,
  unidade: Type.Union([Type.Null(), Type.String({ minLength: 1, maxLength: 30 })]),
  opcoes: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 100 }),
  regra_validacao: Type.Union([Type.Null(), Type.String({ minLength: 1, maxLength: 80 })]),
  peso: Type.Number({ minimum: 0, maximum: 1_000 }),
};

export const checklistItemBodySchema = Type.Object(checklistItemFields, {
  additionalProperties: false,
});

export const checklistAggregateBodySchema = Type.Object(
  {
    checklist_id: Type.Union([Type.Null(), uuid]),
    analise_tecnica_origem_id: Type.Union([Type.Null(), uuid]),
    checklist: checklistFields,
    itens: Type.Array(
      Type.Object(
        {
          id: Type.Union([Type.Null(), uuid]),
          parametro_nome: Type.Union([Type.Null(), Type.String({ maxLength: 160 })]),
          ...checklistItemFields,
        },
        { additionalProperties: false },
      ),
      { maxItems: 500 },
    ),
  },
  { additionalProperties: false },
);

export const reorderChecklistItemsBodySchema = Type.Object(
  { itens_ids: Type.Array(uuid, { minItems: 1, maxItems: 500 }) },
  { additionalProperties: false },
);

export const reviewChecklistBodySchema = Type.Object(
  {
    decisao: Type.Union([
      Type.Literal('APPROVED'),
      Type.Literal('CHANGES_REQUESTED'),
      Type.Literal('REJECTED'),
    ]),
    justificativa: Type.String({ minLength: 3, maxLength: 2_000 }),
  },
  { additionalProperties: false },
);

export const submitChecklistConfiguredBodySchema = Type.Object(
  {
    politica_assinatura: signaturePolicy,
    comentario: Type.String({ minLength: 3, maxLength: 2_000 }),
    exige_segregacao: Type.Boolean(),
    responsavel_atual_id: Type.Union([Type.Null(), uuid]),
    usuarios_validadores: Type.Array(uuid, { maxItems: 50 }),
  },
  { additionalProperties: false },
);

export const planListQuerySchema = Type.Object(
  {
    busca: Type.Optional(Type.String({ maxLength: 160 })),
    status: Type.Optional(versionStatus),
    ativo_id: Type.Optional(uuid),
    tipo: Type.Optional(planType),
    limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

const planFields = Type.Object({
  codigo: shortCode,
  nome: shortName,
  ativo_id: uuid,
  componente_id: Type.Union([Type.Null(), uuid]),
  tipo: planType,
  checklist_versao_id: uuid,
  criticidade: criticality,
  tipo_disparo: triggerType,
  valor_disparo: nullableNumber,
  unidade_disparo: Type.Union([Type.Null(), Type.String({ minLength: 1, maxLength: 50 })]),
  recorrencia_dias: Type.Union([Type.Null(), Type.Integer({ minimum: 1, maximum: 36_500 })]),
  duracao_estimada_minutos: Type.Union([
    Type.Integer({ minimum: 1, maximum: 525_600 }),
    Type.Null(),
  ]),
  exige_loto: Type.Boolean(),
  exige_evidencia: Type.Boolean(),
  maximo_sessoes: Type.Union([Type.Null(), Type.Integer({ minimum: 1, maximum: 1_000 })]),
  modo_parada: stopMode,
  analise_tecnica: metadata,
  area_tecnica_id: Type.Union([Type.Null(), uuid]),
});

export const createPlanBodySchema = planFields;
export const updatePlanBodySchema = Type.Partial(
  Type.Object({
    codigo: shortCode,
    nome: shortName,
    status_ciclo_vida: lifecycleStatus,
    checklist_versao_id: uuid,
    criticidade: criticality,
    tipo_disparo: triggerType,
    valor_disparo: nullableNumber,
    unidade_disparo: Type.Union([Type.String({ minLength: 1, maxLength: 50 }), Type.Null()]),
    recorrencia_dias: Type.Union([Type.Integer({ minimum: 1, maximum: 36_500 }), Type.Null()]),
    duracao_estimada_minutos: Type.Union([
      Type.Integer({ minimum: 1, maximum: 525_600 }),
      Type.Null(),
    ]),
    exige_loto: Type.Boolean(),
    exige_evidencia: Type.Boolean(),
    maximo_sessoes: Type.Union([Type.Integer({ minimum: 1, maximum: 1_000 }), Type.Null()]),
    modo_parada: stopMode,
    analise_tecnica: metadata,
    area_tecnica_id: Type.Union([Type.Null(), uuid]),
  }),
  { additionalProperties: false, minProperties: 1 },
);
