import assert from 'node:assert/strict'
import test from 'node:test'
import { workspaceExperience } from '../src/services/auth/workspaceExperience.ts'

test('Qualidade e Segurança mantêm a área de validação mesmo com tipo MANAGER', () => {
  for (const code of ['QUALIDADE', 'SEGURANCA', 'QUALITY', 'SAFETY']) {
    assert.equal(workspaceExperience({ roleType: 'MANAGER', primaryRoleCode: code, perfil: code }), 'other')
    assert.equal(workspaceExperience({ roleType: 'MANAGER', perfil: code }), 'other')
    assert.equal(workspaceExperience({ roleType: 'MANAGER', primaryRoleCode: 'CUSTOM_VALIDATOR', perfil: code }), 'other')
  }
})

test('PCM, TI e operação preservam suas áreas sem depender das permissões de assinatura', () => {
  assert.equal(workspaceExperience({ roleType: 'MANAGER', primaryRoleCode: 'PCM', perfil: 'PCM' }), 'pcm')
  assert.equal(workspaceExperience({ roleType: 'ADMIN', primaryRoleCode: 'ADMIN', perfil: 'ADMIN' }), 'ti')
  assert.equal(workspaceExperience({ roleType: 'ADMIN', perfil: 'QUALIDADE' }), 'ti')
  assert.equal(workspaceExperience({ roleType: 'CUSTOM', perfil: 'TECNICO' }), 'other')
  assert.equal(workspaceExperience({ roleType: 'OPERATOR', perfil: 'PRODUCAO' }), 'other')
  assert.equal(workspaceExperience({ perfil: 'PCM' }), 'pcm')
  assert.equal(workspaceExperience({ perfil: 'ADMIN' }), 'ti')
  assert.equal(workspaceExperience(null), 'other')
})
