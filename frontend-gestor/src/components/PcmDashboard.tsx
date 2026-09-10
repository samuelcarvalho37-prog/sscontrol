import { useCallback, useEffect, useState } from 'react'
import { callApi } from '../services/api/client'
import { getGestorToken } from '../services/api/config'
import { isGestorAuthenticationError } from '../services/api/gestor'
import './PcmDashboard.css'

interface PcmData {
  atualizado_em: string
  atual: {
    ativos_parados: number; ordens_abertas: number; ordens_criticas: number
    ordens_atrasadas: number; preventivas_proximas: number; backlog_horas_estimadas: number
    ordens_sem_estimativa: number; tecnicos_em_atividade: number
  }
  confiabilidade: {
    ativos_considerados: number; falhas: number; mttr_segundos: number | null
    mtbf_segundos: number | null; disponibilidade_percentual: number | null
    reincidencias: number; ativos_reincidentes: number
  }
  falhas_por_ativo: { ativo_id: string; ativo_tag: string; ativo_nome: string; setor_nome: string; falhas: number }[]
  falhas_por_setor: { setor_id: string; setor_nome: string; falhas: number }[]
  preventivas: { id: string; codigo: string; ativo_tag: string; programada_para: string }[]
  tecnicos: { id: string; nome: string; execucoes: number }[]
}

function number(value: number) { return value.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) }
function duration(seconds: number | null) {
  if (seconds === null) return 'Sem amostra'
  return seconds >= 3600 ? `${number(seconds / 3600)} h` : `${number(seconds / 60)} min`
}
function Metric({ label, value, note }: { label: string; value: string | number; note: string }) {
  return <article className="pcm-metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>
}

