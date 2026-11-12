import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
const vite = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr:false } })
test.after(() => vite.close())
const { nodeActionRequest } = await vite.ssrLoadModule('/src/services/api/client.ts')
test('PCM usa rotas exclusivas para importar e preserva hash de confirmação', () => {
  assert.equal(nodeActionRequest('pcm.importacao.modelos', {}).path, '/v1/pcm/imports/models')
  const validate = nodeActionRequest('pcm.importacao.validar', { tipo: 'ativos', linhas: [{ __linha: 2, tag: 'A' }] })
  assert.equal(validate.path, '/v1/pcm/imports/validate')
  assert.equal(validate.body.tipo, 'ativos')
  const confirm = nodeActionRequest('pcm.importacao.confirmar', { lote_id: 'lote', validacao_hash: 'hash' })
  assert.equal(confirm.path, '/v1/pcm/imports/lote/confirm')
  assert.deepEqual(confirm.body, { validacao_hash: 'hash' })
  assert.equal(nodeActionRequest('admin.importacao.modelos', {}).path, '/v1/admin/imports/models')
})

test('planos mantêm identidade do cadastro e acompanhamento usa paginação própria', () => {
  const request = nodeActionRequest('admin.listar', { entidade:'planos' })
  const result = request.transform({itens:[{id:'plan-id',nome:'Inspeção',versao_atual:{id:'version-id',status:'PUBLISHED'}}]})
  assert.equal(result.rows[0].id,'plan-id')
  assert.equal(result.rows[0].versao_id,'version-id')
  const tracking = nodeActionRequest('pcm.tracking',{filtro:'blocked',pagina:2,setor_id:'sector'})
  assert.ok(tracking.path.startsWith('/v1/pcm/tracking?'))
  assert.ok(tracking.path.includes('pagina=2'))
  const create = nodeActionRequest('admin.intervencoes.salvar',{dados:{checklist_versao_id:'checklist-version',tipo:'CORRETIVA',titulo:'Teste',descricao:'Teste',prioridade:'MEDIA'}})
  assert.equal(create.body.checklist_versao_id,'checklist-version')
})
