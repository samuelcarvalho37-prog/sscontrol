import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const vite = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
const access = await vite.ssrLoadModule(fileURLToPath(new URL('../../frontend/src/services/auth/accessBlock.ts', import.meta.url)))
test.after(() => vite.close())

function browser() {
  const originals = ['window','document','navigator'].map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)])
  const window = new EventTarget()
  const document = Object.assign(new EventTarget(), { hidden: false })
  let interval
  window.setInterval = fn => { interval = fn; return 1 }
  window.clearInterval = () => { interval = undefined }
  for(const [key,value] of Object.entries({window,document,navigator:{onLine:true}})) Object.defineProperty(globalThis,key,{value,configurable:true})
  return {window,document,tick:()=>interval?.(),restore:()=>originals.forEach(([key,descriptor])=>descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key])}
}

test('Mensagem distingue TI e demais perfis sem expor motivo comercial aos operadores', () => {
  assert.match(access.accessBlockMessage('AUTH_SUBSCRIPTION_EXPIRED',true),/validade do plano/)
  assert.match(access.accessBlockMessage('AUTH_TENANT_DISABLED',true),/foi desativado/)
  assert.match(access.accessBlockMessage('AUTH_SUBSCRIPTION_EXPIRED'),/responsável da sua empresa/)
  assert.doesNotMatch(access.accessBlockMessage('AUTH_SUBSCRIPTION_EXPIRED'),/venc|validade|assinatura/)
})

test('Bloqueio encerra uma vez e falha de rede preserva a sessão', async () => {
  const b=browser(); const reasons=[]; let blocked=false
  const stop=access.watchCompanyAccess(async()=>{if(blocked)throw {code:'AUTH_TENANT_DISABLED'};throw {code:'NETWORK_ERROR'}},code=>reasons.push(code))
  try {
    await new Promise(resolve=>setImmediate(resolve)); assert.deepEqual(reasons,[])
    blocked=true; await b.tick(); await b.tick(); assert.deepEqual(reasons,['AUTH_TENANT_DISABLED'])
  } finally { stop();b.restore() }
})

test('Erro de outra requisição dispara bloqueio imediato e limpeza remove a escuta', () => {
  const b=browser();b.document.hidden=true;const reasons=[]
  const stop=access.watchCompanyAccess(async()=>{},code=>reasons.push(code))
  try {
    access.emitAccessBlock('AUTH_SUBSCRIPTION_EXPIRED');access.emitAccessBlock('AUTH_SUBSCRIPTION_EXPIRED')
    assert.deepEqual(reasons,['AUTH_SUBSCRIPTION_EXPIRED']);stop()
    access.emitAccessBlock('AUTH_TENANT_DISABLED');assert.equal(reasons.length,1)
  } finally {stop();b.restore()}
})

test('Aba oculta consulta ao retornar e não sobrepõe consultas', async () => {
  const b=browser();b.document.hidden=true;let calls=0;let release
  const stop=access.watchCompanyAccess(()=>{calls++;return new Promise(resolve=>{release=resolve})},()=>{})
  try {
    await b.tick();assert.equal(calls,0);b.document.hidden=false;b.document.dispatchEvent(new Event('visibilitychange'))
    b.window.dispatchEvent(new Event('focus'));void b.tick();assert.equal(calls,1)
    release();await new Promise(resolve=>setImmediate(resolve));void b.tick();assert.equal(calls,2);release()
  } finally {stop();b.restore()}
})
