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

async function completionModule() {
  vite ??= await createServer({
    configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  });
  return vite.ssrLoadModule('/src/components/technicianCompletion.ts');
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
      pecas_materiais: 'Nenhuma peça ou material utilizado nesta intervenção.',
      medicoes: 'Nenhuma medição necessária para esta intervenção.',
    },
    resultado: 'Execução concluída',
    observacao: 'Intervenção concluída sem intercorrências.',
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
  assert.equal(twoSupports.body.relatorio_tecnico.pecas_materiais, 'Nenhuma peça ou material utilizado nesta intervenção.');
  assert.equal(twoSupports.body.relatorio_tecnico.medicoes, 'Nenhuma medição necessária para esta intervenção.');
});

test('normaliza relatório preenchido sem inventar conteúdo', async () => {
  const { prepareTechnicalCompletionInput, submitTechnicalCompletion } = await completionModule();
  const prepared = prepareTechnicalCompletionInput({
    ...completionPayload([]),
    relatorio_tecnico: {
      diagnostico_tecnico: '  Diagnóstico confirmado  ',
      acao_realizada: '  Ajuste executado  ',
      pecas_materiais: '  Nenhuma peça utilizada  ',
      medicoes: '  Não se aplica  ',
    },
    resultado: '  Execução concluída  ',
    observacao: '  Sem intercorrências  ',
  });
  assert.equal(prepared.ok, true);
  assert.deepEqual(prepared.input.relatorio_tecnico, {
    diagnostico_tecnico: 'Diagnóstico confirmado',
    acao_realizada: 'Ajuste executado',
    pecas_materiais: 'Nenhuma peça utilizada',
    medicoes: 'Não se aplica',
  });
  assert.equal(prepared.input.resultado, 'Execução concluída');
  assert.equal(prepared.input.observacao, 'Sem intercorrências');

  let completionRequests = 0;
  const submitted = await submitTechnicalCompletion(prepared.input, async (input) => {
    completionRequests += 1;
    return input;
  });
  assert.equal(submitted.ok, true);
  assert.equal(completionRequests, 1);
});

test('bloqueia localmente cada campo obrigatório antes do request de conclusão', async () => {
  const { submitTechnicalCompletion } = await completionModule();
  const valid = completionPayload([]);
  const cases = [
    ['diagnostico_tecnico', { ...valid, relatorio_tecnico: { ...valid.relatorio_tecnico, diagnostico_tecnico: '' } }, 'Informe o diagnóstico técnico.'],
    ['acao_realizada', { ...valid, relatorio_tecnico: { ...valid.relatorio_tecnico, acao_realizada: '' } }, 'Informe a ação realizada.'],
    ['pecas_materiais', { ...valid, relatorio_tecnico: { ...valid.relatorio_tecnico, pecas_materiais: '' } }, 'Informe as peças/materiais utilizados ou registre que não houve utilização.'],
    ['medicoes', { ...valid, relatorio_tecnico: { ...valid.relatorio_tecnico, medicoes: '' } }, 'Informe as medições realizadas ou registre que não se aplica.'],
    ['resultado', { ...valid, resultado: '' }, 'Informe o resultado da intervenção.'],
    ['observacao', { ...valid, observacao: null }, 'Informe a observação da intervenção.'],
  ];
  let completionRequests = 0;
  for (const [field, input, expectedMessage] of cases) {
    const submitted = await submitTechnicalCompletion(input, async () => {
      completionRequests += 1;
      return {};
    });
    assert.equal(submitted.ok, false, field);
    assert.equal(submitted.issues[0].message, expectedMessage, field);
  }
  assert.equal(completionRequests, 0);
});

test('traduz validação de campo e distingue conclusão normal da pós-intervenção', async () => {
  const client = await vite.ssrLoadModule('/src/services/api/client.ts');
  const { completionButtonLabel, completionErrorMessage, requiresPostInterventionRelease } = await completionModule();
  const error = new client.ApiRequestError(
    'A requisição contém campos inválidos.',
    'REQUEST_VALIDATION_FAILED',
    [{ instancePath: '/relatorio_tecnico/diagnostico_tecnico', message: 'must NOT have fewer than 3 characters' }],
  );
  assert.equal(completionErrorMessage(error), 'Revise os campos obrigatórios: Diagnóstico técnico.');
  assert.equal(requiresPostInterventionRelease({ exige_liberacao_pos_intervencao: false }), false);
  assert.equal(requiresPostInterventionRelease({ exige_liberacao_pos_intervencao: true }), true);
  assert.equal(completionButtonLabel(false, false), 'Concluir OS');
  assert.equal(completionButtonLabel(true, false), 'Concluir e encaminhar para validação');
});
