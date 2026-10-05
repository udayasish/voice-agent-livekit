import { create } from "zustand";
import type { AuthOrganization, AuthUser } from "@/types/auth";

interface AuthState {
  user: AuthUser | null;
  organizations: AuthOrganization[];
  activeOrganization: AuthOrganization | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  setUser: (user: AuthUser | null) => void;
  setOrganizations: (orgs: AuthOrganization[]) => void;
  setActiveOrganization: (org: AuthOrganization | null) => void;
  setSession: (user: AuthUser, orgs: AuthOrganization[], activeOrg?: AuthOrganization | null) => void;
  clearAuth: () => void;
  setLoading: (loading: boolean) => void;
}

/**
 * Zustand store for authenticated user profile & active organization context.
 * Strictly adheres to FRONTEND_ARCHITECTURE.md §9:
 * - NO JWT tokens or secrets stored in localStorage.
 * - Tokens are stored exclusively in HTTP-only, secure cookies managed by the browser.
 */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  organizations: [],
  activeOrganization: null,
  isAuthenticated: false,
  isLoading: true,

  setUser: (user) => set({ user, isAuthenticated: !!user }),
  setOrganizations: (organizations) => set({ organizations }),
  setActiveOrganization: (activeOrganization) => set({ activeOrganization }),
  setSession: (user, organizations, activeOrg) =>
    set({
      user,
      organizations,
      activeOrganization: activeOrg ?? organizations[0] ?? null,
      isAuthenticated: true,
      isLoading: false,
    }),
  clearAuth: () =>
    set({
      user: null,
      organizations: [],
      activeOrganization: null,
      isAuthenticated: false,
      isLoading: false,
    }),
  setLoading: (isLoading) => set({ isLoading }),
}));
