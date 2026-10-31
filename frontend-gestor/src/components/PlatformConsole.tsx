import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { SupportAttachments } from "./SupportAttachments";
import "../styles/platform-console.css";
import {
  getPlatformSession,
  createPlatformTenant,
  createPlatformTenantInitialAdmin,
  listPlatformSupportRequests,
  listPlatformTenants,
  listPlatformPlans,
  listPlatformFeatures,
  savePlatformPlan,
  updatePlatformTenantSubscription,
  loginPlatform,
  logoutPlatform,
  readPlatformTelemetry,
  updatePlatformSupportRequest,
  type PlatformModuleMetric,
  type PlatformSession,
  type PlatformSupportRequest,
  type PlatformTenantSummary,
  type PlatformPlan,
  type PlatformFeature,
} from "../services/api/platform";
import {
  PLATFORM_DEMO_REQUESTS,
  PLATFORM_DEMO_TELEMETRY,
  PLATFORM_DEMO_TENANTS,
} from "./platformDemoData";

const SESSION_KEY = "vorqix.platform.session.v1";

interface StoredSession {
  token: string;
  expires_at: string;
  operator: PlatformSession["operator"];
  development?: boolean;
}

const DEVELOPMENT_DEMO_SESSION_MINUTES = 30;

function readStoredSession(): StoredSession | null {
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(SESSION_KEY) ?? "null",
    ) as StoredSession | null;
    if (
      !parsed?.token ||
      !parsed.expires_at ||
      new Date(parsed.expires_at).getTime() <= Date.now()
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
}

function companyState(modules: PlatformModuleMetric[]): {
  label: string;
  tone: string;
} {
  if (modules.some((module) => module.state === "CRITICAL"))
    return { label: "Instabilidade", tone: "critical" };
  if (modules.some((module) => module.state === "WARNING"))
    return { label: "Atenção", tone: "warning" };
  if (modules.some((module) => module.state === "HEALTHY"))
    return { label: "Operando", tone: "healthy" };
  return { label: "Sem amostras", tone: "neutral" };
}

function platformCustomerTenants(tenants: PlatformTenantSummary[]): PlatformTenantSummary[] {
  const testRecord = /(?:^|[-_\s])(?:test|tests|teste|testes|numbering|numera[cç][aã]o)(?:$|[-_\s])/iu;
  const candidates = tenants.filter((tenant) =>
    tenant.environment !== "DEVELOPMENT" &&
    !tenant.slug.toLowerCase().startsWith("fab-control-") &&
    !testRecord.test(`${tenant.slug} ${tenant.display_name}`),
  );
  const byName = new Map<string, PlatformTenantSummary[]>();
  for (const tenant of candidates) {
    const name = tenant.display_name.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
    byName.set(name, [...(byName.get(name) ?? []), tenant]);
  }
  return [...byName.values()].map((items) =>
    items.sort((first, second) => {
      const demoPriority = Number(second.slug.endsWith("-demo")) - Number(first.slug.endsWith("-demo"));
      if (demoPriority) return demoPriority;
      return new Date(second.created_at).getTime() - new Date(first.created_at).getTime();
    })[0],
  ).filter((tenant): tenant is PlatformTenantSummary => Boolean(tenant));
}

function initialAccessMessage(receipt: { tenantName: string; tenantSlug: string; name: string; login: string; password: string }): string {
  return [
    `Olá, ${receipt.name}!`,
    "",
    `Seu acesso TI à plataforma VORQIX da empresa ${receipt.tenantName} foi criado.`,
    `Acesse: ${window.location.origin}/?tenant=${encodeURIComponent(receipt.tenantSlug)}`,
    `Matrícula (login): ${receipt.login}`,
    `Senha temporária: ${receipt.password}`,
    "",
    "No primeiro acesso, o sistema solicitará a troca da senha.",
  ].join("\n");
}

