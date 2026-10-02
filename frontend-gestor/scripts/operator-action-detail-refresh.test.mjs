import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

let vite;
async function factory() {
  vite ??= await createServer({ configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } });
  return (await vite.ssrLoadModule('/src/components/operatorActionDetailLoader.ts')).createOperatorActionDetailLoader;
}
test.after(async () => { await vite?.close(); });

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('abrir sem execução → iniciar → detalhe e candidatos atualizados', async () => {
  const create = await factory();
  let started = false;
  let state;
  const calls = [];
  const candidates = ['principal', 'eletrica', 'inspecao', 'lubrificador', 'mecanico'].map(id => ({ id }));
  const loader = create(detail => { state = detail; }, () => {}, message => assert.equal(message, ''), () => {}, {
    async getOperatorAction(id) {
      calls.push('get');
      return { acao: { id, status: started ? 'IN_PROGRESS' : 'READY' },
        execucao: started ? { id: 'execution', operador_id: 'principal' } : null,
        tecnicos_elegiveis: started ? candidates : [] };
    },
    async listOperatorMaterials() { return []; },
    async startOperatorAction() { calls.push('start'); started = true; return { id: 'execution' }; },
  });
  await loader.open('action');
  assert.equal(state.execucao, null);
  assert.deepEqual(state.tecnicos_elegiveis, []);
  assert.equal(await loader.start('action', 'NO_STOP'), true);
  assert.deepEqual(calls, ['get', 'start', 'get']);
  assert.equal(state.acao.status, 'IN_PROGRESS');
  assert.equal(state.execucao.id, 'execution');
  assert.deepEqual(state.tecnicos_elegiveis, candidates);
});

for (const leave of ['outra ação', 'voltar']) {
  test(`resposta atrasada após ${leave} não aplica detalhe anterior`, async () => {
    const create = await factory();
    const pending = deferred();
    let started = false;
    const applied = [];
    const loader = create(detail => applied.push(detail.acao.id), () => {}, () => {}, () => {}, {
      async getOperatorAction(id) {
        if (id === 'A' && started) await pending.promise;
        return { acao: { id }, execucao: null, tecnicos_elegiveis: [] };
      },
      async listOperatorMaterials() { return []; },
      async startOperatorAction() { started = true; return { id: 'execution' }; },
    });
    await loader.open('A');
    const start = loader.start('A', 'NO_STOP');
    await Promise.resolve();
    if (leave === 'outra ação') await loader.open('B');
    else loader.clear();
    pending.resolve();
    assert.equal(await start, false);
    assert.deepEqual(applied, leave === 'outra ação' ? ['A', 'B'] : ['A']);
  });
}

test('erro real no refresh é informado, sem repetir o POST de início', async () => {
  const create = await factory();
  let started = false;
  let posts = 0;
  let error;
  const loader = create(() => {}, () => {}, message => { error = message; }, () => {}, {
    async getOperatorAction() {
      if (started) throw new Error('HTTP 503');
      return { acao: { id: 'A' }, execucao: null, tecnicos_elegiveis: [] };
    },
    async listOperatorMaterials() { return []; },
    async startOperatorAction() { posts++; started = true; return { id: 'execution' }; },
  });
  await loader.open('A');
  assert.equal(await loader.start('A', 'NO_STOP'), false);
  assert.equal(error, 'HTTP 503');
  assert.equal(posts, 1);
});
