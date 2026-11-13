import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';

test('Plataforma suspende e reativa acesso sem alterar contrato ou dados', { skip: !process.env.PCM_IMPORT_TEST_URL }, async () => {
  const client = new pg.Client({ connectionString: process.env.PCM_IMPORT_TEST_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const tenant = (await client.query("SELECT id,slug,environment FROM platform.tenants WHERE status='ACTIVE' AND deleted_at IS NULL LIMIT 1")).rows[0];
    const operator = (await client.query("SELECT id FROM platform.platform_operators WHERE status='ACTIVE' LIMIT 1")).rows[0];
    assert.ok(tenant && operator, 'Empresa e operador ativos necessários');
    const subscription = await client.query('SELECT id,status FROM platform.tenant_subscriptions WHERE tenant_id=$1 ORDER BY id', [tenant.id]);
    await client.query('SET LOCAL ROLE fab_control_api_local');
    await client.query('SELECT platform.set_console_tenant_status($1,$2,$3,$4)', [operator.id, tenant.id, 'SUSPENDED', 'tenant-status-test']);
    assert.equal((await client.query('SELECT * FROM platform.resolve_active_tenant_by_slug($1,$2)', [tenant.slug,tenant.environment])).rowCount, 0);
    await client.query('SELECT platform.set_console_tenant_status($1,$2,$3,$4)', [operator.id, tenant.id, 'ACTIVE', 'tenant-status-test']);
    assert.equal((await client.query('SELECT * FROM platform.resolve_active_tenant_by_slug($1,$2)', [tenant.slug,tenant.environment])).rowCount, 1);
    await client.query('SAVEPOINT invalid_operator');
    await assert.rejects(client.query("SELECT platform.set_console_tenant_status(gen_random_uuid(),$1,'SUSPENDED','tenant-status-test')", [tenant.id]), /Operador da plataforma inválido/);
    await client.query('ROLLBACK TO SAVEPOINT invalid_operator');
    await client.query('RESET ROLE');
    assert.deepEqual((await client.query('SELECT id,status FROM platform.tenant_subscriptions WHERE tenant_id=$1 ORDER BY id', [tenant.id])).rows,subscription.rows);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM platform.platform_audit_events WHERE tenant_id=$1 AND request_id='tenant-status-test'", [tenant.id])).rows[0].n, 2);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
