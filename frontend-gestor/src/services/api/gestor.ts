import type {
  GestorAction,
  GestorActionAudit,
  GestorActionDetail,
  GestorAsset,
  GestorAssetCatalog,
  GestorAssetJourney,
  GestorAssetParameter,
  GestorParameterActionRequest,
  GestorChecklistModel,
  GestorChecklistModelDecision,
  GestorChecklistModelDecisionResult,
  GestorChecklistModelDetail,
  GestorComponent,
  GestorDecision,
  GestorDecisionResult,
  GestorKpiBase,
  GestorNotification,
  GestorTechnicalBrief,
  GestorTechnicalAnalysisInput,
  GestorTechnicalContext,
  GestorTechnicalDemand,
  GestorTechnicalKpis,
  GestorOccurrence,
  GestorOverview,
  GestorStop,
} from "../../types/gestor";
import { API_TIMEOUT_MS, ApiRequestError, callApi } from "./client";
import { getApiTransport, getGestorToken, usesNodeApi } from "./config";

interface ActionListData {
  total: number;
  status: string[];
  acoes: GestorAction[];
}

interface StopListData {
  total: number;
  paradas: GestorStop[];
}

interface OccurrenceListData {
  total: number;
  ocorrencias: GestorOccurrence[];
}

interface ChecklistModelListData {
  total: number;
  modelos: GestorChecklistModel[];
}

interface TechnicalDemandListData {
  total: number;
  demandas: GestorTechnicalDemand[];
}

interface NotificationListData {
  total: number;
  notificacoes?: GestorNotification[];
}

interface AdminListData<T> {
  entidade: string;
  total: number;
  rows: T[];
}

const OPEN_STOP_STATUSES = new Set([
  "PARADA_ABERTA",
  "MANUTENCAO_EM_EXECUCAO",
  "AGUARDANDO_RETORNO_OPERACIONAL",
]);

const OPEN_TECHNICAL_DEMAND_STATUSES = [
  "ABERTA",
  "EM_TRIAGEM",
  "EM_VALIDACAO_TECNICA",
  "AGUARDANDO_ASSINATURA",
  "ENCAMINHADA",
] as const;

const FINAL_TECHNICAL_DEMAND_STATUSES = new Set([
  "DEVOLVIDA_ADMIN",
  "APROVADA_TECNICAMENTE",
  "LIBERADA_OPERACAO",
  "CONCLUIDA",
  "CANCELADA",
]);

function normalizedStatus(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleUpperCase("pt-BR");
}

function gestorToken(): string {
  const token = getGestorToken();
  if (token) return token;

  throw new ApiRequestError(
    "Sessão do gestor não encontrada. Entre novamente.",
    "GESTOR_SESSION_MISSING",
  );
}

async function readGestorData<T>(
  action: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await callApi<T>(
    action,
    {
      token: gestorToken(),
      ...payload,
    },
    signal,
    {
      timeoutMs: API_TIMEOUT_MS.DETAIL_READ,
      dedupe: true,
    },
  );

  if (!response.data) {
    throw new ApiRequestError(
      "A API não retornou dados para " + action + ".",
      "GESTOR_EMPTY_RESPONSE",
      { action },
    );
  }

  return response.data;
}

async function writeGestorData<T>(
  action: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const response = await callApi<T>(
    action,
    {
      token: gestorToken(),
      ...payload,
    },
    undefined,
    {
      timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE,
    },
  );

  if (!response.data) {
    throw new ApiRequestError(
      "A API não confirmou a operação " + action + ".",
      "GESTOR_EMPTY_RESPONSE",
      { action },
    );
  }

  return response.data;
}

export async function getGestorActions(
  signal?: AbortSignal,
): Promise<GestorAction[]> {
  const data = await readGestorData<ActionListData>(
    "gestor.listar_acoes",
    {
      status: "PENDENTE,EM_EXECUCAO,AGUARDANDO_VALIDACAO,BLOQUEADA",
      limite: 200,
    },
    signal,
  );

  return Array.isArray(data.acoes) ? data.acoes : [];
}

