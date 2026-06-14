// Cafinity rebrand — logo + favicon update
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  getTokenFromStorage,
  getClaimsFromStorage,
  clearAllAuthStorage,
} from '@/lib/authStorage';

export type UserRole = 'super_admin' | 'admin' | 'employee' | 'kitchen' | 'counter';
export type Portal = 'ess' | 'cms';
export type PortalOrNull = Portal | null;

interface UIState {
  // ─── Auth ──────────────────────────────────────────────────────────────────
  isAuthenticated: boolean;
  authToken: string | null;
  userId: string | null;
  username: string | null;

  // ─── Role ──────────────────────────────────────────────────────────────────
  /** Derived from the user's role_type returned by the API on login. */
  role: UserRole;

  // ─── Navigation ───────────────────────────────────────────────────────────
  /** Which top-level module is active (e.g. 'canteen'). */
  activeModule: string;
  /** Portal context: 'ess' = employee self-service, 'cms' = admin/kitchen/counter.
   *  null = not yet selected (admin sees portal chooser). */
  portal: PortalOrNull;
  /** Per-module view mode: 'employee' | 'admin' | 'kitchen' | 'counter'. */
  moduleViews: Record<string, string>;
  setActiveModule: (module: string) => void;
  setPortal: (portal: PortalOrNull) => void;
  setModuleView: (module: string, view: string) => void;

  // ─── Theme ─────────────────────────────────────────────────────────────────
  isDark: boolean;

  // ─── Actions ───────────────────────────────────────────────────────────────
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  setRole: (role: UserRole) => void;
  toggleTheme: () => void;
  syncAuthFromStorage: () => void;
  hardResetAuthState: () => void;
}

/**
 * Maps Django role_type strings to frontend UserRole values.
 * Kitchen and counter users authenticate via a separate device-login endpoint
 * that returns role = 'KITCHEN' | 'COUNTER' directly.
 */
function mapRoleType(roleType: string): UserRole {
  if (roleType === 'SUPER_ADMIN') return 'super_admin';
  if (roleType === 'COMPANY_ADMIN' || roleType === 'HR_MANAGER' || roleType === 'PAYROLL_MANAGER' || roleType === 'LIMITED_ADMIN') return 'admin';
  if (roleType === 'KITCHEN') return 'kitchen';
  if (roleType === 'COUNTER') return 'counter';
  return 'employee';
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      authToken: null,
      userId: null,
      username: null,
      role: 'employee',
      activeModule: 'canteen',
      portal: null as PortalOrNull,
      moduleViews: { canteen: 'employee' },
      isDark: false,

      setActiveModule: (module) => set({ activeModule: module }),
      setPortal: (portal) => set({ portal }),
      setModuleView: (module, view) =>
        set((s) => ({ moduleViews: { ...s.moduleViews, [module]: view } })),

      /**
       * Sync auth state from sessionStorage (called after login or on app init)
       */
      syncAuthFromStorage: () => {
        const token = getTokenFromStorage();
        const claims = getClaimsFromStorage();

        if (token && claims) {
          const mappedRole = mapRoleType(claims.role_type || '');
          const defaultPortal: PortalOrNull = (mappedRole === 'employee') ? 'ess' : null;
          set({
            isAuthenticated: true,
            authToken: token,
            userId: claims.user_id,
            username: claims.username,
            role: mappedRole,
            portal: defaultPortal,
          });
        } else {
          set({
            isAuthenticated: false,
            authToken: null,
            userId: null,
            username: null,
            role: 'employee',
            portal: null,
          });
        }
      },

      login: async (username: string, _password: string) => {
        // Mock authentication — no backend required
        // In production, the login flow uses lib/auth.ts which calls real endpoints
        const mockRoles: Record<string, string> = {
          superadmin: 'SUPER_ADMIN',
          admin: 'COMPANY_ADMIN',
          kitchen: 'KITCHEN',
          counter: 'COUNTER',
        };
        const roleType = mockRoles[username.toLowerCase()] ?? 'EMPLOYEE';
        const mappedRole = mapRoleType(roleType);
        const defaultPortal: PortalOrNull = (mappedRole === 'employee') ? 'ess' : null;
        set({
          isAuthenticated: true,
          authToken: null,
          userId: '1',
          username,
          role: mappedRole,
          portal: defaultPortal,
        });
      },

      logout: () => {
        if (typeof window !== "undefined") {
          clearAllAuthStorage();
        }
        set({
          isAuthenticated: false,
          authToken: null,
          userId: null,
          username: null,
          role: 'employee',
          portal: null,
        });
      },
      hardResetAuthState: () => {
        if (typeof window !== "undefined") {
          localStorage.removeItem("canteenx-ui");
        }
        set({
          isAuthenticated: false,
          authToken: null,
          userId: null,
          username: null,
          role: 'employee',
          portal: null,
        });
      },

      setRole: (role) => set({ role }),

      toggleTheme: () => set((s) => {
        const next = !s.isDark;
        document.documentElement.classList.toggle('dark', next);
        return { isDark: next };
      }),
    }),
    {
      name: 'canteenx-ui',
      // Only persist auth state; role is re-derived on next login
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        authToken: state.authToken,
        userId: state.userId,
        username: state.username,
        role: state.role,
        isDark: state.isDark,
        portal: state.portal,
        moduleViews: state.moduleViews,
      }),
    },
  ),
);
