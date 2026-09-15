import { useEffect, useState } from 'react'

type Choice = { id: string; nome: string; tag?: string }
type Sector = Choice & { linhas: Choice[] }
type Structure = { plantas: (Choice & { setores: Sector[] })[] }
type Assessment = Record<'equipamento_parado' | 'risco_parada' | 'risco_seguranca' | 'impacto_producao' | 'impacto_qualidade' | 'existe_redundancia', boolean | null>
const questions: [keyof Assessment, string][] = [
  ['equipamento_parado', 'O equipamento está parado?'], ['risco_parada', 'Existe risco de parada?'],
  ['risco_seguranca', 'Existe risco de segurança?'], ['impacto_producao', 'Há impacto na produção?'],
  ['impacto_qualidade', 'Há impacto na qualidade?'], ['existe_redundancia', 'Existe equipamento redundante disponível?'],
]
const blank = (): Assessment => ({ equipamento_parado: null, risco_parada: null, risco_seguranca: null, impacto_producao: null, impacto_qualidade: null, existe_redundancia: null })
const labels = ['Setor', 'Linha', 'Equipamento', 'Problema', 'Situação atual', 'Avaliação', 'Prioridade', 'Descrição e foto', 'Revisar e enviar']
const priorities: Record<string, string> = { CRITICAL: 'Crítica', HIGH: 'Alta', MEDIUM: 'Média', LOW: 'Baixa' }
function displayName(value: string): string {
  return value
    .replace(/\btranporte\b/giu, 'Transporte')
    .replace(/\benbalagens\b/giu, 'Embalagens')
}
function priority(a: Assessment) {
  if (a.risco_seguranca || (a.equipamento_parado && a.impacto_producao && !a.existe_redundancia)) return 'CRITICAL'
  if (a.equipamento_parado || a.impacto_qualidade || (a.risco_parada && !a.existe_redundancia)) return 'HIGH'
  return a.risco_parada || a.impacto_producao ? 'MEDIUM' : 'LOW'
}

