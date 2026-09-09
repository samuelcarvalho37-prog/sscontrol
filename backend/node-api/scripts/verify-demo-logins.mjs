import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { loadEnvironment } from '../src/config/environment.ts';

const environment = loadEnvironment();
if (
  environment.release.environment === 'PRODUCTION' ||
  environment.nodeEnv === 'production' ||
  !['localhost', '127.0.0.1'].includes(new URL(environment.database.url).hostname)
) {
  throw new Error('Verificação permitida somente no banco local de demonstração.');
}
const profiles = [
  ['USR-ADMIN-DEMO', 'ADMIN', 'DEMO_ADMIN_PASSWORD'],
  ['USR-QUAL-DEMO', 'QUALIDADE', 'DEMO_QUALITY_PASSWORD'],
  ['USR-SEG-DEMO', 'SEGURANCA', 'DEMO_SAFETY_PASSWORD'],
  ['USR-MAN-DEMO', 'TECNICO', 'DEMO_MAINTENANCE_PASSWORD'],
  ['USR-OPE-DEMO', 'OPERADOR', 'DEMO_OPERATOR_PASSWORD'],
  ['USR-PCM-DEMO', 'PCM', 'DEMO_PCM_PASSWORD'],
  ['USR-PRO-DEMO', 'PRODUCAO', 'DEMO_PRODUCAO_PASSWORD'],
];
const app = await buildApp({ environment, logger: false });
try {
  for (const [matricula, role, passwordVariable] of profiles) {
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { matricula, senha: process.env[passwordVariable] },
    });
    assert.equal(login.statusCode, 200, `Login ${role}: HTTP ${login.statusCode}`);
    const data = login.json().data;
    const headers = { authorization: `Bearer ${data.access_token}` };
    try {
      assert.equal(data.user.primaryRoleCode, role);
      assert.ok(data.user.roleCodes.includes(role));
      if (['QUALIDADE', 'SEGURANCA', 'TECNICO'].includes(role)) {
        assert.ok(!data.user.roleCodes.includes('GESTOR_TECNICO'));
      }
      const session = await app.inject({ method: 'GET', url: '/v1/auth/session', headers });
      assert.equal(session.statusCode, 200);
      assert.equal(session.json().data.user.primaryRoleCode, role);
      console.log(
        `${role}: login e sessão confirmados (${data.user.capacidades.length} capacidades).`,
      );
    } finally {
      if (data.access_token) {
        const logout = await app.inject({
          method: 'POST',
          url: '/v1/auth/logout',
          headers,
          payload: {},
        });
        assert.equal(logout.statusCode, 200);
      }
    }
  }
} finally {
  await app.close();
}
