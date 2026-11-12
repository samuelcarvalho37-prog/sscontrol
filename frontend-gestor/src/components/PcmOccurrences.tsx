import { useCallback, useEffect, useState } from "react";
import { getGestorOccurrences } from "../services/api/gestor";
import { decidePcmOccurrence } from "../services/api/interventions";
import type { GestorOccurrence } from "../types/gestor";

export function PcmOccurrences({
  onCreateOrder,
  canManage = true,
}: {
  canManage?: boolean;
  onCreateOrder: (occurrence: GestorOccurrence) => void;
}) {
  const [items, setItems] = useState<GestorOccurrence[]>([]);
  const [selected, setSelected] = useState<GestorOccurrence | null>(null);
  const [decision, setDecision] = useState<"TRATAR" | "AGENDAR" | "RECUSAR">(
    "TRATAR",
  );
  const [note, setNote] = useState("");
  const [scheduled, setScheduled] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const rows = await getGestorOccurrences(signal, "");
      if (!signal?.aborted) setItems(rows);
    } catch (cause) {
      if (!signal?.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível consultar as ocorrências.",
        );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  return (
    <section className="pcm-tracking-occurrences">
      <header>
        <h2>Ocorrências da produção</h2>
        <button
          type="button"
          disabled={busy || loading}
          onClick={() => void load()}
        >
          Atualizar
        </button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {loading ? <p role="status">Consultando ocorrências…</p> : null}
      {selected ? (
        <form
          className="pcm-tracking-form"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            void decidePcmOccurrence(
              selected.id,
              decision,
              note,
              decision === "AGENDAR" && scheduled
                ? new Date(scheduled).toISOString()
                : undefined,
            )
              .then(async () => {
                setSelected(null);
                await load();
              })
              .catch((cause) =>
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Decisão não confirmada.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <h3>
            {selected.titulo} · {selected.ativo_nome || selected.ativo_tag}
          </h3>
          <p className="wide">{selected.descricao}</p>
          <label>
            Decisão
            <select
              value={decision}
              disabled={busy}
              onChange={(event) =>
                setDecision(event.target.value as typeof decision)
              }
            >
              <option value="TRATAR">Tratar agora</option>
              <option value="AGENDAR">Agendar tratamento</option>
              <option value="RECUSAR">Recusar ocorrência</option>
            </select>
          </label>
          {decision === "AGENDAR" ? (
            <label>
              Data do tratamento
              <input
                type="datetime-local"
                required
                value={scheduled}
                disabled={busy}
                onChange={(event) => setScheduled(event.target.value)}
              />
            </label>
          ) : null}
          <label className="wide">
            Motivo e orientação à produção
            <textarea
              required
              minLength={10}
              maxLength={4000}
              value={note}
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <footer className="wide">
            <button
              type="button"
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              Cancelar
            </button>
            <button type="submit" disabled={busy}>
              Confirmar decisão
            </button>
          </footer>
        </form>
      ) : (
        <div className="pcm-tracking-orders">
          {items.map((item) => {
            const closed = ["RESOLVED", "CLOSED", "CANCELLED"].includes(
              item.status,
            );
            return (
              <article key={item.id} className="pcm-occurrence-row">
                <div>
                  <strong>{item.titulo}</strong>
                  <p>
                    {[item.ativo_tag, item.ativo_nome]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <small>
                    {item.status === "CANCELLED"
                      ? "Recusada"
                      : item.ordem_servico_id
                        ? "OS criada"
                        : item.tratamento_agendado_para
                          ? `Tratamento: ${new Date(String(item.tratamento_agendado_para)).toLocaleString("pt-BR")}`
                          : item.status === "IN_TREATMENT"
                            ? "Em tratamento"
                            : item.status === "AGUARDANDO_ANALISE"
                              ? "Aguardando análise"
                              : item.status}
                  </small>
                  {item.decisao_observacao ? (
                    <p>{String(item.decisao_observacao)}</p>
                  ) : null}
                </div>
                {canManage && !closed && !item.ordem_servico_id ? (
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(item);
                        setNote("");
                        setScheduled("");
                        setDecision("TRATAR");
                        setError("");
                      }}
                    >
                      Analisar
                    </button>
                    <button type="button" onClick={() => onCreateOrder(item)}>
                      Criar OS
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
          {!loading && !items.length ? (
            <p>Nenhuma ocorrência recebida.</p>
          ) : null}
          <small>Exibindo até 100 ocorrências recentes.</small>
        </div>
      )}
    </section>
  );
}
