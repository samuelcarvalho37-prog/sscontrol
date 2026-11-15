import { useEffect, useState } from 'react'
import { permitsAction } from '../services/auth/permissionActions'
import './PermissionTools.css'

type RecordItem = Record<string, unknown>
interface Props { apiUrl: string; token: string; capabilities: readonly string[]; onSessionExpired?: () => void }
export function hasPermissionTools(capabilities: readonly string[] = []): boolean {
  return permitsAction(capabilities,'POST','/v1/cmms/parameters','cmms.parameters.manage') || permitsAction(capabilities,'POST','/v1/maintenance/checklists/:checklistId/review','maintenance.checklists.review')
}
export function PermissionTools({apiUrl,token,capabilities,onSessionExpired}: Props) {
  const canCreate = permitsAction(capabilities,'POST','/v1/cmms/parameters','cmms.parameters.manage')
  const canReview = permitsAction(capabilities,'POST','/v1/maintenance/checklists/:checklistId/review','maintenance.checklists.review')
  const canReadAssets = permitsAction(capabilities,'GET','/v1/cmms/assets','cmms.assets.read')
  const canReadModels = permitsAction(capabilities,'GET','/v1/maintenance/checklists','maintenance.checklists.read') && permitsAction(capabilities,'GET','/v1/maintenance/checklists/:checklistId','maintenance.checklists.read')
  const [mode,setMode] = useState<'parameter'|'review'>(()=>canCreate?'parameter':'review')
  const [assets,setAssets] = useState<RecordItem[]>([])
  const [models,setModels] = useState<RecordItem[]>([])
  const [detail,setDetail] = useState<RecordItem|null>(null)
  const [error,setError] = useState('')
  const [notice,setNotice] = useState('')
  const [busy,setBusy] = useState(false)
  const [loading,setLoading] = useState(false)
  const [search,setSearch] = useState('')
  const [revision,setRevision] = useState(0)
  useEffect(()=>{
    if(mode==='parameter'&&!canCreate&&canReview)setMode('review')
    if(mode==='review'&&!canReview&&canCreate)setMode('parameter')
  },[mode,canCreate,canReview])
  async function request<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T> {
    const response=await fetch(`${apiUrl.replace(/\/+$/,'').replace(/\/v1$/,'')}${path}`,{method,signal,cache:'no-store',headers:{...(new URLSearchParams(window.location.search).get('tenant')?{'X-VORQIX-DEV-TENANT':new URLSearchParams(window.location.search).get('tenant')!}:{}),Authorization:`Bearer ${token}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})})
    const result=await response.json()
    if(response.status===401)onSessionExpired?.()
    if(!response.ok||!result.ok)throw new Error(result.error?.message??'Não foi possível concluir esta operação.')
    return result.data as T
  }
  useEffect(()=>{
    const controller=new AbortController();setError('');setDetail(null);setLoading(true)
    const permitted=mode==='parameter'?canCreate&&canReadAssets:canReview&&canReadModels
    if(!permitted){setLoading(false);return ()=>controller.abort()}
    const path=mode==='parameter'?'/v1/cmms/assets':'/v1/maintenance/checklists'
    void request<{itens:RecordItem[]}>(`${path}?busca=${encodeURIComponent(search)}&limite=100${mode==='review'?'&status=IN_REVIEW':''}`,'GET',undefined,controller.signal).then(result=>{if(mode==='parameter')setAssets(result.itens);else setModels(result.itens)}).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Falha na consulta.')}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return ()=>controller.abort()
  },[mode,search,revision,token,apiUrl,canCreate,canReview,canReadAssets,canReadModels])
  if(!canCreate&&!canReview)return null
  const version=detail?.versao_atual as RecordItem|undefined
  const items=Array.isArray(detail?.itens)?detail.itens as RecordItem[]:[]
  return <section className="permission-tools" aria-label="Funções autorizadas">
    <header><h1>Ferramentas</h1><nav aria-label="Funções autorizadas">{canCreate?<button type="button" aria-pressed={mode==='parameter'} onClick={()=>{setMode('parameter');setNotice('')}}>Criar parâmetro</button>:null}{canReview?<button type="button" aria-pressed={mode==='review'} onClick={()=>{setMode('review');setNotice('')}}>Revisar checklist</button>:null}</nav></header>
    {error?<p role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
    {mode==='parameter'&&canCreate?<>
      {!canReadAssets?<p>A criação está habilitada. Para selecionar um equipamento, solicite também a permissão de consultar a lista de ativos.</p>:<>
      <label>Localizar equipamento<input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Nome ou TAG" /></label>
      <form onSubmit={async event=>{event.preventDefault();if(busy)return;const form=event.currentTarget;const data=new FormData(form);setBusy(true);setError('');setNotice('');try{await request('/v1/cmms/parameters','POST',{ativo_id:data.get('asset'),componente_id:null,codigo:String(data.get('code')).trim(),nome:String(data.get('name')).trim(),unidade:String(data.get('unit')).trim(),tipo_valor:data.get('value_type'),tipo_origem:'MANUAL',descricao:null,metadados:{}});form.reset();setNotice('Parâmetro criado.')}catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível criar o parâmetro.')}finally{setBusy(false)}}}>
        <label>Equipamento<select name="asset" required disabled={loading||busy}><option value="">{loading?'Consultando equipamentos…':'Selecione um equipamento'}</option>{assets.map(asset=><option key={String(asset.id)} value={String(asset.id)}>{String(asset.tag??asset.codigo??'')} · {String(asset.name??asset.nome??'')}</option>)}</select></label>
        <label>Nome do parâmetro<input name="name" required minLength={2} maxLength={160} disabled={busy}/></label>
        <label>Código<input name="code" required minLength={1} maxLength={80} disabled={busy}/></label>
        <label>Unidade<input name="unit" required maxLength={30} placeholder="Ex.: °C, bar, h" disabled={busy}/></label>
        <label>Tipo de valor<select name="value_type" disabled={busy}><option value="DECIMAL">Número decimal</option><option value="INTEGER">Número inteiro</option><option value="BOOLEAN">Sim ou não</option><option value="TEXT">Texto</option></select></label>
        <footer><button type="submit" disabled={busy||loading||!assets.length}>{busy?'Salvando…':'Criar parâmetro'}</button></footer>
      </form></>}
    </>:null}
    {mode==='review'&&canReview?<>
      {!canReadModels?<p>A revisão está habilitada. Para analisar o conteúdo antes de decidir, solicite também a consulta da lista e dos detalhes dos checklists.</p>:<>
      <label>Localizar checklist<input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Nome ou equipamento"/></label>
      {loading?<p role="status">Consultando checklists…</p>:<ul>{models.map(model=><li key={String(model.id)}><button type="button" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{setDetail(await request(`/v1/maintenance/checklists/${encodeURIComponent(String(model.id))}`))}catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível abrir o checklist.')}finally{setBusy(false)}}}><strong>{String(model.nome)}</strong><small>{String(model.ativo_tag??'')} · {String(model.status??'')}</small></button></li>)}</ul>}
      {!loading&&!models.length?<p>Nenhum checklist encontrado.</p>:null}
      {detail?<article><h2>{String(detail.nome)}</h2><p>{String(detail.ativo_tag??'')} · {String(detail.ativo_nome??'')}</p><p>Revisão {String(version?.revisao??'')} · {String(version?.status??'')}</p><ol>{items.map((item,index)=><li key={String(item.id??index)}><strong>{String(item.title??item.titulo??item.label??item.nome??`Etapa ${index+1}`)}</strong>{item.instruction||item.instrucao?<p>{String(item.instruction??item.instrucao)}</p>:null}<small>{String(item.response_type??item.tipo_resposta??'')}</small></li>)}</ol>
        <form onSubmit={async event=>{event.preventDefault();if(busy)return;const data=new FormData(event.currentTarget);setBusy(true);setError('');setNotice('');try{await request(`/v1/maintenance/checklists/${encodeURIComponent(String(detail.id))}/review`,'POST',{decisao:data.get('decision'),justificativa:data.get('reason')});setNotice('Decisão registrada.');setDetail(null);setRevision(value=>value+1)}catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível registrar a revisão.')}finally{setBusy(false)}}}>
          <p>A assinatura respeita a área, a habilitação técnica e a política definida neste checklist.</p>
          <label>Decisão<select name="decision" disabled={busy}><option value="CHANGES_REQUESTED">Solicitar correção</option><option value="APPROVED">Aprovar</option><option value="REJECTED">Recusar</option></select></label>
          <label>Justificativa<textarea name="reason" required minLength={3} maxLength={2000} disabled={busy}/></label><footer><button type="submit" disabled={busy||!items.length}>{busy?'Registrando…':'Registrar decisão'}</button></footer>
        </form>
      </article>:null}</>}
    </>:null}
  </section>
}
