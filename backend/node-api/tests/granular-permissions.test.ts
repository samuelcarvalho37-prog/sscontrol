import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { CAPABILITY_CATALOG, routeCapability } from '../src/modules/auth/capability-catalog.js';
import { effectiveCapabilities, policyAllows } from '../src/modules/auth/permission-policy.js';

const full = { personalizavel: true, permissoes: null, recursos: null };
test('acompanhamento de qualidade e segurança preserva decisões específicas', () => {
  const code = 'maintenance.shared.observe.quality';
  assert.ok(effectiveCapabilities([code], full).includes(code));
  assert.ok(!effectiveCapabilities([code], full).includes('maintenance.shared.observe.safety'));
  assert.ok(!effectiveCapabilities([code], { ...full, recursos: ['CADASTROS'] }).includes(code));
});
test('cada ação protegida do catálogo tem identidade única e explicação de impacto', () => {
  assert.equal(new Set(CAPABILITY_CATALOG.map((item) => item.id)).size, CAPABILITY_CATALOG.length);
  for (const item of CAPABILITY_CATALOG) {
    assert.ok(item.nome.length > 3);
    assert.ok(item.impacto.length > 3);
    if (item.rota) {
      const split = item.rota.indexOf(' ');
      assert.equal(
        routeCapability(item.rota.slice(0, split), item.rota.slice(split + 1), item.legado),
        item.id,
      );
    }
  }
});
test('criar e editar parâmetros são independentes e não mudam o perfil ou o tema', () => {
  const create = routeCapability('POST', '/v1/cmms/parameters', '');
  const edit = routeCapability('PATCH', '/v1/cmms/parameters/:parameterId', '');
  assert.notEqual(create, edit);
  const active = effectiveCapabilities([create], full);
  assert.ok(active.includes(create));
  assert.ok(!active.includes(edit));
  assert.ok(active.includes('cmms.parameters.manage'));
});
test('QR e consulta de ativos têm permissões distintas', () => {
  assert.notEqual(
    routeCapability('GET', '/v1/cmms/qr-context/:code', ''),
    routeCapability('GET', '/v1/cmms/assets', ''),
  );
});
test('teto do plano restringe ações e módulos sem conceder ações ao usuário', () => {
  const create = routeCapability('POST', '/v1/cmms/parameters', '');
  assert.equal(policyAllows({ ...full, permissoes: [] }, create), false);
  assert.equal(policyAllows({ ...full, recursos: [] }, create), false);
  assert.ok(!effectiveCapabilities([], full).includes(create));
  assert.ok(
    !effectiveCapabilities([create], { ...full, permissoes: [] }).includes(
      'cmms.parameters.manage',
    ),
  );
});
test('rotas de governança distinguem documentos, importação e restauração', () => {
  const keys = [
    ['GET', '/v1/admin/documents'],
    ['GET', '/v1/admin/imports'],
    ['POST', '/v1/admin/backups/:backupId/restore'],
  ].map(([method, path]) => routeCapability(method!, path!, 'admin.governance.read'));
  assert.equal(new Set(keys).size, 3);
});
test('rotas estáticas autorizadas permanecem cobertas pelo catálogo', async () => {
  for (const module of [
    'admin/admin',
    'catalog/catalog',
    'governance/governance',
    'monitoring/monitoring',
    'operations/operations',
    'planning/planning',
  ]) {
    const source = await readFile(
      new URL(`../src/modules/${module}.routes.ts`, import.meta.url),
      'utf8',
    );
    const matches = [...source.matchAll(/app\.(get|post|put|patch|delete)\('([^']+)'/g)];
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]!;
      const block = source.slice(match.index!, matches[i + 1]?.index ?? source.length);
      const original = block.match(/authorize\(request, '([^']+)'/);
      if (original)
        assert.notEqual(
          routeCapability(match[1]!, match[2]!, original[1]!),
          original[1],
          `${module} ${match[2]}`,
        );
    }
  }
});
