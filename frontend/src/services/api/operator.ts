import type {
  ActiveStopResponseData,
  FinishStopInput,
  FinishStopResponseData,
  ChecklistBatchItemInput,
  ChecklistBatchSaveData,
  EvidenceInput,
  EvidencePhotoUploadInput,
  EvidenceSaveData,
  FinalizationValidationData,
  FinalizeActionData,
  FinalizeActionInput,
  HealthData,
  MaintenanceStartDecision,
  OperatorActionDetailData,
  OperatorActionStateData,
  OperatorActionsData,
  OperatorQrContextData,
  QrHistoryPageData,
  RawOperatorCard,
  RegisterOccurrenceInput,
  RegisterOccurrenceResponseData,
  RegisterParameterData,
  RegisterParameterInput,
  StartActionData,
  StartStopInput,
  StartStopResponseData,
} from "../../types/api";
import type {
  ActionGroup,
  ActionPriority,
  ActionStatus,
  OperatorAction,
} from "../../types/operator";
import {
  API_TIMEOUT_MS,
  callApi,
  callNodeMultipart,
  fetchNodePrivateBlob,
  usesNodeApiTransport,
} from "./client";
import { getOperatorToken } from "./config";

export async function loadOperatorEvidenceBlob(
  storageObjectId: string,
): Promise<Blob> {
  const token = getOperatorToken();
  if (!token) throw new Error("Token do operador não configurado.");
  return fetchNodePrivateBlob(
    `/v1/maintenance/evidence-files/${encodeURIComponent(storageObjectId)}`,
    token,
  );
}

function mapPriority(value?: string): ActionPriority {
  const normalized = (value ?? "").toUpperCase();
  if (normalized === "CRITICA" || normalized === "CRÍTICA") return "CRITICA";
  if (normalized === "ALTA") return "ALTA";
  if (normalized === "MEDIA" || normalized === "MÉDIA") return "MEDIA";
  if (normalized === "BAIXA") return "BAIXA";
  return "NORMAL";
}

function mapStatus(value?: string): ActionStatus {
  const normalized = (value ?? "").toUpperCase();
  if (normalized === "EM_EXECUCAO") return "EM_EXECUCAO";
  if (normalized === "AGUARDANDO_VALIDACAO") return "AGUARDANDO_VALIDACAO";
  if (normalized === "CONCLUIDA" || normalized === "CONCLUÍDA")
    return "CONCLUIDA";
  return "PENDENTE";
}

