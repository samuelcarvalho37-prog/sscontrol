import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const vite = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
const { platformCustomerTenants } = await vite.ssrLoadModule('/src/services/platformTenantVisibility.ts')
test.after(() => vite.close())

function company(id, environment, slug = `company-${id}`) {
  return { tenant_id: id, display_name: `Empresa ${id}`, slug, environment, created_at: '2026-11-20T12:00:00Z', tenant_status: 'ACTIVE', plan_name: 'Plano QA Visual' }
}

test('empresa local com plano aparece junto às empresas de homologação e produção', () => {
  const companies = [company('local', 'DEVELOPMENT', 'tozzi-alimentos'), company('hml', 'HOMOLOGATION'), company('prod', 'PRODUCTION')]
  assert.deepEqual(platformCustomerTenants(companies).map(item => item.tenant_id), ['local', 'hml', 'prod'])
  assert.equal(platformCustomerTenants(companies)[0].plan_name, 'Plano QA Visual')
})

test('ambiente interno de demonstração continua fora da carteira de clientes', () => {
  const companies = [company('seed', 'DEVELOPMENT', 'fab-control-homologacao-000000000000'), company('local', 'DEVELOPMENT', 'tozzi-alimentos')]
  assert.deepEqual(platformCustomerTenants(companies).map(item => item.slug), ['tozzi-alimentos'])
})

test('empresa suspensa permanece visível para administração', () => {
  assert.equal(platformCustomerTenants([{ ...company('local', 'DEVELOPMENT'), tenant_status: 'SUSPENDED' }]).length, 1)
})
