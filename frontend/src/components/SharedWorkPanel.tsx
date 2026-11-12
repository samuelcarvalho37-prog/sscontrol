import { useCallback, useEffect, useRef, useState } from "react";
import { SharedRequestForm } from "./SharedRequestForm";
import {
  assessmentQuestions,
  workDate as date,
  workLabels as labels,
  workText as text,
  type SharedApi,
  type SharedRow as Row,
} from "./sharedWorkModel";
import "./SharedWorkPanel.css";

type Tab = "requests" | "orders";
export function SharedWorkPanel({
  apiUrl,
  token,
  capabilities = [],
}: {
  apiUrl: string;
  token: string;
  capabilities?: readonly string[];
}) {
  const [tab, setTab] = useState<Tab>("orders"),
    [items, setItems] = useState<Row[]>([]),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0);
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("ALL"),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [form, setForm] = useState(false),
    [initial, setInitial] = useState<Row | undefined>(),
    [detail, setDetail] = useState<{ row: Row; tab: Tab } | null>(null),
    [detailLoading, setDetailLoading] = useState(false),
    [detailError, setDetailError] = useState("");
  const [observing, setObserving] = useState(false),
    [area, setArea] = useState("QUALITY"),
    [note, setNote] = useState(""),
    [saving, setSaving] = useState(false),
    [revision, setRevision] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    detailAbort = useRef<AbortController | null>(null);
  const base = apiUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  useEffect(() => {
    heading.current?.closest(".app-content")?.scrollTo({ top: 0 });
  }, []);
  const canRequest = capabilities.includes("maintenance.shared.request"),
    canQuality = capabilities.includes("maintenance.shared.observe.quality"),
    canSafety = capabilities.includes("maintenance.shared.observe.safety");
  const api: SharedApi = useCallback(
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
        signal: signal ?? AbortSignal.timeout(30000),
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
      try {
        const result = await api<{ itens: Row[]; total: number }>(
          `/${tab}?${new URLSearchParams({ busca: query, pagina: String(page), situacao: status })}`,
          undefined,
          "GET",
          signal,
        );
        if (!signal?.aborted) {
          setItems(result.itens);
          setTotal(result.total);
          setError("");
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
    [api, tab, page, query, status],
  );
  useEffect(() => {
    if (form) return;
    const abort = new AbortController();
    void load(abort.signal);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !dialog.current?.open)
        void load(abort.signal);
    }, 30000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [load, form, revision]);
  useEffect(() => () => detailAbort.current?.abort(), []);
  function close() {
    detailAbort.current?.abort();
    dialog.current?.close();
    setDetail(null);
    setObserving(false);
    setDetailError("");
  }
  async function inspect(row: Row, source: Tab) {
    detailAbort.current?.abort();
    const abort = new AbortController();
    detailAbort.current = abort;
    setDetail({ row, tab: source });
    setDetailLoading(true);
    setDetailError("");
    setObserving(false);
    if (!dialog.current?.open) dialog.current?.showModal();
    try {
      const result = await api<Row>(
        `/${source}/${row.id}`,
        undefined,
        "GET",
        abort.signal,
      );
      if (!abort.signal.aborted)
        setDetail({ row: { ...row, ...result }, tab: source });
    } catch (cause) {
      if (!abort.signal.aborted)
        setDetailError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível abrir os detalhes.",
        );
    } finally {
      if (!abort.signal.aborted) setDetailLoading(false);
    }
  }
  function begin(row?: Row) {
    close();
    setInitial(row);
    setNotice("");
    setForm(true);
  }
  async function record() {
    if (!detail) return;
    setSaving(true);
    setDetailError("");
    try {
      await api(`/orders/${detail.row.id}/observations`, {
        area,
        observacao: note.trim(),
      });
      setNotice(
        "Acompanhamento registrado. A assinatura final permanece na fila da sua área.",
      );
      close();
      setRevision((v) => v + 1);
    } catch (cause) {
      setDetailError(
        cause instanceof Error
          ? cause.message
          : "Falha ao registrar acompanhamento.",
      );
    } finally {
      setSaving(false);
    }
  }
  const row = detail?.row,
    report = row?.relato as
      | { triagem?: Record<string, unknown>; foto?: string }
      | undefined;
  const observed = Array.isArray(row?.acompanhamentos)
    ? (row.acompanhamentos as Record<string, unknown>[])
    : [];
  return (
    <section
      className="shared-work"
      aria-label="Solicitações e acompanhamento de manutenção"
    >
      <header>
        <div>
          <h1 ref={heading} tabIndex={-1}>
            Solicitações e manutenção
          </h1>
          <p>
            Histórico da unidade, incluindo trabalhos concluídos e pedidos de
            todos os solicitantes.
          </p>
        </div>
        {canRequest && !form ? (
          <button type="button" onClick={() => begin()}>
            Solicitar OS
          </button>
        ) : null}
      </header>
      {notice ? (
        <p role="status" className="shared-work__notice">
          {notice}
        </p>
      ) : null}
      {form ? (
        <SharedRequestForm
          key={initial?.id ?? "new"}
          api={api}
          initial={initial}
          onCancel={() => {
            setForm(false);
            heading.current?.focus();
          }}
          onSent={(id) => {
            setForm(false);
            setInitial(undefined);
            setTab("requests");
            setStatus("ALL");
            setQuery("");
            setSearch("");
            setPage(1);
            setNotice(
              `Solicitação ${id} enviada ao PCM. Aguarde a avaliação e liberação.`,
            );
            setRevision((v) => v + 1);
            heading.current?.focus();
          }}
          onInspect={(r, t) => void inspect(r, t)}
        />
      ) : (
        <>
          <nav aria-label="Visões do acompanhamento">
            {(
              [
                ["orders", "Ordens de serviço"],
                ["requests", "Solicitações"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={tab === value}
                onClick={() => {
                  setTab(value);
                  setPage(1);
                  setItems([]);
                }}
              >
                {label}
              </button>
            ))}
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
                maxLength={160}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label>
              Situação
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
              >
                <option value="ALL">Todas, incluindo concluídas</option>
                <option value="OPEN">Em aberto</option>
                <option value="CLOSED">Concluídas ou encerradas</option>
              </select>
            </label>
            <button>Buscar</button>
            <button
              type="button"
              disabled={loading}
              onClick={() => void load()}
            >
              Atualizar
            </button>
          </form>
          {error ? (
            <p role="alert" className="shared-work__error">
              {error}
            </p>
          ) : null}
          {loading ? <p role="status">Consultando…</p> : null}
          {!loading && !items.length ? (
            <p>Nenhum registro neste filtro ou no seu escopo autorizado.</p>
          ) : null}
          <div className="shared-work__list">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="shared-work__row"
                onClick={() => void inspect(item, tab)}
                aria-label={`Abrir ${item.codigo ?? "solicitação"}: ${item.titulo}`}
              >
                <span>
                  <strong>{text(item.titulo)}</strong>
                  {item.codigo ? <small>{text(item.codigo)}</small> : null}
                </span>
                <span className="shared-work__status">
                  {item.devolvida
                    ? "Devolvida para correção"
                    : (labels[
                        String(
                          item.execucao_status === "PAUSED"
                            ? "PAUSED"
                            : (item.os_status ?? item.status),
                        )
                      ] ?? text(item.status))}
                </span>
                <span aria-hidden="true">›</span>
              </button>
            ))}
          </div>
          <footer>
            <button
              type="button"
              disabled={loading || page <= 1}
              onClick={() => setPage((v) => v - 1)}
            >
              Anterior
            </button>
            <span>
              Página {page} · {total} registros
            </span>
            <button
              type="button"
              disabled={loading || page * 30 >= total}
              onClick={() => setPage((v) => v + 1)}
            >
              Próxima
            </button>
          </footer>
        </>
      )}
      <dialog
        ref={dialog}
        className="shared-work__dialog"
        aria-labelledby="shared-detail-title"
        onCancel={(event) => {
          event.preventDefault();
          if (!saving) close();
        }}
        onClick={(event) => {
          if (event.target === dialog.current && !saving) close();
        }}
      >
        <div className="shared-work__dialog-content">
          <header>
            <div>
              <small>
                {detail?.tab === "orders"
                  ? text(row?.codigo)
                  : "Solicitação ao PCM"}
              </small>
              <h2 id="shared-detail-title">{text(row?.titulo)}</h2>
            </div>
            <button type="button" disabled={saving} onClick={close}>
              Fechar
            </button>
          </header>
          {detailLoading ? <p role="status">Carregando detalhes…</p> : null}
          {detailError ? (
            <p role="alert" className="shared-work__error">
              {detailError}
            </p>
          ) : null}
          {row && !detailLoading && !detailError ? (
            <>
              <p>
                <strong>
                  {row.devolvida
                    ? "Devolvida para correção"
                    : (labels[String(row.os_status ?? row.status)] ??
                      text(row.status))}
                </strong>
              </p>
              <dl>
                {[
                  [
                    "Equipamento",
                    `${text(row.ativo_tag)} · ${text(row.ativo_nome)}`,
                  ],
                  ["Planta", row.planta],
                  ["Setor", row.setor],
                  ["Linha", row.linha],
                  ["Solicitante", row.solicitante],
                  ["PCM", row.pcm],
                  ["Tipo", labels[String(row.tipo ?? row.tipo_trabalho)]],
                  ["Prioridade", labels[String(row.prioridade)]],
                  ["Responsável designado", row.responsavel],
                  ["Executor", row.executor],
                  ["Criada", date(row.criada_em)],
                  ["Programada", date(row.programada_para)],
                  ["Liberada", date(row.liberada_em)],
                  ["Início real", date(row.iniciada_em)],
                  ["Conclusão técnica", date(row.conclusao_tecnica_em)],
                  ["Encerrada", date(row.encerrada_em)],
                ]
                  .filter(([, value]) => value && value !== "—")
                  .map(([label, value]) => (
                    <div key={String(label)}>
                      <dt>{text(label)}</dt>
                      <dd>{text(value)}</dd>
                    </div>
                  ))}
              </dl>
              <h3>Descrição</h3>
              <p className="shared-work__multiline">{text(row.descricao)}</p>
              {row.parecer ? (
                <p>
                  <strong>Parecer do PCM:</strong> {text(row.parecer)}
                </p>
              ) : null}
              {report?.triagem ? (
                <>
                  <h3>Avaliação do solicitante</h3>
                  <p>{text(report.triagem.situacao_atual)}</p>
                  <ul>
                    {assessmentQuestions.map(([key, label]) => (
                      <li key={key}>
                        {label}{" "}
                        <strong>
                          {report.triagem?.[key] === true
                            ? "Sim"
                            : report.triagem?.[key] === false
                              ? "Não"
                              : "Não informado"}
                        </strong>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {report?.foto && /^data:image\/jpeg;base64,/.test(report.foto) ? (
                <img
                  className="shared-work__photo"
                  src={report.foto}
                  alt="Foto anexada pelo solicitante"
                />
              ) : null}
              {detail?.tab === "requests" ? (
                <>
                  <p>
                    Validação indicada:{" "}
                    {[
                      row.qualidade ? "Qualidade" : "",
                      row.seguranca ? "Segurança" : "",
                    ]
                      .filter(Boolean)
                      .join(" + ") || "Não indicada"}
                  </p>
                  <p>Pedido: {row.id}</p>
                  {row.devolvida === true &&
                  row.minha === true &&
                  canRequest &&
                  !detailError ? (
                    <button type="button" onClick={() => begin(row)}>
                      Corrigir meu pedido
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  <h3>Acompanhamento das áreas</h3>
                  {["QUALITY", "SAFETY"].map((value) => (
                    <p key={value}>
                      {labels[value]}:{" "}
                      {observed.some((ob) => ob.area === value)
                        ? "acompanhamento registrado"
                        : "sem acompanhamento registrado"}
                    </p>
                  ))}
                  {observed.map((ob, i) => (
                    <p key={i}>
                      <strong>
                        {labels[String(ob.area)]} · {text(ob.nome)}
                      </strong>{" "}
                      · {date(ob.data)}
                      <br />
                      {text(ob.observacao)}
                    </p>
                  ))}
                  <h3>Validações finais</h3>
                  <p>
                    {row.assinaturas_exigidas
                      ? `${text(row.assinaturas_realizadas)} de ${text(row.assinaturas_exigidas)} assinaturas · ${text(row.politica_assinatura).replaceAll("_", " ")}`
                      : "Sem validação final exigida para esta OS."}
                  </p>
                  {Array.isArray(row.assinaturas)
                    ? row.assinaturas.map(
                        (signature: Record<string, unknown>, i: number) => (
                          <p key={i}>
                            {text(signature.nome)} · {text(signature.perfil)} ·{" "}
                            {date(signature.data)}
                            <br />
                            {text(signature.significado)}
                          </p>
                        ),
                      )
                    : null}
                  <h3>Histórico de execução</h3>
                  {Array.isArray(row.execucoes) && row.execucoes.length ? (
                    row.execucoes.map(
                      (execution: Record<string, unknown>, i: number) => (
                        <p key={i}>
                          <strong>
                            {text(execution.executor)} ·{" "}
                            {labels[String(execution.status)] ??
                              text(execution.status)}
                          </strong>
                          <br />
                          {date(execution.inicio)} até{" "}
                          {date(execution.conclusao)}
                          <br />
                          {text(execution.resultado)}
                        </p>
                      ),
                    )
                  ) : (
                    <p>Nenhuma execução registrada.</p>
                  )}
                  {(canQuality || canSafety) &&
                  Boolean(row.liberada_em) &&
                  row.status !== "CANCELLED" &&
                  !observing ? (
                    <button
                      type="button"
                      onClick={() => {
                        setObserving(true);
                        setArea(canQuality ? "QUALITY" : "SAFETY");
                        setNote("");
                      }}
                    >
                      Registrar acompanhamento
                    </button>
                  ) : null}
                  {observing ? (
                    <form
                      className="shared-work__form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void record();
                      }}
                    >
                      <h3>Registrar acompanhamento</h3>
                      <label>
                        Área
                        <select
                          value={area}
                          disabled={saving}
                          onChange={(event) => setArea(event.target.value)}
                        >
                          {canQuality ? (
                            <option value="QUALITY">Qualidade</option>
                          ) : null}
                          {canSafety ? (
                            <option value="SAFETY">Segurança</option>
                          ) : null}
                        </select>
                      </label>
                      <label>
                        Observação
                        <textarea
                          autoFocus
                          required
                          minLength={3}
                          maxLength={4000}
                          value={note}
                          disabled={saving}
                          onChange={(event) => setNote(event.target.value)}
                        />
                      </label>
                      <p>
                        Este registro documenta o acompanhamento neste horário.
                        Não substitui a assinatura final.
                      </p>
                      <button disabled={saving || note.trim().length < 3}>
                        {saving ? "Registrando…" : "Registrar"}
                      </button>
                    </form>
                  ) : null}
                </>
              )}
            </>
          ) : null}
        </div>
      </dialog>
    </section>
  );
}
