import { useMemo, useState } from "react";
import {
  saveGestorTechnicalAnalysis,
  sendGestorTechnicalAnalysis,
  requiresSeparateTechnicalAnalysisDispatch,
} from "../services/api/gestor";
import type {
  GestorOccurrence,
  GestorTechnicalBrief,
  GestorTechnicalStep,
} from "../types/gestor";
import {
  AlertIcon,
  CheckIcon,
  ChevronRightIcon,
  ShieldIcon,
  ValidationIcon,
  WrenchIcon,
} from "./Icons";

interface TechnicalAnalysisDialogProps {
  occurrence: GestorOccurrence;
  onClose: () => void;
  onChanged: (message: string) => Promise<void>;
}

type AnalysisStage = "context" | "plan" | "execution";

function upper(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleUpperCase("pt-BR");
}

function defaultCause(occurrence: GestorOccurrence): string {
  const text =
    `${occurrence.titulo ?? ""} ${occurrence.descricao ?? ""}`.toLocaleLowerCase(
      "pt-BR",
    );
  if (text.includes("ruído") || text.includes("vibra")) {
    return "Desgaste, desalinhamento ou fixação inadequada";
  }
  if (
    text.includes("temperatura") ||
    text.includes("quente") ||
    text.includes("aquec")
  ) {
    return "Lubrificação, ventilação ou carga fora da condição esperada";
  }
  if (text.includes("vazamento") || text.includes("pressão")) {
    return "Perda de vedação, conexão solta ou componente pressurizado degradado";
  }
  if (text.includes("não liga") || text.includes("eletr")) {
    return "Falha de alimentação, comando, proteção ou intertravamento";
  }
  return "A confirmar por inspeção técnica no equipamento";
}

function defaultSteps(occurrence: GestorOccurrence): GestorTechnicalStep[] {
  const asset = occurrence.ativo_id || "equipamento";
  return [
    {
      ordem: 1,
      titulo: "Preparar e isolar",
      descricao: `Identificar ${asset}, confirmar autorização e aplicar as medidas de segurança.`,
    },
    {
      ordem: 2,
      titulo: "Inspecionar a condição",
      descricao:
        "Verificar o ponto relatado, registrar parâmetros e coletar evidências antes da intervenção.",
    },
    {
      ordem: 3,
      titulo: "Corrigir ou estabilizar",
      descricao:
        "Executar somente a atividade autorizada e registrar qualquer desvio de escopo.",
    },
    {
      ordem: 4,
      titulo: "Testar e liberar",
      descricao:
        "Confirmar o resultado, anexar evidências e registrar a condição operacional final.",
    },
  ];
}

function defaultBrief(occurrence: GestorOccurrence): GestorTechnicalBrief {
  const source =
    `${occurrence.titulo ?? ""} ${occurrence.descricao ?? ""}`.toLocaleLowerCase(
      "pt-BR",
    );
  const electrical = source.includes("eletr") || source.includes("não liga");
  const atHeight = source.includes("altura");
  const nrs = ["NR-12"];
  if (electrical) nrs.unshift("NR-10");
  if (atHeight) nrs.push("NR-35");

  return {
    situacao:
      occurrence.descricao ||
      occurrence.titulo ||
      "Anormalidade registrada pelo Operador.",
    causa_provavel: defaultCause(occurrence),
    resultado_esperado:
      "Eliminar ou controlar a anormalidade, comprovar a condição segura e registrar o retorno operacional.",
    riscos: [
      {
        tipo: upper(occurrence.severidade || "OPERACIONAL"),
        titulo: "Risco operacional",
        descricao:
          "Interromper a atividade se a condição observada exceder o escopo autorizado.",
      },
    ],
    seguranca: [
      "Confirmar autorização, condição segura da área e identificação do equipamento.",
      electrical
        ? "Desenergizar, bloquear e testar ausência de tensão antes da intervenção."
        : "Isolar as fontes de energia aplicáveis antes de acessar a zona de risco.",
      "Não executar atividades fora do escopo; comunicar qualquer desvio ao responsável.",
    ],
    nrs,
    ferramentas: [
      {
        tipo: "INSPECAO",
        nome: "Instrumento de medição compatível com o diagnóstico",
      },
      { tipo: "REGISTRO", nome: "Dispositivo para evidência fotográfica" },
    ],
    etapas: defaultSteps(occurrence),
    evidencias_requeridas: [
      "Foto da condição encontrada",
      "Registro do teste ou medição final",
    ],
    criterio_aceite:
      "Equipamento em condição segura, sem a anormalidade relatada e com evidências registradas.",
  };
}

