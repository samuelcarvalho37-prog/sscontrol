import type { ApiEnvelope } from "../../types/api";
import { getApiTransport, getApiUrl, getLegacyApiUrl } from "./config";

export const API_TIMEOUT_MS = {
  FAST_READ: 15_000,
  DETAIL_READ: 30_000,
  SAVE: 45_000,
  CRITICAL_WRITE: 60_000,
  EVIDENCE_UPLOAD: 90_000,
} as const;

export interface ApiCallOptions {
  timeoutMs?: number;
  dedupe?: boolean;
  dedupeKey?: string;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly code = "API_REQUEST_FAILED",
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

const inFlightReads = new Map<string, Promise<ApiEnvelope<unknown>>>();

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;

  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(object[key])}`)
    .join(",")}}`;
}

async function executeAppsScriptCall<T>(
  apiUrl: string,
  action: string,
  payload: Record<string, unknown>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<ApiEnvelope<T>> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller, { once: true });

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ action, payload }),
      signal: controller.signal,
      redirect: "follow",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      if (signal?.aborted) throw error;
      if (timedOut) {
        const timeoutSeconds = Math.round(timeoutMs / 1000);
        throw new ApiRequestError(
          `A API excedeu ${timeoutSeconds} segundos. Os dados salvos permanecem disponíveis; tente atualizar novamente.`,
          "API_TIMEOUT",
          { action, timeoutMs },
        );
      }
      throw new ApiRequestError(
        "A requisição foi cancelada.",
        "API_ABORTED",
        error,
      );
    }
    throw new ApiRequestError(
      "Não foi possível alcançar a API. Verifique internet, URL e publicação do Apps Script.",
      "NETWORK_ERROR",
      error,
    );
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromCaller);
  }

  if (!response.ok) {
    throw new ApiRequestError(
      `A API respondeu com HTTP ${response.status}.`,
      "HTTP_ERROR",
      {
        status: response.status,
      },
    );
  }

  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch (error) {
    throw new ApiRequestError(
      "A API não retornou JSON válido.",
      "INVALID_JSON",
      error,
    );
  }

  if (!envelope.ok) {
    throw new ApiRequestError(
      envelope.error?.message ?? "A API rejeitou a operação.",
      envelope.error?.code ?? "API_ERROR",
      envelope.error?.details,
    );
  }

  return envelope;
}

