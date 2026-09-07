import { Type } from '@fastify/type-provider-typebox';

const uuid = Type.String({ format: 'uuid' });
const nullableUuid = Type.Union([uuid, Type.Null()]);
const nullableText = Type.Union([Type.String({ maxLength: 4_000 }), Type.Null()]);
const documentType = Type.Union([
  Type.Literal('MANUAL'),
  Type.Literal('DIAGRAMA'),
  Type.Literal('CERTIFICADO'),
  Type.Literal('LAUDO'),
  Type.Literal('PROCEDIMENTO'),
  Type.Literal('FICHA_TECNICA'),
  Type.Literal('OUTRO'),
]);
const entityType = Type.Union([
  Type.Literal('EMPRESA'),
  Type.Literal('PLANTA'),
  Type.Literal('SETOR'),
  Type.Literal('LINHA'),
  Type.Literal('ATIVO'),
  Type.Literal('COMPONENTE'),
]);
const documentStatus = Type.Union([
  Type.Literal('RASCUNHO'),
  Type.Literal('EM_REVISAO'),
  Type.Literal('VIGENTE'),
  Type.Literal('OBSOLETO'),
]);

export const documentParamsSchema = Type.Object(
  {
    documentId: Type.Optional(uuid),
    objectId: Type.Optional(uuid),
  },
  { additionalProperties: false },
);

export const documentListQuerySchema = Type.Object(
  {
    busca: Type.Optional(Type.String({ maxLength: 200 })),
    status: Type.Optional(documentStatus),
    tipo: Type.Optional(documentType),
    limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  },
  { additionalProperties: false },
);

const metadata = Type.Object(
  {
    id: Type.Optional(uuid),
    documento_id: Type.Optional(uuid),
    codigo: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    titulo: Type.String({ minLength: 1, maxLength: 240 }),
    tipo: documentType,
    entidade_tipo: entityType,
    entidade_id: Type.Optional(nullableUuid),
    status: documentStatus,
    validade_em: Type.Optional(
      Type.Union([Type.String({ format: 'date' }), Type.Literal(''), Type.Null()]),
    ),
    responsavel_id: Type.Optional(nullableUuid),
    descricao: Type.Optional(nullableText),
    revisao: Type.Optional(Type.String({ maxLength: 40 })),
    observacao: Type.Optional(nullableText),
  },
  { additionalProperties: false },
);

export const documentUploadBodySchema = Type.Object(
  {
    dados: metadata,
    arquivo: Type.Object(
      {
        nome: Type.String({ minLength: 1, maxLength: 180 }),
        mime_type: Type.String({ minLength: 1, maxLength: 160 }),
        base64: Type.String({ minLength: 1, maxLength: 8_500_000 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const documentUpdateBodySchema = Type.Object(
  { dados: metadata },
  { additionalProperties: false },
);

export const importBatchParamsSchema = Type.Object(
  { batchId: uuid },
  { additionalProperties: false },
);

export const importBatchListQuerySchema = Type.Object(
  { limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) },
  { additionalProperties: false },
);

const importCell = Type.Union([
  Type.String({ maxLength: 5_000 }),
  Type.Number(),
  Type.Boolean(),
  Type.Null(),
]);

export const importValidateBodySchema = Type.Object(
  {
    tipo: Type.String({ minLength: 1, maxLength: 80 }),
    arquivo_nome: Type.String({ minLength: 1, maxLength: 180 }),
    aba_nome: Type.String({ minLength: 1, maxLength: 120 }),
    cabecalhos: Type.Array(Type.String({ minLength: 1, maxLength: 180 }), {
      minItems: 1,
      maxItems: 100,
    }),
    linhas: Type.Array(
      Type.Object(
        { __linha: Type.Integer({ minimum: 2, maximum: 1_000_000 }) },
        { additionalProperties: importCell },
      ),
      { minItems: 1, maxItems: 250 },
    ),
  },
  { additionalProperties: false },
);

export const importConfirmBodySchema = Type.Object(
  { validacao_hash: Type.String({ pattern: '^[a-f0-9]{64}$' }) },
  { additionalProperties: false },
);

export const importRollbackBodySchema = Type.Object(
  { motivo: Type.String({ minLength: 8, maxLength: 1_000 }) },
  { additionalProperties: false },
);

export const backupParamsSchema = Type.Object(
  { backupId: uuid },
  { additionalProperties: false },
);

export const backupListQuerySchema = Type.Object(
  { limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })) },
  { additionalProperties: false },
);

export const backupCreateBodySchema = Type.Object(
  {
    motivo: Type.String({ minLength: 8, maxLength: 1_000 }),
    confirmacao: Type.Literal('CRIAR BACKUP'),
  },
  { additionalProperties: false },
);

export const backupRestoreBodySchema = Type.Object(
  {
    token: Type.String({ minLength: 40, maxLength: 4_000 }),
    confirmacao: Type.String({ minLength: 1, maxLength: 80 }),
    confirmacao_final: Type.Literal('RESTAURAR BACKUP'),
    motivo: Type.String({ minLength: 8, maxLength: 1_000 }),
    criar_backup_seguranca: Type.Literal(true),
  },
  { additionalProperties: false },
);