export async function getGestorCompletedActions(
  signal?: AbortSignal,
): Promise<GestorAction[]> {
  const data = await readGestorData<ActionListData>(
    "gestor.listar_acoes",
    {
      status: "CONCLUIDA",
      limite: 200,
    },
    signal,
  );

  return Array.isArray(data.acoes) ? data.acoes : [];
}

export async function getGestorStops(
  signal?: AbortSignal,
): Promise<GestorStop[]> {
  const data = await readGestorData<StopListData>(
    "gestor.listar_paradas",
    { limite: 200 },
    signal,
  );

  return Array.isArray(data.paradas) ? data.paradas : [];
}

export async function getGestorOccurrences(
  signal?: AbortSignal,
  status = "AGUARDANDO_ANALISE",
): Promise<GestorOccurrence[]> {
  const data = await readGestorData<OccurrenceListData>(
    "gestor.listar_ocorrencias",
    {
      status,
      limite: 200,
    },
    signal,
  );

  return Array.isArray(data.ocorrencias) ? data.ocorrencias : [];
}

export async function createGestorStopTreatment(stopId: string): Promise<{
  created: boolean;
  already_exists: boolean;
  parada_id: string;
  occurrence: GestorOccurrence;
}> {
  return writeGestorData("gestor.paradas.criar_tratamento", {
    parada_id: stopId,
  });
}

export async function getUnreadNotificationCount(
  signal?: AbortSignal,
): Promise<number> {
  if (usesNodeApi()) {
    const data = await readGestorData<NotificationListData>(
      "gestor.notificacoes.listar",
      { somente_nao_lidas: true, limite: 100 },
      signal,
    );
    return Array.isArray(data.notificacoes) ? data.notificacoes.length : 0;
  }
  const [data, overview] = await Promise.all([
    readGestorData<NotificationListData>(
      "gestor.notificacoes.listar",
      { limite: 300 },
      signal,
    ),
    getGestorOverview(signal),
  ]);
  const notifications = Array.isArray(data.notificacoes)
    ? data.notificacoes
    : [];
  const unreadNotifications = notifications.filter(
    (item) => normalizedStatus(item.status) === "NAO_LIDA",
  );
  const entities = new Set(
    notifications.map(
      (item) =>
        `${normalizedStatus(item.entidade_tipo)}:${item.entidade_id ?? ""}`,
    ),
  );
  const treatmentByStop = new Map(
    overview.occurrenceHistory
      .filter((item) => item.parada_id)
      .map((item) => [String(item.parada_id), item]),
  );
  const occurrenceCount = overview.occurrences.filter(
    (item) => !entities.has(`OCORRENCIAS_OPERACIONAIS:${item.id}`),
  ).length;
  const stopCount = overview.openStops.filter((stop) => {
    const treatment = treatmentByStop.get(stop.id);
    const key = treatment
      ? `OCORRENCIAS_OPERACIONAIS:${treatment.id}`
      : `PARADAS_EQUIPAMENTO:${stop.id}`;
    return !entities.has(key);
  }).length;
  return unreadNotifications.length + occurrenceCount + stopCount;
}

export async function getGestorNotifications(
  signal?: AbortSignal,
): Promise<GestorNotification[]> {
  const data = await readGestorData<NotificationListData>(
    "gestor.notificacoes.listar",
    { limite: 300 },
    signal,
  );

  return Array.isArray(data.notificacoes) ? data.notificacoes : [];
}

