import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const vite = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
const { PcmExecutiveOverview } = await vite.ssrLoadModule('/src/components/PcmExecutiveOverview.tsx')
const { pcmMonthlyWindows } = await vite.ssrLoadModule('/src/services/api/pcmMonthlyOrders.ts')
const React = await import('react')
const { renderToStaticMarkup } = await import('react-dom/server')
test.after(() => vite.close())

function fixture() {
  return {
    atualizado_em: '2026-11-20T12:00:00Z', atual: { ordens_abertas: 0 },
    confiabilidade: { disponibilidade_percentual: null, ativos_considerados: 0, mttr_segundos: null, mtbf_segundos: null },
    relatorios: { ordens: { concluidas_no_periodo: 0, por_tipo: [] }, gestao: {
      metas: [], custos_linhas: [], externos_mensais: [], mes_atual: '2026-11', corretivas_recorrentes: [],
    } },
  }
}
function render(data) {
  const noop = () => { throw new Error('Rendering must not invoke operations') }
  return renderToStaticMarkup(React.createElement(PcmExecutiveOverview, {
    data, days: '30', assetId: '', assets: [], loading: false,
    onDays: noop, onAsset: noop, onRefresh: noop, onCustomize: noop, onOrders: noop, onOrder: noop,
  }))
}

test('planta sem OS mostra estados vazios e não os valores da arte de demonstração', () => {
  const html = render(fixture())
  assert.match(html, /Nenhum custo de manutenção registrado/)
  assert.match(html, /Sem vencimentos/)
  assert.match(html, /Nenhum alerta no momento/)
  assert.match(html, /Não definido/)
  assert.doesNotMatch(html, /98,7|84\.600|18\.400|NaN|Infinity|PRÉVIA/)
})

test('custos somam linhas reais e preservam os centavos', () => {
  const data = fixture()
  data.relatorios.gestao.custos_linhas = [{ line_id: 'a', line_name: 'Linha A', sector_name: 'Envase', materiais: 75.9, mao_obra_interna: 20, externos: 10.1, total: 106, pendencias: 1 }]
  const html = render(data)
  assert.match(html, /106/)
  assert.match(html, /75,9/)
  assert.match(html, /1 lançamento\(s\) aguardando custo/)
})

test('prazo zero é diferente de prazo sem amostra e orçamento zero é definido', () => {
  const data = fixture()
  data.relatorios.gestao.metas = [{ periodo: 'MES', cumprimento_percentual: 0, no_prazo: 0, vencimento_ate_hoje: 3 }]
  data.relatorios.gestao.orcamentos_externos = [{ mes: '2026-11', valor: 0 }]
  const html = render(data)
  assert.match(html, /Mês atual: 0% no prazo/)
  assert.match(html, /0 de 3 no prazo/)
  assert.match(html, /Ano atual: sem vencimentos/)
  assert.match(html, /Saldo disponível/)
  assert.doesNotMatch(html, /Não definido/)
})

test('alertas usam somente os registros recebidos', () => {
  const data = fixture()
  data.relatorios.gestao.corretivas_recorrentes = [{ asset_id: 'a', asset_tag: 'EQ-01', line_name: 'Linha 01', corretivas: 2 }]
  data.relatorios.ordens.por_tipo = [{ tipo: 'PREVENTIVE', quantidade: 4 }, { tipo: 'CORRECTIVE', quantidade: 2 }]
  const html = render(data)
  assert.match(html, /2 corretivas no período/)
  assert.match(html, /EQ-01/)
  assert.match(html, /Últimos 6 meses/)
})

test('histórico mensal usa seis meses reais contíguos e não consulta datas futuras', () => {
  const now = new Date(2026, 0, 20, 12)
  const windows = pcmMonthlyWindows(now)
  assert.deepEqual(windows.map(item => item.month), ['2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01'])
  assert.equal(windows.at(-1).end, now.toISOString())
  for (let index = 0; index < windows.length - 1; index++) assert.equal(Date.parse(windows[index].end) + 1, Date.parse(windows[index + 1].start))
})