function cardClassificationText(card: RawOperatorCard): string {
  return [
    card.group,
    card.grupo,
    card.origem,
    card.tipo,
    card.title,
    card.subtitle,
    card.description,
    card.primary_action?.label,
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
}

function mapGroup(
  card: RawOperatorCard,
  priority: ActionPriority,
): ActionGroup {
  const source = cardClassificationText(card);

  const nonScheduledTerms = [
    "NAO_PROGRAM",
    "NÃO PROGRAM",
    "EMERGEN",
    "CORRETIV",
    "OCORR",
    "FALHA",
    "QUEBRA",
    "URGENT",
  ];
  if (nonScheduledTerms.some((term) => source.includes(term))) {
    return "NAO_PROGRAMADA";
  }

  const scheduledTerms = [
    "PROGRAM",
    "PREVENT",
    "PREDIT",
    "INSPE",
    "CHECKLIST",
    "LUBR",
    "ROTA",
    "PLANO",
    "PERIOD",
  ];
  if (scheduledTerms.some((term) => source.includes(term))) {
    return "PROGRAMADA";
  }

  // Compatibilidade com contratos antigos que não expõem origem/grupo.
  return priority === "CRITICA" ? "NAO_PROGRAMADA" : "PROGRAMADA";
}

function inferType(card: RawOperatorCard, group: ActionGroup): string {
  const explicit = String(card.tipo ?? "").trim();
  if (explicit) return explicit.toUpperCase();

  const source = cardClassificationText(card);
  if (source.includes("PREVENT")) return "PREVENTIVA";
  if (source.includes("PREDIT")) return "PREDITIVA";
  if (source.includes("INSPE") || source.includes("CHECKLIST"))
    return "INSPEÇÃO";
  if (source.includes("CORRETIV")) return "CORRETIVA";
  if (group === "NAO_PROGRAMADA") return "EMERGENCIAL";
  return "PROGRAMADA";
}

export function mapOperatorCard(card: RawOperatorCard): OperatorAction {
  const priority = mapPriority(card.priority?.value);
  const group = mapGroup(card, priority);
  const id = card.acao_id ?? card.id ?? "";

  const generatedAt = card.dates?.gerado_em || new Date().toISOString();
  const plannedAt =
    card.availability?.planejada_para ||
    card.dates?.planejada_para ||
    undefined;
  const availabilityState =
    card.availability?.estado || (plannedAt ? "AGENDADA" : "SEM_AGENDAMENTO");

  return {
    id,
    group,
    type: inferType(card, group),
    title: card.title?.trim() || "Ação de manutenção",
    assetTag: card.asset?.tag?.trim() || card.asset?.id?.trim() || "ATIVO",
    assetName: card.asset?.name?.trim() || "Equipamento",
    componentTag:
      card.component?.tag?.trim() || card.component?.id?.trim() || "COMPONENTE",
    componentName: card.component?.name?.trim() || "Componente",
    description: card.description?.trim() || "Sem descrição operacional.",
    priority,
    status: mapStatus(card.status?.state),
    startAt: plannedAt || generatedAt,
    generatedAt,
    plannedAt,
    availability: {
      state: availabilityState,
      canStart: card.availability?.pode_iniciar ?? !plannedAt,
      plannedAt,
      alertMinutes: card.availability?.alerta_minutos ?? 60,
      overdueGraceMinutes: card.availability?.tolerancia_atraso_minutos ?? 15,
    },
    durationMinutes:
      typeof card.duracao_minutos === "number"
        ? card.duracao_minutos
        : undefined,
    crew: Array.isArray(card.equipe) ? card.equipe : [],
    progress: {
      total: card.progress?.total ?? 0,
      answered: card.progress?.respondidos ?? 0,
      pending: card.progress?.pendentes ?? 0,
      percentage: card.progress?.percentual ?? 0,
    },
  };
}

export async function getSystemHealth(
  signal?: AbortSignal,
): Promise<HealthData> {
  const response = await callApi<HealthData>("sistema.health", {}, signal, {
    timeoutMs: API_TIMEOUT_MS.FAST_READ,
    dedupe: true,
  });

  if (!response.data) {
    throw new Error("Resposta de health sem conteúdo.");
  }

  return response.data;
}

export async function getOperatorActions(
  signal?: AbortSignal,
): Promise<OperatorAction[]> {
  const token = getOperatorToken();
  if (!token) {
    throw new Error("Token do operador não configurado.");
  }

  const response = await callApi<OperatorActionsData>(
    "operador.minhas_acoes",
    {
      token,
      status: "PENDENTE,EM_EXECUCAO",
      incluir_concluidas: false,
      limite: 200,
    },
    signal,
    { timeoutMs: API_TIMEOUT_MS.FAST_READ, dedupe: true },
  );

  const cards =
    response.data?.cards ??
    response.data?.visual_cards ??
    response.data?.acoes ??
    [];

  return cards
    .map(mapOperatorCard)
    .filter(
      (action) =>
        Boolean(action.id) &&
        (action.status === "PENDENTE" || action.status === "EM_EXECUCAO"),
    );
}

export async function getOperatorActionDetail(
  actionId: string,
  signal?: AbortSignal,
): Promise<OperatorActionDetailData> {
  const token = getOperatorToken();
  if (!token) throw new Error("Token do operador não configurado.");

  const response = await callApi<OperatorActionDetailData>(
    "operador.tela_acao",
    { token, acao_id: actionId },
    signal,
    {
      timeoutMs: API_TIMEOUT_MS.DETAIL_READ,
      dedupe: true,
    },
  );

  if (!response.data) {
    throw new Error("A API não retornou os detalhes da ação.");
  }

  return response.data;
}

export async function startOperatorAction(
  actionId: string,
  decision: MaintenanceStartDecision,
): Promise<StartActionData> {
  const token = getOperatorToken();
  if (!token) throw new Error("Token do operador não configurado.");

  const response = await callApi<StartActionData>(
    "operador.iniciar_acao",
    {
      token,
      acao_id: actionId,
      decisao_parada_manutencao: decision,
    },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE },
  );

  if (!response.data) {
    throw new Error("A API não retornou a confirmação de início.");
  }

  return response.data;
}