export function TechnicalAnalysisDialog({
  occurrence,
  onClose,
  onChanged,
}: TechnicalAnalysisDialogProps) {
  const initialBrief = useMemo(() => defaultBrief(occurrence), [occurrence]);
  const [stage, setStage] = useState<AnalysisStage>("context");
  const [title, setTitle] = useState(
    `Análise técnica — ${occurrence.titulo || occurrence.id}`,
  );
  const [diagnosis, setDiagnosis] = useState(initialBrief.situacao);
  const [probableCause, setProbableCause] = useState(
    initialBrief.causa_provavel,
  );
  const [recommendation, setRecommendation] = useState(
    "Realizar inspeção orientada, tratar a causa confirmada e validar o retorno operacional.",
  );
  const [expectedResult, setExpectedResult] = useState(
    initialBrief.resultado_esperado,
  );
  const [acceptance, setAcceptance] = useState(initialBrief.criterio_aceite);
  const [steps, setSteps] = useState<GestorTechnicalStep[]>(
    initialBrief.etapas,
  );
  const [editSteps, setEditSteps] = useState(false);
  const [recommendChecklist, setRecommendChecklist] = useState(true);
  const [recommendOrder, setRecommendOrder] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function buildBrief(): GestorTechnicalBrief {
    return {
      ...initialBrief,
      situacao: diagnosis.trim(),
      causa_provavel: probableCause.trim(),
      resultado_esperado: expectedResult.trim(),
      criterio_aceite: acceptance.trim(),
      etapas: steps
        .map((step, index) => ({
          ordem: index + 1,
          titulo: step.titulo.trim(),
          descricao: step.descricao.trim(),
        }))
        .filter((step) => step.titulo && step.descricao),
    };
  }

  function goTo(next: AnalysisStage) {
    setError("");
    if (
      stage === "context" &&
      (diagnosis.trim().length < 5 || probableCause.trim().length < 5)
    ) {
      setError("Confirme a situação e a causa provável antes de avançar.");
      return;
    }
    if (
      stage === "plan" &&
      (recommendation.trim().length < 5 ||
        expectedResult.trim().length < 5 ||
        (!recommendChecklist && !recommendOrder))
    ) {
      setError("Defina a recomendação, o resultado e ao menos uma demanda.");
      return;
    }
    setStage(next);
  }

  function updateStep(index: number, patch: Partial<GestorTechnicalStep>) {
    setSteps((current) =>
      current.map((step, stepIndex) =>
        stepIndex === index ? { ...step, ...patch } : step,
      ),
    );
  }

  async function submit() {
    setError("");
    const brief = buildBrief();
    if (brief.etapas.length === 0 || acceptance.trim().length < 5) {
      setError("Mantenha ao menos uma etapa e um critério de aceite.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await saveGestorTechnicalAnalysis({
        ocorrencia_id: occurrence.id,
        ativo_id: occurrence.ativo_id,
        titulo: title.trim(),
        diagnostico: diagnosis.trim(),
        risco: initialBrief.riscos.map((risk) => risk.descricao).join(" "),
        causa_provavel: probableCause.trim(),
        recomendacao: recommendation.trim(),
        recomenda_checklist: recommendChecklist,
        recomenda_os: recommendOrder,
        prioridade: occurrence.severidade || "MEDIA",
        relatorio_tecnico: brief,
      });
      if (requiresSeparateTechnicalAnalysisDispatch()) {
        await sendGestorTechnicalAnalysis(result.analise.id);
      }
      await onChanged(
        "Análise estruturada enviada ao Administrador com etapas, segurança e critérios de aceite.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível enviar a análise.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="review-overlay" role="presentation">
      <section
        className="review-dialog technical-analysis-dialog manager-analysis-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="technical-analysis-title"
      >
        <header className="review-dialog__header">
          <div>
            <span className="eyebrow">
              ANÁLISE ASSISTIDA · {occurrence.ativo_id || "SEM ATIVO"}
            </span>
            <h2 id="technical-analysis-title">
              Transformar ocorrência em demanda
            </h2>
            <p>{occurrence.titulo || occurrence.id}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>

        <nav className="manager-analysis-stages" aria-label="Etapas da análise">
          {(
            [
              ["context", "1", "Diagnóstico"],
              ["plan", "2", "Recomendação"],
              ["execution", "3", "Execução"],
            ] as Array<[AnalysisStage, string, string]>
          ).map(([id, number, label]) => (
            <button
              className={stage === id ? "is-active" : ""}
              type="button"
              key={id}
              onClick={() => setStage(id)}
            >
              <span>{number}</span>
              {label}
            </button>
          ))}
        </nav>

        <div className="manager-analysis-body">
          {stage === "context" ? (
            <section className="manager-analysis-section">
              <article className="manager-analysis-source">
                <AlertIcon />
                <span>
                  <small>REGISTRO ORIGINAL</small>
                  <strong>
                    {occurrence.titulo || "Ocorrência operacional"}
                  </strong>
                  <p>{occurrence.descricao || "Sem descrição complementar."}</p>
                </span>
                <b>{upper(occurrence.severidade || "MEDIA")}</b>
              </article>
              <div className="manager-analysis-fields">
                <label className="is-wide">
                  <span>Situação confirmada</span>
                  <textarea
                    rows={3}
                    value={diagnosis}
                    onChange={(event) => setDiagnosis(event.target.value)}
                  />
                </label>
                <label>
                  <span>Causa provável</span>
                  <select
                    value={probableCause}
                    onChange={(event) => setProbableCause(event.target.value)}
                  >
                    <option value={initialBrief.causa_provavel}>
                      {initialBrief.causa_provavel}
                    </option>
                    <option value="Desgaste ou falha mecânica">
                      Desgaste ou falha mecânica
                    </option>
                    <option value="Falha elétrica ou de comando">
                      Falha elétrica ou de comando
                    </option>
                    <option value="Parâmetro fora da faixa">
                      Parâmetro fora da faixa
                    </option>
                    <option value="Condição operacional inadequada">
                      Condição operacional inadequada
                    </option>
                    <option value="A confirmar por inspeção técnica no equipamento">
                      A confirmar na inspeção
                    </option>
                  </select>
                </label>
                <label>
                  <span>Título da análise</span>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
              </div>
            </section>
          ) : null}

          {stage === "plan" ? (
            <section className="manager-analysis-section">
              <div className="manager-analysis-fields">
                <label className="is-wide">
                  <span>Recomendação técnica</span>
                  <textarea
                    rows={3}
                    value={recommendation}
                    onChange={(event) => setRecommendation(event.target.value)}
                  />
                </label>
                <label className="is-wide">
                  <span>Resultado esperado</span>
                  <textarea
                    rows={2}
                    value={expectedResult}
                    onChange={(event) => setExpectedResult(event.target.value)}
                  />
                </label>
              </div>
              <div className="manager-analysis-demands">
                <button
                  className={recommendChecklist ? "is-selected" : ""}
                  type="button"
                  onClick={() => setRecommendChecklist((current) => !current)}
                >
                  <CheckIcon />
                  <span>
                    <strong>Modelo de checklist</strong>
                    <small>
                      O Admin recebe a estrutura pronta para completar.
                    </small>
                  </span>
                </button>
                <button
                  className={recommendOrder ? "is-selected" : ""}
                  type="button"
                  onClick={() => setRecommendOrder((current) => !current)}
                >
                  <WrenchIcon />
                  <span>
                    <strong>Ordem de serviço</strong>
                    <small>Solicita uma intervenção administrativa.</small>
                  </span>
                </button>
              </div>
            </section>
          ) : null}

          {stage === "execution" ? (
            <section className="manager-analysis-section">
              <div className="manager-briefing-summary">
                <article>
                  <header>
                    <ShieldIcon />
                    <strong>Segurança</strong>
                    <span>{initialBrief.nrs.join(" · ")}</span>
                  </header>
                  <ul>
                    {initialBrief.seguranca.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
                <article>
                  <header>
                    <ValidationIcon />
                    <strong>Fluxo de execução</strong>
                    <button
                      type="button"
                      onClick={() => setEditSteps((current) => !current)}
                    >
                      {editSteps ? "Concluir edição" : "Ajustar"}
                    </button>
                  </header>
                  <div className="manager-analysis-steps">
                    {steps.map((step, index) => (
                      <div key={`${step.ordem}-${index}`}>
                        <b>{String(index + 1).padStart(2, "0")}</b>
                        {editSteps ? (
                          <span>
                            <input
                              value={step.titulo}
                              onChange={(event) =>
                                updateStep(index, {
                                  titulo: event.target.value,
                                })
                              }
                              aria-label={`Título da etapa ${index + 1}`}
                            />
                            <textarea
                              rows={2}
                              value={step.descricao}
                              onChange={(event) =>
                                updateStep(index, {
                                  descricao: event.target.value,
                                })
                              }
                              aria-label={`Descrição da etapa ${index + 1}`}
                            />
                          </span>
                        ) : (
                          <span>
                            <strong>{step.titulo}</strong>
                            <p>{step.descricao}</p>
                          </span>
                        )}
                        {editSteps && steps.length > 1 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setSteps((current) =>
                                current.filter(
                                  (_, stepIndex) => stepIndex !== index,
                                ),
                              )
                            }
                            aria-label={`Remover etapa ${index + 1}`}
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {editSteps ? (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() =>
                        setSteps((current) => [
                          ...current,
                          {
                            ordem: current.length + 1,
                            titulo: "Nova etapa",
                            descricao:
                              "Descreva a atividade e a condição esperada.",
                          },
                        ])
                      }
                    >
                      Adicionar etapa
                    </button>
                  ) : null}
                </article>
              </div>
              <label className="manager-acceptance-field">
                <span>Critério de aceite</span>
                <textarea
                  rows={2}
                  value={acceptance}
                  onChange={(event) => setAcceptance(event.target.value)}
                />
              </label>
            </section>
          ) : null}
        </div>

        {error ? (
          <div className="feedback feedback--error" role="alert">
            {error}
          </div>
        ) : null}

        <footer className="review-dialog__footer manager-analysis-footer">
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancelar
          </button>
          <div>
            {stage !== "context" ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  setStage(stage === "execution" ? "plan" : "context")
                }
              >
                Voltar
              </button>
            ) : null}
            {stage === "context" ? (
              <button
                className="primary-button"
                type="button"
                onClick={() => goTo("plan")}
              >
                Continuar <ChevronRightIcon />
              </button>
            ) : null}
            {stage === "plan" ? (
              <button
                className="primary-button"
                type="button"
                onClick={() => goTo("execution")}
              >
                Revisar execução <ChevronRightIcon />
              </button>
            ) : null}
            {stage === "execution" ? (
              <button
                className="primary-button"
                type="button"
                disabled={submitting}
                onClick={() => void submit()}
              >
                {submitting ? "Enviando…" : "Enviar ao Administrador"}
              </button>
            ) : null}
          </div>
        </footer>
      </section>
    </div>
  );
}
