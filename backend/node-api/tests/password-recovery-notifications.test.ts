import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AuthRepository } from '../src/modules/auth/auth.repository.js';
import { AdminRepository } from '../src/modules/admin/admin.repository.js';

test('recuperação avisa gestores de acesso e redefinição encerra pedido e aviso', { skip: !process.env.PCM_IMPORT_TEST_URL }, async () => {
  const pool = new Pool({connectionString: process.env.PCM_IMPORT_TEST_URL});
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const identity = (await client.query(`SELECT u.id,u.tenant_id FROM iam.users u JOIN platform.tenants t ON t.id=u.tenant_id WHERE t.slug='manteiga-serra-dourada-demo' AND u.deleted_at IS NULL LIMIT 1`)).rows[0];
    assert.ok(identity);
    await client.query('SET LOCAL ROLE fab_control_api_local');
    await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)", [identity.tenant_id,identity.id]);
    await client.query("SELECT set_config('app.user_id','',true)");
    const reference='REC-TEST-'+randomUUID();
    await new AuthRepository().createRecoveryRequest(client,{tenantId:identity.tenant_id,userId:identity.id,publicReference:reference,secretHash:'a'.repeat(64),ipAddress:'127.0.0.1',userAgent:'integration-test'});
    const notice=await client.query(`SELECT n.id,count(r.user_id)::int AS recipients FROM workflow.notifications n JOIN workflow.notification_recipients r ON r.notification_id=n.id WHERE n.deduplication_key=$1 GROUP BY n.id`,['recovery:'+reference]);
    assert.equal(notice.rows.length,1);
    assert.ok(notice.rows[0].recipients>0);
    await client.query("SELECT set_config('app.user_id',$1,true)",[identity.id]);
    await new AdminRepository().resetPassword(client,identity.id,'rollback-test-hash');
    const user=(await client.query('SELECT recovery_reference FROM iam.users WHERE id=$1',[identity.id])).rows[0];
    assert.equal(user.recovery_reference,null);
    assert.equal((await client.query('SELECT status FROM iam.recovery_requests WHERE public_reference=$1',[reference])).rows[0].status,'CONSUMED');
    assert.equal((await client.query('SELECT status FROM workflow.notifications WHERE id=$1',[notice.rows[0].id])).rows[0].status,'RETRACTED');
  } finally { await client.query('ROLLBACK'); client.release(); await pool.end(); }
});
