import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

let vite;
async function policyModule() {
  vite ??= await createServer({
    configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  });
  return vite.ssrLoadModule('/src/components/postInterventionPolicy.ts');
}

async function apiClientModule() {
  vite ??= await createServer({
    configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  });
  return vite.ssrLoadModule('/src/services/api/client.ts');
}

async function notificationPolicyModule() {
  vite ??= await createServer({
    configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  });
  return vite.ssrLoadModule('/src/components/notificationPolicy.ts');
}

async function portalAccessModule() {
  vite ??= await createServer({
    configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  });
  return vite.ssrLoadModule('/src/services/auth/portalAccess.ts');
}

test.after(async () => { await vite?.close(); });

test('mapeia seleção de áreas para as políticas persistidas existentes', async () => {
  const { postInterventionPolicySelectionError, selectedPostInterventionPolicy } = await policyModule();
  assert.equal(selectedPostInterventionPolicy(false, false), null);
  assert.equal(selectedPostInterventionPolicy(true, false), 'QUALIDADE');
  assert.equal(selectedPostInterventionPolicy(false, true), 'SEGURANCA');
  assert.equal(selectedPostInterventionPolicy(true, true), 'QUALIDADE_E_SEGURANCA');
  assert.equal(
    postInterventionPolicySelectionError(true, selectedPostInterventionPolicy(false, false)),
    'Selecione ao menos uma área responsável pela liberação pós-intervenção.',
  );
  assert.equal(
    postInterventionPolicySelectionError(false, selectedPostInterventionPolicy(false, false)),
    null,
  );
});

test('mostra a política lida da demanda, sem inferir pela descrição', async () => {
  const { postInterventionPolicyLabel } = await policyModule();
  assert.equal(postInterventionPolicyLabel(false), 'Não exigida');
  assert.equal(postInterventionPolicyLabel(true, 'QUALIDADE'), 'Qualidade');
  assert.equal(postInterventionPolicyLabel(true, 'SEGURANCA'), 'Segurança');
  assert.equal(postInterventionPolicyLabel(true, 'QUALIDADE_E_SEGURANCA'), 'Qualidade + Segurança');
  assert.equal(postInterventionPolicyLabel(true), 'Configuração pendente');
});

test('preserva a política persistida pela API no detalhe da OS', async () => {
  const { nodeActionRequest } = await apiClientModule();
  const request = nodeActionRequest('admin.intervencoes.detalhe', {
    token: 'session-placeholder',
    intervencao_id: 'work-order-id',
  });
  assert.ok(request?.transform);
  const mapped = request.transform({
    id: 'work-order-id',
    status: 'APPROVED',
    analise_tecnica: { exige_liberacao_pos_intervencao: true },
    validacao: {
      id: 'demand-id',
      status: 'OPEN',
      politica_assinatura: 'SEGURANCA',
      assinaturas_exigidas: 1,
      assinaturas_realizadas: 0,
    },
  });
  assert.equal(mapped.exige_liberacao_pos_intervencao, true);
  assert.equal(mapped.demanda.politica_assinatura, 'SEGURANCA');
});

test('não transforma ocorrência operacional em pendência de Qualidade ou Segurança', async () => {
  const { notificationNavigation, isNotificationActionableForProfile } = await notificationPolicyModule();
  const occurrence = {
    tipo: 'OCCURRENCE_REPORTED',
    entidade_tipo: 'OPERATIONAL_OCCURRENCE',
    entidade_id: 'occurrence-id',
  };
  assert.equal(isNotificationActionableForProfile(occurrence, 'QUALIDADE'), false);
  assert.equal(isNotificationActionableForProfile(occurrence, 'SEGURANCA'), false);
  assert.equal(notificationNavigation(occurrence, 'QUALIDADE'), null);
  assert.equal(notificationNavigation(occurrence, 'SEGURANCA'), null);
  assert.deepEqual(notificationNavigation(occurrence, 'PCM'), {
    kind: 'occurrence',
    id: 'occurrence-id',
  });
});

test('notificação explícita de pós-intervenção abre a demanda exata e mantém deep-link após refresh', async () => {
  const { notificationNavigation, notificationActionLabel, validationDemandFromSearch } = await notificationPolicyModule();
  const notification = {
    tipo: 'POST_INTERVENTION_VALIDATION_REQUESTED',
    entidade_tipo: 'DEMANDAS_TECNICAS',
    entidade_id: 'exact-demand-id',
  };
  assert.deepEqual(notificationNavigation(notification, 'QUALIDADE'), {
    kind: 'technical-demand',
    id: 'exact-demand-id',
  });
  assert.deepEqual(notificationNavigation(notification, 'SEGURANCA'), {
    kind: 'technical-demand',
    id: 'exact-demand-id',
  });
  assert.equal(notificationActionLabel(notification, 'QUALIDADE'), 'Analisar validação');
  assert.equal(validationDemandFromSearch('?validationDemand=exact-demand-id'), 'exact-demand-id');
});

test('papéis com capability de revisão entram no portal sem receber acesso genérico de leitura de OS', async () => {
  const { allowsPortal } = await portalAccessModule();
  assert.equal(allowsPortal('GESTOR', 'QUALIDADE', ['maintenance.work-orders.review']), true);
  assert.equal(allowsPortal('GESTOR', 'SEGURANCA', ['maintenance.work-orders.review']), true);
  assert.equal(allowsPortal('GESTOR', 'QUALIDADE', []), false);
});
