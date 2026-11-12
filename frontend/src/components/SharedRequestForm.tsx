import { useEffect, useRef, useState } from "react";
import { SharedQrScanner } from "./SharedQrScanner";
import { prepareOccurrencePhoto } from "../services/media/prepareOccurrencePhoto";
import {
  assessmentQuestions,
  blankAnswers,
  locationChoices,
  workLabels,
  workPriority,
  type Answers,
  type SharedApi,
  type SharedAsset,
  type SharedRow,
} from "./sharedWorkModel";

export function SharedRequestForm({
  api,
  initial,
  onCancel,
  onSent,
  onInspect,
}: {
  api: SharedApi;
  initial?: SharedRow;
  onCancel: () => void;
  onSent: (id: string) => void;
  onInspect: (row: SharedRow, tab: "requests" | "orders") => void;
}) {
  const report = initial?.relato as
    | { triagem?: Answers & { situacao_atual?: string }; foto?: string }
    | undefined;
  const [step, setStep] = useState(0),
    [assets, setAssets] = useState<SharedAsset[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [plant, setPlant] = useState(""),
    [sector, setSector] = useState(""),
    [line, setLine] = useState(""),
    [asset, setAsset] = useState(String(initial?.ativo_id ?? ""));
  const [title, setTitle] = useState(String(initial?.titulo ?? "")),
    [description, setDescription] = useState(String(initial?.descricao ?? "")),
    [situation, setSituation] = useState(report?.triagem?.situacao_atual ?? "");
  const [kind, setKind] = useState(String(initial?.tipo ?? "CORRECTIVE")),
    [quality, setQuality] = useState(initial?.qualidade === true),
    [safety, setSafety] = useState(initial?.seguranca === true);
  const [answers, setAnswers] = useState<Answers>(
      report?.triagem ?? blankAnswers(),
    ),
    [photo, setPhoto] = useState(report?.foto ?? ""),
    [preparing, setPreparing] = useState(false),
    [scanner, setScanner] = useState(false),
    [qrNotice, setQrNotice] = useState("");
  const [related, setRelated] = useState<{
      requests: SharedRow[];
      orders: SharedRow[];
      requestTotal: number;
      orderTotal: number;
    } | null>(null),
    [relatedError, setRelatedError] = useState("");
  const submission = useRef(crypto.randomUUID()),
    heading = useRef<HTMLHeadingElement>(null),
    fileGeneration = useRef(0);
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        let page: number | null = 1;
        const all: SharedAsset[] = [];
        while (page) {
          const data: { itens: SharedAsset[]; proxima_pagina: number | null } =
            await api<{ itens: SharedAsset[]; proxima_pagina: number | null }>(
              `/assets?pagina=${page}`,
              undefined,
              "GET",
              abort.signal,
            );
          all.push(...data.itens);
          page = data.proxima_pagina;
        }
        if (!abort.signal.aborted) {
          setAssets(all);
          const current = all.find((a) => a.id === initial?.ativo_id);
          if (current) {
            setPlant(current.planta_id);
            setSector(current.setor_id);
            setLine(current.linha_id);
          }
        }
      } catch (cause) {
        if (!abort.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Falha ao carregar localização.",
          );
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      abort.abort();
      fileGeneration.current++;
    };
  }, [api, initial]);
  useEffect(() => {
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: "start" });
  }, [step]);
  useEffect(() => {
    setRelated(null);
    setRelatedError("");
    if (!asset) return;
    const abort = new AbortController();
    void Promise.all([
      api<{ itens: SharedRow[]; total: number }>(
        `/requests?ativo_id=${asset}&situacao=OPEN`,
        undefined,
        "GET",
        abort.signal,
      ),
      api<{ itens: SharedRow[]; total: number }>(
        `/orders?ativo_id=${asset}&situacao=OPEN`,
        undefined,
        "GET",
        abort.signal,
      ),
    ])
      .then(([r, o]) => {
        if (!abort.signal.aborted)
          setRelated({
            requests: r.itens.filter(
              (row) => row.id !== initial?.id && !row.os_id,
            ),
            orders: o.itens,
            requestTotal: r.total,
            orderTotal: o.total,
          });
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setRelatedError(
            "Não foi possível verificar pedidos e OS existentes. Tente novamente antes de enviar.",
          );
      });
    return () => abort.abort();
  }, [asset, api, initial, step === 4]);
  async function resolve(code: string) {
    const data = await api<{ ativo_id: string; componente_id: string | null }>(
      "/resolve-code?" + new URLSearchParams({ codigo: code }),
    );
    const found = assets.find((a) => a.id === data.ativo_id);
    if (!found)
      throw Error(
        "O equipamento não está disponível na sua unidade para solicitação.",
      );
    setPlant(found.planta_id);
    setSector(found.setor_id);
    setLine(found.linha_id);
    setAsset(found.id);
    setScanner(false);
    setQrNotice(
      `Identificado: ${found.tag} · ${found.nome}.${data.componente_id ? " A etiqueta é de componente; a solicitação será do equipamento." : ""}`,
    );
  }
  async function send() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ id: string }>(
        `/requests${initial ? `/${initial.id}` : ""}`,
        {
          ativo_id: asset,
          titulo: title.trim(),
          descricao: description.trim(),
          tipo: kind,
          qualidade: quality,
          seguranca: safety,
          chave_envio: submission.current,
          triagem: { ...answers, situacao_atual: situation.trim() },
          ...(photo ? { foto: photo } : {}),
        },
        initial ? "PUT" : "POST",
      );
      onSent(result.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha no envio.");
    } finally {
      setBusy(false);
    }
  }
  const selected = assets.find((a) => a.id === asset),
    stages = [
      "Local e equipamento",
      "Problema e situação",
      "Avaliação de riscos",
      "Descrição e foto",
      "Revisar e enviar",
    ];
  const valid = [
    !!selected && !!plant && !!sector && !!line,
    title.trim().length >= 3 && situation.trim().length >= 3,
    assessmentQuestions.every(([key]) => answers[key] !== null),
    description.trim().length >= 10,
    true,
  ][step];
  const choices = (
    label: string,
    value: string,
    list: { id: string; nome: string }[],
    change: (value: string) => void,
  ) => (
    <label>
      {label}
      <select
        required
        value={value}
        disabled={busy || loading}
        onChange={(event) => change(event.target.value)}
      >
        <option value="">Selecione</option>
        {list.map((item) => (
          <option key={item.id} value={item.id}>
            {item.nome}
          </option>
        ))}
      </select>
    </label>
  );
  const relatedView = asset ? (
    <aside
      className="shared-work__related"
      aria-label="Trabalhos já registrados para este equipamento"
    >
      <h3>Confira antes de abrir outro pedido</h3>
      {relatedError ? (
        <p role="alert">{relatedError}</p>
      ) : !related ? (
        <p role="status">Consultando trabalhos do equipamento…</p>
      ) : (
        <>
          <p>
            {related.orders.length || related.requests.length
              ? "Já existem trabalhos em aberto. Confira se tratam do mesmo problema."
              : "Nenhum pedido sem OS nem OS em aberto encontrado para este equipamento."}
          </p>
          {[
            ...related.requests.map((row) => ({
              row,
              tab: "requests" as const,
            })),
            ...related.orders.map((row) => ({ row, tab: "orders" as const })),
          ].map(({ row, tab }) => (
            <button
              type="button"
              key={row.id}
              onClick={() => onInspect(row, tab)}
            >
              {String(row.codigo ?? "Solicitação")} · {String(row.titulo)} ·{" "}
              {workLabels[String(row.os_status ?? row.status)] ??
                String(row.status)}
            </button>
          ))}
          {related.orderTotal > 30 || related.requestTotal > 30 ? (
            <p>
              Mostrando os 30 registros mais recentes de cada lista. Consulte
              também o histórico completo.
            </p>
          ) : null}
          <p>
            Uma falha diferente pode ser solicitada normalmente. O PCM avaliará
            a relação com os serviços existentes.
          </p>
        </>
      )}
    </aside>
  ) : null;
  return (
    <section className="shared-work__form" aria-label="Nova solicitação de OS">
      <h2 ref={heading} tabIndex={-1}>
        {initial ? "Corrigir solicitação" : "Solicitar OS"} · {stages[step]}
      </h2>
      <p aria-live="polite">
        Etapa {step + 1} de {stages.length}
      </p>
      <progress max={stages.length} value={step + 1} />
      {error ? (
        <p role="alert" className="shared-work__error">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p role="status">Carregando equipamentos autorizados…</p>
      ) : null}
      {step === 0 ? (
        <>
          <button
            type="button"
            disabled={loading || !assets.length}
            onClick={() => setScanner(true)}
          >
            Ler QR Code
          </button>
          {scanner ? (
            <SharedQrScanner
              onCode={resolve}
              onClose={() => setScanner(false)}
            />
          ) : null}
          {qrNotice ? <p role="status">{qrNotice}</p> : null}
          <p>Ou selecione a localização:</p>
          <div className="shared-work__fields">
            {choices(
              "Planta",
              plant,
              locationChoices(assets, "planta"),
              (value) => {
                setPlant(value);
                setSector("");
                setLine("");
                setAsset("");
                setQrNotice("");
              },
            )}
            {choices(
              "Setor",
              sector,
              locationChoices(assets, "setor", plant),
              (value) => {
                setSector(value);
                setLine("");
                setAsset("");
              },
            )}
            {choices(
              "Linha",
              line,
              locationChoices(assets, "linha", plant, sector),
              (value) => {
                setLine(value);
                setAsset("");
              },
            )}
            {choices(
              "Equipamento",
              asset,
              assets
                .filter(
                  (a) =>
                    a.planta_id === plant &&
                    a.setor_id === sector &&
                    a.linha_id === line,
                )
                .map((a) => ({ id: a.id, nome: `${a.tag} · ${a.nome}` })),
              setAsset,
            )}
          </div>
          {!loading && !assets.length ? (
            <p>Nenhum equipamento ativo no seu escopo autorizado.</p>
          ) : null}
          {relatedView}
        </>
      ) : null}
      {step === 1 ? (
        <>
          <label>
            Tipo de trabalho
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              {[
                "CORRECTIVE",
                "PREVENTIVE",
                "LUBRICATION",
                "INSPECTION",
                "IMPROVEMENT",
              ].map((value) => (
                <option key={value} value={value}>
                  {workLabels[value]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Título do problema ou serviço
            <input
              minLength={3}
              maxLength={240}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ex.: Bomba está vazando líquido"
            />
          </label>
          <label>
            Situação atual
            <textarea
              maxLength={1000}
              value={situation}
              onChange={(event) => setSituation(event.target.value)}
              placeholder="Como o equipamento está funcionando agora?"
            />
          </label>
        </>
      ) : null}
      {step === 2 ? (
        <>
          {assessmentQuestions.map(([key, label]) => (
            <fieldset key={key}>
              <legend>{label}</legend>
              {[true, false].map((value) => (
                <label key={String(value)}>
                  <input
                    type="radio"
                    name={key}
                    checked={answers[key] === value}
                    onChange={() =>
                      setAnswers((current) => ({ ...current, [key]: value }))
                    }
                  />
                  {value ? "Sim" : "Não"}
                </label>
              ))}
            </fieldset>
          ))}
          <p>
            Prioridade sugerida:{" "}
            <strong>{workLabels[workPriority(answers)]}</strong>. O PCM fará a
            avaliação técnica.
          </p>
          <fieldset>
            <legend>Indicação de validação ao final</legend>
            <label>
              <input
                type="checkbox"
                checked={quality}
                onChange={(event) => setQuality(event.target.checked)}
              />
              Qualidade
            </label>
            <label>
              <input
                type="checkbox"
                checked={safety}
                onChange={(event) => setSafety(event.target.checked)}
              />
              Segurança
            </label>
            <p>
              As áreas acompanham o serviço. A presença não bloqueia o início de
              uma OS liberada.
            </p>
          </fieldset>
        </>
      ) : null}
      {step === 3 ? (
        <>
          <label>
            Descrição da necessidade
            <textarea
              minLength={10}
              maxLength={8000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label>
            Foto opcional
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              disabled={preparing}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const generation = ++fileGeneration.current;
                setPreparing(true);
                setError("");
                void prepareOccurrencePhoto(file)
                  .then((value) => {
                    if (generation === fileGeneration.current) setPhoto(value);
                  })
                  .catch((cause) => {
                    if (generation === fileGeneration.current)
                      setError(cause.message);
                  })
                  .finally(() => {
                    if (generation === fileGeneration.current)
                      setPreparing(false);
                  });
              }}
            />
          </label>
          {preparing ? <p role="status">Preparando foto…</p> : null}
          {photo ? (
            <>
              <img
                className="shared-work__photo"
                src={photo}
                alt="Foto que será anexada ao pedido"
              />
              <button type="button" onClick={() => setPhoto("")}>
                Remover foto
              </button>
            </>
          ) : null}
        </>
      ) : null}
      {step === 4 ? (
        <>
          <h3>{title}</h3>
          <p>
            {selected?.planta} → {selected?.setor} → {selected?.linha} →{" "}
            {selected?.tag} · {selected?.nome}
          </p>
          <p>
            {workLabels[kind]} · Prioridade sugerida{" "}
            {workLabels[workPriority(answers)]}
          </p>
          <p>{situation}</p>
          <ul>
            {assessmentQuestions.map(([key, label]) => (
              <li key={key}>
                {label} <strong>{answers[key] ? "Sim" : "Não"}</strong>
              </li>
            ))}
          </ul>
          <p className="shared-work__multiline">{description}</p>
          <p>
            Validação indicada:{" "}
            {[quality ? "Qualidade" : "", safety ? "Segurança" : ""]
              .filter(Boolean)
              .join(" + ") || "Nenhuma"}
          </p>
          {photo ? (
            <img
              className="shared-work__photo"
              src={photo}
              alt="Foto do relato para revisão"
            />
          ) : null}
          {relatedView}
          <p>
            O envio registra a solicitação para análise do PCM. Não libera
            execução nem altera a condição física do equipamento.
          </p>
        </>
      ) : null}
      <footer>
        <button type="button" disabled={busy || preparing} onClick={onCancel}>
          Cancelar
        </button>
        {step > 0 ? (
          <button
            type="button"
            disabled={busy || preparing}
            onClick={() => {
              setScanner(false);
              setStep((value) => value - 1);
            }}
          >
            Voltar
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy || loading || preparing || !valid}
          onClick={() => {
            setError("");
            setScanner(false);
            if (step < 4) setStep((value) => value + 1);
            else void send();
          }}
        >
          {busy ? "Enviando…" : step === 4 ? "Enviar ao PCM" : "Continuar"}
        </button>
      </footer>
    </section>
  );
}
