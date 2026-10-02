import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

let vite;

async function mapper() {
  vite ??= await createServer({
    configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  });
  return (await vite.ssrLoadModule('/src/services/api/client.ts')).nodeActionRequest;
}

test.after(async () => {
  await vite?.close();
});

function completionPayload(supportTechnicianIds) {
  return {
    acao_id: 'action-1',
    relatorio_tecnico: {
      diagnostico_tecnico: 'Diagnóstico',
      acao_realizada: 'Ação',
      pecas_materiais: 'Nenhuma',
      medicoes: 'Conforme',
    },
    resultado: 'Execução concluída',
    observacao: null,
    modo_parada: 'NO_STOP',
    ...(supportTechnicianIds === undefined
      ? {}
      : { tecnicos_auxiliares_ids: supportTechnicianIds }),
  };
}

test('preserva auxiliares no body de conclusão da ação operacional', async () => {
  const nodeActionRequest = await mapper();

  const withoutSupports = nodeActionRequest(
    'operator-actions.complete',
    completionPayload(undefined),
  );
  assert.equal(withoutSupports.body.tecnicos_auxiliares_ids, undefined);

  const emptySupports = nodeActionRequest(
    'operator-actions.complete',
    completionPayload([]),
  );
  assert.deepEqual(emptySupports.body.tecnicos_auxiliares_ids, []);

  const oneSupport = nodeActionRequest(
    'operator-actions.complete',
    completionPayload(['auxiliar-1']),
  );
  assert.deepEqual(oneSupport.body.tecnicos_auxiliares_ids, ['auxiliar-1']);

  const twoSupports = nodeActionRequest(
    'operator-actions.complete',
    completionPayload(['auxiliar-1', 'auxiliar-2']),
  );
  assert.deepEqual(twoSupports.body.tecnicos_auxiliares_ids, [
    'auxiliar-1',
    'auxiliar-2',
  ]);
});