export function OccurrenceWizard({ apiUrl, token }: { apiUrl: string; token: string }) {
  const [step, setStep] = useState(0)
  const [sectors, setSectors] = useState<Sector[]>([])
  const [assets, setAssets] = useState<Choice[]>([])
  const [sector, setSector] = useState('')
  const [line, setLine] = useState('')
  const [asset, setAsset] = useState('')
  const [problem, setProblem] = useState('')
  const [situation, setSituation] = useState('')
  const [answers, setAnswers] = useState<Assessment>(blank)
  const [description, setDescription] = useState('')
  const [photo, setPhoto] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [preparingPhoto, setPreparingPhoto] = useState(false)
  const [sent, setSent] = useState('')
  const [reload, setReload] = useState(0)
  const base = apiUrl.replace(/\/+$/, '').replace(/\/v1$/, '')
  const lines = sectors.find(item => item.id === sector)?.linhas ?? []
  async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: signal ?? AbortSignal.timeout(30000) })
    const result = await response.json()
    if (!response.ok || !result.ok) throw new Error(result.error?.message ?? `Não foi possível concluir (HTTP ${response.status}).`)
    return result.data as T
  }
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    void request<Structure>('/v1/cmms/structure?status=ACTIVE', undefined, controller.signal)
      .then(data => setSectors(data.plantas.flatMap(plant => plant.setores.map(item => ({ ...item, nome: `${displayName(plant.nome)} · ${displayName(item.nome)}` })))))
      .catch(cause => { if (!controller.signal.aborted) setError(String(cause.message ?? cause)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [base, token, reload])
  useEffect(() => {
    setAssets([])
    if (!line) return
    const controller = new AbortController()
    setLoading(true); setError('')
    void (async () => {
      let cursor: string | null = null
      const items: Choice[] = []
      do {
        const page: { itens: Choice[]; proximo_cursor: string | null } = await request(`/v1/cmms/assets?linha_id=${line}&status_ciclo_vida=ACTIVE&limite=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, undefined, controller.signal)
        items.push(...page.itens); cursor = page.proximo_cursor
      } while (cursor)
      if (!controller.signal.aborted) setAssets(items)
    })().catch(cause => { if (!controller.signal.aborted) setError(String(cause.message ?? cause)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [line, base, token, reload])
  async function preparePhoto(file?: File) {
    if (!file) return
    setPreparingPhoto(true); setError('')
    let objectUrl = ''
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) throw new Error('Escolha uma foto JPEG, PNG ou WebP de até 15 MB.')
      objectUrl = URL.createObjectURL(file)
      const image = new Image(); image.src = objectUrl; await image.decode()
      const canvas = document.createElement('canvas')
      const scale = Math.min(1, 1280 / Math.max(image.width, image.height))
      canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale))
      const context = canvas.getContext('2d'); if (!context) throw new Error('Não foi possível preparar a foto.')
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height)
      let encoded = canvas.toDataURL('image/jpeg', 0.75)
      for (const quality of [0.6, 0.45, 0.3]) { if (encoded.length <= 410000) break; encoded = canvas.toDataURL('image/jpeg', quality) }
      if (encoded.length > 410000) throw new Error('A foto ainda está grande. Escolha outra imagem.')
      setPhoto(encoded)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível preparar a foto.') }
    finally { if (objectUrl) URL.revokeObjectURL(objectUrl); setPreparingPhoto(false) }
  }
  async function send() {
    setSending(true); setError('')
    try {
      const result = await request<{ id: string; severidade: string }>('/v1/maintenance/occurrences', {
        ativo_id: asset, componente_id: null, tipo: problem, titulo: `${problem} — ${assets.find(item => item.id === asset)?.tag ?? 'Equipamento'}`,
        descricao: description.trim(), severidade: priority(answers), equipamento_parado: answers.equipamento_parado,
        tipo_parada: answers.equipamento_parado ? 'UNPLANNED' : null,
        motivo_parada: answers.equipamento_parado ? description.trim() : null, ocorrida_em: null,
        triagem: { ...answers, situacao_atual: situation.trim() }, ...(photo ? { foto: photo } : {}),
      })
      setSent(`${result.id} · Prioridade ${priorities[result.severidade] ?? result.severidade}`)
      setPhoto('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível enviar. Confira a conexão antes de tentar novamente.') }
    finally { setSending(false) }
  }
  const valid = [!!sector, !!line, !!asset, !!problem, situation.trim().length >= 3, questions.every(([key]) => answers[key] !== null), true, description.trim().length >= 3, true][step]
  const select = (label: string, value: string, choices: Choice[], change: (value: string) => void) => <label style={{ display: 'grid', gap: 8 }}>{label}<select value={value} onChange={event => change(event.target.value)} style={{ padding: 12 }}><option value="">Selecione</option>{choices.map(item => <option key={item.id} value={item.id}>{item.tag ? `${item.tag} · ` : ''}{displayName(item.nome)}</option>)}</select>{!loading && !choices.length && <span>Nenhum registro disponível.</span>}</label>
  return <section style={{ maxWidth: 760, margin: '24px auto', padding: 24, background: '#fff', color: '#102d42', borderRadius: 18, display: 'grid', gap: 20 }}>
    <header><h1>Nova ocorrência</h1><p>Informe o problema para a equipe de manutenção.</p></header>
    {sent ? <><p role="status">Ocorrência enviada: {sent}</p><button onClick={() => { setSent(''); setStep(0); setSector(''); setLine(''); setAsset(''); setProblem(''); setSituation(''); setAnswers(blank()); setDescription('') }}>Registrar outra ocorrência</button></> : <>
      <p aria-live="polite">Etapa {step + 1} de {labels.length} · {labels[step]}</p>
      {loading && <p role="status">Carregando opções…</p>}
      {error && <div role="alert"><p>{error}</p>{step < 3 && <button onClick={() => setReload(value => value + 1)}>Tentar carregar novamente</button>}</div>}
      {step === 0 && select('Setor', sector, sectors, value => { setSector(value); setLine(''); setAsset('') })}
      {step === 1 && select('Linha', line, lines, value => { setLine(value); setAsset('') })}
      {step === 2 && select('Equipamento', asset, assets, setAsset)}
      {step === 3 && select('Tipo de problema', problem, ['Falha mecânica', 'Falha elétrica', 'Vazamento', 'Ruído ou vibração', 'Temperatura', 'Qualidade', 'Segurança', 'Outro'].map(nome => ({ id: nome, nome })), setProblem)}
      {step === 4 && <label>Situação atual<textarea rows={4} maxLength={1000} value={situation} onChange={event => setSituation(event.target.value)} placeholder="Como o equipamento está funcionando agora?" style={{ display: 'block', width: '100%' }} /></label>}
      {step === 5 && questions.map(([key, label]) => <fieldset key={key} style={{ padding: 12 }}><legend>{label}</legend>{[true, false].map(value => <label key={String(value)} style={{ marginRight: 24 }}><input type="radio" name={key} checked={answers[key] === value} onChange={() => setAnswers(current => ({ ...current, [key]: value }))} /> {value ? 'Sim' : 'Não'}</label>)}</fieldset>)}
      {step === 6 && <><h2>Prioridade sugerida: {priorities[priority(answers)]}</h2><p>Risco de segurança e parada com impacto sem redundância são críticos. Parada, impacto na qualidade e risco de parada sem redundância recebem prioridade alta.</p><p>A equipe de manutenção fará a análise técnica.</p></>}
      {step === 7 && <><label>Descrição do problema<textarea rows={5} maxLength={8000} value={description} onChange={event => setDescription(event.target.value)} style={{ display: 'block', width: '100%' }} /></label><label>Foto opcional<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={preparingPhoto} onChange={event => void preparePhoto(event.target.files?.[0])} /></label>{preparingPhoto && <p>Preparando foto…</p>}{photo && <><img src={photo} alt="Foto que será anexada à ocorrência" style={{ width: '100%', maxHeight: 300, objectFit: 'contain' }} /><button onClick={() => setPhoto('')}>Remover foto</button></>}</>}
      {step === 8 && <><h2>Confira o relato</h2><p>{sectors.find(item => item.id === sector)?.nome} → {lines.find(item => item.id === line)?.nome} → {assets.find(item => item.id === asset)?.nome}</p><p>{problem} · Prioridade {priorities[priority(answers)]}</p><p>{situation}</p><ul>{questions.map(([key, label]) => <li key={key}>{label} {answers[key] ? 'Sim' : 'Não'}</li>)}</ul><p style={{ whiteSpace: 'pre-wrap' }}>{description}</p><p>{photo ? 'Foto anexada.' : 'Sem foto.'}</p></>}
      <footer style={{ display: 'flex', gap: 16, justifyContent: 'space-between' }}><button disabled={step === 0 || sending} onClick={() => setStep(value => value - 1)}>Voltar</button>{step < 8 ? <button disabled={!valid || loading || preparingPhoto} onClick={() => { setError(''); setStep(value => value + 1) }}>Continuar</button> : <button disabled={sending} onClick={() => void send()}>{sending ? 'Enviando…' : 'Enviar ocorrência'}</button>}</footer>
    </>}
  </section>
}
