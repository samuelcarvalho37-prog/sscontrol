import type {
  PlatformModuleMetric,
  PlatformSupportRequest,
  PlatformTenantSummary,
} from "../services/api/platform";

export const PLATFORM_DEMO_TENANTS: PlatformTenantSummary[] = [
  {
    tenant_id: "local-demo-fabrica-norte",
    display_name: "Fábrica Norte · Demonstração",
    slug: "fabrica-norte-demo",
    tenant_status: "ACTIVE",
    environment: "DEVELOPMENT",
    created_at: "2026-10-20T12:00:00.000Z",
    plan_code: "COMPLETE",
    plan_name: "Completo",
    subscription_status: "ACTIVE",
    subscription_ends_at: null,
    subscription_id: null,
    monthly_price: null,
    discount_percent: 0,
    implementation_days: 0,
    feature_codes: [],
  },
  {
    tenant_id: "local-demo-usina-central",
    display_name: "Usina Central · Demonstração",
    slug: "usina-central-demo",
    tenant_status: "ACTIVE",
    environment: "DEVELOPMENT",
    created_at: "2026-10-18T12:00:00.000Z",
    plan_code: "BUSINESS",
    plan_name: "Empresarial",
    subscription_status: "TRIAL",
    subscription_ends_at: "2026-11-30T23:59:59.000Z",
    subscription_id: null,
    monthly_price: null,
    discount_percent: 0,
    implementation_days: 0,
    feature_codes: [],
  },
];

export const PLATFORM_DEMO_TELEMETRY: Array<{
  tenant_id: string;
  modules: PlatformModuleMetric[];
}> = [
  {
    tenant_id: "local-demo-fabrica-norte",
    modules: [
      {
        module: "maintenance",
        calls: 184,
        serverErrors: 0,
        deniedRequests: 2,
        p95Ms: 210,
        averageMs: 84,
        state: "HEALTHY",
        capabilities: [
          {
            capability: "work_orders.read",
            calls: 102,
            p95Ms: 198,
            serverErrors: 0,
            state: "HEALTHY",
          },
          {
            capability: "checklists.execute",
            calls: 82,
            p95Ms: 210,
            serverErrors: 0,
            state: "HEALTHY",
          },
        ],
      },
      {
        module: "governance",
        calls: 42,
        serverErrors: 1,
        deniedRequests: 0,
        p95Ms: 1_240,
        averageMs: 380,
        state: "WARNING",
        capabilities: [
          {
            capability: "imports.validate",
            calls: 42,
            p95Ms: 1_240,
            serverErrors: 1,
            state: "WARNING",
          },
        ],
      },
    ],
  },
  {
    tenant_id: "local-demo-usina-central",
    modules: [
      {
        module: "maintenance",
        calls: 76,
        serverErrors: 4,
        deniedRequests: 1,
        p95Ms: 2_410,
        averageMs: 620,
        state: "CRITICAL",
        capabilities: [
          {
            capability: "plans.publish",
            calls: 76,
            p95Ms: 2_410,
            serverErrors: 4,
            state: "CRITICAL",
          },
        ],
      },
    ],
  },
];

export const PLATFORM_DEMO_REQUESTS: PlatformSupportRequest[] = [
  {
    request_id: "local-demo-support-001",
    tenant_id: "local-demo-usina-central",
    tenant_name: "Usina Central · Demonstração",
    requester_id: "local-demo-requester-001",
    topic: "DESEMPENHO",
    module: "Manutenção",
    summary: "Atraso na publicação de planos",
    technical_context:
      "Registro fictício para demonstrar o acompanhamento de chamados no console.",
    request_id_header: "DEMO-001",
    status: "OPEN",
    created_at: "2026-10-27T10:30:00.000Z",
    updated_at: "2026-10-27T10:30:00.000Z",
    scheduled_at: null,
    service_mode: "REMOTE",
  },
];
