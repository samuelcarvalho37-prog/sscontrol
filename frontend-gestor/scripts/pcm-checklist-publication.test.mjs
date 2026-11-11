import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
const vite = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
test.after(() => vite.close())
const { nodeActionRequest } = await vite.ssrLoadModule('/src/services/api/client.ts')
const { estimateChecklistMinutes } = await vite.ssrLoadModule('/src/components/pcmChecklistEstimate.ts')
test('publicação sem assinatura mantém zero no contrato e não usa submit-configured', () => {
 const saved = nodeActionRequest('admin.salvar_modelo_checklist', { plano: { id: 'modelo', nome: 'Teste', assinaturas_exigidas: 0 }, itens: [] })
 assert.equal(saved.body.checklist.assinaturas_exigidas, 0)
 assert.match(nodeActionRequest('pcm.submeter_checklist_sem_assinatura', { plano_id: 'modelo' }).path, /\/modelo\/submit$/)
 assert.match(nodeActionRequest('pcm.publicar_checklist', { plano_id: 'modelo' }).path, /\/modelo\/publish$/)
})
test('rota assinada continua exigindo duas assinaturas para Qualidade e Segurança', () => {
 const saved = nodeActionRequest('admin.salvar_modelo_checklist', { plano: { nome: 'Teste', politica_assinatura: 'QUALIDADE_E_SEGURANCA', assinaturas_exigidas: 1 }, itens: [] })
 assert.equal(saved.body.checklist.assinaturas_exigidas, 2)
 assert.match(nodeActionRequest('admin.enviar_modelo_checklist_validacao', { plano_id: 'modelo' }).path, /submit-configured$/)
})
test('pré-configuração de execução faz ida e volta pelo contrato', () => {
 const req = nodeActionRequest('admin.salvar_modelo_checklist', { plano: { nome: 'Teste', modo_parada_manutencao: 'OBRIGATORIA', requer_bloqueio: 'NAO', tempo_estimado_min: 35, estimativa_automatica: true }, itens: [] })
 assert.deepEqual(req.body.checklist.pre_configuracao, { modo_parada: 'MANDATORY_STOP', requer_bloqueio: false, tempo_estimado_min: 35, estimativa_automatica: true })
 const result = req.transform({ id: 'modelo', versao_atual: { status: 'DRAFT', pre_configuracao: req.body.checklist.pre_configuracao }, itens: [] })
 assert.equal(result.plano.tempo_estimado_min, 35)
 assert.equal(result.plano.requer_bloqueio, 'NAO')
 assert.equal(result.plano.modo_parada_manutencao, 'OBRIGATORIA')
})
test('estimativa é positiva, cresce com as etapas e identifica a criticidade', () => {
 assert.equal(estimateChecklistMinutes([], 'BAIXA'), 5)
 const steps = [{ tipo_resposta: 'PARAMETRO' }, { tipo_resposta: 'EVIDENCIA' }]
 assert.ok(estimateChecklistMinutes(steps, 'CRITICA') > estimateChecklistMinutes(steps, 'BAIXA'))
 assert.ok(estimateChecklistMinutes([...steps, ...steps], 'ALTA') >= estimateChecklistMinutes(steps, 'ALTA'))
})