export async function getOperatorActionState(
  actionId: string,
): Promise<OperatorActionStateData> {
  const token = getOperatorToken();
  if (!token) throw new Error("Token do operador não configurado.");

  const response = await callApi<OperatorActionStateData>(
    "operador.estado_acao",
    { token, acao_id: actionId },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.DETAIL_READ, dedupe: true },
  );

  if (!response.data) throw new Error("A API não retornou o estado da ação.");
  return response.data;
}

export async function saveOperatorChecklistBatch(
  actionId: string,
  items: ChecklistBatchItemInput[],
): Promise<ChecklistBatchSaveData> {
  const token = getOperatorToken();
  if (!token) throw new Error("Token do operador não configurado.");

  const response = await callApi<ChecklistBatchSaveData>(
    "operador.salvar_checklist_lote",
    { token, acao_id: actionId, itens: items },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.SAVE },
  );

  if (!response.data)
    throw new Error("A API não confirmou o salvamento do checklist.");
  return response.data;
}

export async function registerOperatorEvidence(
  actionId: string,
  executionId: string,
  input: EvidenceInput,
): Promise<EvidenceSaveData> {
  const token = getOperatorToken();
  if (!token) throw new Error("Token do operador não configurado.");

  const response = await callApi<EvidenceSaveData>(
    "operador.registrar_evidencia",
    {
      token,
      acao_id: actionId,
      execucao_id: executionId,
      checklist_execucao_id: input.checklist_execucao_id,
      tipo: input.tipo,
      nome_arquivo: input.nome_arquivo,
      url: input.url,
      observacao: input.observacao ?? "",
    },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.SAVE },
  );

  if (!response.data) throw new Error("A API não confirmou a evidência.");
  return response.data;
}

