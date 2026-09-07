import assert from 'node:assert/strict';
import test from 'node:test';

import { PasswordService } from '../src/modules/auth/password.service.js';

const passwords = new PasswordService('unit-test-password-pepper-with-at-least-32-characters');

test('gera e verifica Argon2id com pepper', async () => {
  const password = 'FabControl!Secure-2026';
  const passwordHash = await passwords.hash(password);

  assert.match(passwordHash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/u);
  assert.equal(await passwords.verify(passwordHash, password), true);
  assert.equal(await passwords.verify(passwordHash, 'Senha!Incorreta-2026'), false);
});

test('rejeita senha fora da política', () => {
  const result = passwords.validatePolicy('curta');

  assert.equal(result.valid, false);
  assert.ok(result.violations.length >= 3);
  assert.throws(() => passwords.assertPolicy('curta'), {
    name: 'AppError',
  });
});