export function markGestorNotificationRead(
  notification: Pick<
    GestorNotification,
    | "id"
    | "tipo"
    | "titulo"
    | "mensagem"
    | "entidade_tipo"
    | "entidade_id"
    | "prioridade"
  >,
): Promise<{
  read: boolean;
  already_read?: boolean;
  notificacao_id: string;
}> {
  const virtual = notification.id.startsWith("virtual-");
  return writeGestorData("gestor.notificacoes.marcar_lida", {
    notificacao_id: virtual ? "" : notification.id,
    entidade_tipo: notification.entidade_tipo ?? "",
    entidade_id: notification.entidade_id ?? "",
    tipo: notification.tipo,
    titulo: notification.titulo,
    mensagem: notification.mensagem ?? "",
    prioridade: notification.prioridade ?? "MEDIA",
  });
}

export async function getGestorOverview(
  signal?: AbortSignal,
): Promise<GestorOverview> {
  const [actions, completedActions, stops, occurrenceHistory, kpis] =
    await Promise.all([
      getGestorActions(signal),
      getGestorCompletedActions(signal),
      getGestorStops(signal),
      getGestorOccurrences(signal, ""),
      getGestorTechnicalKpis(signal),
    ]);
  const occurrences = occurrenceHistory.filter(
    (occurrence) =>
      normalizedStatus(occurrence.status) === "AGUARDANDO_ANALISE",
  );

  const statusCount = (status: string) =>
    actions.filter((action) => action.status.trim().toUpperCase() === status)
      .length;

  const validationQueue = actions.filter(
    (action) => action.status.trim().toUpperCase() === "AGUARDANDO_VALIDACAO",
  );

  const openStops = stops.filter((stop) =>
    OPEN_STOP_STATUSES.has(stop.status.trim().toUpperCase()),
  );

  return {
    actions,
    completedActions,
    validationQueue,
    stops,
    openStops,
    occurrences,
    occurrenceHistory,
    kpis,
    counts: {
      pending: statusCount("PENDENTE"),
      executing: statusCount("EM_EXECUCAO"),
      awaitingValidation: validationQueue.length,
      blocked: statusCount("BLOQUEADA"),
      openStops: openStops.length,
      awaitingOccurrences: occurrences.length,
    },
  };
}

export async function getGestorKpis(
  signal?: AbortSignal,
): Promise<GestorKpiBase> {
  return readGestorData<GestorKpiBase>("cmms.kpis_base", {}, signal);
}

export async function getGestorTechnicalKpis(
  signal?: AbortSignal,
): Promise<GestorTechnicalKpis> {
  return getGestorTechnicalKpisForPeriod({}, signal);
}

export interface GestorTechnicalKpiFilters {
  ativo_id?: string;
  componente_id?: string;
  inicio_em?: string;
  fim_em?: string;
}

export async function getGestorTechnicalKpisForPeriod(
  filters: GestorTechnicalKpiFilters,
  signal?: AbortSignal,
): Promise<GestorTechnicalKpis> {
  return readGestorData<GestorTechnicalKpis>(
    "cmms.kpis_tecnicos",
    { ...filters },
    signal,
  );
}

export async function getGestorTechnicalContext(
  signal?: AbortSignal,
): Promise<GestorTechnicalContext> {
  return readGestorData<GestorTechnicalContext>(
    "gestor.contexto_tecnico",
    {},
    signal,
  );
}

export async function getGestorTechnicalDemands(
  signal?: AbortSignal,
): Promise<GestorTechnicalDemand[]> {
  const data = await readGestorData<TechnicalDemandListData>(
    "gestor.demandas.listar",
    {
      status: OPEN_TECHNICAL_DEMAND_STATUSES.join(","),
      limite: 300,
    },
    signal,
  );
  return Array.isArray(data.demandas)
    ? data.demandas.filter(
        (demand) =>
          !FINAL_TECHNICAL_DEMAND_STATUSES.has(normalizedStatus(demand.status)),
      )
    : [];
}

export function assumeGestorTechnicalDemand(
  demandId: string,
): Promise<{ assumed: boolean; demanda: GestorTechnicalDemand }> {
  return writeGestorData("gestor.demandas.assumir", { demanda_id: demandId });
}

