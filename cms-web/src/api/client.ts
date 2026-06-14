import {
  getAccessToken,
  getRefreshToken,
  saveAccessToken,
  saveClaims,
  clearAllAuthStorage,
} from "@/lib/authStorage";
import { clearValidatedRole, setValidatedRole } from "@/lib/authRole";
import { redirectToLogin } from "@/lib/navigation";
import { API_BASE_URL, API_TIMEOUT_MS } from "./baseUrl";

/**
 * Fetch-based API client.
 *
 * Connection strategy (configurable via ENV):
 *  - VITE_API_BASE_URL: Direct API URL (e.g., http://10.0.0.5:8000/api/v1)
 *  - Default: /api/v1 (uses Vite proxy)
 *
 * Token: Read from sessionStorage on each request.
 */
const baseURL = API_BASE_URL;
let attemptedBootstrapRefresh = false;

const NON_REFRESHABLE_PATH_PREFIXES = [
  "/auth/login/",
  "/auth/otp/request/",
  "/auth/otp/verify/",
  "/auth/password-reset/request/",
  "/auth/password-reset/confirm/",
  "/auth/forgot-password/",
  "/auth/reset-password/",
  "/auth/set-password/",
  "/auth/logout/",
  "/auth/refresh/",
  "/cms/auth/device-login/",
  "/cms/auth/device/",
];

function isPublicAuthPath(path: string): boolean {
  return NON_REFRESHABLE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function shouldTryTokenRefresh(path: string): boolean {
  return !isPublicAuthPath(path);
}

function parseJwtExp(token: string | null): number | null {
  if (!token) return null;

  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) return null;
    const payload = JSON.parse(atob(payloadPart.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload?.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

async function ensureValidAccessToken(path: string): Promise<void> {
  if (!shouldTryTokenRefresh(path)) return;

  const refresh = getRefreshToken();
  if (!refresh) return;

  // Attempt a one-time bootstrap refresh after app load to recover from stale access tokens.
  if (!attemptedBootstrapRefresh) {
    attemptedBootstrapRefresh = true;
    await tryRefreshToken();
    return;
  }

  const exp = parseJwtExp(getAccessToken());
  if (!exp) return;

  const now = Math.floor(Date.now() / 1000);
  const secondsRemaining = exp - now;

  // Refresh when token is close to expiry to avoid avoidable 401 responses.
  if (secondsRemaining <= 30) {
    await tryRefreshToken();
  }
}

function shouldHandleUnauthorized(path: string): boolean {
  return !isPublicAuthPath(path);
}

function isOnLoginPage(): boolean {
  if (typeof window === "undefined") return false;

  const pathname = window.location.pathname;
  if (pathname === "/login" || pathname.endsWith("/login")) return true;

  const hash = window.location.hash || "";
  return hash === "#/login" || hash.startsWith("#/login?") || hash.startsWith("#/login/");
}

function handleUnauthorized(code?: string): void {
  attemptedBootstrapRefresh = false;
  clearAllAuthStorage();
  clearValidatedRole();

  if (typeof window !== "undefined" && !isOnLoginPage()) {
    if (code === "session_inactive") {
      window.location.href = "/login?reason=inactivity";
      return;
    }
    if (code === "token_expired") {
      window.location.href = "/login?reason=session_expired";
      return;
    }
    redirectToLogin();
  }
}

function buildHeaders(isJson = true, includeAuth = true) {
  const headers: Record<string, string> = {};

  if (isJson) {
    headers["Content-Type"] = "application/json";
  }

  if (includeAuth) {
    const token = getAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  return headers;
}

function isFormDataBody(body: unknown): body is FormData {
  return typeof FormData !== "undefined" && body instanceof FormData;
}

function buildBody(body: unknown) {
  if (body === undefined || body === null) return undefined;
  return isFormDataBody(body) ? body : JSON.stringify(body);
}

function buildUrl(path: string, params?: Record<string, unknown>) {
  const absoluteUrl = `${baseURL}${path}`;
  const url = new URL(
    absoluteUrl,
    typeof window !== "undefined" ? window.location.origin : "http://localhost",
  );

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, String(value));
  });

  return url.toString();
}

/**
 * Wraps fetch with a timeout using AbortController to prevent browser hangs.
 * Converts AbortError into a user-friendly timeout message.
 */
function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = API_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...init, signal: controller.signal })
    .catch((err: unknown) => {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error("Connection timed out. Please check your network and try again.");
      }
      throw err;
    })
    .finally(() => clearTimeout(timeoutId));
}

