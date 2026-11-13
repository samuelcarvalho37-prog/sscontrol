import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';

test('Acesso distingue empresa desativada, vencimento, carência e assinatura suspensa', { skip: !process.env.PCM_IMPORT_TEST_URL }, async () => {
  const c = new pg.Client({ connectionString: process.env.PCM_IMPORT_TEST_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    const t = (await c.query("SELECT id,slug,environment FROM platform.tenants WHERE deleted_at IS NULL AND status<>'ARCHIVED' LIMIT 1 FOR UPDATE")).rows[0];
    assert.ok(t);
    await c.query("UPDATE platform.tenants SET status='ACTIVE' WHERE id=$1", [t.id]);
    const subscription = (await c.query('SELECT id FROM platform.tenant_subscriptions WHERE tenant_id=$1 ORDER BY starts_at DESC LIMIT 1', [t.id])).rows[0];
    assert.ok(subscription, 'Empresa com assinatura necessária');
    const state = async () => {
      await c.query('SET LOCAL ROLE fab_control_api_local');
      const r = await c.query('SELECT platform.tenant_access_state($1,$2) AS state',[t.slug,t.environment]);
      await c.query('RESET ROLE');
      return r.rows[0].state;
    };
    await c.query("UPDATE platform.tenant_subscriptions SET status='ACTIVE',starts_at=now()-interval '10 days',ends_at=now()+interval '1 day',grace_ends_at=NULL WHERE id=$1",[subscription.id]);
    assert.equal(await state(),'ACTIVE');
    await c.query("UPDATE platform.tenants SET status='SUSPENDED' WHERE id=$1",[t.id]);
    assert.equal(await state(),'DISABLED');
    await c.query("UPDATE platform.tenants SET status='ACTIVE' WHERE id=$1",[t.id]);
    await c.query("UPDATE platform.tenant_subscriptions SET ends_at=now()-interval '1 day' WHERE id=$1",[subscription.id]);
    assert.equal(await state(),'EXPIRED');
    await c.query("UPDATE platform.tenant_subscriptions SET status='PAST_DUE',grace_ends_at=now()+interval '1 day' WHERE id=$1",[subscription.id]);
    assert.equal(await state(),'ACTIVE');
    await c.query("UPDATE platform.tenant_subscriptions SET status='SUSPENDED' WHERE id=$1",[subscription.id]);
    assert.equal(await state(),'SUBSCRIPTION_DISABLED');
    assert.equal((await c.query("SELECT platform.tenant_access_state('unknown-company',$1) AS state",[t.environment])).rows[0].state,null);
  } finally { await c.query('ROLLBACK'); await c.end(); }
});
