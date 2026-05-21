import { create } from "zustand";
import type { ArtifactKind } from "@/core/artifact-preview";
import { useProfileStore } from "./profile-store";

export type RuntimeStatus =
  | "idle"
  | "booting"
  | "installing"
  | "running"
  | "error"
  | "stopped";

export interface ProfileRuntimeState {
  runtimeStatus: RuntimeStatus;
  errorMessage: string | null;
  awaitingResponse: boolean;
  queuedInputs: string[];
  recentToolCalls: string[];
  modelId: string | null;
  contextWindowTokens: number | null;
  estimatedPromptTokens: number;
  /** First-run wizard: adapter emits ONBOARDING markers; exposed for E2E (xterm output is not text-queryable). */
  onboardingActive: boolean;
  /** Tool gate is awaiting a line on stdin (e.g. `y`). Chat bypasses queue when true. */
  pendingToolConfirm: boolean;
  /** Latest artifact offer from artifact_present markers. */
  artifactOffer: {
    title: string;
    filename: string;
    kind: ArtifactKind;
    path?: string;
    markdown?: string;
  } | null;
  /** <<<CLARIFY>>> skill marker — structured question + option buttons. */
  clarifyOffer: { question: string; options: string[]; openEnded: boolean } | null;
  /** Recent background review / curator summaries for this profile. */
  selfImprovementFeed: Array<{
    at: string;
    summary: string;
    kind: string | null;
    source: string | null;
  }>;
}

const EMPTY_PROFILE_RUNTIME: ProfileRuntimeState = {
  runtimeStatus: "idle",
  errorMessage: null,
  awaitingResponse: false,
  queuedInputs: [],
  recentToolCalls: [],
  modelId: null,
  contextWindowTokens: null,
  estimatedPromptTokens: 0,
  onboardingActive: false,
  pendingToolConfirm: false,
  artifactOffer: null,
  clarifyOffer: null,
  selfImprovementFeed: [],
};

export interface RuntimeState {
  profileRuntime: Record<string, ProfileRuntimeState>;
  nodeVersion: string | null;
  storageUsed: number;
  storagePersistent: boolean | null;
  webContainerWarm: boolean;
  runningProfileIds: string[];

  setRuntimeStatus: (profileId: string, status: RuntimeStatus) => void;
  setError: (profileId: string, message: string | null) => void;
  setAwaitingResponse: (profileId: string, awaiting: boolean) => void;
  enqueueInput: (profileId: string, input: string) => void;
  commitQueuedDispatch: (profileId: string) => string | null;
  clearQueuedInputs: (profileId: string) => void;
  setNodeVersion: (version: string) => void;
  setStorageUsed: (bytes: number) => void;
  setStoragePersistent: (persistent: boolean) => void;
  pushToolCall: (profileId: string, toolName: string) => void;
  clearToolCalls: (profileId: string) => void;
  markWebContainerWarm: () => void;
  setModelContext: (profileId: string, payload: {
    modelId: string | null;
    contextWindowTokens: number | null;
  }) => void;
  setEstimatedPromptTokens: (profileId: string, tokens: number) => void;
  resetModelContext: (profileId: string) => void;
  setProfileRunning: (profileId: string, running: boolean) => void;
  setOnboardingActive: (profileId: string, active: boolean) => void;
  setPendingToolConfirm: (profileId: string, pending: boolean) => void;
  setArtifactOffer: (
    profileId: string,
    payload: ProfileRuntimeState["artifactOffer"],
  ) => void;
  setClarifyOffer: (
    profileId: string,
    payload: ProfileRuntimeState["clarifyOffer"],
  ) => void;
  pushSelfImprovementSummary: (
    profileId: string,
    payload: { summary: string; kind?: string | null; source?: string | null; at?: string },
  ) => void;
}

function getProfileRuntime(
  profileRuntime: Record<string, ProfileRuntimeState>,
  profileId: string
): ProfileRuntimeState {
  return profileRuntime[profileId] ?? EMPTY_PROFILE_RUNTIME;
}

