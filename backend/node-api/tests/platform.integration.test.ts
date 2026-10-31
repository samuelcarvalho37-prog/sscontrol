import assert from 'node:assert/strict';
import { createCipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { buildApp } from '../src/app.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { createTestEnvironment } from './helpers/environment.js';

const runtimeUrl = process.env.TEST_DATABASE_URL;
const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;

test('plataforma: MFA, plano, empresa, administrador inicial, contrato e logout', {
  skip: !runtimeUrl || !migrationUrl,
}, async () => {
  assert.ok(runtimeUrl && migrationUrl);
  assert.match(new URL(runtimeUrl).pathname, /\/fab_control_node_test_\d{8}_\d{6}$/u);
  const environment = createTestEnvironment(runtimeUrl);
  const administrator = new Pool({ connectionString: migrationUrl, max: 1 });
  const app = await buildApp({ environment });
  const login = `qa-${randomUUID()}`;
  const password = `Qa!${randomBytes(24).toString('hex')}`;
  const secret = randomBytes(20);
  const iv = randomBytes(12);
  const key = createHash('sha256').update(environment.auth.passwordPepper).digest();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret), cipher.final()]);
  const ciphertext = ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join(':');
  const passwordHash = await new PasswordService(environment.auth.passwordPepper).hash(password);
  try {
    // A unique fixture keeps repeated test runs independent of the one-time
    // bootstrap account. The guard above restricts this to the isolated DB.
    await administrator.query(
      'INSERT INTO platform.platform_operators (login_name,display_name,password_hash,totp_secret_ciphertext) VALUES ($1,$2,$3,$4)',
      [login, 'Operador QA isolado', passwordHash, ciphertext],
    );
    const anonymous = await app.inject({ method: 'GET', url: '/v1/platform/plans' });
    assert.equal(anonymous.statusCode, 401);
    const missingMfa = await app.inject({ method: 'POST', url: '/v1/platform/auth/login', payload: { login, password, code: '' } });
    assert.equal(missingMfa.statusCode, 401);
    const factor = Buffer.alloc(8);
    factor.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
    const digest = createHmac('sha1', secret).update(factor).digest();
    const offset = (digest[digest.length - 1] ?? 0) & 15;
    const code = String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
    const signedIn = await app.inject({ method: 'POST', url: '/v1/platform/auth/login', payload: { login, password, code } });
    assert.equal(signedIn.statusCode, 200, 'Login com senha e MFA válidos');
    assert.equal(signedIn.headers['cache-control'], 'no-store');
    const token: string = signedIn.json().data.token;
    const headers = { authorization: `Bearer ${token}` };
    const plan = { code: `QA-${randomUUID().toUpperCase()}`, name: 'Plano QA isolado', description: 'Homologação automática', status: 'ACTIVE', monthly_price: 100, feature_codes: ['CADASTROS'] };
    const createdPlan = await app.inject({ method: 'POST', url: '/v1/platform/plans', headers, payload: plan });
    assert.equal(createdPlan.statusCode, 200, createdPlan.body);
    const planId: string = createdPlan.json().data.plan_id;
    assert.ok(planId);
    const updatedPlan = await app.inject({ method: 'PUT', url: `/v1/platform/plans/${planId}`, headers, payload: { ...plan, monthly_price: 120 } });
    assert.equal(updatedPlan.statusCode, 200, updatedPlan.body);
    const plans = await app.inject({ method: 'GET', url: '/v1/platform/plans', headers });
    assert.equal(plans.statusCode, 200);
    assert.ok(plans.body.includes(planId));
    const tenant = await app.inject({ method: 'POST', url: '/v1/platform/tenants', headers, payload: { display_name: 'Empresa QA isolada', legal_name: 'Empresa QA isolada', slug: `qa-${randomUUID()}`, environment: 'HOMOLOGATION' } });
    assert.equal(tenant.statusCode, 200, tenant.body);
    const tenantId: string = tenant.json().data.tenant_id;
    assert.equal(tenant.json().data.subscription_id, null);
    const initialAdmin = await app.inject({ method: 'POST', url: `/v1/platform/tenants/${tenantId}/initial-admin`, headers, payload: { name: 'Administrador QA', employee_number: 'QA-ADMIN', email: 'qa-admin@example.invalid' } });
    assert.equal(initialAdmin.statusCode, 200, 'Criação do administrador inicial');
    assert.ok(initialAdmin.json().data.user_id);
    assert.equal(initialAdmin.headers['cache-control'], 'no-store');
    const duplicateAdmin = await app.inject({ method: 'POST', url: `/v1/platform/tenants/${tenantId}/initial-admin`, headers, payload: { name: 'Outro administrador QA', employee_number: 'QA-ADMIN-2', email: 'qa-admin-2@example.invalid' } });
    assert.equal(duplicateAdmin.statusCode, 409, 'Não deve criar outro administrador inicial');
    const subscription = await app.inject({ method: 'PATCH', url: `/v1/platform/tenants/${tenantId}/subscription`, headers, payload: { plan_id: planId, status: 'ACTIVE', monthly_price: 120, discount_percent: 10, implementation_days: 7, feature_codes: ['CADASTROS'] } });
    assert.equal(subscription.statusCode, 200, subscription.body);
    assert.ok(subscription.json().data.subscription_id);
    const invalidPrice = await app.inject({ method: 'PUT', url: `/v1/platform/plans/${planId}`, headers, payload: { ...plan, monthly_price: -1 } });
    assert.equal(invalidPrice.statusCode, 400);
    const invalidCode = await app.inject({ method: 'POST', url: '/v1/platform/plans', headers, payload: { ...plan, code: 'plano inválido' } });
    assert.equal(invalidCode.statusCode, 400, 'Código inválido deve retornar validação, não erro interno');
    const logout = await app.inject({ method: 'POST', url: '/v1/platform/auth/logout', headers });
    assert.equal(logout.statusCode, 200);
    const expired = await app.inject({ method: 'GET', url: '/v1/platform/plans', headers });
    assert.equal(expired.statusCode, 401);
  } finally {
    await app.close();
    await administrator.end();
  }
});
