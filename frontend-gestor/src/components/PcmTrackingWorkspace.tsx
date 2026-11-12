import "./PcmPlanning.css";
import "./PcmTrackingWorkspace.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Plus, RefreshCw } from "lucide-react";
import {
  getPcmTracking,
  getAdminIntervention,
  saveAdminIntervention,
  sendAdminInterventionForValidation,
} from "../services/api/interventions";
import {
  releaseMaintenanceWorkOrder,
  listActiveTechnicians,
  assignMaintenanceAction,
  requestWorkOrderUpdate,
  type ActiveTechnician,
} from "../services/api/maintenanceAssignments";
import { listAdminEntity } from "../services/api/catalog";
import { listAdminChecklistModels } from "../services/api/checklists";
import type { AdminChecklistPlan } from "../types/checklists";
import { getGestorActionDetail } from "../services/api/gestor";
import type { AdminIntervention } from "../types/interventions";
import type { AdminEntityRecord } from "../types/catalog";
import type { GestorActionDetail } from "../types/gestor";
import type { GestorOccurrence } from "../types/gestor";
import { PcmOccurrences } from "./PcmOccurrences";
import { isTrackingLate, type TrackingFilter } from "./pcmTrackingModel";

const FILTERS: { id: TrackingFilter; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "running", label: "Em execução" },
  { id: "blocked", label: "Paradas / bloqueadas" },
  { id: "late", label: "Programação vencida" },
  { id: "queued", label: "A executar" },
  { id: "completed", label: "Concluídas" },
];
const STATUS_LABELS: Record<string, string> = {
  IN_PROGRESS: "Em execução",
  EM_EXECUCAO: "Em execução",
  PAUSED: "Pausada",
  BLOCKED: "Bloqueada",
  BLOQUEADA: "Bloqueada",
  RELEASED: "Liberada",
  LIBERADA: "Liberada",
  COMPLETED: "Concluída",
  CONCLUIDA: "Concluída",
  OPEN: "Assumida",
  DRAFT: "Rascunho",
  RASCUNHO: "Rascunho",
  AGUARDANDO_LIBERACAO: "Pronta para envio",
  APPROVED: "Pronta para envio",
  AGUARDANDO_VALIDACAO: "Em revisão",
  IN_TECHNICAL_REVIEW: "Em revisão",
  AGUARDANDO_PECA: "Aguardando peça",
  CHANGES_REQUESTED: "Correção solicitada",
  CANCELLED: "Cancelada",
  CANCELADA: "Cancelada",
};
const label = (value: unknown) =>
  STATUS_LABELS[String(value ?? "")] ||
  String(value ?? "")
    .replaceAll("_", " ")
    .toLocaleLowerCase("pt-BR");
const date = (value?: string) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString("pt-BR")
    : "Sem programação";

