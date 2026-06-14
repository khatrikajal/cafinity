// Cafinity Security Fix Round 2 — VAPT June 2026 — Fix H (env-based API URL)
const configuredApiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();

export const API_BASE_URL = configuredApiBase
  ? configuredApiBase.replace(/\/+$/, '')
  : '/api/v1';

/**
 * API request timeout in milliseconds. Prevents browser hang on unresponsive backend.
 * Configured via VITE_API_TIMEOUT environment variable, default 15 seconds.
 */
export const API_TIMEOUT_MS = parseInt(
  (import.meta.env.VITE_API_TIMEOUT as string | undefined) || '15000',
  10
);
