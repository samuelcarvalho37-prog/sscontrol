import assert from 'node:assert/strict';
import test from 'node:test';

import {
  backupScopes,
  backupTablesForScopes,
  defaultBackupScopes,
  normalizeBackupScopes,
} from '../src/modules/governance/backup-catalog.js';

test('catálogo de backup inclui operações e linhas de importação por padrão', () => {
  assert.deepEqual(defaultBackupScopes, ['OPERACIONAL', 'IMPORTACOES']);
  const tables = backupTablesForScopes(defaultBackupScopes).map(({ name }) => name);
  assert.ok(tables.includes('cmms.plants'));
  assert.ok(tables.includes('governance.import_batches'));
  assert.ok(tables.includes('governance.import_records'));
  assert.equal(new Set(tables).size, tables.length);
});

test('catálogo de backup mantém grupos selecionáveis isolados', () => {
  const permissions = backupTablesForScopes(['ACESSOS']).map(({ name }) => name);
  assert.deepEqual(permissions, ['iam.role_capabilities', 'iam.user_capabilities']);

  const configuration = backupTablesForScopes(['CONFIGURACOES']).map(({ name }) => name);
  assert.deepEqual(configuration, [
    'platform.configuration_versions',
    'platform.configuration_drafts',
  ]);
});

test('normalização rejeita escopo vazio ou desconhecido', () => {
  assert.throws(() => normalizeBackupScopes([]));
  assert.throws(() => normalizeBackupScopes(['OUTRO']));
  assert.deepEqual(
    normalizeBackupScopes(['ACESSOS']),
    backupScopes.filter((scope) => scope.id === 'ACESSOS').map((scope) => scope.id),
  );
});