export const useRuntimeStore = create<RuntimeState>()((set, get) => ({
  profileRuntime: {},
  nodeVersion: null,
  storageUsed: 0,
  storagePersistent: null,
  webContainerWarm: false,
  runningProfileIds: [],

  setRuntimeStatus: (profileId, status) =>
    set((s) => {
      const prev = getProfileRuntime(s.profileRuntime, profileId);
      return {
        profileRuntime: {
          ...s.profileRuntime,
          [profileId]: { ...prev, runtimeStatus: status },
        },
      };
    }),
  setError: (profileId, message) =>
    set((s) => {
      const prev = getProfileRuntime(s.profileRuntime, profileId);
      if (message) {
        return {
          profileRuntime: {
            ...s.profileRuntime,
            [profileId]: { ...prev, errorMessage: message, runtimeStatus: "error" },
          },
        };
      }
      const nextStatus = prev.runtimeStatus === "error" ? "idle" : prev.runtimeStatus;
      return {
        profileRuntime: {
          ...s.profileRuntime,
          [profileId]: { ...prev, errorMessage: null, runtimeStatus: nextStatus },
        },
      };
    }),
  setAwaitingResponse: (profileId, awaiting) =>
    set((s) => {
      const prev = getProfileRuntime(s.profileRuntime, profileId);
      return {
        profileRuntime: {
          ...s.profileRuntime,
          [profileId]: { ...prev, awaitingResponse: awaiting },
        },
      };
    }),
  enqueueInput: (profileId, input) =>
    set((s) => {
      const prev = getProfileRuntime(s.profileRuntime, profileId);
      return {
        profileRuntime: {
          ...s.profileRuntime,
          [profileId]: { ...prev, queuedInputs: [...prev.queuedInputs, input] },
        },
      };
    }),
  commitQueuedDispatch: (profileId) => {
    let nextInput: string | null = null;
    set((s) => {
      const prev = getProfileRuntime(s.profileRuntime, profileId);
      const [next, ...rest] = prev.queuedInputs;
      if (!next) {
        return {
          profileRuntime: {
            ...s.profileRuntime,
            [profileId]: { ...prev, awaitingResponse: false },
          },
        };
      }
      nextInput = next;
      return {
        profileRuntime: {
          ...s.profileRuntime,
          [profileId]: { ...prev, queuedInputs: rest, awaitingResponse: true },
        },
      };
    });
    return nextInput;
  },
  clearQueuedInputs: (profileId) =>
    set((s) => {
      const prev = getProfileRuntime(s.profileRuntime, profileId);
      return {
        profileRuntime: {
          ...s.profileRuntime,
          [profileId]: { ...prev, queuedInputs: [] },
        },
      };
    }),
  setNodeVersion: (version) => set({ nodeVersion: version }),
  setStorageUsed: (bytes) => set({ storageUsed: bytes }),
  setStoragePersistent: (persistent) => set({ storagePersistent: persistent }),
  pushToolCall: (profileId, toolName) =>
    set((s) => {
      const prev = getProfileRuntime(s.profileRuntime, profileId);
      const next = [...prev.recentToolCalls, toolName];
      return {
        profileRuntime: {
          ...s.profileRuntime,
          [profileId]: { ...prev, recentToolCalls: next.slice(-20) },
        },
      };
    }),
  clearToolCalls: (profileId) =>
    set((s) => {
      const prev = getProfileRuntime(s.profileRuntime, profileId);
      return {
        profileRuntime: {
          ...s.profileRuntime,
          [profileId]: { ...prev, recentToolCalls: [] },
        },
      };
    }),
  markWebContainerWarm: () => set({ webContainerWarm: true }),
  setModelContext: (profileId, { modelId, contextWindowTokens }) =>
    set((s) => {
      const prev = getProfileRuntime(s.profileRuntime, profileId);
      return {
        profileRuntime: {
          ...s.profileRuntime,
          [profileId]: {
            ...prev,
            modelId,
            contextWindowTokens:
              typeof contextWindowTokens === "number" && Number.isFinite(contextWindowTokens)
                ? Math.max(0, Math.round(contextWindowTokens))
                : null,
          },
        },
      };
    }),
  setEstimatedPromptTokens: (profileId, tokens) =>
    set((s) => {
      const prev = getProfileRuntime(s.profileRuntime, profileId);
      return {
        profileRuntime: {
          ...s.profileRuntime,
          [profileId]: {
            ...prev,
            estimatedPromptTokens: Number.isFinite(tokens)
              ? Math.max(0, Math.round(tokens))
              : 0,
          },
        },
      };
    }),
  resetModelContext: (profileId) =>
    set((s) => {
      const prev = getProfileRuntime(s.profileRuntime, profileId);
      return {
        profileRuntime: {
          ...s.profileRuntime,
          [profileId]: {
            ...prev,
            modelId: null,
            contextWindowTokens: null,
            estimatedPromptTokens: 0,
          },
        },
      };
    }),
  setProfileRunning: (profileId, running) =>
    set((s) => {
      const next = new Set(s.runningProfileIds);
      if (running) next.add(profileId);
      else next.delete(profileId);
      return { runningProfileIds: Array.from(next) };
    }),
  setOnboardingActive: (profileId, active) =>
    set((s) => {
      const prev = getProfileRuntime(s.profileRuntime, profileId);
      return {
        profileRuntime: {
          ...s.profileRuntime,
          [profileId]: { ...prev, onboardingActive: active },
        },
      };
    }),
  setPendingToolConfirm: (profileId, pending) =>
    set((s) => {
      const prev = getProfileRuntime(s.profileRuntime, profileId);
      return {
        profileRuntime: {
          ...s.profileRuntime,
          [profileId]: { ...prev, pendingToolConfirm: pending },
        },
      };
    }),
  setArtifactOffer: (profileId, payload) =>
    set((s) => {
      const prev = getProfileRuntime(s.profileRuntime, profileId);
      return {
        profileRuntime: {
          ...s.profileRuntime,
          [profileId]: { ...prev, artifactOffer: payload },
        },
      };
    }),
  setClarifyOffer: (profileId, payload) =>
    set((s) => {
      const prev = getProfileRuntime(s.profileRuntime, profileId);
      return {
        profileRuntime: {
          ...s.profileRuntime,
          [profileId]: { ...prev, clarifyOffer: payload },
        },
      };
    }),
  pushSelfImprovementSummary: (profileId, payload) =>
    set((s) => {
      const prev = getProfileRuntime(s.profileRuntime, profileId);
      const summary = String(payload.summary || "").trim();
      if (!summary) return s;
      const at = payload.at || new Date().toISOString();
      const nextEntry = {
        at,
        summary,
        kind: payload.kind ?? null,
        source: payload.source ?? null,
      };
      const deduped = prev.selfImprovementFeed.filter(
        (item) => !(item.summary === nextEntry.summary && item.at === nextEntry.at)
      );
      return {
        profileRuntime: {
          ...s.profileRuntime,
          [profileId]: {
            ...prev,
            selfImprovementFeed: [nextEntry, ...deduped].slice(0, 40),
          },
        },
      };
    }),
}));

export function useProfileRuntime(profileId: string | null): ProfileRuntimeState {
  return useRuntimeStore((s) =>
    profileId ? s.profileRuntime[profileId] ?? EMPTY_PROFILE_RUNTIME : EMPTY_PROFILE_RUNTIME
  );
}

export function useActiveProfileRuntime(): ProfileRuntimeState {
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  return useProfileRuntime(activeProfileId);
}

/** True until next prompt-ready: slow LLM TTFBT, streaming, tools, etc. Matches favicon-loading semantics. */
export function profileAgentWorking(rt: ProfileRuntimeState): boolean {
  return (
    rt.runtimeStatus === "running" &&
    !rt.pendingToolConfirm &&
    (rt.awaitingResponse || rt.queuedInputs.length > 0)
  );
}
