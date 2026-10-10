import { useCallback, useEffect, useState } from 'react'
import { getPlantPartShortage, listPlantPartShortages, resumeExecutionForWorkOrder, transitionPartShortage } from '../services/api/operatorActions'
import type { PartShortage } from '../types/operatorActions'

export function PcmPartShortagesPanel({ onSessionExpired, focusShortageId = '' }: { onSessionExpired: () => void; focusShortageId?: string }) {
  const [items,setItems]=useState<PartShortage[]>([])
  const [notes,setNotes]=useState<Record<string,string>>({})
  const [error,setError]=useState('')
  const [busyId,setBusyId]=useState('')
  const reload=useCallback(async()=>{
    try {
      const listed=await listPlantPartShortages()
      if(focusShortageId && !listed.some(item=>item.id===focusShortageId)) {
        try {
          const focused=await getPlantPartShortage(focusShortageId)
          setItems([focused,...listed])
          setError('')
          return
        } catch(cause) {
          setItems(listed)
          setError('A pendência desta notificação não está disponível no seu escopo de planta.')
          const message=cause instanceof Error?cause.message:''
          if(/sessão|autentica|token/i.test(message)) onSessionExpired()
          return
        }
      }
      setItems(listed)
      setError('')
    }
    catch(cause){const message=cause instanceof Error?cause.message:'Não foi possível carregar pendências de peça.';setError(message);if(/sessão|autentica|token/i.test(message))onSessionExpired()}
  },[focusShortageId,onSessionExpired])
  useEffect(()=>{void reload()},[reload])
  useEffect(()=>{
    if(!focusShortageId || !items.some(item=>item.id===focusShortageId)) return
    requestAnimationFrame(()=>{
      const target=document.getElementById(`part-shortage-${focusShortageId}`)
      target?.scrollIntoView({behavior:'smooth',block:'center'})
      target?.focus({preventScroll:true})
    })
  },[focusShortageId,items])

  async function transition(item:PartShortage,action:'resolve'|'cancel'){
    const note=notes[item.id]?.trim() ?? ''
    if(note.length<3){setError('Informe uma justificativa de pelo menos 3 caracteres.');return}
    setBusyId(item.id);setError('')
    try{await transitionPartShortage(item.work_order_id,item.id,action,note);await reload()}
    catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível atualizar a pendência.')}
    finally{setBusyId('')}
  }

  async function resume(item:PartShortage){
    setBusyId(item.execution_id);setError('')
    try{await resumeExecutionForWorkOrder(item.work_order_id,item.execution_id);await reload()}
    catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível retomar a OS.')}
    finally{setBusyId('')}
  }

  const open=items.filter(item=>item.status==='OPEN')
  return <section className="pcm-panel pcm-part-shortages" aria-labelledby="pcm-part-shortages-title">
    <div className="pcm-panel__heading"><div><span className="pcm-section-kicker">EXECUÇÃO · PEÇAS</span><h2 id="pcm-part-shortages-title">Pendências de peça</h2></div><span>{open.length} aberta(s)</span></div>
    <p>Registros não movimentam estoque. A OS pode continuar enquanto a equipe tiver trabalho possível.</p>
    {error?<p role="alert">{error}</p>:null}
    {items.length===0?<p>Nenhuma pendência de peça no seu escopo de planta.</p>:<div className="pcm-part-shortages__list">{items.map(item=><article id={`part-shortage-${item.id}`} tabIndex={-1} key={item.id} className="pcm-part-shortages__item">
      <div><strong>{item.work_order_code ?? 'OS'} · {item.codigo_peca || 'Peça sem código'}</strong><span>{item.descricao} · {item.quantidade} {item.unidade}{item.impeditiva?' · Impeditiva':' · Não impeditiva'}</span><small>Registrada por {item.reported_by_name} em {new Date(item.created_at ?? item.registrado_em ?? '').toLocaleString('pt-BR')} · {item.status}</small>{item.evidence_url?<a href={item.evidence_url} target="_blank" rel="noreferrer">Abrir foto {item.evidence_name ?? ''}</a>:null}{item.resolution_note?<small>{item.status==='RESOLVED'?'Resolução':'Cancelamento'}: {item.resolution_note}</small>:null}</div>
      {item.status==='OPEN'?<div className="pcm-part-shortages__actions"><label>Justificativa obrigatória<textarea value={notes[item.id]??''} maxLength={2000} onChange={event=>setNotes(current=>({...current,[item.id]:event.target.value}))}/></label><button type="button" disabled={busyId===item.id} onClick={()=>void transition(item,'resolve')}>Registrar resolução</button><button type="button" disabled={busyId===item.id} onClick={()=>void transition(item,'cancel')}>Cancelar pendência</button></div>:null}
      {item.execution_status==='PAUSED' && item.status!=='OPEN' && item.impeditiva && !items.some(other=>other.execution_id===item.execution_id && other.status==='OPEN' && other.impeditiva)? <button type="button" disabled={Boolean(busyId)} onClick={()=>void resume(item)}>Retomar OS</button>:null}
    </article>)}</div>}
  </section>
}
