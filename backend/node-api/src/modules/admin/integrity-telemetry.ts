const WINDOW_MS = 15 * 60_000;
const MAX_SAMPLES_PER_CAPABILITY = 120;
const MAX_TRACKED_CAPABILITIES = 5_000;
const MIN_SAMPLES_FOR_ALERT = 5;
const WARNING_P95_MS = 800;
const CRITICAL_P95_MS = 2_000;
const WARNING_ERROR_RATIO = 0.05;
const CRITICAL_ERROR_RATIO = 0.1;

interface TelemetrySample {
  readonly elapsedMs: number;
  readonly statusCode: number;
  readonly occurredAt: number;
}

interface CapabilitySamples {
  readonly tenantId: string;
  readonly capability: string;
  samples: TelemetrySample[];
}

export interface CapabilityTelemetry {
  readonly capability: string;
  readonly calls: number;
  readonly p95Ms: number;
  readonly averageMs: number;
  readonly serverErrors: number;
  readonly deniedRequests: number;
  readonly errorRatio: number;
  readonly state: 'INSUFFICIENT_DATA' | 'HEALTHY' | 'WARNING' | 'CRITICAL';
  readonly observedAt: string | null;
}

export interface ModuleTelemetry {
  readonly module: string;
  readonly calls: number;
  readonly serverErrors: number;
  readonly deniedRequests: number;
  readonly p95Ms: number;
  readonly averageMs: number;
  readonly state: CapabilityTelemetry['state'];
  readonly capabilities: readonly CapabilityTelemetry[];
}

const telemetry = new Map<string, CapabilitySamples>();