export async function uploadOperatorEvidencePhoto(
  actionId: string,
  executionId: string,
  input: EvidencePhotoUploadInput,
): Promise<EvidenceSaveData> {
  const token = getOperatorToken();
  if (!token) throw new Error("Token do operador não configurado.");

  if (usesNodeApiTransport()) {
    const form = new FormData();
    if (input.observacao?.trim())
      form.append("observacao", input.observacao.trim());
    form.append("arquivo", input.arquivo, input.nome_arquivo);
    const response = await callNodeMultipart<{
      itens?: Array<{
        id?: string;
        quantidade_evidencias?: number;
        minimo_evidencias?: number;
        evidencias?: Array<{
          id?: string;
          objeto_armazenamento_id?: string;
          nome_arquivo?: string;
          url?: string;
          tipo_midia?: string;
          tamanho_bytes?: number;
          observacao?: string;
          registrada_em?: string;
        }>;
      }>;
    }>(
      `/v1/maintenance/executions/${encodeURIComponent(executionId)}/items/${encodeURIComponent(input.checklist_execucao_id)}/evidence-file`,
      token,
      form,
    );
    const item = response.data?.itens?.find(
      (candidate) => candidate.id === input.checklist_execucao_id,
    );
    const evidence = item?.evidencias?.at(-1);
    if (!item || !evidence?.objeto_armazenamento_id) {
      throw new Error(
        "A API Node não confirmou o arquivo de evidência armazenado.",
      );
    }
    return {
      saved: true,
      uploaded: true,
      checklist_execucao_id: input.checklist_execucao_id,
      evidencias_count: item.quantidade_evidencias,
      minimo_fotos: item.minimo_evidencias,
      arquivo_id: evidence.objeto_armazenamento_id,
      url: evidence.url,
      mime_type: evidence.tipo_midia,
      tamanho_bytes: evidence.tamanho_bytes,
      evidencia: {
        id: evidence.id,
        checklist_execucao_id: input.checklist_execucao_id,
        tipo: "FOTO",
        nome_arquivo: evidence.nome_arquivo,
        url: evidence.url,
        arquivo_id: evidence.objeto_armazenamento_id,
        mime_type: evidence.tipo_midia,
        tamanho_bytes: evidence.tamanho_bytes,
        observacao: evidence.observacao,
        criado_em: evidence.registrada_em,
      },
    };
  }

  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("Falha ao ler a evidência."));
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(
        value.includes(",") ? value.slice(value.indexOf(",") + 1) : value,
      );
    };
    reader.readAsDataURL(input.arquivo);
  });

  const response = await callApi<EvidenceSaveData>(
    "operador.upload_evidencia_foto",
    {
      token,
      acao_id: actionId,
      execucao_id: executionId,
      checklist_execucao_id: input.checklist_execucao_id,
      nome_arquivo: input.nome_arquivo,
      mime_type: input.mime_type,
      tamanho_bytes: input.tamanho_bytes,
      base64_data: base64,
      observacao: input.observacao ?? "",
    },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.EVIDENCE_UPLOAD },
  );

  if (!response.data) throw new Error("A API não confirmou o upload da foto.");
  return response.data;
}

export async function validateOperatorFinalization(
  actionId: string,
): Promise<FinalizationValidationData> {
  const token = getOperatorToken();
  if (!token) throw new Error("Token do operador não configurado.");

  const response = await callApi<FinalizationValidationData>(
    "operador.validar_finalizacao_acao",
    { token, acao_id: actionId },
    undefined,
    {
      timeoutMs: API_TIMEOUT_MS.DETAIL_READ,
      dedupe: true,
    },
  );

  if (!response.data)
    throw new Error("A API não retornou a validação da finalização.");
  return response.data;
}

export async function finalizeOperatorAction(
  actionId: string,
  input: FinalizeActionInput,
): Promise<FinalizeActionData> {
  const token = getOperatorToken();
  if (!token) throw new Error("Token do operador não configurado.");

  const response = await callApi<FinalizeActionData>(
    "operador.finalizar_acao",
    {
      token,
      acao_id: actionId,
      resultado: input.resultado,
      resultado_operacional: input.resultado_operacional,
      observacao: input.observacao,
      duracao_segundos: input.duracao_segundos ?? 0,
    },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.EVIDENCE_UPLOAD },
  );

  if (!response.data) throw new Error("A API não confirmou a finalização.");
  return response.data;
}

export async function getOperatorQrContext(
  qrPayload: string,
  signal?: AbortSignal,
): Promise<OperatorQrContextData> {
  const token = getOperatorToken();
  if (!token) throw new Error("Token do operador não configurado.");

  const response = await callApi<OperatorQrContextData>(
    "operador.contexto_qr",
    { token, qr_payload: qrPayload.trim() },
    signal,
    {
      timeoutMs: API_TIMEOUT_MS.DETAIL_READ,
      dedupe: true,
    },
  );

  if (!response.data)
    throw new Error("A API não retornou o contexto do QR Code.");
  return response.data;
}

