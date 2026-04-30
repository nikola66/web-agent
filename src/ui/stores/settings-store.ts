import { create } from "zustand";
import { LLM_PROVIDER_CONFIG } from "@/core/profiles";

/** Default / “mid” sidebar width (px). */
export const SIDEBAR_WIDTH_DEFAULT_PX = 280;
/** Narrowest drag target (px). */
export const SIDEBAR_WIDTH_MIN_PX = 220;
/** Widest drag target (px); also capped by viewport so the main column stays usable. */
export const SIDEBAR_WIDTH_MAX_PX = 520;
/** Minimum width left for the main column when computing the drag max. */
export const SIDEBAR_MAIN_RESERVE_PX = 360;

export function clampSidebarWidthPx(w: number): number {
  const min = SIDEBAR_WIDTH_MIN_PX;
  if (typeof window === "undefined") {
    return Math.round(Math.min(Math.max(w, min), SIDEBAR_WIDTH_MAX_PX));
  }
  const max = Math.min(
    SIDEBAR_WIDTH_MAX_PX,
    Math.max(min, window.innerWidth - SIDEBAR_MAIN_RESERVE_PX)
  );
  return Math.round(Math.min(Math.max(w, min), max));
}

export interface ApiKeyEntry {
  provider: string;
  key: string;
}

export type SidebarView = "profiles" | "settings" | "workspaces";

interface SettingsState {
  apiKeys: Record<string, string>;
  sidebarView: SidebarView;
  sidebarOpen: boolean;
  sidebarWidthPx: number;

  setApiKey: (provider: string, key: string) => void;
  removeApiKey: (provider: string) => void;
  loadApiKeys: (keys: Record<string, string>) => void;
  setSidebarView: (view: SidebarView) => void;
  toggleSidebar: () => void;
  setSidebarWidthPx: (widthPx: number) => void;
}

export interface LlmProviderConfig {
  id: string;
  name: string;
  label?: string;
  model?: string;
  requiresUserApiKey: boolean;
  isDefault?: boolean;
  placeholder?: string;
  getKeyUrl?: string;
}

export const LLM_PROVIDERS: readonly LlmProviderConfig[] = LLM_PROVIDER_CONFIG.map(
  (provider) => ({
    ...provider,
    label: provider.label || provider.name,
  })
);

export const useSettingsStore = create<SettingsState>((set) => ({
  apiKeys: {},
  sidebarView: "profiles",
  sidebarOpen: true,
  sidebarWidthPx: SIDEBAR_WIDTH_DEFAULT_PX,

  setApiKey: (provider, key) =>
    set((state) => ({ apiKeys: { ...state.apiKeys, [provider]: key } })),
  removeApiKey: (provider) =>
    set((state) => {
      const { [provider]: _, ...rest } = state.apiKeys;
      return { apiKeys: rest };
    }),
  loadApiKeys: (keys) => set({ apiKeys: keys }),
  setSidebarView: (view) => set({ sidebarView: view }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarWidthPx: (widthPx) =>
    set({ sidebarWidthPx: clampSidebarWidthPx(widthPx) }),
}));
