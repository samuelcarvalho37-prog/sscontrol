import { Type } from '@fastify/type-provider-typebox';

export const loginBodySchema = Type.Object(
  {
    matricula: Type.String({ minLength: 1, maxLength: 80 }),
    senha: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);

export const firstAccessBodySchema = Type.Object(
  {
    change_token: Type.String({ minLength: 40, maxLength: 128 }),
    senha_atual: Type.String({ minLength: 1, maxLength: 128 }),
    nova_senha: Type.String({ minLength: 12, maxLength: 128 }),
  },
  { additionalProperties: false },
);

export const recoveryBodySchema = Type.Object(
  {
    matricula: Type.String({ minLength: 1, maxLength: 80 }),
  },
  { additionalProperties: false },
);

export const maintenanceExchangeBodySchema = Type.Object(
  {
    codigo: Type.String({ minLength: 16, maxLength: 160 }),
  },
  { additionalProperties: false },
);

export const successEnvelopeSchema = Type.Object(
  {
    ok: Type.Literal(true),
    action: Type.String(),
    elapsed_ms: Type.Integer({ minimum: 0 }),
    trace_id: Type.String(),
    data: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);

export const emptyBodySchema = Type.Object({}, { additionalProperties: false });
