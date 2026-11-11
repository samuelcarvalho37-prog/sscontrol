import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { PlanningRepository } from '../src/modules/planning/planning.repository.js';
import type { ChecklistInput } from '../src/modules/planning/planning.types.js';

function recordingClient() {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const client = {
    query: async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      const positions = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
      assert.equal(Math.max(0, ...positions), values.length, 'Quantidade de parâmetros SQL');
      return { rows: sql.includes('AS revision') ? [{ revision: 2 }] : [] };
    },
  } as unknown as PoolClient;
  return { calls, client };
}
const defaults = {
  modo_parada: 'MANDATORY_STOP' as const,
  requer_bloqueio: true,
  tempo_estimado_min: 40,
  estimativa_automatica: true,
};
const input: ChecklistInput = {
  code: 'CHK',
  name: 'Modelo',
  assetId: 'ativo',
  componentId: null,
  checklistType: 'INSPECAO',
  criticality: 'HIGH',
  technicalAreaId: null,
  technicalRoleId: null,
  signaturePolicy: 'QUALIDADE_OU_SEGURANCA',
  requiredSignatures: 0,
  segregationRequired: false,
  managerGuidance: null,
  safetyRequirements: [],
  executionDefaults: defaults,
};
test('criação grava as pré-configurações na mesma versão', async () => {
  const { calls, client } = recordingClient();
  await new PlanningRepository().createChecklist(
    client,
    'tenant',
    'template',
    'version',
    'user',
    input,
    'hash',
  );
  const insert = calls.find((call) =>
    call.sql.includes('INSERT INTO maintenance.checklist_template_versions'),
  )!;
  assert.equal((insert.sql.match(/execution_defaults/g) ?? []).length, 1);
  assert.deepEqual(JSON.parse(String(insert.values.at(-1))), defaults);
});
test('edição e revisão mantêm as pré-configurações e contratos SQL', async () => {
  const { calls, client } = recordingClient();
  const repo = new PlanningRepository();
  await repo.updateChecklistAggregate(client, 'template', 'version', input);
  await repo.createChecklistRevision(
    client,
    'tenant',
    'template',
    { id: 'source', safety_requirements: [], execution_defaults: defaults },
    'next-version',
    'user',
  );
  const revision = calls.find((call) =>
    call.sql.includes('INSERT INTO maintenance.checklist_template_versions'),
  )!;
  assert.deepEqual(JSON.parse(String(revision.values.at(-1))), defaults);
  const update = calls.find((call) =>
    call.sql.includes('UPDATE maintenance.checklist_template_versions'),
  )!;
  assert.deepEqual(JSON.parse(String(update.values.at(-1))), defaults);
});
