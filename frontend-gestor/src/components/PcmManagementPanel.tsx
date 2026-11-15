import { useEffect, useRef, useState } from "react";
import { callApi } from "../services/api/client";
import { getGestorToken } from "../services/api/config";
import "./pcm-management.css";

type Amount = number | string;
export interface ManagementReport {
  mes_atual: string;
  orcamentos_externos?: { mes: string; valor: Amount }[];
  custos_equipamentos?: {
    tag: string;
    nome: string;
    total: Amount;
    pendencias: number;
  }[];
  pendencias?: { prioridade: string; abertas: number; atrasadas: number }[];
  assinaturas_pendentes?: {
    id: string;
    codigo: string;
    titulo: string;
    asset_tag: string;
    line_name: string;
  }[];
  paradas?: {
    line_id: string;
    line_name: string;
    asset_tag: string;
    asset_name: string;
    paradas: number;
    segundos: Amount;
  }[];
  planejamento?: {
    horas_planejadas: Amount;
    horas_totais: Amount;
    sem_prazo: number;
  };
  metas: {
    periodo: string;
    previstas: number;
    vencimento_ate_hoje: number;
    no_prazo: number;
    com_atraso: number;
    vencidas_abertas: number;
    futuras: number;
    cumprimento_percentual: number | null;
  }[];
  custos_linhas: {
    line_id: string;
    line_name: string;
    sector_name: string;
    materiais: Amount;
    mao_obra_interna: Amount;
    externos: Amount;
    total: Amount;
    pendencias: number;
  }[];
  lancamentos: {
    work_order_id: string;
    operational_code: string;
    title: string;
    line_id: string;
    line_name: string;
    asset_tag: string;
    asset_name: string;
    category: string;
    provider: string | null;
    event_at: string;
    amount: Amount | null;
  }[];
  externos_mensais: {
    mes: string;
    mao_obra: Amount;
    pecas: Amount;
    outros: Amount;
    nao_classificado: Amount;
    pendencias: number;
  }[];
  corretivas_recorrentes: {
    asset_id: string;
    asset_tag: string;
    asset_name: string;
    line_name: string;
    corretivas: number;
  }[];
  corretivas_linhas: {
    line_id: string;
    line_name: string;
    sector_name: string;
    corretivas: number;
    equipamentos: number;
  }[];
  esperas: { motivo: string; ocorrencias: number; segundos: Amount }[];
}
const money = (v: Amount | null | undefined) =>
  v == null
    ? "Valor pendente"
    : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const category: Record<string, string> = {
  MATERIAL: "Peças do estoque",
  INTERNAL_LABOR: "Mão de obra interna",
  EXTERNAL_LABOR: "Mão de obra externa",
  EXTERNAL_PARTS: "Peças do prestador",
  EXTERNAL_OTHER: "Outros externos",
  EXTERNAL_UNCLASSIFIED: "Externo não classificado",
};
type Rate = {
  id: string;
  nome: string;
  custo_hora: Amount;
  vigente_desde: string;
};
export function PcmManagementPanel({
  report,
  onOpenOrder,
}: {
  report: ManagementReport;
  onOpenOrder: (id: string) => void;
}) {
  const [budgetMonth, setBudgetMonth] = useState(report.mes_atual),
    [budgetInput, setBudgetInput] = useState(""),
    [budgetSaved, setBudgetSaved] = useState<Amount | null>(
      report.orcamentos_externos?.find((b) => b.mes === report.mes_atual)
        ?.valor ?? null,
    );
  const saveBudget = async () => {
    setBusy(true);
    setNotice("");
    try {
      await callApi("external-budget.save", {
        token: getGestorToken(),
        mes: budgetMonth,
        valor: Number(budgetInput),
      });
      if (budgetMonth === report.mes_atual) setBudgetSaved(Number(budgetInput));
      setBudgetInput("");
      setNotice("Orçamento registrado com histórico de alteração.");
    } catch (e) {
      setNotice(
        e instanceof Error
          ? e.message
          : "Não foi possível registrar o orçamento.",
      );
    } finally {
      setBusy(false);
    }
  };
  const ledgerRef = useRef<HTMLDetailsElement>(null);
  const [year, month] = report.mes_atual.split("-").map(Number);
  const prevKey = new Date(Date.UTC(year, month - 2, 1))
    .toISOString()
    .slice(0, 7);
  const previous = report.externos_mensais.find((m) => m.mes === prevKey);
  const current = report.externos_mensais.find(
    (m) => m.mes === report.mes_atual,
  );
  const annual = report.externos_mensais
    .filter((m) => m.mes.startsWith(report.mes_atual.slice(0, 4)))
    .reduce((sum, m) => sum + Number(m.mao_obra), 0);
  const [line, setLine] = useState(""),
    [rates, setRates] = useState<Rate[]>([]),
    [people, setPeople] = useState<{ id: string; nome: string }[]>([]);
  const [user, setUser] = useState(""),
    [amount, setAmount] = useState(""),
    [date, setDate] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (line)
      ledgerRef.current?.scrollIntoView({
        block: "start",
        behavior: "instant",
      });
  }, [line]);
  useEffect(() => {
    setBudgetMonth(report.mes_atual);
  }, [report.mes_atual]);
  useEffect(() => {
    setBudgetSaved(
      report.orcamentos_externos?.find((b) => b.mes === report.mes_atual)
        ?.valor ?? null,
    );
  }, [report.mes_atual, report.orcamentos_externos]);
  const load = async () => {
    setBusy(true);
    setNotice("");
    try {
      const r = await callApi<{
        taxas: Rate[];
        pessoas: { id: string; nome: string }[];
      }>("labor-rates.list", { token: getGestorToken() });
      setRates(r.data?.taxas ?? []);
      setPeople(r.data?.pessoas ?? []);
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Não foi possível consultar custos.",
      );
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setNotice("");
    try {
      await callApi("labor-rates.create", {
        token: getGestorToken(),
        usuario_id: user,
        custo_hora: Number(amount),
        vigente_desde: date ? new Date(date).toISOString() : null,
      });
      setAmount("");
      setDate("");
      await load();
      setNotice(
        "Nova vigência registrada. Períodos de trabalho já iniciados mantêm o custo anterior.",
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="pcm-management"
      aria-label="Custos e metas de manutenção"
    >
      <header>
        <span className="pcm-section-kicker">GESTÃO DA MANUTENÇÃO</span>
        <h2>Custos, metas e recorrência</h2>
        <p>
          Custos e corretivas seguem o período dos indicadores. Metas usam mês e
          ano atuais, no horário de Brasília.
        </p>
      </header>
      <div className="pcm-management__goals">
        <article>
          <h3>Mão de obra externa · mês atual</h3>
          <strong>{money(current?.mao_obra ?? 0)}</strong>
          <p>
            {budgetSaved == null
              ? "Orçamento mensal não cadastrado"
              : "Orçamento mensal: " +
                money(budgetSaved) +
                " · Saldo: " +
                money(Number(budgetSaved) - Number(current?.mao_obra ?? 0))}
          </p>
          {budgetSaved != null &&
          Number(current?.mao_obra ?? 0) > Number(budgetSaved) ? (
            <p role="status">Mão de obra externa acima do orçamento.</p>
          ) : null}
          <p>Acumulado anual: {money(annual)}</p>
          <p>
            Mês anterior: {money(previous?.mao_obra ?? 0)} · Diferença:{" "}
            {money(
              Number(current?.mao_obra ?? 0) - Number(previous?.mao_obra ?? 0),
            )}
          </p>
          <p>
            Não classificado no mês: {money(current?.nao_classificado ?? 0)} ·{" "}
            {current?.pendencias ?? 0} preço(s) pendente(s)
          </p>
        </article>
        {[...report.metas]
          .sort((a, b) => b.periodo.localeCompare(a.periodo))
          .map((g) => (
            <article key={g.periodo}>
              <h3>
                {g.periodo === "MES" ? "Meta mensal" : "Meta anual acumulada"}
              </h3>
              <strong>
                {g.cumprimento_percentual == null
                  ? "Sem vencimentos"
                  : `${Number(g.cumprimento_percentual).toLocaleString("pt-BR")}% no prazo`}
              </strong>
              <progress
                max={100}
                value={g.cumprimento_percentual ?? 0}
                aria-label={`Cumprimento ${g.periodo}`}
              />
              <p>
                {g.previstas} previstas · {g.vencimento_ate_hoje} com vencimento
                até hoje
              </p>
              <p>
                {g.no_prazo} concluídas no prazo · {g.com_atraso} com atraso ·{" "}
                {g.vencidas_abertas} vencidas abertas · {g.futuras} futuras
              </p>
            </article>
          ))}
      </div>
      <details open>
        <summary>Custos por linha / sistema</summary>
        <p>
          Valores conhecidos por data do consumo, serviço ou término do período
          individual de trabalho. Custos sem preço não são considerados zero.
        </p>
        <div className="pcm-management__table">
          <table>
            <thead>
              <tr>
                <th>Linha / sistema</th>
                <th>Peças</th>
                <th>Equipe interna</th>
                <th>Terceiros</th>
                <th>Total conhecido</th>
                <th>Pendências</th>
              </tr>
            </thead>
            <tbody>
              {report.custos_linhas.map((c) => (
                <tr key={c.line_id}>
                  <td>
                    <button onClick={() => setLine(c.line_id)}>
                      {c.line_name}
                    </button>
                    <small>{c.sector_name}</small>
                  </td>
                  <td>{money(c.materiais)}</td>
                  <td>{money(c.mao_obra_interna)}</td>
                  <td>{money(c.externos)}</td>
                  <td>{money(c.total)}</td>
                  <td>{c.pendencias || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!report.custos_linhas.length ? (
            <p>Sem lançamentos no período.</p>
          ) : null}
        </div>
      </details>
      <details>
        <summary>Mão de obra externa — evolução mensal</summary>
        <p>
          Competência pela data do serviço; se ausente, data do registro. Não
          representa pagamentos. Faturas antigas ou mistas sem discriminação
          ficam separadas.
        </p>
        <div className="pcm-management__table">
          <table>
            <thead>
              <tr>
                <th>Mês</th>
                <th>Mão de obra</th>
                <th>Peças</th>
                <th>Outros</th>
                <th>Não classificado</th>
                <th>Pendências</th>
              </tr>
            </thead>
            <tbody>
              {report.externos_mensais.map((m) => (
                <tr key={m.mes}>
                  <td>{m.mes}</td>
                  <td>{money(m.mao_obra)}</td>
                  <td>{money(m.pecas)}</td>
                  <td>{money(m.outros)}</td>
                  <td>{money(m.nao_classificado)}</td>
                  <td>{m.pendencias}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!report.externos_mensais.length ? (
            <p>Sem serviços externos registrados no ano.</p>
          ) : null}
        </div>
      </details>
      <details open>
        <summary>Avisos de corretivas recorrentes</summary>
        <p>
          Duas ou mais corretivas no período. A repetição não confirma a mesma
          causa.
        </p>
        {report.corretivas_linhas.map((r) => (
          <p key={r.line_id}>
            <strong>{r.line_name}</strong>: {r.corretivas} corretivas em{" "}
            {r.equipamentos} equipamento(s).
          </p>
        ))}
        {report.corretivas_recorrentes.map((r) => (
          <p key={r.asset_id}>
            <strong>
              {r.asset_tag} · {r.asset_name}
            </strong>{" "}
            — {r.line_name}: {r.corretivas} corretivas.
          </p>
        ))}
        {!report.corretivas_linhas.length ? (
          <p>Sem recorrência no período.</p>
        ) : null}
      </details>
      <details>
        <summary>Tempo em espera por motivo</summary>
        {report.esperas.map((p) => (
          <p key={p.motivo}>
            {p.motivo.replaceAll("_", " ")} · {p.ocorrencias} pausa(s) ·{" "}
            {(Number(p.segundos) / 3600).toFixed(1)} h
          </p>
        ))}
        {!report.esperas.length ? (
          <p>Sem pausas registradas no período.</p>
        ) : null}
      </details>
      <details ref={ledgerRef} open={Boolean(line)}>
        <summary>Lançamentos e OS de origem</summary>
        <label>
          Linha / sistema
          <select value={line} onChange={(e) => setLine(e.target.value)}>
            <option value="">Todas</option>
            {report.custos_linhas.map((c) => (
              <option key={c.line_id} value={c.line_id}>
                {c.line_name}
              </option>
            ))}
          </select>
        </label>
        <p>Até 500 lançamentos mais recentes do período.</p>
        <ul>
          {report.lancamentos
            .filter((e) => !line || e.line_id === line)
            .map((e, i) => (
              <li key={`${e.work_order_id}:${i}`}>
                <button onClick={() => onOpenOrder(e.work_order_id)}>
                  {e.operational_code} · {e.title}
                </button>
                <small>
                  {e.line_name} · {e.asset_tag} ·{" "}
                  {category[e.category] ?? e.category}
                  {e.provider ? ` · ${e.provider}` : ""} ·{" "}
                  {new Date(e.event_at).toLocaleDateString("pt-BR")}
                </small>
                <strong>{money(e.amount)}</strong>
              </li>
            ))}
        </ul>
      </details>
      <details>
        <summary>Equipamentos com maior custo conhecido</summary>
        <p>
          Até 20 equipamentos, considerando todos os lançamentos do período.
        </p>
        <ol>
          {(report.custos_equipamentos ?? []).map((r) => (
            <li key={r.tag}>
              <strong>
                {r.tag} · {r.nome}
              </strong>
              <small>
                {money(r.total)} · {r.pendencias} preço(s) pendente(s)
              </small>
            </li>
          ))}
        </ol>
      </details>
      <details>
        <summary>Paradas por equipamento e linha</summary>
        <p>
          Horas de parada de cada equipamento dentro do período. Paradas
          simultâneas de equipamentos não equivalem ao tempo de parada da linha.
        </p>
        <ul>
          {(report.paradas ?? []).map((p) => (
            <li key={p.asset_tag}>
              <strong>
                {p.line_name} · {p.asset_tag} · {p.asset_name}
              </strong>
              <small>
                {p.paradas} parada(s) ·{" "}
                {(Number(p.segundos) / 3600).toLocaleString("pt-BR", {
                  maximumFractionDigits: 1,
                })}{" "}
                h
              </small>
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>Pendências por criticidade e assinaturas finais</summary>
        {(report.pendencias ?? []).map((p) => (
          <p key={p.prioridade}>
            {(
              {
                CRITICAL: "Crítica",
                HIGH: "Alta",
                MEDIUM: "Média",
                LOW: "Baixa",
              } as Record<string, string>
            )[p.prioridade] ?? p.prioridade}
            : {p.abertas} abertas · {p.atrasadas} atrasadas
          </p>
        ))}
        <h3>Aguardando assinatura final</h3>
        <ul>
          {(report.assinaturas_pendentes ?? []).map((p) => (
            <li key={p.id}>
              <button onClick={() => onOpenOrder(p.id)}>
                {p.codigo} · {p.titulo}
              </button>
              <small>
                {p.asset_tag} · {p.line_name}
              </small>
            </li>
          ))}
        </ul>
        {!report.assinaturas_pendentes?.length ? (
          <p>Sem assinaturas finais pendentes.</p>
        ) : null}
      </details>
      <details>
        <summary>Horas preventivas e demais serviços</summary>
        <p>
          {Number(report.planejamento?.horas_planejadas ?? 0).toLocaleString(
            "pt-BR",
            { maximumFractionDigits: 1 },
          )}{" "}
          h preventivas de{" "}
          {Number(report.planejamento?.horas_totais ?? 0).toLocaleString(
            "pt-BR",
            { maximumFractionDigits: 1 },
          )}{" "}
          h de execução concluída. São horas de execução; a mão de obra
          individual é apurada pelos intervalos de cada participante.
        </p>
        <p>
          Corretiva não significa necessariamente emergência. Este indicador não
          classifica automaticamente uma corretiva como não planejada.
        </p>
      </details>
      <details>
        <summary>Definir orçamento mensal de mão de obra externa</summary>
        <p>
          Compare o orçamento com a mão de obra externa classificada. Custos
          pendentes e faturas não discriminadas podem aumentar o gasto após
          complementação.
        </p>
        <div className="pcm-management__form">
          <label>
            Mês
            <input
              type="month"
              value={budgetMonth}
              onChange={(e) => setBudgetMonth(e.target.value)}
            />
          </label>
          <label>
            Orçamento (R$)
            <input
              type="number"
              min="0"
              step="0.01"
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
            />
          </label>
          <button
            onClick={() => void saveBudget()}
            disabled={
              busy ||
              !budgetMonth ||
              budgetInput === "" ||
              !Number.isFinite(Number(budgetInput)) ||
              Number(budgetInput) < 0
            }
          >
            Salvar orçamento mensal
          </button>
        </div>
        <p role="status">{notice}</p>
      </details>
      <details
        onToggle={(e) => {
          if (e.currentTarget.open && !people.length && !busy) void load();
        }}
      >
        <summary>Custo por hora da equipe — vigências</summary>
        <p>
          Informe o custo-hora aprovado pelo financeiro, sem cadastrar salário.
          Novos valores valem para períodos de trabalho iniciados após a
          vigência; históricos sem valor permanecem pendentes.
        </p>
        <div className="pcm-management__form">
          <label>
            Profissional
            <select value={user} onChange={(e) => setUser(e.target.value)}>
              <option value="">Selecione</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </label>
          <label>
            Custo por hora (R$)
            <input
              type="number"
              min="0"
              max="1000000"
              step="0.0001"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label>
            Vigência (vazio = agora)
            <input
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <button
            disabled={
              busy ||
              !user ||
              amount === "" ||
              !Number.isFinite(Number(amount)) ||
              Number(amount) < 0
            }
            onClick={() => void save()}
          >
            {busy ? "Aguarde…" : "Registrar nova vigência"}
          </button>
        </div>
        <p role="status">{notice}</p>
        <ul>
          {rates.map((r) => (
            <li key={r.id}>
              {r.nome} · {money(r.custo_hora)}/h · desde{" "}
              {new Date(r.vigente_desde).toLocaleString("pt-BR")}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
