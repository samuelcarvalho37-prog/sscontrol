import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { executionBatchResponseBodySchema, executionResponseBodySchema } from '../src/modules/operations/operations.schemas.js';

test('respostas operacionais preservam zero, false e null sob a coerção HTTP', async () => {
  const app = Fastify();
  app.put('/batch', { schema: { body: executionBatchResponseBodySchema } }, request => request.body);
  app.put('/single', { schema: { body: executionResponseBodySchema } }, request => request.body);
  try {
    for (const value of [0, null]) {
      const response = await app.inject({ method: 'PUT', url: '/batch', payload: {
        itens: [{ item_id: '00000000-0000-4000-8000-000000000001', resposta: null, valor: value, observacao: null }],
      } });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().itens[0].valor, value);
    }
    for (const value of [false, null]) {
      const response = await app.inject({ method: 'PUT', url: '/single', payload: {
        resposta_texto: null, resposta_numero: 0, resposta_booleano: value,
        resposta_opcao: null, observacao: null, nao_aplicavel: false,
      } });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().resposta_numero, 0);
      assert.equal(response.json().resposta_booleano, value);
    }
  } finally { await app.close(); }
});
