const API_URL_KEY = "fab-control.gestor-api-url";
const GESTOR_TOKEN_SESSION_KEY = "fab-control.gestor-token";
const LEGACY_GESTOR_TOKEN_PERSISTENT_KEY =
  "fab-control.gestor-token-persistent";

export type ApiTransport = "auto" | "node" | "apps-script";

let inMemoryGestorToken = "";

function environmentGestorToken(): string {
  return (
    (import.meta.env.VITE_GESTOR_TOKEN as string | undefined)?.trim() ?? ""
  );
}

export function getEnvironmentApiUrl(): string {
  return (
    (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? ""
  );
}

function readLocalStorage(key: string): string {
  try {
    return window.localStorage.getItem(key)?.trim() ?? "";
  } catch {
    return "";
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Configuração em memória/ambiente continua disponível quando o storage é bloqueado.
  }
}

function readSessionStorage(key: string): string {
  try {
    return window.sessionStorage.getItem(key)?.trim() ?? "";
  } catch {
    return "";
  }
}

function writeSessionStorage(key: string, value: string): void {
  try {
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    // A sessão pode continuar em memória no componente atual.
  }
}

function clearLegacyPersistentToken(): void {
  writeLocalStorage(LEGACY_GESTOR_TOKEN_PERSISTENT_KEY, "");
}

export function getApiUrl(): string {
  const fromEnv = getEnvironmentApiUrl();
  if (fromEnv) return fromEnv;
  return readLocalStorage(API_URL_KEY);
}

export function getLegacyApiUrl(): string {
  return (
    (import.meta.env.VITE_APPS_SCRIPT_API_URL as string | undefined)?.trim() ??
    ""
  );
}

export function getApiTransport(): ApiTransport {
  const value = (import.meta.env.VITE_API_TRANSPORT as string | undefined)
    ?.trim()
    .toLowerCase();
  return value === "node" || value === "apps-script" ? value : "auto";
}

export function usesNodeApi(): boolean {
  const transport = getApiTransport();
  if (transport === "node") return true;
  if (transport === "apps-script") return false;
  return !getApiUrl().toLowerCase().includes("script.google.com");
}

export function isApiUrlManagedByEnvironment(): boolean {
  return Boolean(getEnvironmentApiUrl());
}

export function saveApiUrl(value: string): void {
  writeLocalStorage(API_URL_KEY, value.trim());
}

export function getGestorToken(): string {
  clearLegacyPersistentToken();
  return (
    readSessionStorage(GESTOR_TOKEN_SESSION_KEY) ||
    inMemoryGestorToken ||
    environmentGestorToken()
  );
}

export function saveGestorToken(value: string): void {
  clearLegacyPersistentToken();
  inMemoryGestorToken = value.trim();
  writeSessionStorage(GESTOR_TOKEN_SESSION_KEY, inMemoryGestorToken);
}

export function clearGestorToken(): void {
  saveGestorToken("");
}

export function hasApiConfiguration(): boolean {
  return Boolean(getApiUrl() && getGestorToken());
}
