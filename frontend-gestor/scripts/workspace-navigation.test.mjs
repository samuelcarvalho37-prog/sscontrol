import assert from 'node:assert/strict'
import test from 'node:test'
import { technicalContextLandingSection } from '../src/components/workspaceNavigation.ts'

test('atualizar a sessão não retira o usuário da área que ele abriu', () => {
  for (const section of ['maintenance', 'tracking', 'scan', 'tools', 'more', 'shared', 'validations']) {
    assert.equal(technicalContextLandingSection(section, false, false, true), section)
    assert.equal(technicalContextLandingSection(section, false, false, false), section)
  }
})

test('a entrada inicial continua respeitando validação, técnico e acesso a indicadores', () => {
  assert.equal(technicalContextLandingSection('home', false, false, true), 'validations')
  assert.equal(technicalContextLandingSection('home', false, false, false), 'more')
  assert.equal(technicalContextLandingSection('home', true, false, false), 'home')
  assert.equal(technicalContextLandingSection('home', false, true, false), 'home')
})