export function forwardGestorTechnicalDemand(input: {
  demanda_id: string;
  para_area_id: string;
  para_cargo_id?: string;
  motivo: string;
  parecer?: string;
}): Promise<{ forwarded: boolean; demanda: GestorTechnicalDemand }> {
  return writeGestorData("gestor.demandas.encaminhar", input);
}

export function signGestorTechnicalDemand(
  demandId: string,
  declaration: string,
): Promise<{
  signed: boolean;
  already_signed?: boolean;
  demanda: GestorTechnicalDemand;
}> {
  return writeGestorData("gestor.demandas.assinar", {
    demanda_id: demandId,
    declaracao: declaration,
  });
}

export function validateGestorTechnicalDemand(
  demandId: string,
  opinion: string,
  technicalBrief?: GestorTechnicalBrief,
): Promise<{
  validated: boolean;
  already_validated?: boolean;
  completed: boolean;
  assinaturas_pendentes?: number;
  demanda: GestorTechnicalDemand;
}> {
  return writeGestorData("gestor.demandas.validar", {
    demanda_id: demandId,
    parecer: opinion,
    declaracao: opinion,
    relatorio_tecnico: technicalBrief,
  });
}

export function decideGestorTechnicalDemand(
  demandId: string,
  decision: "APROVAR" | "DEVOLVER_ADMIN" | "LIBERAR_OPERACAO",
  opinion: string,
  technicalBrief?: GestorTechnicalBrief,
): Promise<{ decided: boolean; demanda: GestorTechnicalDemand }> {
  return writeGestorData("gestor.demandas.decidir", {
    demanda_id: demandId,
    decisao: decision,
    parecer: opinion,
    relatorio_tecnico: technicalBrief,
  });
}

export async function saveGestorTechnicalAnalysis(
  analysis: GestorTechnicalAnalysisInput,
): Promise<{ saved: boolean; sent?: boolean; analise: { id: string } }> {
  return writeGestorData("gestor.analises.salvar", { analise: analysis });
}

export function requiresSeparateTechnicalAnalysisDispatch(): boolean {
  return getApiTransport() === "apps-script";
}

export function sendGestorTechnicalAnalysis(
  analysisId: string,
): Promise<{ sent: boolean }> {
  return writeGestorData("gestor.analises.enviar_admin", {
    analise_id: analysisId,
  });
}

export async function getGestorChecklistModels(
  signal?: AbortSignal,
): Promise<GestorChecklistModel[]> {
  const data = await readGestorData<ChecklistModelListData>(
    "gestor.modelos_em_validacao",
    { limite: 200 },
    signal,
  );

  return Array.isArray(data.modelos) ? data.modelos : [];
}

export async function getGestorChecklistModelDetail(
  modelId: string,
  signal?: AbortSignal,
): Promise<GestorChecklistModelDetail> {
  return readGestorData<GestorChecklistModelDetail>(
    "gestor.detalhe_modelo_checklist",
    { plano_id: modelId },
    signal,
  );
}

export async function validateGestorChecklistModel(
  modelId: string,
  decision: GestorChecklistModelDecision,
  justification: string,
): Promise<GestorChecklistModelDecisionResult> {
  return writeGestorData<GestorChecklistModelDecisionResult>(
    "gestor.validar_modelo_checklist",
    {
      plano_id: modelId,
      decisao: decision,
      justificativa: justification.trim(),
    },
  );
}

export async function getGestorAssetCatalog(
  signal?: AbortSignal,
): Promise<GestorAssetCatalog> {
  const [assetData, componentData] = await Promise.all([
    readGestorData<AdminListData<GestorAsset>>(
      "admin.listar",
      { entidade: "ativos", limite: 500 },
      signal,
    ),
    readGestorData<AdminListData<GestorComponent>>(
      "admin.listar",
      { entidade: "componentes", limite: 500 },
      signal,
    ),
  ]);

  return {
    assets: Array.isArray(assetData.rows) ? assetData.rows : [],
    components: Array.isArray(componentData.rows) ? componentData.rows : [],
  };
}