async function parseJsonResponse(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function sanitizeApiErrorText(text: string, fallback: string): string {
  const trimmed = text.trim();
  if (!trimmed) return fallback;

  if (/<!DOCTYPE html>|<html[\s>]/i.test(trimmed)) {
    const titleMatch = trimmed.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch?.[1]) {
      const title = titleMatch[1].trim();
      if (/ProgrammingError|OperationalError|IntegrityError|DatabaseError/i.test(title)) {
        return "Server database error. Please contact your administrator.";
      }
      return title.replace(/\s+at\s+\/api\/.*$/i, "").trim() || fallback;
    }
    return fallback;
  }

  if (trimmed.length > 280) {
    return fallback;
  }

  return trimmed;
}

function extractErrorMessage(data: unknown, fallback: string): string {
  if (!data) return fallback;
  if (typeof data === "string") return sanitizeApiErrorText(data, fallback);
  if (Array.isArray(data)) {
    const messages = data
      .map((entry) => extractErrorMessage(entry, ""))
      .filter(Boolean);
    return messages.join(", ") || fallback;
  }
  if (typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.detail === "string") return record.detail;
    if (typeof record.error === "string") return record.error;

    for (const value of Object.values(record)) {
      const message = extractErrorMessage(value, "");
      if (message) return message;
    }
  }
  return fallback;
}
/**
 *  NEW: refresh token logic
 */