export async function getOperatorQrHistoryPage(input: {
  ativo_id: string;
  componente_id?: string;
  cursor?: string;
  limit?: number;
}): Promise<QrHistoryPageData> {
  const token = getOperatorToken();
  if (!token) throw new Error("Token do operador não configurado.");

  const response = await callApi<QrHistoryPageData>(
    "operador.historico_qr",
    {
      token,
      ativo_id: input.ativo_id,
      componente_id: input.componente_id ?? "",
      cursor: input.cursor ?? "",
      limit: input.limit ?? 4,
    },
    undefined,
    {
      timeoutMs: API_TIMEOUT_MS.DETAIL_READ,
      dedupe: true,
    },
  );

  if (!response.data)
    throw new Error("A API não retornou a próxima página do histórico.");
  return response.data;
}

export async function registerOperatorParameter(
  input: RegisterParameterInput,
): Promise<RegisterParameterData> {
  const token = getOperatorToken();
  if (!token) throw new Error("Token do operador não configurado.");

  const response = await callApi<RegisterParameterData>(
    "operador.registrar_parametro",
    {
      token,
      ativo_id: input.ativo_id,
      componente_id: input.componente_id ?? "",
      parametro: input.parametro.trim(),
      valor: input.valor,
      unidade: input.unidade?.trim() ?? "",
      origem: input.origem ?? "OPERADOR_QR",
    },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.SAVE },
  );

  if (!response.data)
    throw new Error("A API não confirmou o registro do parâmetro.");
  return response.data;
}

export async function getOperatorActiveStop(input: {
  ativo_id?: string;
  acao_id?: string;
}): Promise<ActiveStopResponseData> {
  const token = getOperatorToken();
  if (!token) throw new Error("Token do operador não configurado.");

  const response = await callApi<ActiveStopResponseData>(
    "operador.parada_ativa",
    {
      token,
      ativo_id: input.ativo_id ?? "",
      acao_id: input.acao_id ?? "",
    },
    undefined,
    {
      timeoutMs: API_TIMEOUT_MS.FAST_READ,
      dedupe: true,
    },
  );

  if (!response.data) throw new Error("A API não retornou a parada ativa.");
  return response.data;
}

export async function startOperatorStop(
  input: StartStopInput,
): Promise<StartStopResponseData> {
  const token = getOperatorToken();
  if (!token) throw new Error("Token do operador não configurado.");

  const response = await callApi<StartStopResponseData>(
    "operador.iniciar_parada",
    {
      token,
      ativo_id: input.ativo_id,
      componente_id: input.componente_id ?? "",
      tipo: input.tipo ?? "NAO_PROGRAMADA",
      motivo_parada: input.motivo_parada ?? "",
    },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE },
  );

  if (!response.data)
    throw new Error("A API não confirmou o início da parada.");
  return response.data;
}

export async function finishOperatorStop(
  input: FinishStopInput,
): Promise<FinishStopResponseData> {
  const token = getOperatorToken();
  if (!token) throw new Error("Token do operador não configurado.");

  const response = await callApi<FinishStopResponseData>(
    "operador.finalizar_parada",
    {
      token,
      parada_id: input.parada_id ?? "",
      ativo_id: input.ativo_id ?? "",
      categoria_retorno: input.categoria_retorno ?? "",
      justificativa_divergencia: input.justificativa_divergencia ?? "",
    },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE },
  );

  if (!response.data)
    throw new Error("A API não confirmou a finalização da parada.");
  return response.data;
}

export async function registerOperatorOccurrence(
  input: RegisterOccurrenceInput,
): Promise<RegisterOccurrenceResponseData> {
  const token = getOperatorToken();
  if (!token) throw new Error("Token do operador não configurado.");

  const response = await callApi<RegisterOccurrenceResponseData>(
    "operador.registrar_ocorrencia",
    {
      token,
      ativo_id: input.ativo_id,
      componente_id: input.componente_id ?? "",
      alvo_ocorrencia: input.alvo_ocorrencia,
      tipo: input.tipo ?? input.alvo_ocorrencia,
      titulo: input.titulo,
      descricao: input.descricao,
      severidade: input.severidade ?? "MEDIA",
    },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.SAVE },
  );

  if (!response.data) throw new Error("A API não confirmou a ocorrência.");
  return response.data;
}
