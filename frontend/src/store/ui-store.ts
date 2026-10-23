import { create } from "zustand";

interface UiState {
  agentFormDirty: boolean;
  voiceSessionBusy: boolean;
  setAgentFormDirty: (value: boolean) => void;
  setVoiceSessionBusy: (value: boolean) => void;
  isSidebarCollapsed: boolean;
  isMobileNavOpen: boolean;
  activeOrgId: string;
  activeOrgName: string;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
  setActiveOrg: (id: string, name: string) => void;
}

/**
 * Zustand store for purely client-side UI and layout state.
 * Strictly adheres to FRONTEND_ARCHITECTURE.md:
 * - NO server/API data stored here
 * - Only UI flags and client preferences
 */
export const useUiStore = create<UiState>((set) => ({
  agentFormDirty: false, voiceSessionBusy: false,
  setAgentFormDirty: (agentFormDirty) => set({ agentFormDirty }),
  setVoiceSessionBusy: (voiceSessionBusy) => set({ voiceSessionBusy }),
  isSidebarCollapsed: false,
  isMobileNavOpen: false,
  activeOrgId: "org-default-001",
  activeOrgName: "Brahmaputra Health Clinic",
  toggleSidebar: () =>
    set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ isSidebarCollapsed: collapsed }),
  setMobileNavOpen: (open) => set({ isMobileNavOpen: open }),
  setActiveOrg: (id, name) => set({ activeOrgId: id, activeOrgName: name }),
}));
