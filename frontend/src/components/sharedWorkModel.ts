export type SharedRow = Record<string, unknown> & { id: string };
export function usesSharedHome(capabilities:readonly string[]|undefined,profile:string){
  return Boolean(capabilities?.includes('maintenance.shared.read')) && !capabilities?.includes('maintenance.work-orders.review')
    && !['TECNICO','PCM','GESTOR','ADMIN','SISTEMA'].includes(profile.trim().toUpperCase());
}
export type SharedAsset = {
  id: string;
  tag: string;
  nome: string;
  planta_id: string;
  planta: string;
  setor_id: string;
  setor: string;
  linha_id: string;
  linha: string;
};
export type SharedApi = <T>(
  path: string,
  body?: unknown,
  method?: string,
  signal?: AbortSignal,
) => Promise<T>;
export const workText = (value: unknown) =>
  value == null || value === "" ? "—" : String(value);
export const workDate = (value: unknown) =>
  value ? new Date(String(value)).toLocaleString("pt-BR") : "—";
export const workLabels: Record<string, string> = {
  OPEN: "Aguardando PCM",
  IN_TREATMENT: "Em avaliação pelo PCM",
  DRAFT: "Em preparação pelo PCM",
  APPROVED: "Aprovada pelo PCM",
  RELEASED: "Liberada para execução",
  IN_PROGRESS: "Em execução",
  PAUSED: "Pausada",
  IN_TECHNICAL_REVIEW: "Aguardando validação técnica",
  COMPLETED: "Concluída",
  RESOLVED: "Resolvida",
  CANCELLED: "Rejeitada ou cancelada",
  CLOSED: "Encerrada",
  CORRECTIVE: "Corretiva",
  PREVENTIVE: "Preventiva",
  LUBRICATION: "Lubrificação",
  INSPECTION: "Inspeção",
  IMPROVEMENT: "Melhoria",
  CRITICAL: "Crítica",
  HIGH: "Alta",
  MEDIUM: "Média",
  LOW: "Baixa",
  QUALITY: "Qualidade",
  SAFETY: "Segurança",
};
export const assessmentQuestions = [
  ["equipamento_parado", "O equipamento está parado?"],
  ["risco_parada", "Existe risco de parada?"],
  ["risco_seguranca", "Existe risco de segurança?"],
  ["impacto_producao", "Há impacto na produção?"],
  ["impacto_qualidade", "Há impacto na qualidade?"],
  ["existe_redundancia", "Existe equipamento redundante disponível?"],
] as const;
export type Answers = Record<
  (typeof assessmentQuestions)[number][0],
  boolean | null
>;
export const blankAnswers = (): Answers => ({
  equipamento_parado: null,
  risco_parada: null,
  risco_seguranca: null,
  impacto_producao: null,
  impacto_qualidade: null,
  existe_redundancia: null,
});
export function workPriority(a: Answers) {
  if (
    a.risco_seguranca ||
    (a.equipamento_parado &&
      a.impacto_producao &&
      a.existe_redundancia === false)
  )
    return "CRITICAL";
  if (
    a.equipamento_parado ||
    a.impacto_qualidade ||
    (a.risco_parada && a.existe_redundancia === false)
  )
    return "HIGH";
  return a.risco_parada || a.impacto_producao ? "MEDIUM" : "LOW";
}
export function locationChoices(
  assets: SharedAsset[],
  level: "planta" | "setor" | "linha",
  plant = "",
  sector = "",
) {
  const rows = assets.filter(
    (a) =>
      (level === "planta" || a.planta_id === plant) &&
      (level !== "linha" || a.setor_id === sector),
  );
  return Array.from(
    new Map(
      rows.map((a) => [
        a[`${level}_id`],
        { id: a[`${level}_id`], nome: a[level] },
      ]),
    ).values(),
  ).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}
