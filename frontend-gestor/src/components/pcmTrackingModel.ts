import type { AdminIntervention } from "../types/interventions";

export type TrackingFilter =
  | "all"
  | "running"
  | "blocked"
  | "late"
  | "completed"
  | "queued";
export function trackingState(
  order: AdminIntervention,
): TrackingFilter | "cancelled" {
  const status = order.status.toUpperCase();
  if (["CANCELADA", "CANCELLED"].includes(status)) return "cancelled";
  if (["CONCLUIDA", "COMPLETED"].includes(status)) return "completed";
  if (["BLOQUEADA", "BLOCKED"].includes(status)) return "blocked";
  if (["EM_EXECUCAO", "IN_PROGRESS"].includes(status)) return "running";
  return "queued";
}
export function isTrackingLate(order: AdminIntervention, now: number): boolean {
  if (
    [
      "CONCLUIDA",
      "COMPLETED",
      "CANCELADA",
      "CANCELLED",
      "RASCUNHO",
      "DRAFT",
    ].includes(order.status.toUpperCase())
  )
    return false;
  const scheduled = Date.parse(order.planejada_para ?? "");
  return Number.isFinite(scheduled) && scheduled < now;
}
export function matchesTrackingFilter(
  order: AdminIntervention,
  filter: TrackingFilter,
  now: number,
): boolean {
  return (
    filter === "all" ||
    (filter === "late"
      ? isTrackingLate(order, now)
      : trackingState(order) === filter)
  );
}