async function tryRefreshToken(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;

  try {
    const res = await fetchWithTimeout(`${baseURL}/auth/refresh/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh }),
    });

    if (!res.ok) {
      clearAllAuthStorage();
      return false;
    }

    const data = await res.json();

    saveAccessToken(data.access);
    const refreshedClaims = {
      user_id: data.user_id,
      username: data.username,
      role_type: data.role_type,
      company_id: data.company_id,
      employee_id: data.employee_id,
    };

    saveClaims(refreshedClaims);
    setValidatedRole({
      role_type: typeof data.role_type === "string" ? data.role_type : "",
      user_id: typeof data.user_id === "string" ? data.user_id : undefined,
      username: typeof data.username === "string" ? data.username : undefined,
    });

    return true;
  } catch {
    clearAllAuthStorage();
    return false;
  }
}
async function get<T = unknown>(
  path: string,
  configOrRetry?: { params?: Record<string, unknown> } | boolean,
  retry = true,
): Promise<{ data: T }> {
  const config = typeof configOrRetry === "boolean" ? undefined : configOrRetry;
  const shouldRetry = typeof configOrRetry === "boolean" ? configOrRetry : retry;

  await ensureValidAccessToken(path);

  let response = await fetchWithTimeout(buildUrl(path, config?.params), {
    method: "GET",
    headers: buildHeaders(true, !isPublicAuthPath(path)),
  });

  let data = await parseJsonResponse(response);

  // Handle token expiry
  if (response.status === 401 && shouldRetry && shouldTryTokenRefresh(path)) {
    const refreshed = await tryRefreshToken();

    if (refreshed) {
      return get<T>(path, config, false);
    }

    if (shouldHandleUnauthorized(path)) {
      const code = typeof (data as Record<string, unknown> | null)?.code === "string"
        ? (data as Record<string, string>).code
        : undefined;
      handleUnauthorized(code);
    }
  } else if (response.status === 401 && shouldHandleUnauthorized(path)) {
    const code = typeof (data as Record<string, unknown> | null)?.code === "string"
      ? (data as Record<string, string>).code
      : undefined;
    handleUnauthorized(code);
  }

  if (!response.ok) {
    const error = new Error(extractErrorMessage(data, response.statusText || "Request failed"));

    (error as any).response = {
      status: response.status,
      data,
    };

    throw error;
  }

  return { data };
}

async function post<T = unknown>(
  path: string,
  body: unknown,
  configOrRetry?: { headers?: Record<string, string> } | boolean,
  retry = true,
): Promise<{ data: T }> {
  const shouldRetry = typeof configOrRetry === "boolean" ? configOrRetry : retry;
  const isFormData = isFormDataBody(body);

  await ensureValidAccessToken(path);

  let response = await fetchWithTimeout(`${baseURL}${path}`, {
    method: "POST",
    headers: buildHeaders(!isFormData, !isPublicAuthPath(path)),
    body: buildBody(body),
  });

  // Handle expiry
  if (response.status === 401 && shouldRetry && shouldTryTokenRefresh(path)) {
    const refreshed = await tryRefreshToken();

    if (refreshed) {
      // retry ONLY ONCE via recursion
      return post<T>(path, body, false);
    }

    if (shouldHandleUnauthorized(path)) {
      handleUnauthorized();
    }
  } else if (response.status === 401 && shouldHandleUnauthorized(path)) {
    handleUnauthorized();
  }

  const data = await parseJsonResponse(response);

  if (!response.ok) {
    const error = new Error(extractErrorMessage(data, response.statusText || "Request failed"));
    (error as any).response = { status: response.status, data };
    throw error;
  }

  return { data };
}

async function patch<T = unknown>(
  path: string,
  body: unknown,
  _config?: { headers?: Record<string, string> },
): Promise<{ data: T }> {
  const isFormData = isFormDataBody(body);

  await ensureValidAccessToken(path);

  const response = await fetchWithTimeout(`${baseURL}${path}`, {
    method: "PATCH",
    headers: buildHeaders(!isFormData, !isPublicAuthPath(path)),
    body: buildBody(body),
  });

  const data = await parseJsonResponse(response);
  if (response.status === 401 && shouldHandleUnauthorized(path)) {
    handleUnauthorized();
  }

  if (!response.ok) {
    const error = new Error(extractErrorMessage(data, response.statusText || "Request failed"));
    (error as any).response = { status: response.status, data };
    throw error;
  }

  return { data };
}

async function del<T = null>(path: string): Promise<{ data: T | null }> {
  await ensureValidAccessToken(path);

  const response = await fetchWithTimeout(`${baseURL}${path}`, {
    method: "DELETE",
    headers: buildHeaders(true, !isPublicAuthPath(path)),
  });

  if (response.status === 401 && shouldHandleUnauthorized(path)) {
    handleUnauthorized();
  }

  if (!response.ok) {
    const data = await parseJsonResponse(response);
    const error = new Error(extractErrorMessage(data, response.statusText || "Request failed"));
    (error as any).response = { status: response.status, data };
    throw error;
  }

  return { data: null };
}

async function download(path: string) {
  const response = await fetchWithTimeout(`${baseURL}${path}`, {
    method: "GET",
    headers: buildHeaders(),
  });

  if (!response.ok) {
    const data = await parseJsonResponse(response);
    const error = new Error(extractErrorMessage(data, response.statusText || "Request failed"));
    (error as any).response = { status: response.status, data };
    throw error;
  }

  const blob = await response.blob();
  return { blob };
}

const api = {
  defaults: { baseURL },
  get,
  post,
  patch,
  delete: del,
  download,
};

export function resetApiAuthState(): void {
  attemptedBootstrapRefresh = false;
}

export async function bootstrapAuthSession(): Promise<boolean> {
  if (getAccessToken()) return true;
  const refresh = getRefreshToken();
  if (!refresh) return false;
  attemptedBootstrapRefresh = false;
  return tryRefreshToken();
}

export default api;
