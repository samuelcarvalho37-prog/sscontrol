import { Type } from '@fastify/type-provider-typebox';

const profileSchema = Type.Union([
  Type.Literal('ADMIN'),
  Type.Literal('GESTOR'),
  Type.Literal('OPERADOR'),
]);
const statusSchema = Type.Union([Type.Literal('ATIVO'), Type.Literal('INATIVO')]);

export const adminIdentifierParamsSchema = Type.Object(
  {
    userId: Type.Optional(Type.String({ format: 'uuid' })),
    areaId: Type.Optional(Type.String({ format: 'uuid' })),
    roleId: Type.Optional(Type.String({ format: 'uuid' })),
    profile: Type.Optional(profileSchema),
  },
  { additionalProperties: false },
);

export const userListQuerySchema = Type.Object(
  {
    busca: Type.Optional(Type.String({ maxLength: 160 })),
    perfil: Type.Optional(profileSchema),
    status: Type.Optional(statusSchema),
    limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  },
  { additionalProperties: false },
);

export const saveUserBodySchema = Type.Object(
  {
    id: Type.Optional(Type.String({ format: 'uuid' })),
    nome: Type.String({ minLength: 2, maxLength: 160 }),
    email: Type.Optional(
      Type.Union([Type.String({ format: 'email', maxLength: 254 }), Type.Null()]),
    ),
    matricula: Type.String({ minLength: 2, maxLength: 80 }),
    perfil: profileSchema,
    status: statusSchema,
    senha_temporaria: Type.Optional(Type.String({ minLength: 12, maxLength: 128 })),
    area_id: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
    cargo_id: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
    especialidades: Type.Optional(Type.Array(Type.String({ maxLength: 100 }), { maxItems: 50 })),
    escopo_ids: Type.Optional(Type.Array(Type.String({ maxLength: 100 }), { maxItems: 200 })),
  },
  { additionalProperties: false },
);

export const resetPasswordBodySchema = Type.Object(
  { senha_temporaria: Type.String({ minLength: 12, maxLength: 128 }) },
  { additionalProperties: false },
);

export const technicalAreaQuerySchema = Type.Object(
  { status: Type.Optional(statusSchema) },
  { additionalProperties: false },
);

export const saveTechnicalAreaBodySchema = Type.Object(
  {
    id: Type.Optional(Type.String({ format: 'uuid' })),
    codigo: Type.String({ minLength: 2, maxLength: 80 }),
    nome: Type.String({ minLength: 2, maxLength: 160 }),
    descricao: Type.Optional(Type.String({ maxLength: 1_000 })),
    status: statusSchema,
    exige_assinatura_padrao: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const technicalRoleQuerySchema = Type.Object(
  {
    area_id: Type.Optional(Type.String({ format: 'uuid' })),
    status: Type.Optional(statusSchema),
  },
  { additionalProperties: false },
);

export const saveTechnicalRoleBodySchema = Type.Object(
  {
    id: Type.Optional(Type.String({ format: 'uuid' })),
    area_id: Type.String({ format: 'uuid' }),
    codigo: Type.String({ minLength: 2, maxLength: 80 }),
    nome: Type.String({ minLength: 2, maxLength: 160 }),
    descricao: Type.Optional(Type.String({ maxLength: 1_000 })),
    status: statusSchema,
    pode_assinar: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const permissionBodySchema = Type.Object(
  { permissoes: Type.Record(Type.String({ minLength: 1 }), Type.Boolean()) },
  { additionalProperties: false },
);

export const companyBodySchema = Type.Object(
  {
    nome: Type.String({ minLength: 2, maxLength: 160 }),
    logo_data_url: Type.String({ maxLength: 7_000_000 }),
  },
  { additionalProperties: false },
);

export const auditListQuerySchema = Type.Object(
  {
    busca: Type.Optional(Type.String({ maxLength: 200 })),
    grupo_acao: Type.Optional(Type.String({ maxLength: 100 })),
    entidade: Type.Optional(Type.String({ maxLength: 160 })),
    responsavel_id: Type.Optional(Type.String({ format: 'uuid' })),
    limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  },
  { additionalProperties: false },
);

const configurationValueSchema = Type.Unknown();

export const configurationBodySchema = Type.Object(
  {
    configuracao: Type.Record(
      Type.String({ minLength: 1, maxLength: 160 }),
      configurationValueSchema,
    ),
  },
  { additionalProperties: false },
);

export const configurationDraftBodySchema = Type.Object(
  {
    configuracao: Type.Record(
      Type.String({ minLength: 1, maxLength: 160 }),
      configurationValueSchema,
    ),
    base_versao_id: Type.String({ maxLength: 100 }),
  },
  { additionalProperties: false },
);

export const publishDraftBodySchema = Type.Object(
  { rascunho_id: Type.String({ format: 'uuid' }) },
  { additionalProperties: false },
);

export const rollbackBodySchema = Type.Object(
  {
    versao_id: Type.String({ format: 'uuid' }),
    base_versao_id: Type.String({ maxLength: 100 }),
    motivo: Type.String({ minLength: 10, maxLength: 1_000 }),
  },
  { additionalProperties: false },
);

export const versionListQuerySchema = Type.Object(
  { limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) },
  { additionalProperties: false },
);

const commercialFeatureCodeSchema = Type.Union([
  Type.Literal('CADASTROS'),
  Type.Literal('ORDENS_SERVICO'),
  Type.Literal('CHECKLISTS'),
  Type.Literal('GESTAO_TECNICA'),
  Type.Literal('INDICADORES'),
  Type.Literal('DOCUMENTOS'),
  Type.Literal('IMPORTACOES'),
  Type.Literal('AUDITORIA'),
  Type.Literal('CONTINUIDADE'),
  Type.Literal('MOTOR_LIMITADO'),
]);

export const commercialPlansBodySchema = Type.Object(
  {
    planos: Type.Array(
      Type.Object(
        {
          codigo: Type.Union([
            Type.Literal('INICIAL'),
            Type.Literal('BASICO'),
            Type.Literal('COMPLETO'),
          ]),
          nome: Type.String({ minLength: 2, maxLength: 100 }),
          recursos: Type.Array(commercialFeatureCodeSchema, {
            minItems: 1,
            maxItems: 10,
            uniqueItems: true,
          }),
        },
        { additionalProperties: false },
      ),
      { minItems: 3, maxItems: 3 },
    ),
  },
  { additionalProperties: false },
);

export const commercialDraftBodySchema = Type.Object(
  {
    planos: commercialPlansBodySchema.properties.planos,
    base_versao_id: Type.String({ maxLength: 100 }),
  },
  { additionalProperties: false },
);
