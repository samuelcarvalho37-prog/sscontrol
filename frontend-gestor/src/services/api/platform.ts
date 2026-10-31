import { getApiUrl, getDevelopmentTenantSlug, usesNodeApi } from "./config";

export interface PlatformTenantSummary {
  tenant_id: string;
  display_name: string;
  slug: string;
  tenant_status: string;
  environment: string;
  created_at: string;
  plan_code: string | null;
  plan_name: string | null;
  subscription_status: string | null;
  subscription_ends_at: string | null;
  subscription_id: string | null;
  monthly_price: number | string | null;
  discount_percent: number | string | null;
  implementation_days: number | null;
  feature_codes: string[];
  initial_admin_created?: boolean;
}

export interface PlatformPlan {
  plan_id: string;
  code: string;
  name: string;
  description: string;
  status: "DRAFT" | "ACTIVE" | "RETIRED";
  version: number;
  monthly_price: number | string;
  features: Array<{ code: string; name: string; description: string; module: string }>;
}

export interface PlatformFeature {
  code: string;
  name: string;
  description: string;
  module: string;
}

export interface PlatformModuleMetric {
  module: string;
  calls: number;
  serverErrors: number;
  deniedRequests: number;
  p95Ms: number;
  averageMs: number;
  state: "INSUFFICIENT_DATA" | "HEALTHY" | "WARNING" | "CRITICAL";
  capabilities: Array<{
    capability: string;
    calls: number;
    p95Ms: number;
    serverErrors: number;
    state: string;
  }>;
}

export interface PlatformSupportRequest {
  request_id: string;
  tenant_id: string;
  tenant_name: string;
  requester_id: string;
  topic: string;
  module: string;
  summary: string;
  technical_context: string;
  request_id_header: string | null;
  status: "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
  created_at: string;
  updated_at: string;
  scheduled_at: string | null;
  service_mode: "REMOTE" | "ONSITE";
  attachments?: Array<{ object_id: string; original_name: string; media_type: string }>;
}

export interface PlatformSession {
  token: string;
  expires_at: string;
  operator: { id: string; login: string; name: string };
}

const API_TIMEOUT_MS = 20_000;

function apiRoot(): string {
  const configured = getApiUrl().trim();
  if (!configured)
    throw new Error("Configure a URL da API antes de acessar este console.");
  if (!usesNodeApi())
    throw new Error("O console da plataforma requer a API Node.");
  return configured.replace(/\/+$/u, "").replace(/\/v1$/u, "");
}

function devHeaders(): Record<string, string> {
  const slug = getDevelopmentTenantSlug();
  return slug ? { "X-VORQIX-DEV-TENANT": slug } : {};
}

