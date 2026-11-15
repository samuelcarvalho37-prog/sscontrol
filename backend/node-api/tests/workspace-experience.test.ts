import assert from 'node:assert/strict';
import test from 'node:test';
import { workspaceExperience } from '../../../frontend-gestor/src/services/auth/workspaceExperience.js';

test('tipo do perfil preserva a experiência sem depender do nome escolhido pela empresa', () => {
  assert.equal(workspaceExperience({ roleType: 'MANAGER', perfil: 'PLANEJAMENTO_LOCAL' }), 'pcm');
  assert.equal(workspaceExperience({ roleType: 'ADMIN', perfil: 'ADMINISTRACAO_LOCAL' }), 'ti');
  assert.equal(workspaceExperience({ roleType: 'OPERATOR', perfil: 'PCM' }), 'other');
  assert.equal(workspaceExperience({ roleType: 'CUSTOM', perfil: 'PCM' }), 'other');
  assert.equal(workspaceExperience({ perfil: 'PCM' }), 'pcm');
});
