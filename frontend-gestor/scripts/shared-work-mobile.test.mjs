import assert from 'node:assert/strict'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'

const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../../frontend',import.meta.url)),optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false}})
const {locationChoices,blankAnswers,workPriority}=await vite.ssrLoadModule('/src/components/sharedWorkModel.ts')
const {usesSharedHome}=await vite.ssrLoadModule('/src/components/sharedWorkModel.ts')
test.after(()=>vite.close())
const assets=[
  {id:'a',nome:'Bomba',tag:'A',planta_id:'p1',planta:'Unidade 1',setor_id:'s1',setor:'Utilidades',linha_id:'l1',linha:'Linha 1'},
  {id:'b',nome:'Compressor',tag:'B',planta_id:'p1',planta:'Unidade 1',setor_id:'s1',setor:'Utilidades',linha_id:'l1',linha:'Linha 1'},
  {id:'c',nome:'Envasadora',tag:'C',planta_id:'p2',planta:'Unidade 2',setor_id:'s2',setor:'Envase',linha_id:'l2',linha:'Linha 2'},
]
test('seleção hierárquica não mistura plantas ou setores e não repete linha',()=>{
  assert.equal(locationChoices(assets,'planta').length,2)
  assert.deepEqual(locationChoices(assets,'setor','p1').map(row=>row.id),['s1'])
  assert.deepEqual(locationChoices(assets,'linha','p1','s1').map(row=>row.id),['l1'])
  assert.deepEqual(locationChoices(assets,'linha','p1','s2'),[])
  assert.deepEqual(locationChoices(assets,'setor',''),[])
})
test('avaliação preserva risco de segurança e redundância não reduz risco de qualidade',()=>{
  const answers={...blankAnswers(),equipamento_parado:false,risco_parada:false,risco_seguranca:false,impacto_producao:false,impacto_qualidade:false,existe_redundancia:true}
  assert.equal(workPriority(answers),'LOW')
  assert.equal(workPriority({...answers,risco_seguranca:true}),'CRITICAL')
  assert.equal(workPriority({...answers,impacto_qualidade:true}),'HIGH')
  assert.equal(workPriority({...answers,risco_parada:true,existe_redundancia:false}),'HIGH')
  assert.equal(workPriority({...answers,equipamento_parado:true,impacto_producao:true,existe_redundancia:false}),'CRITICAL')
})
test('operador com leitura de OS entra na consulta compartilhada; revisão, técnico e TI preservam suas telas',()=>{
  const read=['maintenance.shared.read','maintenance.work-orders.read','maintenance.occurrences.report']
  assert.equal(usesSharedHome(read,'OPERADOR'),true)
  assert.equal(usesSharedHome(read,'PRODUCAO'),true)
  for(const profile of ['TECNICO','PCM','GESTOR','ADMIN','SISTEMA'])assert.equal(usesSharedHome(read,profile),false)
  assert.equal(usesSharedHome([...read,'maintenance.work-orders.review'],'QUALIDADE'),false)
  assert.equal(usesSharedHome([...read,'maintenance.work-orders.review'],'SEGURANCA'),false)
  assert.equal(usesSharedHome(undefined,'OPERADOR'),false)
})