export function PcmDashboard({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [days, setDays] = useState('30')
  const [refresh, setRefresh] = useState(0)
  const [data, setData] = useState<PcmData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const reload = useCallback(() => setRefresh(value => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    const end = new Date()
    setLoading(true)
    setError('')
    void callApi<PcmData>('cmms.pcm_dashboard', {
      token: getGestorToken(), inicio_em: new Date(end.getTime() - Number(days) * 86400000).toISOString(), fim_em: end.toISOString(),
    }, controller.signal).then(response => {
      if (!response.data) throw new Error('A API não retornou os indicadores do PCM.')
      if (!controller.signal.aborted) setData(response.data)
    }).catch(cause => {
      if (controller.signal.aborted) return
      if (isGestorAuthenticationError(cause)) onSessionExpired()
      else setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os indicadores.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [days, refresh, onSessionExpired])

  const current = data?.atual
  const reliability = data?.confiabilidade
  return <section className="pcm-dashboard" aria-label="Dashboard do PCM" aria-busy={loading}>
    <header className="pcm-heading"><div><span className="eyebrow">PLANEJAMENTO E CONTROLE DA MANUTENÇÃO</span><h1>Dashboard do PCM</h1>
      <p>Ordens, equipe e confiabilidade dos equipamentos da sua empresa.</p></div>
      <div className="pcm-controls"><label>Histórico<select value={days} onChange={event => setDays(event.target.value)}>
        <option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="365">Últimos 12 meses</option>
      </select></label><button type="button" disabled={loading} onClick={reload}>{loading ? 'Atualizando…' : 'Atualizar'}</button></div>
    </header>
    {error && <div className="dashboard-error" role="alert">{error}{data && ' Os dados abaixo são da última atualização bem-sucedida.'}</div>}
    {!data && loading && <p role="status">Consultando ordens, paradas e execuções…</p>}
    {data && current && reliability && <>
      <p className="pcm-timestamp">Atualizado em {new Date(data.atualizado_em).toLocaleString('pt-BR')}. Use Atualizar para consultar novamente.</p>
      <h2>Situação atual</h2>
      <div className="pcm-metrics">
        <Metric label="Ativos parados" value={current.ativos_parados} note="Equipamentos ativos com parada aberta" />
        <Metric label="Ordens abertas" value={current.ordens_abertas} note="Todas as ordens não encerradas" />
        <Metric label="Ordens críticas" value={current.ordens_criticas} note="Prioridade crítica, ainda abertas" />
        <Metric label="Ordens atrasadas" value={current.ordens_atrasadas} note="Programação vencida, ainda abertas" />
        <Metric label="Preventivas próximas" value={current.preventivas_proximas} note="Programadas para os próximos 7 dias" />
        <Metric label="Backlog estimado" value={`${number(current.backlog_horas_estimadas)} h`} note={`${current.ordens_abertas} ordens · ${current.ordens_sem_estimativa} sem estimativa`} />
        <Metric label="Técnicos em atividade" value={current.tecnicos_em_atividade} note="Pessoas distintas em execução ativa" />
      </div>
      <h2>Confiabilidade · últimos {days} dias</h2>
      <div className="pcm-metrics">
        <Metric label="MTTR" value={duration(reliability.mttr_segundos)} note="Tempo médio até restaurar falhas concluídas" />
        <Metric label="MTBF" value={duration(reliability.mtbf_segundos)} note="Horas de operação por falha no período" />
        <Metric label="Disponibilidade" value={reliability.disponibilidade_percentual === null ? 'Sem amostra' : `${number(reliability.disponibilidade_percentual)}%`} note={`${reliability.ativos_considerados} ativos · base de calendário 24 h/dia`} />
        <Metric label="Reincidências" value={reliability.reincidencias} note={`Falhas adicionais em ${reliability.ativos_reincidentes} equipamentos`} />
      </div>
      <div className="pcm-tables">
        <section><h2>Falhas por setor</h2>{data.falhas_por_setor.length ? <table><thead><tr><th>Setor</th><th>Falhas</th></tr></thead><tbody>{data.falhas_por_setor.map(row => <tr key={row.setor_id}><td>{row.setor_nome}</td><td>{row.falhas}</td></tr>)}</tbody></table> : <p>Nenhuma falha registrada no período.</p>}</section>
        <section><h2>Falhas por equipamento</h2>{data.falhas_por_ativo.length ? <table><thead><tr><th>Equipamento / setor</th><th>Falhas</th></tr></thead><tbody>{data.falhas_por_ativo.map(row => <tr key={row.ativo_id}><td><strong>{row.ativo_tag} · {row.ativo_nome}</strong><small>{row.setor_nome}</small></td><td>{row.falhas}</td></tr>)}</tbody></table> : <p>Nenhuma falha registrada no período.</p>}</section>
        <section><h2>Próximas preventivas</h2>{data.preventivas.length ? <table><thead><tr><th>Ordem / equipamento</th><th>Programação</th></tr></thead><tbody>{data.preventivas.map(row => <tr key={row.id}><td>{row.codigo}<small>{row.ativo_tag}</small></td><td>{new Date(row.programada_para).toLocaleString('pt-BR')}</td></tr>)}</tbody></table> : <p>Nenhuma preventiva programada para os próximos 7 dias.</p>}</section>
        <section><h2>Equipe em execução</h2>{data.tecnicos.length ? <table><thead><tr><th>Técnico</th><th>Execuções</th></tr></thead><tbody>{data.tecnicos.map(row => <tr key={row.id}><td>{row.nome}</td><td>{row.execucoes}</td></tr>)}</tbody></table> : <p>Nenhum técnico com execução em andamento.</p>}</section>
      </div>
      <details className="pcm-method"><summary>Como os indicadores são calculados</summary>
        <p>Os totais atuais incluem todos os registros abertos dos ativos ativos. O período selecionado filtra somente a confiabilidade e as falhas. As listas mostram até 10 registros; os totais não são limitados.</p>
        <p>Falhas são paradas não planejadas ou originadas por alerta técnico que começaram no período. Reincidência significa uma nova falha no mesmo equipamento, sem afirmar que a causa é a mesma.</p>
        <p>A disponibilidade desconta todas as paradas registradas, unindo intervalos sobrepostos. A base é o calendário contínuo dos ativos atualmente ativos, sem calendário de turnos. MTTR usa falhas concluídas até o fim do período; MTBF divide o tempo disponível acumulado pelo número de falhas. Sem falhas, os tempos ficam sem amostra.</p>
        <p>O backlog soma a duração estimada dos planos de todas as ordens abertas. Não desconta avanço parcial e não representa horas-homem.</p>
      </details>
    </>}
  </section>
}
