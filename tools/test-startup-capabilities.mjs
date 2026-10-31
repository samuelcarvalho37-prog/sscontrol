import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from '../frontend-gestor/node_modules/typescript/lib/typescript.js'

const source = fs.readFileSync(new URL('../frontend-gestor/src/services/startup/workspace.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function harness(capabilities, sessionError) {
  const calls = []
  const exports = {}
  const mock = new Proxy({}, {
    get: (_, name) => async () => {
      calls.push(name)
      if (name === 'warmupGestor' && sessionError) throw sessionError
      if (['getGestorTechnicalContext', 'getGestorTechnicalDemands'].includes(name)) {
        assert.ok(capabilities.includes('maintenance.work-orders.review'), 'consulta técnica sem capacidade de revisão')
      }
      return name === 'getSystemHealth' ? { version: '1.4.0' } : { loaded_tables: 0 }
    },
  })
  vm.runInNewContext(compiled, { exports, require: () => mock })
  return {
    calls,
    run: () => exports.prepareWorkspace(
      { token: 'test', user: { perfil: 'ADMIN', capacidades: capabilities } },
      new AbortController().signal,
      () => {},
    ),
  }
}

test('admin consulta usuários e permissões sem exigir revisão técnica', async () => {
  const h = harness(['admin.identity.read', 'maintenance.work-orders.read', 'workflow.notifications.read'])
  const result = await h.run()
  assert.equal(result.verifiedModules, 3)
  assert.deepEqual(h.calls, ['getSystemHealth', 'warmupGestor', 'getUnreadNotificationCount', 'listAdminUsers', 'getAdminPermissionMatrix'])
})

test('capacidade de revisão mantém o carregamento do contexto e das demandas', async () => {
  const h = harness(['maintenance.work-orders.review'])
  assert.equal((await h.run()).verifiedModules, 2)
  assert.ok(h.calls.includes('getGestorTechnicalContext'))
  assert.ok(h.calls.includes('getGestorTechnicalDemands'))
})

test('falha de sessão continua bloqueando a entrada', async () => {
  const expired = new Error('Sessão expirada')
  const h = harness(['admin.identity.read'], expired)
  await assert.rejects(h.run(), error => error === expired)
  assert.deepEqual(h.calls, ['getSystemHealth', 'warmupGestor'])
})