export async function getGestorAssetJourney(
  qrPayload: string,
  _signal?: AbortSignal,
): Promise<GestorAssetJourney> {
  const context = await writeGestorData<GestorAssetJourney>(
    "gestor.dossie_ativo",
    {
      qr_payload: qrPayload,
      limite_historico: 80,
      user_agent: navigator.userAgent,
    },
  );

  return {
    ...context,
    componentes: Array.isArray(context.componentes) ? context.componentes : [],
    acoes_pendentes: Array.isArray(context.acoes_pendentes)
      ? context.acoes_pendentes
      : [],
    historico_recente: Array.isArray(context.historico_recente)
      ? context.historico_recente
      : [],
    historico_manutencao: Array.isArray(context.historico_manutencao)
      ? context.historico_manutencao
      : [],
    parametros_recentes: Array.isArray(context.parametros_recentes)
      ? context.parametros_recentes
      : [],
    parametros_atuais: Array.isArray(context.parametros_atuais)
      ? context.parametros_atuais
      : [],
    ocorrencias_abertas: Array.isArray(context.ocorrencias_abertas)
      ? context.ocorrencias_abertas
      : [],
    parametros_analisados: Array.isArray(context.parametros_analisados)
      ? context.parametros_analisados
      : [],
    regras_parametros: Array.isArray(context.regras_parametros)
      ? context.regras_parametros
      : [],
  };
}

export function registerGestorParameter(input: {
  ativo_id: string;
  componente_id?: string;
  parametro: string;
  valor: number;
  unidade?: string;
}): Promise<{
  saved: boolean;
  parametro: GestorAssetParameter;
}> {
  return writeGestorData("gestor.registrar_parametro", {
    ...input,
    origem: "GESTOR_QR",
    user_agent: navigator.userAgent,
  });
}

export function requestGestorParameterAction(
  input: GestorParameterActionRequest,
): Promise<{
  requested: boolean;
  tipo_solicitacao: string;
  status_parametro: string;
  ocorrencia: GestorOccurrence;
  analise: {
    id: string;
    status: string;
  };
}> {
  return writeGestorData("gestor.parametros.solicitar_acao", {
    ...input,
    user_agent: navigator.userAgent,
  });
}

export async function getGestorActionDetail(
  actionId: string,
  signal?: AbortSignal,
): Promise<GestorActionDetail> {
  return readGestorData<GestorActionDetail>(
    "gestor.detalhe_acao",
    { acao_id: actionId },
    signal,
  );
}

export async function getGestorActionAudit(
  actionId: string,
  signal?: AbortSignal,
): Promise<GestorActionAudit> {
  return readGestorData<GestorActionAudit>(
    "gestor.auditoria_execucao_checklist",
    { acao_id: actionId },
    signal,
  );
}

export async function validateGestorAction(
  actionId: string,
  decision: GestorDecision,
  comment: string,
): Promise<GestorDecisionResult> {
  return writeGestorData<GestorDecisionResult>("gestor.validar_acao", {
    acao_id: actionId,
    decisao: decision,
    comentario: comment.trim(),
  });
}

export function isGestorAuthenticationError(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return false;

  return [
    "AUTH_REQUIRED",
    "AUTH_INVALID",
    "AUTH_EXPIRED",
    "SESSION_EXPIRED",
    "SESSION_INVALID",
    "TOKEN_REQUIRED",
    "TOKEN_EXPIRED",
    "TOKEN_INACTIVE",
    "TOKEN_INVALID",
    "TOKEN_SCOPE_INVALID",
    "USER_INACTIVE",
    "GESTOR_SESSION_MISSING",
    "MOTOR_MAINTENANCE_REQUIRED",
  ].includes(error.code);
}
