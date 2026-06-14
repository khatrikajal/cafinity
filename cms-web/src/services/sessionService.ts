// Cafinity Fix — Session Management — June 2026

import {
  clearAllAuthStorage,
  getRefreshToken,
  saveClaims,
  saveRefreshToken,
  saveUserSession,
} from "@/lib/authStorage";
import type { AuthClaims } from "@/lib/authContext";
import type { User } from "@/lib/auth";

const REFRESH_TOKEN_KEY = "canteen_refresh_token";

let inMemoryAccessToken: string | null = null;
let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

const INACTIVITY_MS = 15 * 60 * 1000;

function redirectToLogin(reason: "session_expired" | "inactivity"): void {
  if (typeof window === "undefined") return;
  window.location.href = `/login?reason=${reason}`;
}

export const sessionService = {
  setTokens(access: string, refresh: string): void {
    inMemoryAccessToken = access;
    saveRefreshToken(refresh);
    if (typeof window !== "undefined") {
      localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
    }
  },

  setSession(access: string, refresh: string, claims: AuthClaims, user: User): void {
    this.setTokens(access, refresh);
    saveClaims(claims);
    saveUserSession(user);
  },

  getAccessToken(): string | null {
    return inMemoryAccessToken;
  },

  clearTokens(): void {
    inMemoryAccessToken = null;
    if (typeof window !== "undefined") {
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    }
    clearAllAuthStorage();
  },

  isAuthenticated(): boolean {
    return Boolean(inMemoryAccessToken || getRefreshToken());
  },

  resetInactivityTimer(): void {
    if (typeof window === "undefined") return;
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      this.clearTokens();
      redirectToLogin("inactivity");
    }, INACTIVITY_MS);
  },

  bindInactivityListeners(): void {
    if (typeof window === "undefined") return;
    const events: Array<keyof DocumentEventMap> = ["mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((event) => {
      document.addEventListener(event, () => this.resetInactivityTimer(), true);
    });
    this.resetInactivityTimer();
  },
};