export function PcmTrackingWorkspace({
  onSessionExpired,
  initialChecklistId,
  canManage = true,
}: {
  onSessionExpired: () => void;
  initialChecklistId?: string;
  canManage?: boolean;
}) {
  const [orders, setOrders] = useState<AdminIntervention[]>([]);
  const [filter, setFilter] = useState<TrackingFilter>("all");
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("");
  const [page, setPage] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [sectors, setSectors] = useState<{ id: string; nome: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<AdminIntervention | null>(null);
  const [detail, setDetail] = useState<GestorActionDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<"orders" | "occurrences">("orders");
  const [qualityValidation, setQualityValidation] = useState(false);
  const [safetyValidation, setSafetyValidation] = useState(false);
  const [validationReason, setValidationReason] = useState('');
  const [origin, setOrigin] = useState<GestorOccurrence | null>(null);
  const [plans, setPlans] = useState<AdminEntityRecord[]>([]);
  const [checklists, setChecklists] = useState<AdminChecklistPlan[]>([]);
  const [technicians, setTechnicians] = useState<ActiveTechnician[]>([]);
  const [planId, setPlanId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("MEDIA");
  const [scheduled, setScheduled] = useState("");
  const [responsible, setResponsible] = useState("");
  const [busy, setBusy] = useState(false);
  const [followup, setFollowup] = useState("");
  const generation = useRef(0);
  const initialSource = useRef(initialChecklistId);
  useEffect(() => {
    if (initialSource.current) {
      const id = initialSource.current;
      initialSource.current = "";
      void beginCreate(null, id);
    }
  }, []);
  const [now, setNow] = useState(Date.now());
  const fail = useCallback(
    (cause: unknown) => {
      if (
        cause instanceof Error &&
        "code" in cause &&
        [
          "AUTH_UNAUTHORIZED",
          "GESTOR_SESSION_MISSING",
          "TOKEN_EXPIRED",
          "AUTH_TOKEN_EXPIRED",
        ].includes(String(cause.code))
      )
        onSessionExpired();
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível consultar o acompanhamento.",
      );
    },
    [onSessionExpired],
  );
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const result = await getPcmTracking(
          filter,
          search,
          sector,
          page,
          signal,
        );
        if (!signal?.aborted) {
          setOrders(result.itens);
          setCounts(result.contadores);
          setSectors(result.setores);
          setSelected((current) => {
            const refreshed =
              current && result.itens.find((item) => item.id === current.id);
            return refreshed ? { ...current, ...refreshed } : current;
          });
          setError("");
          setNow(Date.now());
        }
      } catch (cause) {
        if (!signal?.aborted) fail(cause);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [fail, filter, search, sector, page],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(controller.signal);
    }, 30000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      generation.current++;
    };
  }, [load]);
  async function open(order: AdminIntervention) {
    const request = ++generation.current;
    setSelected(order);
    setDetail(null);
    setError("");
    setResponsible(order.responsavel_id || "");
    setFollowup("");
    setLoading(true);
    try {
      const [record, execution, people] = await Promise.all([
        getAdminIntervention(order.id),
        order.acao_id
          ? getGestorActionDetail(order.acao_id)
          : Promise.resolve(null),
        canManage ? listActiveTechnicians() : Promise.resolve([]),
      ]);
      if (request === generation.current) {
        setSelected({ ...order, ...record });
        setDetail(execution);
        setTechnicians(people);
      }
    } catch (cause) {
      if (request === generation.current) fail(cause);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }
  async function beginCreate(
    occurrence: GestorOccurrence | null = null,
    checklistId?: string,
  ) {
    setView("orders");
    setOrigin(occurrence);
    setQualityValidation(occurrence?.qualidade_solicitada === true);
    setSafetyValidation(occurrence?.seguranca_solicitada === true);
    setValidationReason('');
    setCreating(true);
    setSelected(null);
    setError("");
    setNotice("");
    setBusy(true);
    setTitle(occurrence?.titulo || "");
    setDescription(occurrence?.descricao || "");
    setPlanId("");
    setResponsible("");
    setScheduled("");
    setPriority("MEDIA");
    try {
      const [catalog, people, models] = await Promise.all([
        listAdminEntity("planos"),
        listActiveTechnicians(),
        listAdminChecklistModels(),
      ]);
      setPlans(
        catalog.rows.filter(
          (plan) =>
            String(plan.versao_status).toUpperCase() === "PUBLISHED" &&
            ["ACTIVE", "ATIVO"].includes(String(plan.status).toUpperCase()) &&
            Boolean(plan.versao_id) &&
            (!occurrence?.ativo_id ||
              String(plan.ativo_id) === occurrence.ativo_id),
        ),
      );
      setTechnicians(people);
      setChecklists(
        models.filter(
          (model) =>
            model.operacional &&
            model.versao_id &&
            Number(model.itens_count) > 0 &&
            (!occurrence?.ativo_id || model.ativo_id === occurrence.ativo_id),
        ),
      );
      if (checklistId) {
        const model = models.find(
          (item) => item.id === checklistId && item.operacional,
        );
        if (model?.versao_id) {
          setPlanId(`checklist:${String(model.versao_id)}`);
          setTitle(model.nome);
          setDescription(`Executar o checklist ${model.nome}.`);
        }
      }
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  }
  async function dispatch(order: AdminIntervention) {
    let current = order;
    if (["RASCUNHO", "DRAFT"].includes(current.status)) {
      await sendAdminInterventionForValidation({
        intervencao_id: current.id,
        politica_assinatura: "QUALIDADE_OU_SEGURANCA",
        comentario:
          "Encaminhamento operacional do PCM com validações conforme análise da solicitação.",
        exige_segregacao: "NAO",
      });
      current = await getAdminIntervention(current.id);
    }
    if (["AGUARDANDO_LIBERACAO", "APPROVED"].includes(current.status))
      await releaseMaintenanceWorkOrder(current.id);
    current = await getAdminIntervention(current.id);
    if (
      !["LIBERADA", "RELEASED", "EM_EXECUCAO", "IN_PROGRESS"].includes(
        current.status,
      )
    )
      throw new Error(
        "A OS foi salva, mas ainda não está liberada. Confira a revisão ou a pendência informada antes de reenviar.",
      );
    if (responsible && current.acao_id)
      await assignMaintenanceAction(current.acao_id, responsible);
    return current;
  }
  async function create(event: React.FormEvent) {
    event.preventDefault();
    const checklist = planId.startsWith("checklist:")
      ? checklists.find((item) => String(item.versao_id) === planId.slice(10))
      : undefined;
    const plan =
      checklist || plans.find((item) => String(item.versao_id) === planId);
    if (!plan || title.trim().length < 3 || description.trim().length < 3) {
      setError(
        "Selecione um plano e preencha título e descrição com pelo menos três caracteres.",
      );
      return;
    }
    setBusy(true);
    setError("");
    let saved: AdminIntervention | null = null;
    try {
      saved = await saveAdminIntervention({
        origem: origin ? "OCCURRENCE" : "PCM",
        entidade_origem_id: origin?.id,
        ...(checklist
          ? { checklist_versao_id: String(checklist.versao_id) }
          : { plano_versao_id: planId }),
        tipo: ["CORRETIVA", "CORRECTIVE"].includes(String(plan.tipo))
          ? "CORRETIVA"
          : ["MELHORIA", "IMPROVEMENT"].includes(String(plan.tipo))
            ? "MELHORIA"
            : ["PREDITIVA", "PREDICTIVE"].includes(String(plan.tipo))
              ? "PREDITIVA"
              : "PREVENTIVA",
        titulo: title.trim(),
        descricao: description.trim(),
        prioridade: priority,
        planejada_para: scheduled
          ? new Date(scheduled).toISOString()
          : undefined,
        modo_parada_manutencao: String(
          plan.modo_parada_manutencao ||
            plan.modo_parada ||
            "EXECUTOR_DECISION",
        ),
        exige_liberacao_pos_intervencao: qualityValidation || safetyValidation,
        analise_tecnica: { validacao_qualidade: qualityValidation, validacao_seguranca: safetyValidation, justificativa_validacao: validationReason },
      });
      await dispatch(saved);
      setCreating(false);
      setNotice(
        `OS ${saved.codigo} enviada para execução${responsible ? " ao responsável selecionado" : " à equipe de manutenção"}.`,
      );
      await load();
    } catch (cause) {
      if (saved) {
        setCreating(false);
        setSelected(await getAdminIntervention(saved.id).catch(() => saved));
        setNotice(
          `OS ${saved.codigo} foi salva. Confira o erro de encaminhamento antes de tentar novamente; não é necessário criar outra OS.`,
        );
        await load();
      }
      fail(cause);
    } finally {
      setBusy(false);
    }
  }
  const visible = orders;
  return (
    <main
      className="content pcm-maintenance-workspace pcm-tracking"
      aria-label="Acompanhamento da manutenção"
    >
      <header className="pcm-planning-heading">
        <h1>Acompanhamento</h1>
        <div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || busy}
            aria-label="Atualizar acompanhamento"
          >
            <RefreshCw size={16} />
          </button>
          <button
            type="button"
            onClick={() => void beginCreate()}
            disabled={busy || !canManage}
          >
            <Plus size={16} />
            Criar OS
          </button>
        </div>
      </header>
      <div className="pcm-planning-page">
        <nav className="pcm-tracking-tabs" aria-label="Visão do acompanhamento">
          <button
            type="button"
            aria-pressed={view === "orders"}
            disabled={busy}
            onClick={() => {
              setView("orders");
              setCreating(false);
              setSelected(null);
            }}
          >
            Ordens de serviço
          </button>
          <button
            type="button"
            aria-pressed={view === "occurrences"}
            disabled={busy}
            onClick={() => {
              generation.current++;
              setView("occurrences");
              setCreating(false);
              setSelected(null);
            }}
          >
            Ocorrências
          </button>
        </nav>
        {error ? <p role="alert">{error}</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
        {view === "occurrences" ? (
          <PcmOccurrences
            canManage={canManage}
            onCreateOrder={(occurrence) => void beginCreate(occurrence)}
          />
        ) : creating ? (
          <form
            className="pcm-tracking-form"
            onSubmit={(event) => void create(event)}
          >
            <h2>Nova ordem de serviço</h2>
            <label>
              Plano ou checklist publicado
              <select
                required
                value={planId}
                onChange={(event) => setPlanId(event.target.value)}
                disabled={busy}
              >
                <option value="">Selecione o roteiro do trabalho</option>
                <optgroup label="Checklists prontos para execução">
                  {checklists.map((model) => (
                    <option
                      key={model.id}
                      value={`checklist:${String(model.versao_id)}`}
                    >
                      {model.nome} · {model.ativo_tag || model.ativo_nome}
                    </option>
                  ))}
                </optgroup>
                {plans.map((plan) => (
                  <option
                    key={String(plan.versao_id)}
                    value={String(plan.versao_id)}
                  >
                    {String(plan.nome)} ·{" "}
                    {String(plan.ativo_tag || plan.ativo_nome || "")}
                  </option>
                ))}
              </select>
            </label>
            {!busy && !plans.length && !checklists.length ? (
              <p>
                Publique um checklist ou disponibilize um plano na área de
                Manutenção.
              </p>
            ) : null}
            <label>
              Título
              <input
                required
                minLength={3}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={busy}
              />
            </label>
            <label className="wide">
              Trabalho a executar
              <textarea
                required
                minLength={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={busy}
              />
            </label>              <fieldset className="wide"><legend>Validação após a conclusão técnica</legend>
                <label><input type="checkbox" checked={qualityValidation} onChange={event => setQualityValidation(event.target.checked)} /> Qualidade</label>
                <label><input type="checkbox" checked={safetyValidation} onChange={event => setSafetyValidation(event.target.checked)} /> Segurança</label>
                <p>Acompanhamento não bloqueia o início. As áreas selecionadas assinam após a conclusão técnica.</p>
                <label>Justificativa se alterar a indicação do solicitante<textarea value={validationReason} onChange={event => setValidationReason(event.target.value)} maxLength={4000} /></label>
              </fieldset>
            <label>
              Prioridade
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                disabled={busy}
              >
                {["BAIXA", "MEDIA", "ALTA", "CRITICA"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Programada para
              <input
                type="datetime-local"
                value={scheduled}
                onChange={(event) => setScheduled(event.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              Responsável
              <select
                value={responsible}
                onChange={(event) => setResponsible(event.target.value)}
                disabled={busy}
              >
                <option value="">Disponibilizar para a equipe</option>
                {technicians.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.nome}
                  </option>
                ))}
              </select>
            </label>
            <footer className="wide">
              <button
                type="button"
                disabled={busy}
                onClick={() => setCreating(false)}
              >
                Cancelar
              </button>
              <button
                disabled={busy || (!plans.length && !checklists.length)}
                type="submit"
              >
                {busy ? "Processando…" : "Salvar e enviar para execução"}
              </button>
            </footer>
          </form>
        ) : selected ? (
          <section>
            <button
              type="button"
              onClick={() => {
                generation.current++;
                setSelected(null);
                setDetail(null);
              }}
            >
              <ArrowLeft size={15} />
              Ordens
            </button>
            <h2>
              {selected.codigo} · {selected.titulo}
            </h2>
            <dl className="pcm-tracking-summary">
              {Object.entries({
                Status: label(selected.status),
                Ativo: [selected.ativo_tag, selected.ativo_nome]
                  .filter(Boolean)
                  .join(" · "),
                Localização: [selected.setor_nome, selected.linha_nome]
                  .filter(Boolean)
                  .join(" / "),
                Responsável:
                  selected.responsavel_nome || "Equipe de manutenção",
                Executor: selected.executor_nome || "Ainda não assumida",
                "Motivo da parada":
                  [label(selected.motivo_pausa), selected.detalhe_pausa]
                    .filter(Boolean)
                    .join(" · ") || "Sem pausa registrada",
                Programação: date(selected.planejada_para),
                Checklist: selected.plano_nome || "Não informado",
              }).map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p>{selected.descricao}</p>
            {canManage &&
            ["RASCUNHO", "DRAFT", "AGUARDANDO_LIBERACAO", "APPROVED"].includes(
              selected.status,
            ) ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setError("");
                  void dispatch(selected)
                    .then((record) => {
                      setSelected(record);
                      setNotice("OS disponibilizada para execução.");
                      return load();
                    })
                    .catch(fail)
                    .finally(() => setBusy(false));
                }}
              >
                Enviar para execução
              </button>
            ) : null}
            {canManage &&
            selected.acao_id &&
            !["CONCLUIDA", "COMPLETED", "CANCELADA", "CANCELLED"].includes(
              selected.status,
            ) ? (
              <form
                className="pcm-tracking-followup"
                onSubmit={(event) => {
                  event.preventDefault();
                  setBusy(true);
                  setError("");
                  void assignMaintenanceAction(selected.acao_id!, responsible)
                    .then(async () => {
                      setSelected(await getAdminIntervention(selected.id));
                      setNotice("Responsável atualizado.");
                      await load();
                    })
                    .catch(fail)
                    .finally(() => setBusy(false));
                }}
              >
                <label>
                  Responsável pela execução
                  <select
                    required
                    disabled={busy}
                    value={responsible}
                    onChange={(event) => setResponsible(event.target.value)}
                  >
                    <option value="">Selecione um técnico</option>
                    {technicians.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" disabled={busy || !responsible}>
                  Atribuir responsável
                </button>
              </form>
            ) : null}
            {canManage &&
            !["CONCLUIDA", "COMPLETED", "CANCELADA", "CANCELLED"].includes(
              selected.status,
            ) ? (
              <form
                className="pcm-tracking-followup"
                onSubmit={(event) => {
                  event.preventDefault();
                  setBusy(true);
                  setError("");
                  void requestWorkOrderUpdate(selected.id, followup)
                    .then(() => {
                      setNotice(
                        "Solicitação enviada ao responsável e ao técnico que assumiu a OS.",
                      );
                      setFollowup("");
                    })
                    .catch(fail)
                    .finally(() => setBusy(false));
                }}
              >
                <label>
                  Solicitar atualização ou justificativa de atraso
                  <textarea
                    minLength={10}
                    maxLength={4000}
                    required
                    value={followup}
                    onChange={(event) => setFollowup(event.target.value)}
                    disabled={busy}
                  />
                </label>
                <button type="submit" disabled={busy}>
                  Enviar solicitação
                </button>
              </form>
            ) : null}
            {loading ? <p role="status">Carregando execução…</p> : null}
            {detail ? (
              <>
                <h3>Execução e checklist</h3>
                {detail.execucoes.map((execution, index) => (
                  <p key={execution.id || index}>
                    {String(
                      execution.operador_nome ||
                        execution.usuario_nome ||
                        "Técnico registrado",
                    )}{" "}
                    · {label(execution.status)} ·{" "}
                    {execution.iniciou_em
                      ? date(execution.iniciou_em)
                      : "Início não registrado"}
                    {execution.observacao
                      ? ` · ${String(execution.observacao)}`
                      : ""}
                  </p>
                ))}
                <ul className="pcm-tracking-checklist">
                  {detail.checklist.map((item, index) => (
                    <li key={item.id || index}>
                      <strong>
                        {item.titulo ||
                          item.descricao ||
                          item.pergunta ||
                          `Etapa ${index + 1}`}
                      </strong>
                      <span>
                        {item.resposta ||
                          String(
                            item.valor ??
                              item.resultado ??
                              item.status ??
                              "Pendente",
                          )}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : (
          <>
            <div className="pcm-tracking-kpis">
              {FILTERS.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  aria-pressed={filter === item.id}
                  onClick={() => {
                    setPage(0);
                    setFilter(item.id);
                  }}
                >
                  <span>{item.label}</span>
                  <strong>{counts[item.id] ?? 0}</strong>
                </button>
              ))}
            </div>
            <div className="pcm-tracking-filters">
              <label>
                Buscar OS, ativo ou responsável
                <input
                  type="search"
                  value={search}
                  onChange={(event) => {
                    setPage(0);
                    setSearch(event.target.value);
                  }}
                />
              </label>
              <label>
                Setor
                <select
                  value={sector}
                  onChange={(event) => {
                    setPage(0);
                    setSector(event.target.value);
                  }}
                >
                  <option value="">Todos os setores</option>
                  {sectors.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.nome}
                    </option>
                  ))}
                </select>
              </label>
              <small>
                {loading
                  ? "Atualizando…"
                  : `${counts[filter] ?? 0} ordens · página ${page + 1} · atualização a cada 30 segundos`}
              </small>
            </div>
            <div className="pcm-tracking-pagination">
              <button
                type="button"
                disabled={loading || page === 0}
                onClick={() => setPage((current) => current - 1)}
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={loading || (page + 1) * 50 >= (counts[filter] ?? 0)}
                onClick={() => setPage((current) => current + 1)}
              >
                Próxima
              </button>
            </div>
            <div className="pcm-tracking-orders">
              {visible.map((order) => (
                <button
                  type="button"
                  className="pcm-tracking-order"
                  key={order.id}
                  onClick={() => void open(order)}
                >
                  <div>
                    <strong>
                      {order.codigo} · {order.titulo}
                    </strong>
                    <span>
                      {[order.ativo_tag, order.ativo_nome]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <small>
                      {[order.setor_nome, order.linha_nome]
                        .filter(Boolean)
                        .join(" / ")}
                    </small>
                  </div>
                  <div>
                    <span>{label(order.status)}</span>
                    <small>
                      {order.executor_nome ||
                        order.responsavel_nome ||
                        "Equipe de manutenção"}
                    </small>
                    {order.motivo_pausa ? (
                      <small>
                        {label(order.motivo_pausa)}
                        {order.detalhe_pausa ? " · " + order.detalhe_pausa : ""}
                      </small>
                    ) : null}
                  </div>
                  <div>
                    <span>{date(order.planejada_para)}</span>
                    {isTrackingLate(order, now) ? (
                      <small>Programação vencida</small>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
            {!loading && !visible.length ? (
              <p>Nenhuma ordem corresponde a esta seleção.</p>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