function percentile95(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

function capabilityModule(capability: string): string {
  if (capability.startsWith('admin.identity.')) return 'IDENTIDADES';
  if (capability.startsWith('admin.governance.')) return 'GOVERNANCA';
  if (capability.startsWith('admin.configuration.')) return 'CONFIGURACAO';
  if (capability.startsWith('cmms.structure.')) return 'ESTRUTURA';
  if (capability.startsWith('cmms.assets.') || capability.startsWith('cmms.parameters.') || capability === 'cmms.readings.create') return 'ATIVOS';
  if (capability.startsWith('cmms.materials.')) return 'MATERIAIS';
  if (capability.startsWith('maintenance.checklists.')) return 'CHECKLISTS';
  if (capability.startsWith('maintenance.plans.')) return 'PLANOS';
  if (capability.startsWith('maintenance.work-orders.') || capability.startsWith('maintenance.executions.') || capability.startsWith('maintenance.actions.')) return 'ORDENS_E_EXECUCOES';
  if (capability.startsWith('maintenance.occurrences.') || capability.startsWith('maintenance.stops.') || capability.startsWith('maintenance.alerts.')) return 'OCORRENCIAS_E_ALERTAS';
  if (capability.startsWith('analytics.')) return 'INDICADORES';
  if (capability.startsWith('workflow.notifications.')) return 'NOTIFICACOES';
  return 'OUTROS';
}

function summarize(entry: CapabilitySamples, now: number): CapabilityTelemetry | null {
  const active = entry.samples.filter((sample) => sample.occurredAt >= now - WINDOW_MS);
  entry.samples = active;
  if (!active.length) return null;

  const durations = active.map((sample) => sample.elapsedMs);
  const serverErrors = active.filter((sample) => sample.statusCode >= 500).length;
  const deniedRequests = active.filter((sample) => sample.statusCode === 403).length;
  const errorRatio = serverErrors / active.length;
  const p95Ms = percentile95(durations);
  const state: CapabilityTelemetry['state'] = active.length < MIN_SAMPLES_FOR_ALERT
    ? 'INSUFFICIENT_DATA'
    : errorRatio >= CRITICAL_ERROR_RATIO || p95Ms >= CRITICAL_P95_MS
      ? 'CRITICAL'
      : errorRatio >= WARNING_ERROR_RATIO || p95Ms >= WARNING_P95_MS
        ? 'WARNING'
        : 'HEALTHY';

  return {
    capability: entry.capability,
    calls: active.length,
    p95Ms,
    averageMs: Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
    serverErrors,
    deniedRequests,
    errorRatio: Math.round(errorRatio * 10_000) / 100,
    state,
    observedAt: new Date(active[active.length - 1]?.occurredAt ?? now).toISOString(),
  };
}

export function recordCapabilityResponse(
  tenantId: string,
  capability: string,
  elapsedMs: number,
  statusCode: number,
  occurredAt = Date.now(),
): void {
  if (!tenantId || !capability || !Number.isFinite(elapsedMs) || elapsedMs < 0) return;
  const key = `${tenantId}:${capability}`;
  let entry = telemetry.get(key);
  if (!entry) {
    if (telemetry.size >= MAX_TRACKED_CAPABILITIES) {
      const oldestKey = telemetry.keys().next().value;
      if (oldestKey) telemetry.delete(oldestKey);
    }
    entry = { tenantId, capability, samples: [] };
    telemetry.set(key, entry);
  }
  entry.samples = entry.samples.filter((sample) => sample.occurredAt >= occurredAt - WINDOW_MS);
  entry.samples.push({ elapsedMs: Math.round(elapsedMs), statusCode, occurredAt });
  if (entry.samples.length > MAX_SAMPLES_PER_CAPABILITY) {
    entry.samples = entry.samples.slice(-MAX_SAMPLES_PER_CAPABILITY);
  }
}

export function readCapabilityTelemetry(tenantId: string, now = Date.now()): readonly ModuleTelemetry[] {
  const byModule = new Map<string, CapabilityTelemetry[]>();
  for (const [key, entry] of telemetry) {
    if (entry.tenantId !== tenantId) continue;
    const summary = summarize(entry, now);
    if (!summary) {
      telemetry.delete(key);
      continue;
    }
    const module = capabilityModule(entry.capability);
    const capabilities = byModule.get(module) ?? [];
    capabilities.push(summary);
    byModule.set(module, capabilities);
  }

  return [...byModule.entries()].map(([module, capabilities]) => {
    const calls = capabilities.reduce((sum, item) => sum + item.calls, 0);
    const serverErrors = capabilities.reduce((sum, item) => sum + item.serverErrors, 0);
    const deniedRequests = capabilities.reduce((sum, item) => sum + item.deniedRequests, 0);
    const weightedAverage = calls
      ? Math.round(capabilities.reduce((sum, item) => sum + item.averageMs * item.calls, 0) / calls)
      : 0;
    // O módulo resume o pior p95 por capacidade, sem simular amostras que não existem.
    const p95Ms = Math.max(...capabilities.map((item) => item.p95Ms));
    const state: CapabilityTelemetry['state'] = capabilities.some((item) => item.state === 'CRITICAL')
      ? 'CRITICAL'
      : capabilities.some((item) => item.state === 'WARNING')
        ? 'WARNING'
        : capabilities.every((item) => item.state === 'INSUFFICIENT_DATA')
          ? 'INSUFFICIENT_DATA'
          : 'HEALTHY';
    return {
      module,
      calls,
      serverErrors,
      deniedRequests,
      p95Ms,
      averageMs: weightedAverage,
      state,
      capabilities: capabilities.sort((first, second) => first.capability.localeCompare(second.capability)),
    };
  }).sort((first, second) => {
    const rank = (state: CapabilityTelemetry['state']) => state === 'CRITICAL' ? 0 : state === 'WARNING' ? 1 : state === 'INSUFFICIENT_DATA' ? 2 : 3;
    return rank(first.state) - rank(second.state) || first.module.localeCompare(second.module);
  });
}

export function readAllCapabilityTelemetry(now = Date.now()): readonly {
  readonly tenantId: string;
  readonly modules: readonly ModuleTelemetry[];
}[] {
  const tenantIds = new Set([...telemetry.values()].map((entry) => entry.tenantId));
  return [...tenantIds].map((tenantId) => ({
    tenantId,
    modules: readCapabilityTelemetry(tenantId, now),
  }));
}

export function clearCapabilityTelemetryForTests(): void {
  telemetry.clear();
}