export function PlatformConsole() {
  const [session, setSession] = useState<StoredSession | null>(
    readStoredSession,
  );
  const [sessionChecked, setSessionChecked] = useState(false);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [tenants, setTenants] = useState<PlatformTenantSummary[]>([]);
  const [telemetry, setTelemetry] = useState<
    Array<{ tenant_id: string; modules: PlatformModuleMetric[] }>
  >([]);
  const [requests, setRequests] = useState<PlatformSupportRequest[]>([]);
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [features, setFeatures] = useState<PlatformFeature[]>([]);
  const [section, setSection] = useState<"clients" | "plans" | "support">("clients");
  const [selectedPlanTenantId, setSelectedPlanTenantId] = useState("");
  const [editingTenant, setEditingTenant] = useState<PlatformTenantSummary | null>(null);
  const [contractFeatureCodes, setContractFeatureCodes] = useState<string[]>([]);
  const [companyEditorOpen, setCompanyEditorOpen] = useState(false);
  const [accessTenant, setAccessTenant] = useState<PlatformTenantSummary | null>(null);
  const [accessError, setAccessError] = useState("");
  const [accessMessageCopied, setAccessMessageCopied] = useState(false);
  const [accessReceipt, setAccessReceipt] = useState<{ tenantName: string; tenantSlug: string; name: string; email: string; login: string; password: string } | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [companySlug, setCompanySlug] = useState("");
  const [editingPlan, setEditingPlan] = useState<PlatformPlan | null>(null);
  const [planEditorOpen, setPlanEditorOpen] = useState(false);
  const [planPreset, setPlanPreset] = useState<"COMPLETE" | "CUSTOM">("CUSTOM");
  const [planName, setPlanName] = useState("");
  const [planCode, setPlanCode] = useState("");
  const [planCodeTouched, setPlanCodeTouched] = useState(false);
  const [planDescription, setPlanDescription] = useState("");
  const [planStatus, setPlanStatus] = useState<PlatformPlan["status"]>("DRAFT");
  const [planPrice, setPlanPrice] = useState("0");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function generatedPlanCode(value: string): string {
    return value.trim().replace(/^plano\s+/iu, "").normalize("NFD")
      .replace(/[\u0300-\u036f]/gu, "").toUpperCase()
      .replace(/[^A-Z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 40);
  }

  function generatedTenantSlug(value: string): string {
    return value.trim().normalize("NFD").replace(/[\u0300-\u036f]/gu, "")
      .toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 80);
  }

  function openPlanEditor(plan: PlatformPlan | null, preset: "COMPLETE" | "CUSTOM" = "CUSTOM") {
    setEditingPlan(plan);
    setPlanPreset(preset);
    setPlanName(plan?.name ?? (preset === "COMPLETE" ? "Plano Completo" : ""));
    setPlanCode(plan?.code ?? (preset === "COMPLETE" ? "COMPLETO" : ""));
    setPlanCodeTouched(Boolean(plan));
    setPlanDescription(plan?.description ?? (preset === "COMPLETE"
      ? "Plano de demonstração com todos os módulos do catálogo VORQIX. As permissões individuais continuam vinculadas aos perfis de usuário."
      : ""));
    setPlanStatus(plan?.status ?? (preset === "COMPLETE" ? "ACTIVE" : "DRAFT"));
    setPlanPrice(String(plan?.monthly_price ?? 0));
    setPlanEditorOpen(true);
  }

  function openTenantPlan(tenant: PlatformTenantSummary | null) {
    setEditingTenant(tenant);
    const existingPlan = tenant?.plan_code ? plans.find((plan) => plan.code === tenant.plan_code) : undefined;
    const plan = existingPlan ?? plans.find((item) => item.status === "ACTIVE");
    setContractFeatureCodes(tenant?.subscription_id ? tenant.feature_codes : plan?.features.map((feature) => feature.code) ?? []);
  }

  const loadConsole = useCallback(async (currentSession: StoredSession) => {
    setLoading(true);
    setError("");
    if (currentSession.development && import.meta.env.DEV) {
      setTenants(PLATFORM_DEMO_TENANTS);
      setPlans([]);
      setTelemetry(PLATFORM_DEMO_TELEMETRY);
      setRequests(PLATFORM_DEMO_REQUESTS);
      setLoading(false);
      return;
    }
    try {
      const [tenantResult, telemetryResult, supportResult, planResult, featureResult] = await Promise.all([
        listPlatformTenants(currentSession.token),
        readPlatformTelemetry(currentSession.token),
        listPlatformSupportRequests(currentSession.token),
        listPlatformPlans(currentSession.token),
        listPlatformFeatures(currentSession.token),
      ]);
      setTenants(tenantResult.items);
      setTelemetry(telemetryResult.tenants);
      setRequests(supportResult.items);
      setPlans(planResult.items);
      setFeatures(featureResult.items);
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar o console.";
      setError(message);
      if (/sessão|autenticação|entre novamente/iu.test(message)) {
        window.sessionStorage.removeItem(SESSION_KEY);
        setSession(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = "VORQIX · Plataforma";
    const current = readStoredSession();
    if (!current) {
      window.sessionStorage.removeItem(SESSION_KEY);
      setSession(null);
      setSessionChecked(true);
      return;
    }
    if (current.development && import.meta.env.DEV) {
      setSession(current);
      setSessionChecked(true);
      return;
    }
    void getPlatformSession(current.token)
      .then(({ operator }) => setSession({ ...current, operator }))
      .catch(() => {
        window.sessionStorage.removeItem(SESSION_KEY);
        setSession(null);
      })
      .finally(() => setSessionChecked(true));
  }, []);

  useEffect(() => {
    if (session) void loadConsole(session);
  }, [loadConsole, session]);

  const metricsByTenant = useMemo(
    () => new Map(telemetry.map((item) => [item.tenant_id, item.modules])),
    [telemetry],
  );
  const customerTenants = useMemo(() => platformCustomerTenants(tenants), [tenants]);
  const moduleHealth = useMemo(() => {
    const aggregate = new Map<string, {
      calls: number;
      serverErrors: number;
      deniedRequests: number;
      maxP95Ms: number;
      weightedAverageMs: number;
      tenantIds: Set<string>;
      states: PlatformModuleMetric["state"][];
    }>();
    for (const tenant of telemetry) {
      for (const module of tenant.modules) {
        const item = aggregate.get(module.module) ?? {
          calls: 0,
          serverErrors: 0,
          deniedRequests: 0,
          maxP95Ms: 0,
          weightedAverageMs: 0,
          tenantIds: new Set<string>(),
          states: [],
        };
        const previousCalls = item.calls;
        item.calls += module.calls;
        item.serverErrors += module.serverErrors;
        item.deniedRequests += module.deniedRequests;
        item.maxP95Ms = Math.max(item.maxP95Ms, module.p95Ms);
        item.weightedAverageMs = item.calls
          ? Math.round((item.weightedAverageMs * previousCalls + module.averageMs * module.calls) / item.calls)
          : 0;
        item.tenantIds.add(tenant.tenant_id);
        item.states.push(module.state);
        aggregate.set(module.module, item);
      }
    }
    const priority: Record<PlatformModuleMetric["state"], number> = {
      CRITICAL: 0,
      WARNING: 1,
      INSUFFICIENT_DATA: 2,
      HEALTHY: 3,
    };
    return [...aggregate.entries()].map(([module, item]) => ({
      module,
      ...item,
      state: [...item.states].sort((first, second) => priority[first] - priority[second])[0] ?? "INSUFFICIENT_DATA",
    })).sort((first, second) => priority[first.state] - priority[second.state] || first.module.localeCompare(second.module));
  }, [telemetry]);
  const openRequests = requests.filter(
    (item) => !["RESOLVED", "CLOSED"].includes(item.status),
  ).length;
  const criticalModules = moduleHealth.filter((module) => module.state === "CRITICAL").length;

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const authenticated = await loginPlatform(login, password, code);
      const next = { ...authenticated, token: authenticated.token };
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
      setSession(next);
      setPassword("");
      setCode("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível iniciar a sessão.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function endSession() {
    if (session && !session.development)
      await logoutPlatform(session.token).catch(() => undefined);
    window.sessionStorage.removeItem(SESSION_KEY);
    setSession(null);
    setTenants([]);
    setTelemetry([]);
    setRequests([]);
  }

  function openDevelopmentDemo() {
    if (!import.meta.env.DEV) return;
    const next: StoredSession = {
      token: "local-development-demo-session",
      expires_at: new Date(
        Date.now() + DEVELOPMENT_DEMO_SESSION_MINUTES * 60_000,
      ).toISOString(),
      operator: {
        id: "local-development-operator",
        login: "equipe.plataforma.local",
        name: "Equipe da Plataforma · Desenvolvimento",
      },
      development: true,
    };
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
    setError("");
    setSession(next);
  }

  async function changeRequestStatus(
    item: PlatformSupportRequest,
    status: PlatformSupportRequest["status"],
    scheduledAt: string | null = item.scheduled_at,
    serviceMode: "REMOTE" | "ONSITE" = item.service_mode,
  ) {
    if (!session || session.development) return;
    setError("");
    try {
      await updatePlatformSupportRequest(
        session.token,
        item.request_id,
        status,
        scheduledAt,
        serviceMode,
      );
      setRequests((current) =>
        current.map((request) =>
          request.request_id === item.request_id
            ? { ...request, status, scheduled_at: scheduledAt, service_mode: serviceMode, updated_at: new Date().toISOString() }
            : request,
        ),
      );
      setNotice(`Chamado atualizado · ${item.tenant_name}`);
      window.setTimeout(() => setNotice(""), 3_500);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível atualizar o chamado.",
      );
    }
  }

  async function saveTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !editingTenant) return;
    const form = new FormData(event.currentTarget);
    const planId = String(form.get("plan_id"));
    const selectedPlan = plans.find((plan) => plan.plan_id === planId);
    if (!selectedPlan) { setError("Selecione um plano ativo para a empresa."); return; }
    setSaving(true); setError("");
    try {
      await updatePlatformTenantSubscription(session.token, editingTenant.tenant_id, {
        plan_id: planId, status: String(form.get("status")),
        monthly_price: Number(form.get("monthly_price")),
        discount_percent: Number(form.get("discount_percent")),
        implementation_days: Number(form.get("implementation_days")), feature_codes: contractFeatureCodes,
      });
      setEditingTenant(null); await loadConsole(session);
      setNotice(`Plano atualizado · ${editingTenant.display_name}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar a assinatura."); }
    finally { setSaving(false); }
  }

  async function createInitialAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || session.development || !accessTenant) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name")).trim();
    const employeeNumber = String(form.get("employee_number")).trim().toUpperCase();
    const email = String(form.get("email")).trim().toLowerCase();
    setSaving(true); setError("");
    setAccessError("");
    try {
      const credentials = await createPlatformTenantInitialAdmin(session.token, accessTenant.tenant_id, {
        name, employee_number: employeeNumber, email,
      });
      const tenantName = accessTenant.display_name;
      setAccessTenant(null);
      await loadConsole(session);
      setAccessReceipt({ tenantName, tenantSlug: accessTenant.slug, name, email, login: credentials.login, password: credentials.temporary_password });
      setNotice(`Acesso TI criado para ${tenantName}. Prepare o e-mail para enviar as credenciais.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Não foi possível criar o acesso TI.";
      setAccessError(message);
      setError("");
    } finally { setSaving(false); }
  }

  async function createTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || session.development) return;
    const form = new FormData(event.currentTarget);
    setSaving(true); setError("");
    try {
      await createPlatformTenant(session.token, {
        display_name: String(form.get("display_name")).trim(),
        legal_name: String(form.get("legal_name")).trim(),
        tax_identifier: String(form.get("tax_identifier")).trim() || undefined,
        slug: String(form.get("slug")).trim().toLowerCase(),
        environment: "HOMOLOGATION",
      });
      const tenantName = String(form.get("display_name")).trim();
      setCompanyEditorOpen(false); setCompanyName(""); setCompanySlug("");
      await loadConsole(session);
      setNotice(`Empresa cadastrada · ${tenantName}. Agora ative o plano e crie o primeiro acesso TI na lista.`);
    } catch (cause) {
      await loadConsole(session);
      setError(cause instanceof Error ? `A empresa pode ter sido cadastrada, mas o acesso TI não foi concluído: ${cause.message} Use “Gerar acesso TI” na linha da empresa para tentar novamente.` : "Não foi possível concluir o cadastro da empresa.");
    } finally { setSaving(false); }
  }

  async function copyInitialAccessMessage() {
    if (!accessReceipt) return;
    try {
      await navigator.clipboard.writeText(initialAccessMessage(accessReceipt));
      setAccessMessageCopied(true);
      setNotice(`Mensagem de primeiro acesso copiada para ${accessReceipt.tenantName}.`);
      window.setTimeout(() => setNotice(""), 3_500);
    } catch {
      setAccessError("Não foi possível copiar a mensagem. Selecione e copie os dados exibidos na tela.");
    }
  }

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const form = new FormData(event.currentTarget);
    setSaving(true); setError("");
    try {
      await savePlatformPlan(session.token, {
        ...(editingPlan ? { plan_id: editingPlan.plan_id } : {}),
        code: String(form.get("code")).trim().toUpperCase(), name: String(form.get("name")).trim(),
        description: String(form.get("description")).trim(), status: String(form.get("status")) as PlatformPlan["status"],
        monthly_price: Number(form.get("monthly_price")),
        feature_codes: form.getAll("feature_codes").map(String),
      });
      setEditingPlan(null); setPlanEditorOpen(false); await loadConsole(session); setNotice("Plano salvo no catálogo comercial.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar o plano."); }
    finally { setSaving(false); }
  }

  if (!sessionChecked)
    return (
      <main className="platform-screen">
        <div className="platform-loading">Validando sessão…</div>
      </main>
    );

  if (!session)
    return (
      <main className="platform-screen platform-screen--login">
        <form
          className="platform-login"
          onSubmit={(event) => void submitLogin(event)}
        >
          <img src="/vorqix-logo.png" alt="VORQIX" />
          <span className="platform-eyebrow">PAINEL DA PLATAFORMA</span>
          <h1>Console VORQIX</h1>
          <p>Acesso exclusivo da equipe da plataforma.</p>
          <label>
            Identificação
            <input
              autoComplete="username"
              required
              value={login}
              onChange={(event) => setLogin(event.target.value)}
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {!import.meta.env.DEV ? <label>
            Código autenticador
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/gu, "").slice(0, 6))
              }
            />
          </label> : <small className="platform-dev-auth-note">Segundo fator desativado apenas no servidor local de desenvolvimento.</small>}
          {error ? (
            <div className="platform-error" role="alert">
              {error}
            </div>
          ) : null}
          <button className="platform-primary" type="submit" disabled={loading}>
            {loading ? "Validando…" : "Acessar plataforma"}
          </button>
          {import.meta.env.DEV ? (
            <div className="platform-demo-access">
              <span>Ambiente local de desenvolvimento</span>
              <button
                className="platform-demo-button"
                type="button"
                onClick={openDevelopmentDemo}
                disabled={loading}
              >
                Abrir demonstração local
              </button>
              <small>Dados fictícios · somente leitura · sessão de 30 min</small>
            </div>
          ) : null}
          <a href="/">Voltar ao VORQIX da empresa</a>
        </form>
      </main>
    );

  return (
    <main className="platform-screen">
      <header className="platform-header">
        <div className="platform-brand">
          <img src="/vorqix-logo.png" alt="VORQIX" />
          <span>Plataforma</span>
        </div>
        <div className="platform-operator">
          {session.development ? (
            <span className="platform-demo-badge">Demonstração local</span>
          ) : null}
          <strong>{session.operator.name}</strong>
          <span>{session.operator.login}</span>
          <button type="button" onClick={() => void endSession()}>
            Sair
          </button>
        </div>
      </header>
      <nav className="platform-nav" aria-label="Seções da plataforma">
        {([["clients", "Cadastro"], ["plans", "Planos e módulos"], ["support", "Suporte"]] as const).map(([key, label]) => <button key={key} type="button" className={section === key ? "is-active" : ""} onClick={() => setSection(key)}>{label}</button>)}
      </nav>
      <div className="platform-content">
        {session.development ? (
          <div className="platform-demo-notice" role="status">
            Ambiente de demonstração. Os dados exibidos são fictícios e as
            alterações estão desativadas.
          </div>
        ) : null}
        <div className="platform-heading">
          <div>
            <span className="platform-eyebrow">OPERAÇÃO MULTIEMPRESA</span>
            <h1>Visão da plataforma</h1>
          </div>
          <button
            type="button"
            onClick={() => void loadConsole(session)}
            disabled={loading}
          >
            {loading ? "Atualizando…" : "Atualizar"}
          </button>
        </div>
        {error ? (
          <div className="platform-error" role="alert">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="platform-notice" role="status">
            {notice}
          </div>
        ) : null}
        <section className="platform-summary" aria-label="Resumo da plataforma">
          <article>
            <span>Módulos monitorados</span>
            <strong>{moduleHealth.length}</strong>
          </article>
          <article>
            <span>Com alerta técnico</span>
            <strong>{criticalModules + moduleHealth.filter((module) => module.state === "WARNING").length}</strong>
          </article>
          <article>
            <span>Chamados em aberto</span>
            <strong>{openRequests}</strong>
          </article>
        </section>
        {section === "clients" ? <section className="platform-section">
          <header>
            <div>
              <span className="platform-eyebrow">CARTEIRA DE CLIENTES</span>
              <h2>Cadastro de empresas</h2>
              <p className="platform-section-intro">Cadastre empresas e gerencie o acesso inicial de cada responsável de TI.</p>
            </div>
            <div className="platform-header-actions">
              <span>{customerTenants.length} cadastradas</span>
              <button type="button" disabled={session.development || saving || !plans.some((plan) => plan.status === "ACTIVE")} onClick={() => setCompanyEditorOpen(true)}>Nova empresa</button>
            </div>
          </header>
          <div className="platform-company-list">
            {customerTenants.map((tenant) => {
              const modules = metricsByTenant.get(tenant.tenant_id) ?? [];
              const state = companyState(modules);
              const calls = modules.reduce((sum, item) => sum + item.calls, 0);
              const errors = modules.reduce((sum, item) => sum + item.serverErrors, 0);
              const subscriptionActive = tenant.subscription_status === "ACTIVE";
              return <article className="platform-company-card" key={tenant.tenant_id}>
                <header className="platform-company-card__header">
                  <div><h3>{tenant.display_name}</h3><span>{tenant.slug} · {tenant.environment}</span></div>
                  <span className={`platform-company-status ${tenant.tenant_status === "ACTIVE" ? "is-active" : ""}`}>{tenant.tenant_status === "ACTIVE" ? "Empresa ativa" : tenant.tenant_status}</span>
                </header>
                <div className="platform-company-card__details">
                  <section><span>Plano</span><strong>{tenant.plan_name ?? "Nenhum plano"}</strong><small>{subscriptionActive ? "Assinatura ativa" : tenant.subscription_status ?? "Ainda não contratado"}</small></section>
                  <section><span>Primeiro acesso</span><strong>{tenant.initial_admin_created ? "TI configurado" : "Pendente"}</strong><small>{tenant.initial_admin_created ? "Administrador da empresa" : "Crie o usuário TI para iniciar a configuração"}</small></section>
                  <section><span>Saúde do sistema</span><strong className={`platform-state-text platform-state-text--${state.tone}`}>{state.label}</strong><small>{modules.length} módulos · {calls} requisições · {errors} erros</small></section>
                  <section><span>Contrato</span><strong>{tenant.monthly_price == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(tenant.monthly_price))}</strong><small>{tenant.discount_percent ?? 0}% desconto · {tenant.implementation_days ?? 0} dias de implantação</small></section>
                </div>
                <footer className="platform-company-card__actions">
                  <button type="button" disabled={session.development} onClick={() => openTenantPlan(tenant)}>{subscriptionActive ? "Gerenciar plano" : "Ativar plano"}</button>
                  {!tenant.initial_admin_created ? <button type="button" className="platform-secondary-button" disabled={session.development || saving} onClick={() => { setAccessError(""); setAccessTenant(tenant); }}>Criar primeiro acesso TI</button> : null}
                </footer>
              </article>;
            })}
            {customerTenants.length === 0 ? (
              <p className="platform-empty">Nenhuma empresa cadastrada.</p>
            ) : null}
          </div>
          <p className="platform-footnote">
            Telemetria de latência e erros HTTP dos últimos 15 minutos, mantida
            em memória no processo atual da API.
          </p>
        </section> : null}
        {section === "support" ? <section className="platform-section">
          <header>
            <div>
              <span className="platform-eyebrow">ATENDIMENTO TÉCNICO</span>
              <h2>Chamados das empresas</h2>
            </div>
            <span>{requests.length} registros recentes</span>
          </header>
          <div className="platform-support-list">
            {requests.map((item) => (
              <article className="platform-support-row" key={item.request_id}>
                <div className="platform-support-row__main">
                  <div>
                    <strong>{item.summary}</strong>
                    <span>
                      {item.tenant_name} · {item.module} · {item.topic}
                    </span>
                  </div>
                  <p>
                    {item.technical_context ||
                      "Sem contexto técnico adicional."}
                  </p>
                  <SupportAttachments token={session.token} items={item.attachments} />
                  <small>
                    {formatDate(item.created_at)} · referência{" "}
                    {item.request_id_header || item.request_id.slice(0, 8)}
                  </small>
                </div>
                <select
                  aria-label={`Status do chamado ${item.summary}`}
                  value={item.status}
                  disabled={
                    session.development ||
                    loading ||
                    ["CLOSED"].includes(item.status)
                  }
                  onChange={(event) =>
                    void changeRequestStatus(
                      item,
                      event.target.value as PlatformSupportRequest["status"],
                    )
                  }
                >
                  <option value="OPEN">Aberto</option>
                  <option value="IN_PROGRESS">Em análise</option>
                  <option value="WAITING_CUSTOMER">Aguardando empresa</option>
                  <option value="RESOLVED">Resolvido</option>
                  <option value="CLOSED">Encerrado</option>
                </select>
                <div className="platform-schedule">
                  <label>Agendar<input type="datetime-local" defaultValue={item.scheduled_at ? new Date(new Date(item.scheduled_at).getTime() - new Date(item.scheduled_at).getTimezoneOffset() * 60000).toISOString().slice(0,16) : ""} disabled={session.development} onBlur={(event) => { const date = event.target.value; if (date) void changeRequestStatus(item, "IN_PROGRESS", new Date(date).toISOString(), item.service_mode ?? "REMOTE"); }} /></label>
                  <label>Atendimento<select value={item.service_mode ?? "REMOTE"} disabled={session.development} onChange={(event) => void changeRequestStatus(item, item.status, item.scheduled_at, event.target.value as "REMOTE" | "ONSITE")}><option value="REMOTE">Remoto</option><option value="ONSITE">Presencial</option></select></label>
                  {item.scheduled_at ? <small>Agendado: {formatDate(item.scheduled_at)}</small> : null}
                </div>
              </article>
            ))}
            {requests.length === 0 ? (
              <p className="platform-empty">Nenhum chamado recente.</p>
            ) : null}
          </div>
          <section className="platform-faq-section" aria-labelledby="platform-faq-title">
            <header><div><span className="platform-eyebrow">BASE DE ATENDIMENTO</span><h3 id="platform-faq-title">Perguntas frequentes</h3></div></header>
            <div className="platform-faq">
              <details><summary>Como acompanho um chamado?</summary><p>Atualize o status no próprio registro. O histórico e os anexos ficam vinculados à empresa e ao chamado.</p></details>
              <details><summary>Quem decide se o atendimento será remoto ou presencial?</summary><p>A equipe da plataforma avalia o caso e combina a forma de atendimento com a empresa.</p></details>
              <details><summary>Como habilito módulos para uma empresa?</summary><p>Em Planos e módulos, selecione a empresa, abra o contrato e ajuste os módulos habilitados.</p></details>
            </div>
          </section>
        </section> : null}
        {section === "plans" ? <section className="platform-section">
          <header><div><span className="platform-eyebrow">CONTRATOS POR EMPRESA</span><h2>Planos e módulos</h2></div><div className="platform-header-actions"><button type="button" disabled={session.development} onClick={() => openPlanEditor(null, "COMPLETE")}>Criar plano completo</button><button type="button" className="platform-secondary-button" disabled={session.development} onClick={() => openPlanEditor(null, "CUSTOM")}>Plano personalizado</button></div></header>
          <section className="platform-module-health" aria-labelledby="platform-module-health-title">
            <header><div><span className="platform-eyebrow">OBSERVAÇÃO TÉCNICA · ÚLTIMOS 15 MINUTOS</span><h3 id="platform-module-health-title">Saúde dos módulos</h3></div><span>{moduleHealth.length} módulos com amostras</span></header>
            {moduleHealth.length ? <div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Módulo</th><th>Empresas com atividade</th><th>Requisições</th><th>Maior p95</th><th>Erros</th><th>Estado</th></tr></thead><tbody>{moduleHealth.map((item) => <tr key={item.module}><td><strong>{item.module.replaceAll("_", " ")}</strong><small>Média ponderada {item.weightedAverageMs} ms · {item.deniedRequests} acessos negados</small></td><td>{item.tenantIds.size}</td><td>{item.calls}</td><td>{item.maxP95Ms} ms</td><td>{item.serverErrors}</td><td><span className={`platform-state platform-state--${item.state === "CRITICAL" ? "critical" : item.state === "WARNING" ? "warning" : item.state === "HEALTHY" ? "healthy" : "neutral"}`}>{item.state === "CRITICAL" ? "Crítico" : item.state === "WARNING" ? "Atenção" : item.state === "HEALTHY" ? "Saudável" : "Poucos dados"}</span></td></tr>)}</tbody></table></div> : <p className="platform-empty">Ainda não há requisições observadas para os módulos. A telemetria aparece quando as empresas usam o sistema.</p>}
            <p className="platform-module-health__note">A telemetria é agregada por módulo a partir das requisições das empresas. O p95 exibido é o maior p95 observado entre elas.</p>
          </section>
          <div className="platform-plan-company">
            <label>Empresa<select value={selectedPlanTenantId || customerTenants[0]?.tenant_id || ""} onChange={(event) => setSelectedPlanTenantId(event.target.value)} disabled={!customerTenants.length}><option value="" disabled>Selecione uma empresa</option>{customerTenants.map((tenant) => <option key={tenant.tenant_id} value={tenant.tenant_id}>{tenant.display_name}</option>)}</select></label>
            {(() => {
              const tenant = customerTenants.find((item) => item.tenant_id === (selectedPlanTenantId || customerTenants[0]?.tenant_id));
              if (!tenant) return <p className="platform-empty">Cadastre uma empresa para consultar contratos e módulos.</p>;
              const tenantModules = metricsByTenant.get(tenant.tenant_id) ?? [];
              const state = companyState(tenantModules);
              const activeCodes = new Set(tenant.feature_codes);
              return <article className="platform-selected-contract">
                <div className="platform-selected-contract__heading"><div><span>PLANO DA EMPRESA</span><h3>{tenant.plan_name ?? "Nenhum plano ativo"}</h3></div><span className={`platform-company-status ${tenant.subscription_status === "ACTIVE" ? "is-active" : ""}`}>{tenant.subscription_status ?? "Sem assinatura"}</span></div>
                <div className="platform-selected-contract__metrics"><div><span>Saúde observada</span><strong className={`platform-state-text platform-state-text--${state.tone}`}>{state.label}</strong></div><div><span>Módulos monitorados</span><strong>{tenantModules.length}</strong></div><div><span>Requisições recentes</span><strong>{tenantModules.reduce((sum, item) => sum + item.calls, 0)}</strong></div><div><span>Erros recentes</span><strong>{tenantModules.reduce((sum, item) => sum + item.serverErrors, 0)}</strong></div></div>
                <div className="platform-selected-modules"><h4>Módulos contratados</h4>{features.length ? <ul>{features.map((feature) => { const active = activeCodes.has(feature.code); return <li key={feature.code}><span>{feature.name}</span><strong className={active ? "is-active" : "is-inactive"}>{active ? "Ativo" : "Inativo"}</strong></li>; })}</ul> : <p>Os módulos serão exibidos quando o catálogo carregar.</p>}</div>
                <footer><span>{tenant.initial_admin_created ? "Acesso TI configurado" : "Primeiro acesso TI pendente"}</span><button type="button" disabled={session.development} onClick={() => openTenantPlan(tenant)}>{tenant.subscription_id ? "Gerenciar plano e módulos" : "Ativar plano"}</button></footer>
              </article>;
            })()}
          </div>
          <div className="platform-plan-grid">{plans.map(plan => <article key={plan.plan_id}><div><strong>{plan.name}</strong><span>{plan.code} · {plan.status}</span></div><b>{new Intl.NumberFormat("pt-BR", { style:"currency", currency:"BRL" }).format(Number(plan.monthly_price))}/mês</b><p>{plan.description || "Sem descrição."}</p><small>{plan.features.map(feature => feature.name).join(" · ") || "Sem módulos incluídos"}</small><button type="button" className="platform-link-button" disabled={session.development} onClick={() => { setEditingPlan(plan); setPlanEditorOpen(true); }}>Editar plano</button></article>)}</div>
          {!plans.length ? <p className="platform-empty">Nenhum plano cadastrado. Use “Criar plano completo” para preparar o pacote com todos os módulos da demonstração.</p> : null}
        </section> : null}

      </div>
      {editingTenant ? <div className="platform-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) openTenantPlan(null); }}><form key={editingTenant.tenant_id} className="platform-editor" onSubmit={(event) => void saveTenant(event)}><header><div><span className="platform-eyebrow">CONTRATO DA EMPRESA</span><h2>Ativar ou alterar plano</h2></div><button type="button" onClick={() => openTenantPlan(null)}>Fechar</button></header><label>Empresa<select value={editingTenant.tenant_id} onChange={(event) => { const selected = customerTenants.find((tenant) => tenant.tenant_id === event.target.value); if (selected) openTenantPlan(selected); }} required>{customerTenants.map((tenant) => <option key={tenant.tenant_id} value={tenant.tenant_id}>{tenant.display_name}</option>)}</select></label><label>Plano<select name="plan_id" defaultValue={plans.find(plan => plan.code === editingTenant.plan_code)?.plan_id ?? plans.find(plan => plan.status === "ACTIVE")?.plan_id ?? ""} onChange={(event) => { const selected = plans.find((plan) => plan.plan_id === event.target.value); setContractFeatureCodes(selected?.features.map((feature) => feature.code) ?? []); }} required>{plans.filter(plan => plan.status === "ACTIVE").map(plan => <option key={plan.plan_id} value={plan.plan_id}>{plan.name}</option>)}</select></label><label>Status da assinatura<select name="status" defaultValue={editingTenant.subscription_status ?? "ACTIVE"}>{["TRIAL","ACTIVE","PAST_DUE","SUSPENDED","CANCELLED","EXPIRED"].map(status => <option key={status}>{status}</option>)}</select></label><div className="platform-form-grid"><label>Valor mensal (R$)<input name="monthly_price" type="number" min="0" step="0.01" defaultValue={Number(editingTenant.monthly_price ?? 0)} required /></label><label>Desconto (%)<input name="discount_percent" type="number" min="0" max="100" step="0.01" defaultValue={Number(editingTenant.discount_percent ?? 0)} required /></label><label>Implantação (dias)<input name="implementation_days" type="number" min="0" max="3650" step="1" defaultValue={editingTenant.implementation_days ?? 0} required /></label></div><fieldset><legend>Módulos habilitados</legend><div className="platform-module-grid">{features.map(feature => <label key={feature.code}><input type="checkbox" name="feature_codes" value={feature.code} checked={contractFeatureCodes.includes(feature.code)} onChange={(event) => setContractFeatureCodes((current) => event.target.checked ? [...new Set([...current, feature.code])] : current.filter((code) => code !== feature.code))} />{feature.name}</label>)}</div><small>A seleção inicial acompanha o plano. Você pode ajustar os módulos contratados antes de salvar.</small></fieldset><footer><button type="button" onClick={() => openTenantPlan(null)}>Cancelar</button><button className="platform-primary" type="submit" disabled={saving || !plans.some(plan => plan.status === "ACTIVE")}>{saving ? "Salvando…" : "Salvar contrato"}</button></footer></form></div> : null}
      {companyEditorOpen ? <div className="platform-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCompanyEditorOpen(false); }}><form className="platform-editor" onSubmit={(event) => void createTenant(event)}><header><div><span className="platform-eyebrow">CADASTRO</span><h2>Nova empresa</h2></div><button type="button" onClick={() => setCompanyEditorOpen(false)}>Fechar</button></header><label>Nome da empresa<input name="display_name" minLength={2} maxLength={120} value={companyName} onChange={(event) => { const next = event.target.value; setCompanyName(next); setCompanySlug(generatedTenantSlug(next)); }} required autoFocus /></label><label>Razão social<input name="legal_name" minLength={2} maxLength={160} required /></label><label>CNPJ (opcional)<input name="tax_identifier" maxLength={32} /></label><label>Identificador do ambiente<input name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" minLength={3} maxLength={80} value={companySlug} onChange={(event) => setCompanySlug(event.target.value.toLowerCase())} required /><small>Endereço técnico gerado pelo nome e usado para abrir o ambiente.</small></label><p className="platform-footnote">Depois do cadastro, use as ações da empresa para ativar o plano e gerar o acesso TI.</p><footer><button type="button" onClick={() => setCompanyEditorOpen(false)}>Cancelar</button><button className="platform-primary" type="submit" disabled={saving}>{saving ? "Cadastrando…" : "Cadastrar empresa"}</button></footer></form></div> : null}
      {accessTenant ? <div className="platform-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAccessTenant(null); }}><form className="platform-editor" onSubmit={(event) => void createInitialAdmin(event)}><header><div><span className="platform-eyebrow">PRIMEIRO ACESSO</span><h2>{accessTenant.display_name}</h2></div><button type="button" onClick={() => setAccessTenant(null)}>Fechar</button></header><p>Informe o responsável, a matrícula de login e o e-mail. A senha temporária será mostrada após a criação.</p>{accessError ? <div className="platform-error" role="alert">Não foi possível criar o acesso TI: {accessError}</div> : null}<label>Nome do responsável<input name="name" minLength={3} maxLength={160} required autoFocus /></label><div className="platform-form-grid"><label>Matrícula (login)<input name="employee_number" pattern="[A-Za-z0-9._-]{3,40}" maxLength={40} required /></label><label>E-mail<input name="email" type="email" maxLength={254} required /></label></div><footer><button type="button" onClick={() => setAccessTenant(null)}>Cancelar</button><button className="platform-primary" type="submit" disabled={saving}>{saving ? "Criando acesso…" : "Criar primeiro acesso"}</button></footer></form></div> : null}
      {accessReceipt ? <div className="platform-modal-backdrop" role="presentation"><section className="platform-editor" aria-labelledby="platform-access-receipt-title"><header><div><span className="platform-eyebrow">PRIMEIRO ACESSO TI</span><h2 id="platform-access-receipt-title">Acesso criado · {accessReceipt.tenantName}</h2></div><button type="button" onClick={() => setAccessReceipt(null)}>Fechar</button></header><p>Senha temporária exibida. Copie a mensagem ou prepare um e-mail; a pessoa deverá trocar a senha no primeiro acesso.</p><dl className="platform-credential-list"><dt>E-mail</dt><dd>{accessReceipt.email}</dd><dt>Login (matrícula)</dt><dd><code>{accessReceipt.login}</code></dd><dt>Senha temporária</dt><dd><code>{accessReceipt.password}</code></dd><dt>Empresa</dt><dd>{accessReceipt.tenantName}</dd></dl>{accessError ? <div className="platform-error" role="alert">{accessError}</div> : null}{accessMessageCopied ? <p className="platform-access-copied" role="status">Mensagem copiada. Cole-a no WhatsApp do responsável.</p> : null}<p className="platform-mail-note">Preparar e-mail abre um rascunho. A mensagem não é enviada automaticamente.</p><footer><button type="button" onClick={() => void navigator.clipboard?.writeText(`Empresa: ${accessReceipt.tenantName}\nLogin: ${accessReceipt.login}\nSenha temporária: ${accessReceipt.password}`)}>Copiar dados</button><button type="button" onClick={() => void copyInitialAccessMessage()}>Copiar mensagem para WhatsApp</button><a className="platform-primary" href={`mailto:${encodeURIComponent(accessReceipt.email)}?subject=${encodeURIComponent(`Acesso TI da ${accessReceipt.tenantName} · VORQIX`)}&body=${encodeURIComponent(initialAccessMessage(accessReceipt))}`}>Preparar e-mail</a><button className="platform-secondary-button" type="button" onClick={() => setAccessReceipt(null)}>Concluído</button></footer></section></div> : null}
      {planEditorOpen ? <div className="platform-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPlanEditorOpen(false); }}><form className="platform-editor" onSubmit={(event) => void savePlan(event)}><header><div><span className="platform-eyebrow">CATÁLOGO COMERCIAL</span><h2>{editingPlan ? "Editar plano" : planPreset === "COMPLETE" ? "Plano completo" : "Plano personalizado"}</h2></div><button type="button" onClick={() => setPlanEditorOpen(false)}>Fechar</button></header><label>Nome que aparece para a empresa<input name="name" minLength={2} maxLength={100} value={planName} onChange={(event) => { const nextName = event.target.value; setPlanName(nextName); if (!planCodeTouched) setPlanCode(generatedPlanCode(nextName)); }} required /></label><div className="platform-form-grid"><label>Código interno do plano<input name="code" pattern="[A-Za-z0-9_-]{2,40}" value={planCode} onChange={(event) => { setPlanCode(event.target.value.toUpperCase()); setPlanCodeTouched(true); }} required /><small>Identificador único gerado pelo nome. Ex.: “Plano Completo” vira “COMPLETO”.</small></label><label>Valor mensal de referência (R$)<input name="monthly_price" type="number" min="0" step="0.01" value={planPrice} onChange={(event) => setPlanPrice(event.target.value)} required /><small>O valor da assinatura da empresa pode ser ajustado no contrato.</small></label><label>Status do plano<select name="status" value={planStatus} onChange={(event) => setPlanStatus(event.target.value as PlatformPlan["status"])}>{["DRAFT","ACTIVE","RETIRED"].map(status => <option key={status} value={status}>{status === "DRAFT" ? "Rascunho" : status === "ACTIVE" ? "Ativo" : "Retirado"}</option>)}</select><small>Ativo: pode ser contratado. Rascunho: em preparação. Retirado: não usar em novos contratos.</small></label></div><label>Descrição<textarea name="description" maxLength={1000} rows={3} value={planDescription} onChange={(event) => setPlanDescription(event.target.value)} /></label><fieldset><legend>Módulos incluídos</legend><div className="platform-module-grid">{features.map(feature => <label key={feature.code}><input type="checkbox" name="feature_codes" value={feature.code} defaultChecked={editingPlan ? editingPlan.features.some(item => item.code === feature.code) : planPreset === "COMPLETE"} />{feature.name}</label>)}</div><small>{planPreset === "COMPLETE" && !editingPlan ? "Todos os módulos estão selecionados. Você pode remover os que não quiser incluir." : "Os módulos são os recursos comerciais reconhecidos pelo sistema."}</small></fieldset><footer><button type="button" onClick={() => setPlanEditorOpen(false)}>Cancelar</button><button className="platform-primary" type="submit" disabled={saving}>{saving ? "Salvando…" : "Salvar plano"}</button></footer></form></div> : null}
    </main>
  );
}