async function request<T>(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...devHeaders(),
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  try {
    const response = await fetch(`${apiRoot()}${path}`, {
      method: options.method ?? "GET",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      cache: "no-store",
    });
    const envelope = (await response.json()) as {
      ok?: boolean;
      data?: T;
      error?: { message?: string };
    };
    if (!response.ok || !envelope.ok || envelope.data === undefined) {
      throw new Error(
        envelope.error?.message ||
          `A API respondeu com HTTP ${response.status}.`,
      );
    }
    return envelope.data;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function loginPlatform(
  login: string,
  password: string,
  code: string,
): Promise<PlatformSession> {
  return request("/v1/platform/auth/login", {
    method: "POST",
    body: { login, password, code },
  });
}

export function getPlatformSession(token: string) {
  return request<{ operator: PlatformSession["operator"] }>(
    "/v1/platform/auth/session",
    { token },
  );
}

export function logoutPlatform(
  token: string,
): Promise<{ logged_out: boolean }> {
  return request("/v1/platform/auth/logout", {
    method: "POST",
    token,
    body: {},
  });
}

export function listPlatformTenants(
  token: string,
): Promise<{ items: PlatformTenantSummary[] }> {
  return request("/v1/platform/tenants", { token });
}

export function createPlatformTenant(token: string, input: {
  display_name: string;
  legal_name: string;
  tax_identifier?: string;
  slug: string;
  environment: "DEVELOPMENT" | "HOMOLOGATION" | "PRODUCTION";
  plan_id?: string;
  monthly_price?: number;
  discount_percent?: number;
  implementation_days?: number;
  feature_codes?: string[];
}): Promise<{ tenant_id: string; subscription_id: string | null }> {
  return request("/v1/platform/tenants", { method: "POST", token, body: input });
}

export function createPlatformTenantInitialAdmin(token: string, tenantId: string, input: {
  name: string;
  employee_number: string;
  email: string;
}): Promise<{ user_id: string; login: string; temporary_password: string }> {
  return request(`/v1/platform/tenants/${encodeURIComponent(tenantId)}/initial-admin`, {
    method: "POST", token, body: input,
  });
}

export function listPlatformPlans(token: string) {
  return request<{ items: PlatformPlan[] }>("/v1/platform/plans", { token });
}

export function listPlatformFeatures(token: string) {
  return request<{ items: PlatformFeature[] }>("/v1/platform/features", { token });
}

export function savePlatformPlan(token: string, input: Omit<PlatformPlan, "plan_id" | "version" | "features"> & { plan_id?: string; feature_codes: string[] }) {
  const { plan_id, ...body } = input;
  return request<{ plan_id: string }>(plan_id ? `/v1/platform/plans/${encodeURIComponent(plan_id)}` : "/v1/platform/plans", {
    method: plan_id ? "PUT" : "POST", token, body,
  });
}

export function updatePlatformTenantSubscription(token: string, tenantId: string, input: {
  plan_id: string; status: string; monthly_price: number; discount_percent: number;
  implementation_days: number; feature_codes: string[];
}) {
  return request<{ subscription_id: string }>(`/v1/platform/tenants/${encodeURIComponent(tenantId)}/subscription`, {
    method: "PATCH", token, body: input,
  });
}

export function readPlatformTelemetry(token: string): Promise<{
  window_minutes: number;
  source: string;
  tenants: Array<{ tenant_id: string; modules: PlatformModuleMetric[] }>;
}> {
  return request("/v1/platform/telemetry", { token });
}

export function listPlatformSupportRequests(
  token: string,
): Promise<{ items: PlatformSupportRequest[] }> {
  return request("/v1/platform/support-requests", { token });
}

export function updatePlatformSupportRequest(
  token: string,
  requestId: string,
  status: PlatformSupportRequest["status"],
  scheduledAt?: string | null,
  serviceMode?: "REMOTE" | "ONSITE",
): Promise<{ updated: boolean }> {
  return request(
    `/v1/platform/support-requests/${encodeURIComponent(requestId)}`,
    { method: "PATCH", token, body: { status, scheduled_at: scheduledAt, service_mode: serviceMode } },
  );
}

export function createTenantSupportRequest(
  token: string,
  input: {
    topic: string;
    module: string;
    summary: string;
    technical_context: string;
    screenshots: File[];
  },
): Promise<{ id: string; status: string }> {
  const body = new FormData();
  body.set("topic", input.topic);
  body.set("module", input.module);
  body.set("summary", input.summary);
  body.set("technical_context", input.technical_context);
  input.screenshots.forEach((file) => body.append("screenshots", file, file.name));
  return multipartRequest("/v1/platform/support-requests", token, body);
}

export function listTenantSupportRequests(token: string) {
  return request<{ items: PlatformSupportRequest[] }>("/v1/platform/my-support-requests", { token });
}

export async function fetchSupportAttachment(token: string, objectId: string, audience: "platform" | "tenant" = "platform"): Promise<Blob> {
  const path = audience === "tenant" ? "my-support-attachments" : "support-attachments";
  const response = await fetch(`${apiRoot()}/v1/platform/${path}/${encodeURIComponent(objectId)}`, {
    headers: { Accept: "image/*", Authorization: `Bearer ${token}`, ...devHeaders() },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Não foi possível abrir a imagem do chamado.");
  return response.blob();
}

async function multipartRequest<T>(path: string, token: string, body: FormData): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(`${apiRoot()}${path}`, {
      method: "POST", headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...devHeaders() },
      body, signal: controller.signal, cache: "no-store",
    });
    const envelope = await response.json() as { ok?: boolean; data?: T; error?: { message?: string } };
    if (!response.ok || !envelope.ok || envelope.data === undefined)
      throw new Error(envelope.error?.message ?? `A API respondeu com HTTP ${response.status}.`);
    return envelope.data;
  } finally {
    window.clearTimeout(timeout);
  }
}
