import { useCallback, useEffect, useRef, useState } from "react";
import "./SharedWorkPanel.css";

type Row = Record<string, unknown> & { id: string };
type Asset = {
  id: string;
  tag: string;
  nome: string;
  setor: string;
  linha: string;
};
const text = (value: unknown) =>
  value == null || value === "" ? "—" : String(value);
const date = (value: unknown) =>
  value ? new Date(String(value)).toLocaleString("pt-BR") : "—";
const labels: Record<string, string> = {
  OPEN: "Aguardando PCM",
  IN_TREATMENT: "Em avaliação pelo PCM",
  DRAFT: "Em preparação pelo PCM",
  APPROVED: "Aprovada pelo PCM",
  RELEASED: "Liberada para execução",
  IN_PROGRESS: "Em execução",
  PAUSED: "Pausada",
  IN_TECHNICAL_REVIEW: "Aguardando validação técnica",
  COMPLETED: "Concluída",
  CANCELLED: "Rejeitada ou cancelada",
  CLOSED: "Encerrada",
  CORRECTIVE: "Corretiva",
  PREVENTIVE: "Preventiva",
  LUBRICATION: "Lubrificação",
  INSPECTION: "Inspeção",
  IMPROVEMENT: "Melhoria",
};
export function SharedWorkPanel({
  apiUrl,
  token,
  capabilities = [],
}: {
  apiUrl: string;
  token: string;
  capabilities?: readonly string[];
}) {
  const [tab, setTab] = useState<"requests" | "orders">("requests"),
    [items, setItems] = useState<Row[]>([]),
    [assets, setAssets] = useState<Asset[]>([]);
  const [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [form, setForm] = useState(false),
    [editId, setEditId] = useState(""),
    [asset, setAsset] = useState(""),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState("");
  const [kind, setKind] = useState("CORRECTIVE"),
    [quality, setQuality] = useState(false),
    [safety, setSafety] = useState(false),
    [detail, setDetail] = useState<Row | null>(null);
  const [observing, setObserving] = useState<Row | null>(null),
    [area, setArea] = useState("QUALITY"),
    [note, setNote] = useState("");
  const key = useRef(crypto.randomUUID());
  const base = apiUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  const canRequest = capabilities.includes("maintenance.shared.request");
  const canQuality = capabilities.includes(
      "maintenance.shared.observe.quality",
    ),
    canSafety = capabilities.includes("maintenance.shared.observe.safety");
  const request = useCallback(
    async <T,>(
      path: string,
      body?: unknown,
      method = body ? "POST" : "GET",
      signal?: AbortSignal,
    ): Promise<T> => {
      const response = await fetch(`${base}/v1/shared${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: signal ?? AbortSignal.timeout(20000),
      });
      const result = await response.json();
      if (!response.ok || !result.ok)
        throw Error(
          result.error?.message ?? "Não foi possível concluir a operação.",
        );
      return result.data as T;
    },
    [base, token],
  );
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const result = await request<{ itens: Row[]; total: number }>(
          `/${tab}?${new URLSearchParams({ busca: query, pagina: String(page) })}`,
          undefined,
          "GET",
          signal,
        );
        if (!signal?.aborted) {
          setItems(result.itens);
          setTotal(result.total);
        }
      } catch (cause) {
        if (!signal?.aborted)
          setError(
            cause instanceof Error ? cause.message : "Falha na consulta.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [request, tab, page, query],
  );
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !form && !observing)
        void load(abort.signal);
    }, 30000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [load, form, observing]);
  async function begin(row?: Row) {
    setError("");
    setNotice("");
    setDetail(null);
    setEditId(row?.id ?? "");
    setTitle(row ? text(row.titulo) : "");
    setDescription(row ? text(row.descricao) : "");
    setAsset(String(row?.ativo_id ?? ""));
    setKind(String(row?.tipo ?? "CORRECTIVE"));
    setQuality(row?.qualidade === true);
    setSafety(row?.seguranca === true);
    key.current = crypto.randomUUID();
    setForm(true);
    try {
      const result = await request<{ itens: Asset[] }>("/assets");
      setAssets(result.itens);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Falha nos equipamentos.",
      );
    }
  }
  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await request<{ id: string }>(
        `/requests${editId ? `/${editId}` : ""}`,
        {
          ativo_id: asset,
          titulo: title.trim(),
          descricao: description.trim(),
          tipo: kind,
          qualidade: quality,
          seguranca: safety,
          chave_envio: key.current,
        },
        editId ? "PUT" : "POST",
      );
      setForm(false);
      setTab("requests");
      setPage(1);
      setNotice(
        `Solicitação ${result.id} enviada para avaliação do PCM. Ainda não está liberada para execução.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha no envio.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="shared-work"
      aria-label="Solicitações e acompanhamento de manutenção"
    >
      <header>
        <div>
          <h1>Solicitações e manutenção</h1>
          <p>
            Acompanhe os serviços da sua unidade e solicite um novo trabalho ao
            PCM.
          </p>
        </div>
        {canRequest && !form ? (
          <button type="button" onClick={() => void begin()}>
            Solicitar OS
          </button>
        ) : null}
      </header>
      {error ? (
        <p role="alert" className="shared-work__error">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="shared-work__notice">
          {notice}
        </p>
      ) : null}
      {form ? (
        <form
          onSubmit={(event) => void send(event)}
          className="shared-work__form"
        >
          <h2>{editId ? "Corrigir solicitação" : "Nova solicitação de OS"}</h2>
          <label>
            Equipamento
            <select
              required
              value={asset}
              onChange={(event) => setAsset(event.target.value)}
              disabled={busy}
            >
              <option value="">Selecione o equipamento da sua unidade</option>
              {assets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.tag} · {item.nome} · {item.setor} / {item.linha}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tipo de trabalho
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              disabled={busy}
            >
              {[
                "CORRECTIVE",
                "PREVENTIVE",
                "LUBRICATION",
                "INSPECTION",
                "IMPROVEMENT",
              ].map((value) => (
                <option key={value} value={value}>
                  {labels[value]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Título
            <input
              required
              minLength={3}
              maxLength={240}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Descreva a necessidade
            <textarea
              required
              minLength={10}
              maxLength={8000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={busy}
            />
          </label>
          <fieldset>
            <legend>Indicação de validação ao final do serviço</legend>
            <label>
              <input
                type="checkbox"
                checked={quality}
                onChange={(event) => setQuality(event.target.checked)}
              />{" "}
              Qualidade
            </label>
            <label>
              <input
                type="checkbox"
                checked={safety}
                onChange={(event) => setSafety(event.target.checked)}
              />{" "}
              Segurança
            </label>
            <p>
              O PCM confirma as exigências na análise. A confirmação de
              acompanhamento não impede o técnico de iniciar uma OS liberada.
            </p>
          </fieldset>
          <footer>
            <button
              type="button"
              disabled={busy}
              onClick={() => setForm(false)}
            >
              Cancelar
            </button>
            <button disabled={busy || !asset || assets.length === 0}>
              {busy ? "Enviando…" : "Enviar ao PCM"}
            </button>
          </footer>
        </form>
      ) : (
        <>
          <nav aria-label="Visões do acompanhamento">
            <button
              type="button"
              aria-pressed={tab === "requests"}
              onClick={() => {
                setTab("requests");
                setPage(1);
                setDetail(null);
              }}
            >
              Solicitações
            </button>
            <button
              type="button"
              aria-pressed={tab === "orders"}
              onClick={() => {
                setTab("orders");
                setPage(1);
                setDetail(null);
              }}
            >
              Ordens de serviço
            </button>
          </nav>
          <form
            className="shared-work__search"
            onSubmit={(event) => {
              event.preventDefault();
              setQuery(search);
              setPage(1);
            }}
          >
            <label>
              Buscar título, código ou equipamento
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                maxLength={160}
              />
            </label>
            <button>Buscar</button>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
            >
              Atualizar
            </button>
          </form>
          {loading ? <p role="status">Consultando…</p> : null}
          {!loading && !items.length ? (
            <p>Nenhum registro neste filtro ou no seu escopo autorizado.</p>
          ) : null}
          <div className="shared-work__list">
            {items.map((row) => (
              <article key={row.id}>
                <header>
                  <h2>{text(row.codigo ?? row.os_codigo ?? row.titulo)}</h2>
                  <strong>
                    {row.devolvida
                      ? "Devolvida para correção"
                      : (labels[String(row.os_status ?? row.status)] ??
                        text(row.status))}
                  </strong>
                </header>
                <p>{text(row.titulo)}</p>
                <p>
                  <b>{text(row.ativo_tag)}</b> · {text(row.ativo_nome)}{" "}
                  {row.setor ? `· ${text(row.setor)} / ${text(row.linha)}` : ""}
                </p>
                <dl>
                  <div>
                    <dt>Solicitante</dt>
                    <dd>{text(row.solicitante)}</dd>
                  </div>
                  {tab === "requests" ? (
                    <>
                      <div>
                        <dt>Tipo solicitado</dt>
                        <dd>{labels[String(row.tipo)] ?? text(row.tipo)}</dd>
                      </div>
                      <div>
                        <dt>PCM</dt>
                        <dd>{text(row.pcm)}</dd>
                      </div>
                      <div>
                        <dt>Pedido</dt>
                        <dd>{row.id}</dd>
                      </div>
                      <div>
                        <dt>Validação indicada</dt>
                        <dd>
                          {[
                            row.qualidade ? "Qualidade" : "",
                            row.seguranca ? "Segurança" : "",
                          ]
                            .filter(Boolean)
                            .join(" + ") || "Não indicada"}
                        </dd>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <dt>PCM responsável pela OS</dt>
                        <dd>{text(row.pcm)}</dd>
                      </div>
                      <div>
                        <dt>Liberada</dt>
                        <dd>{date(row.liberada_em)}</dd>
                      </div>
                      <div>
                        <dt>Encerrada</dt>
                        <dd>{date(row.encerrada_em)}</dd>
                      </div>
                      <div>
                        <dt>Responsável designado</dt>
                        <dd>{text(row.responsavel)}</dd>
                      </div>
                      <div>
                        <dt>Executor</dt>
                        <dd>{text(row.executor)}</dd>
                      </div>
                      <div>
                        <dt>Programada</dt>
                        <dd>{date(row.programada_para)}</dd>
                      </div>
                      <div>
                        <dt>Início real</dt>
                        <dd>{date(row.iniciada_em)}</dd>
                      </div>
                      <div>
                        <dt>Conclusão técnica</dt>
                        <dd>{date(row.conclusao_tecnica_em)}</dd>
                      </div>
                    </>
                  )}
                </dl>
                {row.parecer ? (
                  <p>
                    <b>Parecer do PCM:</b> {text(row.parecer)}
                  </p>
                ) : null}
                {tab === "requests" &&
                row.devolvida &&
                row.minha &&
                canRequest ? (
                  <button type="button" onClick={() => void begin(row)}>
                    Corrigir meu pedido
                  </button>
                ) : null}
                {tab === "orders" ? (
                  <>
                    <p>
                      Qualidade:{" "}
                      {Array.isArray(row.acompanhamentos) &&
                      row.acompanhamentos.some(
                        (entry: Record<string, unknown>) =>
                          entry.area === "QUALITY",
                      )
                        ? "acompanhamento registrado"
                        : "sem acompanhamento registrado"}{" "}
                      · Segurança:{" "}
                      {Array.isArray(row.acompanhamentos) &&
                      row.acompanhamentos.some(
                        (entry: Record<string, unknown>) =>
                          entry.area === "SAFETY",
                      )
                        ? "acompanhamento registrado"
                        : "sem acompanhamento registrado"}
                    </p>
                    <p>
                      <b>Acompanhamento:</b>{" "}
                      {Array.isArray(row.acompanhamentos) &&
                      row.acompanhamentos.length
                        ? row.acompanhamentos
                            .map(
                              (entry: Record<string, unknown>) =>
                                `${entry.area === "QUALITY" ? "Qualidade" : "Segurança"}: ${text(entry.nome)} (${date(entry.data)}) — ${text(entry.observacao)}`,
                            )
                            .join("; ")
                        : "Nenhum acompanhamento registrado"}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setError("");
                        void request<Row>(`/orders/${row.id}`)
                          .then(setDetail)
                          .catch((cause) => setError(cause.message));
                      }}
                    >
                      Histórico e validações
                    </button>
                    {canQuality || canSafety ? (
                      <button
                        type="button"
                        onClick={() => {
                          setObserving(row);
                          setArea(canQuality ? "QUALITY" : "SAFETY");
                          setNote("");
                        }}
                      >
                        Registrar acompanhamento
                      </button>
                    ) : null}
                  </>
                ) : null}
              </article>
            ))}
          </div>
          <footer>
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((value) => value - 1)}
            >
              Anterior
            </button>
            <span>
              Página {page} · {total} registros
            </span>
            <button
              type="button"
              disabled={page * 30 >= total || loading}
              onClick={() => setPage((value) => value + 1)}
            >
              Próxima
            </button>
          </footer>
          {detail ? (
            <section
              className="shared-work__detail"
              aria-label="Histórico e validações"
            >
              <h2>{text(detail.titulo)}</h2>
              <p>{text(detail.descricao)}</p>
              <p>
                Política de assinatura: {text(detail.politica_assinatura)} ·{" "}
                {text(detail.assinaturas_realizadas)} de{" "}
                {text(detail.assinaturas_exigidas)}
              </p>
              <h3>Validações registradas</h3>
              {Array.isArray(detail.assinaturas) &&
              detail.assinaturas.length ? (
                detail.assinaturas.map(
                  (item: Record<string, unknown>, i: number) => (
                    <p key={i}>
                      {text(item.nome)} · {text(item.perfil)} ·{" "}
                      {date(item.data)} · {text(item.significado)}
                    </p>
                  ),
                )
              ) : (
                <p>Nenhuma assinatura registrada.</p>
              )}
              <h3>Execuções</h3>
              {Array.isArray(detail.execucoes)
                ? detail.execucoes.map(
                    (item: Record<string, unknown>, i: number) => (
                      <p key={i}>
                        {text(item.executor)} · {text(item.status)} ·{" "}
                        {date(item.inicio)} até {date(item.conclusao)}
                      </p>
                    ),
                  )
                : null}
              <button type="button" onClick={() => setDetail(null)}>
                Fechar detalhes
              </button>
            </section>
          ) : null}
        </>
      )}
      {observing ? (
        <form
          className="shared-work__form"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            void request(`/orders/${observing.id}/observations`, {
              area,
              observacao: note.trim(),
            })
              .then(async () => {
                setObserving(null);
                setNotice(
                  "Acompanhamento registrado. Este registro não substitui a assinatura final.",
                );
                await load();
              })
              .catch((cause) => setError(cause.message))
              .finally(() => setBusy(false));
          }}
        >
          <h2>Registrar acompanhamento · {text(observing.codigo)}</h2>
          <label>
            Área
            <select
              value={area}
              onChange={(event) => setArea(event.target.value)}
            >
              {canQuality ? <option value="QUALITY">Qualidade</option> : null}
              {canSafety ? <option value="SAFETY">Segurança</option> : null}
            </select>
          </label>
          <label>
            Observação
            <textarea
              required
              minLength={3}
              maxLength={4000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <p>
            Registra sua presença ou observação neste horário. A validação final
            continua na fila de assinaturas da sua área.
          </p>
          <footer>
            <button
              type="button"
              disabled={busy}
              onClick={() => setObserving(null)}
            >
              Cancelar
            </button>
            <button disabled={busy}>Registrar</button>
          </footer>
        </form>
      ) : null}
    </section>
  );
}