interface NodeActionRequest {
  method: "GET" | "POST" | "PATCH" | "PUT";
  path: string;
  body?: Record<string, unknown>;
  token?: string;
  transform?: (data: Record<string, unknown>) => unknown;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function operatorStatus(value: unknown): string {
  switch (stringValue(value).toUpperCase()) {
    case "READY":
      return "PENDENTE";
    case "IN_PROGRESS":
      return "EM_EXECUCAO";
    case "BLOCKED":
      return "BLOQUEADA";
    case "COMPLETED":
      return "CONCLUIDA";
    case "OPEN":
      return "PENDENTE";
    default:
      return stringValue(value).toUpperCase() || "PENDENTE";
  }
}

function operatorPriority(value: unknown): string {
  switch (stringValue(value).toUpperCase()) {
    case "CRITICAL":
      return "CRITICA";
    case "HIGH":
      return "ALTA";
    case "MEDIUM":
      return "MEDIA";
    case "LOW":
      return "BAIXA";
    default:
      return "NORMAL";
  }
}

function monitoringSeverity(value: unknown): string {
  switch (stringValue(value).toUpperCase()) {
    case "CRITICA":
      return "CRITICAL";
    case "ALTA":
      return "HIGH";
    case "MEDIA":
      return "MEDIUM";
    case "BAIXA":
      return "LOW";
    default:
      return stringValue(value).toUpperCase() || "MEDIUM";
  }
}

function operatorStopMode(value: unknown): string {
  switch (stringValue(value).toUpperCase()) {
    case "MANDATORY_STOP":
      return "OBRIGATORIA";
    case "NO_STOP":
      return "SEM_PARADA";
    default:
      return "DECISAO_EXECUTOR";
  }
}

function operatorExecutionMode(value: unknown): string {
  return stringValue(value).toUpperCase() === "NO_STOP"
    ? "SEM_PARADA"
    : "COM_PARADA";
}

function checklistItem(
  value: unknown,
  executionId: string,
  actionId: string,
): JsonRecord {
  const item = asRecord(value);
  const evidence = asArray(item.evidencias).map((entry) => {
    const file = asRecord(entry);
    return {
      id: stringValue(file.id),
      execucao_id: executionId,
      acao_id: actionId,
      checklist_execucao_id: stringValue(item.id),
      tipo: stringValue(file.tipo),
      nome_arquivo: stringValue(file.nome_arquivo),
      arquivo_id: stringValue(file.objeto_armazenamento_id),
      mime_type: stringValue(file.tipo_midia),
      tamanho_bytes: numberValue(file.tamanho_bytes),
      observacao: stringValue(file.observacao),
      criado_em: stringValue(file.registrada_em || file.capturada_em),
    };
  });
  const status = stringValue(item.status).toUpperCase();
  const answered = ["ANSWERED", "NONCOMPLIANT", "NOT_APPLICABLE"].includes(
    status,
  );
  const responseType = stringValue(item.tipo_resposta).toUpperCase() || "TEXTO";
  const response =
    responseType === "CONFIRMACAO" || responseType === "INSTRUCAO"
      ? item.resposta_booleano === true
        ? "SIM"
        : ""
      : responseType === "OK_NOK" || responseType === "SELECAO"
        ? stringValue(item.resposta_opcao)
        : stringValue(item.resposta_texto);
  return {
    id: stringValue(item.id),
    ui_key: stringValue(item.id),
    execucao_id: executionId || undefined,
    acao_id: actionId,
    plano_item_id: stringValue(item.parametro_id) || undefined,
    ordem: numberValue(item.sequencia),
    titulo: stringValue(item.titulo),
    instrucao: stringValue(item.instrucao),
    tipo_resposta: responseType,
    categoria: stringValue(item.categoria),
    obrigatorio: item.obrigatorio !== false,
    evidencia_obrigatoria: item.evidencia_obrigatoria === true,
    bloqueia_finalizacao: item.bloqueia_conclusao === true,
    valor_esperado: item.valor_esperado,
    opcoes: asArray(item.opcoes).map(stringValue).filter(Boolean),
    limite_min: item.minimo,
    limite_max: item.maximo,
    unidade: stringValue(item.unidade),
    resposta: response,
    valor_numero: item.resposta_numero,
    observacao: stringValue(item.observacao),
    conforme:
      item.conforme === null || item.conforme === undefined
        ? ""
        : item.conforme === true
          ? "SIM"
          : "NAO",
    status:
      status === "ANSWERED"
        ? "RESPONDIDO"
        : status === "NONCOMPLIANT"
          ? "NAO_CONFORME"
          : status === "NOT_APPLICABLE"
            ? "NAO_APLICAVEL"
            : "PENDENTE",
    respondido: answered,
    evidencias_count: numberValue(item.quantidade_evidencias),
    evidencia_min_fotos: numberValue(item.minimo_evidencias),
    evidencias: evidence,
    input: {
      tipo_resposta: responseType,
      requer_resposta: item.obrigatorio !== false,
      requer_valor: ["NUMERO", "PARAMETRO", "LEITURA_OPERACIONAL"].includes(
        responseType,
      ),
      requer_opcoes: ["OK_NOK", "SELECAO"].includes(responseType),
      suporta_evidencia:
        item.evidencia_obrigatoria === true || responseType === "EVIDENCIA",
      opcoes: asArray(item.opcoes).map(stringValue).filter(Boolean),
      unidade: stringValue(item.unidade),
      limite_min: item.minimo,
      limite_max: item.maximo,
    },
  };
}

function actionAvailability(action: JsonRecord): JsonRecord {
  const plannedAt = stringValue(action.programada_para);
  const plannedTime = plannedAt ? Date.parse(plannedAt) : Number.NaN;
  const canStart =
    operatorStatus(action.status) === "PENDENTE" &&
    (!Number.isFinite(plannedTime) || plannedTime <= Date.now());
  return {
    programada: Boolean(plannedAt),
    planejada_para: plannedAt || undefined,
    alerta_minutos: 60,
    tolerancia_atraso_minutos: 15,
    estado: !plannedAt
      ? "SEM_AGENDAMENTO"
      : canStart
        ? "DISPONIVEL"
        : "AGENDADA",
    pode_iniciar: canStart,
  };
}

function operatorActionDetail(data: JsonRecord): JsonRecord {
  const action = asRecord(data.acao);
  const execution = asRecord(data.execucao);
  const actionId = stringValue(action.id);
  const executionId = stringValue(execution.id);
  const sourceItems = executionId
    ? asArray(execution.itens)
    : asArray(action.checklist_itens);
  const items = sourceItems.map((item) =>
    checklistItem(item, executionId, actionId),
  );
  const answered = items.filter((item) => item.respondido === true).length;
  const missingEvidence = items.filter(
    (item) =>
      item.evidencia_obrigatoria === true &&
      numberValue(item.evidencias_count) <
        Math.max(1, numberValue(item.evidencia_min_fotos)),
  ).length;
  const pending = items.filter(
    (item) => item.obrigatorio === true && item.respondido !== true,
  ).length;
  const status = operatorStatus(action.status);
  const executionStatus = operatorStatus(execution.status);
  const inProgress =
    executionId.length > 0 && executionStatus === "EM_EXECUCAO";
  const availability = actionAvailability(action);
  const analysis = asRecord(action.analise_tecnica);
  const stopMode = operatorStopMode(action.modo_parada);
  return {
    ok: true,
    version: "1.4.0",
    contract_version: "2.0",
    acao: {
      id: actionId,
      os_id: stringValue(action.ordem_id),
      ativo_id: stringValue(action.ativo_id),
      componente_id: stringValue(action.componente_id),
      plano_id: stringValue(action.plano_id),
      origem: stringValue(action.origem),
      tipo: stringValue(action.tipo),
      titulo: stringValue(action.titulo),
      descricao: stringValue(action.descricao),
      prioridade: operatorPriority(action.prioridade),
      status,
      responsavel_id: stringValue(action.responsavel_id),
      gerado_em: stringValue(action.gerada_em),
      planejada_para: stringValue(action.programada_para),
      iniciado_em: stringValue(action.iniciada_em),
      finalizado_em: stringValue(action.finalizada_em),
      modo_parada_manutencao: stopMode,
    },
    os: {
      id: stringValue(action.ordem_id),
      codigo: stringValue(action.ordem_codigo),
      titulo: stringValue(action.titulo),
      descricao: stringValue(action.descricao),
      prioridade: operatorPriority(action.prioridade),
      status: stringValue(action.ordem_status),
      aberta_em: stringValue(action.ordem_criada_em),
      planejada_para: stringValue(action.programada_para),
    },
    ativo: {
      id: stringValue(action.ativo_id),
      tag: stringValue(action.ativo_tag),
      nome: stringValue(action.ativo_nome),
      tipo: stringValue(action.ativo_tipo),
      criticidade: stringValue(action.ativo_criticidade),
      status: stringValue(action.ativo_status),
      fabricante: stringValue(action.ativo_fabricante),
      modelo: stringValue(action.ativo_modelo),
      numero_serie: stringValue(action.ativo_numero_serie),
      localizacao_tecnica: stringValue(action.ativo_localizacao),
    },
    componente: stringValue(action.componente_id)
      ? {
          id: stringValue(action.componente_id),
          tag: stringValue(action.componente_tag),
          nome: stringValue(action.componente_nome),
          tipo: stringValue(action.componente_tipo),
          criticidade: stringValue(action.componente_criticidade),
          status: stringValue(action.componente_status),
          fabricante: stringValue(action.componente_fabricante),
          modelo: stringValue(action.componente_modelo),
          numero_serie: stringValue(action.componente_numero_serie),
          localizacao_tecnica: stringValue(action.componente_localizacao),
        }
      : undefined,
    plano: {
      id: stringValue(action.plano_id),
      nome: stringValue(action.plano_nome),
      tipo: stringValue(action.plano_tipo),
      criticidade: stringValue(action.ativo_criticidade),
      modo_parada_manutencao: stopMode,
      tempo_estimado_min: numberValue(action.duracao_estimada_minutos),
      requer_bloqueio: action.bloqueio_obrigatorio === true ? "SIM" : "NAO",
      requer_evidencia: action.evidencia_obrigatoria === true ? "SIM" : "NAO",
      status: "PUBLICADO",
      revisao: numberValue(action.plano_revisao),
    },
    executor: executionId
      ? {
          id: stringValue(execution.operador_id || action.operador_id),
          nome: stringValue(execution.operador_nome || action.operador_nome),
        }
      : null,
    execucao: executionId
      ? {
          id: executionId,
          acao_id: actionId,
          operador_id: stringValue(execution.operador_id),
          resultado: stringValue(execution.resultado),
          observacao: stringValue(execution.observacao),
          duracao_segundos: numberValue(execution.duracao_segundos),
          abriu_em: stringValue(execution.assumida_em),
          iniciou_em: stringValue(execution.iniciada_em),
          finalizou_em: stringValue(execution.concluida_em),
          status: executionStatus,
          modo_execucao_manutencao: operatorExecutionMode(
            execution.modo_parada,
          ),
        }
      : null,
    disponibilidade: availability,
    checklist: {
      modelo: !executionId,
      execucao_id: executionId || undefined,
      total: items.length,
      respondidos: answered,
      pending_count: pending,
      evidence_missing_count: missingEvidence,
      blockers_count: pending + missingEvidence,
      itens: items,
    },
    ui: {
      state: inProgress ? "EM_EXECUCAO" : status,
      can_start: availability.pode_iniciar === true,
      can_answer: inProgress,
      can_save_batch: inProgress,
      can_finalize: inProgress && pending === 0 && missingEvidence === 0,
      can_register_evidence: inProgress,
      can_validate: inProgress,
      message: inProgress
        ? "Execução em andamento."
        : "Revise a análise técnica antes de iniciar.",
    },
    operator_screen: {
      header: {
        acao_id: actionId,
        execucao_id: executionId || undefined,
        os_id: stringValue(action.ordem_id),
        os_codigo: stringValue(action.ordem_codigo),
        title: stringValue(action.titulo),
        subtitle: stringValue(action.ativo_nome),
        description: stringValue(action.descricao),
        status: inProgress ? "EM_EXECUCAO" : status,
        responsavel_id: stringValue(action.responsavel_id),
      },
      progress: {
        total: items.length,
        respondidos: answered,
        pendentes: pending,
        percentual: items.length
          ? Math.round((answered / items.length) * 100)
          : 0,
        evidencias_pendentes: missingEvidence,
        bloqueios: pending + missingEvidence,
        completo: pending === 0 && missingEvidence === 0,
        label: `${answered}/${items.length} respondidos`,
      },
      action_bar: {
        buttons: [
          {
            id: "INICIAR_ACAO",
            label: "Iniciar execução",
            endpoint: "operador.iniciar_acao",
            enabled: availability.pode_iniciar === true,
            tone: "primary",
          },
        ],
      },
    },
    analise_tecnica: analysis,
  };
}

function operatorQueue(data: JsonRecord): JsonRecord {
  const rows = asArray(data.itens).map(asRecord);
  const cards = rows.map((item) => ({
    id: stringValue(item.id),
    acao_id: stringValue(item.id),
    title: stringValue(item.titulo),
    subtitle: stringValue(item.checklist_nome),
    description: stringValue(item.descricao),
    priority: {
      value: operatorPriority(item.prioridade),
      label: operatorPriority(item.prioridade),
    },
    status: {
      state: operatorStatus(item.status),
      label: operatorStatus(item.status),
    },
    progress: {
      total: numberValue(item.total_itens),
      respondidos: 0,
      pendentes: numberValue(item.total_itens),
      percentual: 0,
    },
    asset: {
      id: stringValue(item.ativo_id),
      tag: stringValue(item.ativo_tag),
      name: stringValue(item.ativo_nome),
    },
    component: {
      id: stringValue(item.componente_id),
      tag: stringValue(item.componente_tag),
      name: stringValue(item.componente_nome),
    },
    dates: {
      gerado_em: stringValue(item.liberada_em),
      planejada_para: stringValue(item.programada_para),
    },
    origem: stringValue(item.origem),
    tipo: stringValue(item.tipo),
    duracao_minutos: numberValue(item.duracao_estimada_minutos),
    availability: actionAvailability(item),
  }));
  return {
    ok: true,
    version: "1.4.0",
    contract_version: "2.0",
    total: cards.length,
    resumo: {
      total: cards.length,
      aguardando_inicio: rows.filter((item) => item.status === "READY").length,
      em_execucao: rows.filter((item) => item.status === "IN_PROGRESS").length,
      bloqueadas: rows.filter((item) => item.status === "BLOCKED").length,
      concluidas: 0,
    },
    cards,
  };
}

function operatorExecutionChecklist(
  execution: JsonRecord,
  actionId: string,
): JsonRecord {
  const executionId = stringValue(execution.id);
  const items = asArray(execution.itens).map((item) =>
    checklistItem(item, executionId, actionId),
  );
  const answered = items.filter((item) => item.respondido === true).length;
  const pending = items.filter(
    (item) => item.obrigatorio === true && item.respondido !== true,
  ).length;
  const missingEvidence = items.filter(
    (item) =>
      item.evidencia_obrigatoria === true &&
      numberValue(item.evidencias_count) <
        Math.max(1, numberValue(item.evidencia_min_fotos)),
  ).length;
  return {
    execucao_id: executionId,
    total: items.length,
    respondidos: answered,
    pending_count: pending,
    evidence_missing_count: missingEvidence,
    blockers_count: pending + missingEvidence,
    itens: items,
  };
}

function operatorStartResult(data: JsonRecord, actionId: string): JsonRecord {
  const execution = asRecord(data.execucao);
  const executionId = stringValue(execution.id);
  const mode = operatorExecutionMode(execution.modo_parada);
  return {
    ok: true,
    started: data.iniciada === true,
    already_started: data.ja_iniciada === true,
    acao_id: actionId,
    execucao_id: executionId,
    status: operatorStatus(execution.status),
    modo_execucao_manutencao: mode,
    decisao_parada_manutencao:
      mode === "SEM_PARADA" ? "SEM_PARADA" : "PARAR_EQUIPAMENTO",
    execucao: {
      id: executionId,
      acao_id: actionId,
      operador_id: stringValue(execution.operador_id),
      resultado: stringValue(execution.resultado),
      observacao: stringValue(execution.observacao),
      duracao_segundos: numberValue(execution.duracao_segundos),
      abriu_em: stringValue(execution.assumida_em),
      iniciou_em: stringValue(execution.iniciada_em),
      finalizou_em: stringValue(execution.concluida_em),
      status: operatorStatus(execution.status),
      modo_execucao_manutencao: mode,
    },
    checklist: operatorExecutionChecklist(execution, actionId),
  };
}

function operatorState(data: JsonRecord, actionId: string): JsonRecord {
  const detail = operatorActionDetail(data);
  const execution = asRecord(detail.execucao);
  const executionId = stringValue(execution.id);
  return {
    ok: true,
    started:
      executionId.length > 0 &&
      operatorStatus(execution.status) === "EM_EXECUCAO",
    acao_id: actionId,
    status: asRecord(detail.acao).status,
    execucao_id: executionId || undefined,
    execucao: executionId ? execution : null,
    checklist: detail.checklist,
    modo_execucao_manutencao: stringValue(execution.modo_execucao_manutencao),
    server_time: new Date().toISOString(),
  };
}

function operationalStatus(value: unknown): string {
  switch (stringValue(value).toUpperCase()) {
    case "OPERATING":
      return "OPERANDO";
    case "STOPPED":
      return "PARADO";
    case "INSPECTION":
      return "INSPECAO";
    case "MAINTENANCE_PLANNED":
      return "MANUTENCAO_PROGRAMADA";
    case "MAINTENANCE_UNPLANNED":
      return "MANUTENCAO_NAO_PROGRAMADA";
    case "UNAVAILABLE":
      return "INDISPONIVEL";
    default:
      return stringValue(value).toUpperCase();
  }
}

function qrAsset(value: unknown): JsonRecord | null {
  const asset = asRecord(value);
  const id = stringValue(asset.id);
  if (!id) return null;
  return {
    id,
    linha_id: stringValue(asset.linha_id),
    tag: stringValue(asset.tag),
    qr_payload: stringValue(asset.qr_payload),
    nome: stringValue(asset.nome),
    tipo: stringValue(asset.tipo),
    criticidade: stringValue(asset.criticidade),
    status: operationalStatus(asset.status_operacional),
    saude_pct: asset.saude_percentual,
    horimetro_atual: asset.horimetro_atual,
    horimetro_modo: stringValue(asset.modo_horimetro),
    fabricante: stringValue(asset.fabricante),
    modelo: stringValue(asset.modelo),
    numero_serie: stringValue(asset.numero_serie),
    localizacao_tecnica: stringValue(asset.localizacao_tecnica),
  };
}

function qrComponent(value: unknown): JsonRecord | null {
  const component = asRecord(value);
  const id = stringValue(component.id);
  if (!id) return null;
  return {
    id,
    ativo_id: stringValue(component.ativo_id),
    tag: stringValue(component.tag),
    nome: stringValue(component.nome),
    tipo: stringValue(component.tipo),
    criticidade: stringValue(component.criticidade),
    status: operationalStatus(component.status_operacional),
    horas_acumuladas: component.horas_acumuladas,
    fabricante: stringValue(component.fabricante),
    modelo: stringValue(component.modelo),
    numero_serie: stringValue(component.numero_serie),
    localizacao_tecnica: stringValue(component.localizacao_tecnica),
  };
}

function qrParameter(value: unknown): JsonRecord {
  const parameter = asRecord(value);
  const numeric = parameter.ultimo_valor_numerico;
  const booleanValue = parameter.ultimo_valor_booleano;
  const latestValue =
    numeric !== null && numeric !== undefined
      ? numeric
      : parameter.ultimo_valor_texto !== null &&
          parameter.ultimo_valor_texto !== undefined
        ? parameter.ultimo_valor_texto
        : booleanValue;
  return {
    id: stringValue(parameter.id || parameter.parametro_id),
    ativo_id: stringValue(parameter.ativo_id),
    componente_id: stringValue(parameter.componente_id) || undefined,
    parametro: stringValue(
      parameter.codigo || parameter.parametro || parameter.nome,
    ),
    valor: latestValue ?? parameter.valor_numerico ?? parameter.valor ?? "",
    unidade: stringValue(parameter.unidade),
    origem: stringValue(parameter.tipo_origem || parameter.origem),
    registrado_por: stringValue(parameter.registrado_por),
    registrado_em: stringValue(
      parameter.ultima_leitura_em || parameter.registrado_em,
    ),
    criado_em: stringValue(parameter.created_at),
    nome: stringValue(parameter.nome),
    limite_min: parameter.alerta_minimo,
    limite_max: parameter.alerta_maximo,
    limite_critico_min: parameter.critico_minimo,
    limite_critico_max: parameter.critico_maximo,
    classificacao: stringValue(
      parameter.ultima_classificacao || parameter.classificacao,
    ),
  };
}

function qrHistory(value: unknown): JsonRecord {
  const history = asRecord(value);
  return {
    id: stringValue(history.id),
    ativo_id: stringValue(history.ativo_id),
    componente_id: stringValue(history.componente_id) || undefined,
    os_id: stringValue(history.os_id) || undefined,
    acao_id: stringValue(history.acao_id) || undefined,
    execucao_id: stringValue(history.execucao_id) || undefined,
    evento: stringValue(history.evento || history.tipo_evento),
    descricao: stringValue(history.descricao),
    usuario_id: stringValue(history.usuario_id),
    perfil: stringValue(history.perfil),
    criado_em: stringValue(history.criado_em || history.ocorrido_em),
  };
}

function qrAction(value: unknown): JsonRecord {
  const action = asRecord(value);
  return {
    id: stringValue(action.id),
    os_id: stringValue(action.os_id),
    ativo_id: stringValue(action.ativo_id),
    componente_id: stringValue(action.componente_id) || undefined,
    plano_id: stringValue(action.plano_id),
    origem: stringValue(action.origem),
    tipo: stringValue(action.tipo),
    titulo: stringValue(action.titulo),
    descricao: stringValue(action.descricao),
    prioridade: operatorPriority(action.prioridade),
    status: operatorStatus(action.status),
    gerado_em: stringValue(action.gerado_em),
    componente_nome: stringValue(action.componente_nome),
    plano: {
      nome: stringValue(action.plano_nome),
      tipo: stringValue(action.plano_tipo),
      tempo_estimado_min: numberValue(action.tempo_estimado_min),
    },
  };
}

function qrStop(value: unknown): JsonRecord | null {
  const stop = asRecord(value);
  const id = stringValue(stop.id);
  if (!id) return null;
  return {
    id,
    ativo_id: stringValue(stop.ativo_id || stop.asset_id),
    componente_id:
      stringValue(stop.componente_id || stop.component_id) || undefined,
    origem: stringValue(stop.origem || stop.origin),
    tipo: stringValue(stop.tipo || stop.stop_type),
    status: stringValue(stop.status),
    iniciada_em: stringValue(stop.iniciada_em || stop.started_at),
    iniciada_por: stringValue(stop.iniciada_por || stop.started_by),
    manutencao_iniciada_em: stringValue(
      stop.manutencao_iniciada_em || stop.maintenance_started_at,
    ),
    manutencao_finalizada_em: stringValue(
      stop.manutencao_finalizada_em || stop.maintenance_completed_at,
    ),
    finalizada_em: stringValue(stop.finalizada_em || stop.completed_at),
    finalizada_por: stringValue(stop.finalizada_por || stop.completed_by),
    tempo_parada_segundos: numberValue(
      stop.tempo_parada_segundos || stop.downtime_seconds,
    ),
    tempo_espera_manutencao_segundos: numberValue(
      stop.tempo_espera_manutencao_segundos || stop.maintenance_wait_seconds,
    ),
    tempo_execucao_segundos: numberValue(
      stop.tempo_execucao_segundos || stop.execution_seconds,
    ),
    tempo_retorno_operacional_segundos: numberValue(
      stop.tempo_retorno_operacional_segundos ||
        stop.operational_return_seconds,
    ),
    elapsed_seconds: numberValue(
      stop.elapsed_seconds || stop.duracao_atual_segundos,
    ),
    motivo_parada: stringValue(
      stop.motivo_parada || stop.motivo || stop.reason,
    ),
    categoria_retorno: stringValue(
      stop.categoria_retorno || stop.return_category,
    ),
    justificativa_divergencia: stringValue(
      stop.justificativa_divergencia || stop.divergence_justification,
    ),
    tolerancia_retorno_min: numberValue(
      stop.tolerancia_retorno_min ||
        stop.tolerancia_retorno_minutos ||
        stop.return_tolerance_minutes,
    ),
  };
}

function qrOccurrence(value: unknown): JsonRecord {
  const occurrence = asRecord(value);
  return {
    id: stringValue(occurrence.id),
    ativo_id: stringValue(occurrence.ativo_id || occurrence.asset_id),
    componente_id:
      stringValue(occurrence.componente_id || occurrence.component_id) ||
      undefined,
    tipo: stringValue(occurrence.tipo || occurrence.occurrence_type),
    titulo: stringValue(occurrence.titulo || occurrence.title),
    descricao: stringValue(occurrence.descricao || occurrence.description),
    severidade: stringValue(occurrence.severidade || occurrence.severity),
    status: stringValue(occurrence.status),
    usuario_id: stringValue(occurrence.usuario_id || occurrence.reported_by),
    perfil: stringValue(occurrence.perfil || occurrence.reporter_role_snapshot),
    os_id:
      stringValue(occurrence.os_id || occurrence.work_order_id) || undefined,
    analise_tecnica_id:
      stringValue(
        occurrence.analise_tecnica_id || occurrence.technical_analysis_id,
      ) || undefined,
    tratamento_status: stringValue(
      occurrence.tratamento_status || occurrence.treatment_status,
    ),
    criado_em: stringValue(
      occurrence.criado_em || occurrence.criada_em || occurrence.created_at,
    ),
    atualizado_em: stringValue(
      occurrence.atualizado_em ||
        occurrence.atualizada_em ||
        occurrence.updated_at,
    ),
  };
}

function operatorQrContext(data: JsonRecord): JsonRecord {
  const pagination = asRecord(data.historico_paginacao);
  const asset = qrAsset(data.ativo);
  const actions = asArray(data.acoes_pendentes).map(qrAction);
  const health = asRecord(data.saude);
  return {
    found: data.encontrado === true,
    tipo_contexto: stringValue(data.tipo_contexto),
    ativo: asset,
    horimetro: asset
      ? {
          ativo_id: asset.id,
          total_horas: numberValue(asset.horimetro_atual),
          modo:
            stringValue(asset.horimetro_modo).toUpperCase() === "TELEMETRY"
              ? "TELEMETRIA"
              : "MANUAL",
          automatico:
            stringValue(asset.horimetro_modo).toUpperCase() === "TELEMETRY",
          total_reiniciavel: false,
          contador_servico_reiniciavel: true,
        }
      : null,
    componente: qrComponent(data.componente),
    componentes: asArray(data.componentes).map(qrComponent).filter(Boolean),
    acoes_pendentes: actions,
    proxima_acao: actions[0] ?? null,
    historico_recente: asArray(data.historico_recente).map(qrHistory),
    historico_paginacao: {
      next_cursor: stringValue(pagination.proximo_cursor) || undefined,
      has_more: pagination.possui_mais === true,
      limit: numberValue(pagination.limite),
    },
    parametros_recentes: asArray(data.parametros_atuais).map(qrParameter),
    parametros_atuais: asArray(data.parametros_atuais).map(qrParameter),
    parada_ativa: qrStop(data.parada_ativa),
    ocorrencias_abertas: asArray(data.ocorrencias_abertas).map(qrOccurrence),
    saude: {
      pct: numberValue(health.percentual),
      status: stringValue(health.status),
      acoes_abertas: numberValue(health.acoes_abertas),
      os_abertas: numberValue(health.ocorrencias_abertas),
    },
  };
}

function nodeActionRequest(
  action: string,
  payload: Record<string, unknown>,
): NodeActionRequest | null {
  const token = typeof payload.token === "string" ? payload.token : undefined;
  switch (action) {
    case "auth.login":
      return {
        method: "POST",
        path: "/v1/auth/login",
        body: { matricula: payload.matricula, senha: payload.senha },
      };
    case "auth.first_access.complete":
      return {
        method: "POST",
        path: "/v1/auth/first-access",
        body: {
          change_token: payload.change_token,
          senha_atual: payload.senha_atual,
          nova_senha: payload.nova_senha,
        },
      };
    case "auth.recovery.request":
      return {
        method: "POST",
        path: "/v1/auth/recovery",
        body: { matricula: payload.matricula },
      };
    case "auth.logout":
      return { method: "POST", path: "/v1/auth/logout", body: {}, token };
    case "sistema.health":
      return { method: "GET", path: "/health/ready" };
    case "sistema.warmup":
      return {
        method: "GET",
        path: "/v1/auth/session",
        token,
        transform: (data) => {
          const user = data.user as Record<string, unknown> | undefined;
          return {
            warmed: true,
            version: data.release_version,
            perfil: user?.perfil ?? "",
            usuario_id: user?.id ?? "",
            elapsed_internal_ms: 0,
            loaded_tables: 0,
          };
        },
      };
    case "operador.minhas_acoes":
      return {
        method: "GET",
        path: `/v1/maintenance/operator-actions?limite=${Math.min(100, Math.max(1, numberValue(payload.limite) || 100))}`,
        token,
        transform: operatorQueue,
      };
    case "operador.tela_acao": {
      const actionId = encodeURIComponent(stringValue(payload.acao_id));
      return {
        method: "GET",
        path: `/v1/maintenance/operator-actions/${actionId}`,
        token,
        transform: operatorActionDetail,
      };
    }
    case "operador.iniciar_acao": {
      const rawActionId = stringValue(payload.acao_id);
      const actionId = encodeURIComponent(rawActionId);
      const noStop =
        stringValue(payload.decisao_parada_manutencao) === "SEM_PARADA";
      return {
        method: "POST",
        path: `/v1/maintenance/operator-actions/${actionId}/start`,
        token,
        body: { modo_parada: noStop ? "NO_STOP" : "STOPPED" },
        transform: (data) => operatorStartResult(data, rawActionId),
      };
    }
    case "operador.estado_acao": {
      const rawActionId = stringValue(payload.acao_id);
      const actionId = encodeURIComponent(rawActionId);
      return {
        method: "GET",
        path: `/v1/maintenance/operator-actions/${actionId}`,
        token,
        transform: (data) => operatorState(data, rawActionId),
      };
    }
    case "operador.salvar_checklist_lote": {
      const rawActionId = stringValue(payload.acao_id);
      const actionId = encodeURIComponent(rawActionId);
      const items = asArray(payload.itens).map((value) => {
        const item = asRecord(value);
        return {
          item_id: stringValue(item.checklist_execucao_id || item.id),
          resposta: typeof item.resposta === "string" ? item.resposta : null,
          valor:
            typeof item.valor === "number" && Number.isFinite(item.valor)
              ? item.valor
              : null,
          observacao:
            typeof item.observacao === "string" && item.observacao.trim()
              ? item.observacao.trim()
              : null,
        };
      });
      return {
        method: "PUT",
        path: `/v1/maintenance/operator-actions/${actionId}/responses`,
        token,
        body: { itens: items },
        transform: (data) => ({
          ok: true,
          acao_id: rawActionId,
          execucao_id: stringValue(data.execucao_id),
          saved_count: numberValue(data.quantidade_salva),
          error_count: 0,
          salvos: asArray(data.salvos),
          erros: [],
          can_finalize: false,
          message: "Checklist salvo com rastreabilidade.",
        }),
      };
    }
    case "operador.validar_finalizacao_acao": {
      const rawActionId = stringValue(payload.acao_id);
      const actionId = encodeURIComponent(rawActionId);
      return {
        method: "GET",
        path: `/v1/maintenance/operator-actions/${actionId}/validation`,
        token,
        transform: (data) => ({
          ok: true,
          acao_id: rawActionId,
          execucao_id: stringValue(data.execucao_id),
          can_finalize: data.pode_concluir === true,
          finalizacao: {
            ok: data.pode_concluir === true,
            can_finalize: data.pode_concluir === true,
            total: numberValue(data.total),
            respondidos: numberValue(data.respondidos),
            pending_count: numberValue(data.respostas_pendentes),
            evidence_missing_count: numberValue(data.evidencias_pendentes),
            blockers_count: numberValue(data.nao_conformes_bloqueantes),
          },
          message:
            data.pode_concluir === true
              ? "Execução pronta para conclusão."
              : "Ainda existem etapas que bloqueiam a conclusão.",
        }),
      };
    }
    case "operador.finalizar_acao": {
      const rawActionId = stringValue(payload.acao_id);
      const actionId = encodeURIComponent(rawActionId);
      const result =
        stringValue(payload.resultado_operacional) ||
        (stringValue(payload.resultado) === "OK" ? "CONFORME" : "NAO_CONFORME");
      return {
        method: "POST",
        path: `/v1/maintenance/operator-actions/${actionId}/complete`,
        token,
        body: {
          resultado: result,
          observacao: stringValue(payload.observacao) || null,
          modo_parada: "EXECUTOR_DECISION",
        },
        transform: (data) => {
          const execution = asRecord(data.execucao);
          return {
            finalized: data.finalizada === true,
            acao_id: rawActionId,
            execucao_id: stringValue(execution.id),
            status_acao: "CONCLUIDA",
            resultado: stringValue(payload.resultado),
            resultado_operacional: stringValue(payload.resultado_operacional),
            requires_manager_validation: false,
            pendencias_registradas: {
              obrigatorias: 0,
              evidencias: 0,
              bloqueios: 0,
            },
          };
        },
      };
    }
    case "operador.contexto_qr": {
      const code = encodeURIComponent(stringValue(payload.qr_payload).trim());
      return {
        method: "GET",
        path: `/v1/cmms/qr-context/${code}`,
        token,
        transform: operatorQrContext,
      };
    }
    case "operador.historico_qr": {
      const assetId = encodeURIComponent(stringValue(payload.ativo_id));
      const parameters = new URLSearchParams();
      const componentId = stringValue(payload.componente_id);
      const cursor = stringValue(payload.cursor);
      if (componentId) parameters.set("componente_id", componentId);
      if (cursor) parameters.set("antes_de", cursor);
      parameters.set(
        "limite",
        String(Math.min(100, Math.max(1, numberValue(payload.limit) || 4))),
      );
      return {
        method: "GET",
        path: `/v1/cmms/assets/${assetId}/history?${parameters.toString()}`,
        token,
        transform: (data) => ({
          items: asArray(data.itens).map(qrHistory),
          ativo_id: stringValue(data.ativo_id),
          componente_id: stringValue(data.componente_id) || undefined,
          next_cursor: stringValue(data.proximo_cursor) || undefined,
          has_more: data.possui_mais === true,
          limit: numberValue(data.limite),
          scanned_rows: numberValue(data.linhas_consultadas),
        }),
      };
    }
    case "operador.registrar_parametro": {
      const assetId = encodeURIComponent(stringValue(payload.ativo_id));
      return {
        method: "POST",
        path: `/v1/cmms/assets/${assetId}/readings`,
        token,
        body: {
          componente_id: stringValue(payload.componente_id) || null,
          parametro: stringValue(payload.parametro),
          valor: numberValue(payload.valor),
          unidade: stringValue(payload.unidade),
          origem: "MANUAL",
          chave_idempotencia: `qr-${crypto.randomUUID()}`,
        },
        transform: (data) => ({
          saved: data.salva === true,
          parametro: qrParameter(data.parametro),
          recalculo: { criada: data.criada === true },
        }),
      };
    }
    case "operador.parada_ativa": {
      const assetId = stringValue(payload.ativo_id);
      if (!assetId) return null;
      const parameters = new URLSearchParams({
        ativo_id: assetId,
        somente_abertas: "true",
        limite: "1",
      });
      return {
        method: "GET",
        path: `/v1/maintenance/stops?${parameters.toString()}`,
        token,
        transform: (data) => {
          const stop = asArray(data.itens)[0];
          return {
            found: Boolean(stop),
            ativo_id: assetId,
            parada_ativa: qrStop(stop),
            server_time: new Date().toISOString(),
          };
        },
      };
    }
    case "operador.iniciar_parada":
      return {
        method: "POST",
        path: "/v1/maintenance/stops",
        token,
        body: {
          ativo_id: payload.ativo_id,
          componente_id: stringValue(payload.componente_id) || null,
          origem: "OPERADOR_QR",
          tipo: stringValue(payload.tipo) || "NAO_PROGRAMADA",
          motivo:
            stringValue(payload.motivo_parada) ||
            "Parada registrada pelo Operador.",
          iniciada_em: new Date().toISOString(),
          tolerancia_retorno_minutos: 10,
        },
        transform: (data) => ({
          started: true,
          already_open: data.ja_aberta === true,
          parada: qrStop(data),
          notified_profiles: ["ADMIN", "GESTOR"],
        }),
      };
    case "operador.finalizar_parada": {
      const stopId = encodeURIComponent(stringValue(payload.parada_id));
      return {
        method: "POST",
        path: `/v1/maintenance/stops/${stopId}/transition`,
        token,
        body: {
          status: "COMPLETED",
          categoria_retorno:
            stringValue(payload.categoria_retorno) || "RETORNO_NORMAL",
          justificativa_divergencia:
            stringValue(payload.justificativa_divergencia) || null,
        },
        transform: (data) => ({
          closed: true,
          already_closed: data.ja_concluida === true,
          requires_justification: false,
          tolerance_minutes: numberValue(data.return_tolerance_minutes),
          delay_seconds: 0,
          parada: qrStop(data),
          metricas: {
            tempo_parada_segundos: numberValue(data.downtime_seconds),
            tempo_espera_manutencao_segundos: numberValue(
              data.maintenance_wait_seconds,
            ),
            tempo_execucao_segundos: numberValue(data.execution_seconds),
            tempo_retorno_operacional_segundos: numberValue(
              data.operational_return_seconds,
            ),
          },
        }),
      };
    }
    case "operador.registrar_ocorrencia":
      return {
        method: "POST",
        path: "/v1/maintenance/occurrences",
        token,
        body: {
          ativo_id: payload.ativo_id,
          componente_id: stringValue(payload.componente_id) || null,
          tipo:
            stringValue(payload.tipo) ||
            stringValue(payload.alvo_ocorrencia) ||
            "OPERACIONAL",
          titulo: payload.titulo,
          descricao: payload.descricao,
          severidade: monitoringSeverity(payload.severidade),
          equipamento_parado: false,
          tipo_parada: null,
          motivo_parada: null,
          ocorrida_em: new Date().toISOString(),
        },
        transform: (data) => ({
          saved: true,
          occurrence: qrOccurrence(data),
          alvo_ocorrencia: payload.alvo_ocorrencia,
          notified_profiles: ["ADMIN", "GESTOR"],
        }),
      };
    default:
      return null;
  }
}

function nodeBaseUrl(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

function isAppsScriptUrl(apiUrl: string): boolean {
  return /script\.google\.com|script\.googleusercontent\.com/i.test(apiUrl);
}

export function usesNodeApiTransport(): boolean {
  const apiUrl = getApiUrl();
  const transport = getApiTransport();
  return (
    Boolean(apiUrl) &&
    (transport === "node" || (transport === "auto" && !isAppsScriptUrl(apiUrl)))
  );
}

export async function callNodeMultipart<T>(
  path: string,
  token: string,
  body: FormData,
  timeoutMs = API_TIMEOUT_MS.EVIDENCE_UPLOAD,
): Promise<ApiEnvelope<T>> {
  const apiUrl = getApiUrl();
  if (!apiUrl)
    throw new ApiRequestError("URL da API não configurada.", "API_URL_MISSING");

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${nodeBaseUrl(apiUrl)}${path}`, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      body,
      signal: controller.signal,
    });
    const envelope = (await response.json()) as ApiEnvelope<T>;
    if (!response.ok || !envelope.ok) {
      throw new ApiRequestError(
        envelope.error?.message ??
          `A API respondeu com HTTP ${response.status}.`,
        envelope.error?.code ?? "HTTP_ERROR",
        envelope.error?.details ?? { status: response.status },
      );
    }
    return envelope;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiRequestError(
        `O upload excedeu ${Math.round(timeoutMs / 1000)} segundos.`,
        "API_TIMEOUT",
      );
    }
    throw new ApiRequestError(
      "Não foi possível enviar a evidência para a API Node.",
      "NETWORK_ERROR",
      error,
    );
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function fetchNodePrivateBlob(
  path: string,
  token: string,
  timeoutMs = API_TIMEOUT_MS.DETAIL_READ,
): Promise<Blob> {
  const apiUrl = getApiUrl();
  if (!apiUrl)
    throw new ApiRequestError("URL da API não configurada.", "API_URL_MISSING");

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${nodeBaseUrl(apiUrl)}${path}`, {
      headers: {
        Accept: "image/jpeg,image/png,image/webp",
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      let message = `A API respondeu com HTTP ${response.status}.`;
      try {
        const envelope = (await response.json()) as ApiEnvelope<never>;
        message = envelope.error?.message ?? message;
      } catch {
        // Resposta sem envelope; mantém a mensagem HTTP segura.
      }
      throw new ApiRequestError(message, "EVIDENCE_DOWNLOAD_FAILED", {
        status: response.status,
      });
    }
    return await response.blob();
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiRequestError(
        "O carregamento da evidência excedeu o tempo limite.",
        "API_TIMEOUT",
      );
    }
    throw new ApiRequestError(
      "Não foi possível carregar a evidência privada.",
      "NETWORK_ERROR",
      error,
    );
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function executeNodeCall<T>(
  apiUrl: string,
  action: string,
  request: NodeActionRequest,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<ApiEnvelope<T>> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (request.body) headers["Content-Type"] = "application/json";
    if (request.token) headers.Authorization = `Bearer ${request.token}`;
    const response = await fetch(`${nodeBaseUrl(apiUrl)}${request.path}`, {
      method: request.method,
      headers,
      body: request.body ? JSON.stringify(request.body) : undefined,
      signal: controller.signal,
    });
    const envelope = (await response.json()) as ApiEnvelope<
      Record<string, unknown>
    >;
    if (!response.ok || !envelope.ok) {
      throw new ApiRequestError(
        envelope.error?.message ??
          `A API respondeu com HTTP ${response.status}.`,
        envelope.error?.code ?? "HTTP_ERROR",
        envelope.error?.details ?? { status: response.status },
      );
    }
    const data = envelope.data ?? {};
    return {
      ...envelope,
      data: (request.transform ? request.transform(data) : data) as T,
    };
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      if (signal?.aborted) throw error;
      throw new ApiRequestError(
        timedOut
          ? `A API excedeu ${Math.round(timeoutMs / 1000)} segundos.`
          : "A requisição foi cancelada.",
        timedOut ? "API_TIMEOUT" : "API_ABORTED",
        { action, timeoutMs },
      );
    }
    throw new ApiRequestError(
      "Não foi possível alcançar a API Node. Verifique a rede e a configuração do endpoint.",
      "NETWORK_ERROR",
      error,
    );
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

export function callApi<T>(
  action: string,
  payload: Record<string, unknown> = {},
  signal?: AbortSignal,
  options: ApiCallOptions = {},
): Promise<ApiEnvelope<T>> {
  const apiUrl = getApiUrl();

  if (!apiUrl) {
    return Promise.reject(
      new ApiRequestError(
        "URL da API não configurada. Abra Configurações e informe o endpoint.",
        "API_URL_MISSING",
      ),
    );
  }

  const timeoutMs = options.timeoutMs ?? API_TIMEOUT_MS.DETAIL_READ;
  const canDedupe = options.dedupe === true && signal === undefined;
  const dedupeKey = canDedupe
    ? (options.dedupeKey ?? `${apiUrl}|${action}|${stableSerialize(payload)}`)
    : "";

  if (dedupeKey) {
    const existing = inFlightReads.get(dedupeKey);
    if (existing) return existing as Promise<ApiEnvelope<T>>;
  }

  const transport = getApiTransport();
  const useNode =
    transport === "node" || (transport === "auto" && !isAppsScriptUrl(apiUrl));
  const nodeRequest = useNode ? nodeActionRequest(action, payload) : null;
  let request: Promise<ApiEnvelope<T>>;
  if (nodeRequest) {
    request = executeNodeCall<T>(
      apiUrl,
      action,
      nodeRequest,
      signal,
      timeoutMs,
    );
  } else if (useNode) {
    const legacyUrl = getLegacyApiUrl();
    request = legacyUrl
      ? executeAppsScriptCall<T>(legacyUrl, action, payload, signal, timeoutMs)
      : Promise.reject(
          new ApiRequestError(
            `A ação ${action} ainda não possui adaptador Node e o fallback legado não está configurado.`,
            "NODE_ACTION_NOT_MIGRATED",
            { action },
          ),
        );
  } else {
    request = executeAppsScriptCall<T>(
      apiUrl,
      action,
      payload,
      signal,
      timeoutMs,
    );
  }

  if (!dedupeKey) return request;

  const sharedRequest = request.finally(() => {
    if (inFlightReads.get(dedupeKey) === sharedRequest) {
      inFlightReads.delete(dedupeKey);
    }
  });

  inFlightReads.set(dedupeKey, sharedRequest as Promise<ApiEnvelope<unknown>>);
  return sharedRequest;
}
