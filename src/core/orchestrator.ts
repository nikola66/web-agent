/**
 * Central orchestrator — single Web Agent with profiles (WebContainer).
 * Each agent gets isolated workspace, state, and eventually terminal.
 * Currently only one agent can be "active" (receiving UI input), but this
 * structure enables future concurrent multi-agent support.
 */

import { type Terminal } from "@xterm/xterm";
import { useRuntimeStore } from "@/ui/stores/runtime-store";
import { useProfileStore } from "@/ui/stores/profile-store";
import { LLM_PROVIDERS, useSettingsStore } from "@/ui/stores/settings-store";
import { loadApiKeys, saveApiKeys, loadProfileCredentials } from "./credential-vault";
import { CHANNELS } from "./channels";
import { requestPersistentStorage, getStorageEstimate } from "./persistence";
import { runLegacySnapshotMigration } from "./migrate";
import {
  startWebAgent,
  stopWebAgent,
  writeToWebAgent,
  resizeAgentPty,
} from "@/agent/adapter";
import { SLASH_COMMANDS } from "@/agent/embed-commands";
import { TOOL_CATALOG } from "@/agent/tool-catalog";
import { buildToolRowsFromCatalog, renderHelpView } from "@/agent/runtime/slash-command-views";
import {
  enqueueTerminalTypewriter,
  flushTerminalTypewriter,
} from "./terminal-typewriter";
import { snapXtermViewportToLatest } from "./terminal-viewport-sync";

interface OrchestratorAgentState {
  profileId: string;
  agentReadyForInput: boolean;
  onboardingActive: boolean;
  onboardingField: "agent" | "user";
  noAgentTerminalHintShown: boolean;
  // Serialise stop/start for this profile so rapid switches don't leave agents running
  lifecycleMutex: Promise<void>;
}

let activeProfileId: string | null = null;  // Currently displayed profile
const runningProfileIds = new Set<string>();
let agentStates = new Map<string, OrchestratorAgentState>();
let profileTerminals = new Map<string, Terminal>();  // Per-profile xterm instances
let storageCheckInterval: ReturnType<typeof setInterval> | null = null;
let lastStorageWarningAt = 0;
const MAX_CONCURRENT_AGENTS = 4;
const STORAGE_WARNING_PERCENT = 80;
const STORAGE_WARNING_THROTTLE_MS = 5 * 60_000;
const BROWSER_TRANSCRIPT_ENABLED =
  String(import.meta.env.VITE_WEBAGENT_DEBUG_LOG || "").trim() === "1";

/** Drop legacy credential keys so they never hydrate into settings or agent env */
const DEPRECATED_CREDENTIAL_KEYS = ["gmail_client_id", "gmail_client_secret", "gmail_refresh_token"];

function omitDeprecatedCredentialKeys(keys: Record<string, string>): Record<string, string> {
  const out = { ...keys };
  for (const k of DEPRECATED_CREDENTIAL_KEYS) {
    delete out[k];
  }
  return out;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function getOrCreateAgentState(profileId: string): OrchestratorAgentState {
  if (!agentStates.has(profileId)) {
    agentStates.set(profileId, {
      profileId,
      agentReadyForInput: false,
      onboardingActive: false,
      onboardingField: "agent",
      noAgentTerminalHintShown: false,
      lifecycleMutex: Promise.resolve(),
    });
  }
  return agentStates.get(profileId)!;
}

function resetAgentTerminalHint(profileId: string): void {
  getOrCreateAgentState(profileId).noAgentTerminalHintShown = false;
}

function getTerminal(profileId: string | null): Terminal | null {
  if (!profileId) return null;
  return profileTerminals.get(profileId) || null;
}

/** Snap the profile xterm viewport to the latest line (e.g. after sending from ChatInput). */
function scrollProfileTerminalToBottom(profileId: string | null): void {
  snapXtermViewportToLatest(getTerminal(profileId));
}

/** Attach xterm instance for a specific profile */
export function attachProfileTerminal(profileId: string, terminal: Terminal): void {
  profileTerminals.set(profileId, terminal);
  if (!activeProfileId) {
    activeProfileId = profileId;
  }
}

/** Switch to a different profile's terminal (show/hide) and run fitAddon */
export async function switchToProfile(profileId: string): Promise<void> {
  activeProfileId = profileId;
  const terminal = profileTerminals.get(profileId);
  if (terminal) {
    // Terminal visibility is managed by CSS (display/visibility)
    // Re-fit the terminal since it may have been hidden and resized while hidden
    const fitAddon = (terminal as any).__fitAddon;
    if (fitAddon) {
      await Promise.resolve();
      fitAddon.fit();
    }
  }
}

/** Legacy: attach single terminal (for backward compat, maps to profile terminal) */
export function attachTerminal(term: Terminal): void {
  if (activeProfileId) {
    attachProfileTerminal(activeProfileId, term);
  }
}

export function detachTerminal(): void {
  if (activeProfileId) {
    profileTerminals.delete(activeProfileId);
  }
}

/** Send raw terminal input to the running agent process - kept for compatibility */
export async function sendTerminalInput(data: string): Promise<void> {
  // Deprecated: Input should go through submitUserInput via ChatInput
  console.warn("sendTerminalInput is deprecated, use submitUserInput instead");
  await handleTerminalInput(data);
}

function write(data: string): void {
  appendBrowserTranscript(activeProfileId, data, "orchestrator");
  const term = getTerminal(activeProfileId);
  term?.write(data);
}

function writeToProfile(profileId: string, data: string): void {
  appendBrowserTranscript(profileId, data, "agent");
  enqueueTerminalTypewriter(profileId, data, getTerminal);
}

function appendBrowserTranscript(
  profileId: string | null,
  data: string,
  source: "agent" | "orchestrator"
): void {
  if (!BROWSER_TRANSCRIPT_ENABLED || typeof window === "undefined" || !data) return;
  const w = window as typeof window & {
    __WEBAGENT_LIVE_TRANSCRIPT__?: Array<{
      profileId: string | null;
      source: string;
      at: number;
      data: string;
    }>;
  };
  if (!Array.isArray(w.__WEBAGENT_LIVE_TRANSCRIPT__)) {
    w.__WEBAGENT_LIVE_TRANSCRIPT__ = [];
  }
  w.__WEBAGENT_LIVE_TRANSCRIPT__.push({
    profileId,
    source,
    at: Date.now(),
    data,
  });
  if (w.__WEBAGENT_LIVE_TRANSCRIPT__.length > 2000) {
    w.__WEBAGENT_LIVE_TRANSCRIPT__.splice(0, w.__WEBAGENT_LIVE_TRANSCRIPT__.length - 2000);
  }
}

function getPtySizeForProfile(profileId: string): { cols: number; rows: number } {
  const t = getTerminal(profileId);
  if (t && t.cols > 0 && t.rows > 0) return { cols: t.cols, rows: t.rows };
  return { cols: 120, rows: 40 };
}

let notifyAgentTerminalRaf: number | null = null;

export function notifyAgentTerminalResized(): void {
  if (!activeProfileId || !runningProfileIds.has(activeProfileId)) return;
  const profileId = activeProfileId;
  if (notifyAgentTerminalRaf !== null) return;
  notifyAgentTerminalRaf = requestAnimationFrame(() => {
    notifyAgentTerminalRaf = null;
    resizeAgentPty(profileId, getPtySizeForProfile(profileId));
  });
}

async function handleTerminalInput(data: string): Promise<void> {
   const state = activeProfileId ? getOrCreateAgentState(activeProfileId) : null;
   // Deprecated: Input should go through submitUserInput via ChatInput
   // Show warning once per session
   if (data.trim() && state && !state.noAgentTerminalHintShown) {
     state.noAgentTerminalHintShown = true;
     write(
       "\r\n\x1b[90mTerminal input is deprecated. Use the chat input at the bottom instead.\x1b[0m\r\n"
     );
   }

   if (!activeProfileId || !runningProfileIds.has(activeProfileId)) {
     if (data && state && !state.noAgentTerminalHintShown) {
       state.noAgentTerminalHintShown = true;
       write(
         "\r\n\x1b[90mNo agent running — use Launch in the sidebar first.\x1b[0m\r\n"
       );
     }
     return;
   }
   await writeToWebAgent(activeProfileId, data);
 }

async function dispatchQueuedInputIfReady(profileId: string): Promise<void> {
  if (!runningProfileIds.has(profileId)) return;
  const state = getOrCreateAgentState(profileId);
  if (!state.agentReadyForInput) return;
  const rt = useRuntimeStore.getState();
  const nextInput = rt.dequeueInput(profileId);
  if (!nextInput) return;
  state.agentReadyForInput = false;
  rt.setAwaitingResponse(profileId, true);
  await writeToWebAgent(profileId, `${nextInput}\n`);
}

async function onAgentPromptReady(profileId: string): Promise<void> {
  const state = getOrCreateAgentState(profileId);
  state.agentReadyForInput = true;
  const rt = useRuntimeStore.getState();
  rt.setAwaitingResponse(profileId, false);
  rt.setPendingToolConfirm(profileId, false);
  await dispatchQueuedInputIfReady(profileId);
}

export async function submitUserInput(raw: string): Promise<void> {
  const trimmed = raw.trim();
  const targetProfileId = activeProfileId;
  if (!targetProfileId || !runningProfileIds.has(targetProfileId)) {
    scrollProfileTerminalToBottom(targetProfileId);
    write("\r\n\x1b[90mNo agent running — use Launch in the sidebar first.\x1b[0m\r\n");
    return;
  }

  const state = getOrCreateAgentState(targetProfileId);
  const acceptsBlankOnboardingInput = state.onboardingActive;
  if (!trimmed && !acceptsBlankOnboardingInput) return;

  scrollProfileTerminalToBottom(targetProfileId);
  const input = acceptsBlankOnboardingInput ? raw : trimmed;
  if (trimmed === "/stop") {
    await writeToWebAgent(targetProfileId, "/stop\n");
    write("\r\n\x1b[33m▸ Interrupt requested\x1b[0m\r\n");
    useRuntimeStore.getState().setAwaitingResponse(targetProfileId, false);
    return;
  }

  if (trimmed === "/help") {
    const helpText = renderHelpView(SLASH_COMMANDS, buildToolRowsFromCatalog(TOOL_CATALOG));
    write(`\r\n${helpText.replace(/\n/g, "\r\n")}`);
    return;
  }

  if (trimmed === "/clear") {
    if (!state.agentReadyForInput) {
      write("\r\n\x1b[90mCannot clear while response is in progress. Use /stop first.\x1b[0m\r\n");
      return;
    }
    useRuntimeStore.getState().clearQueuedInputs(targetProfileId);
    useRuntimeStore.getState().resetModelContext(targetProfileId);
    state.agentReadyForInput = false;
    useRuntimeStore.getState().setAwaitingResponse(targetProfileId, true);
    await writeToWebAgent(targetProfileId, "/clear\n");
    return;
  }

  if (state.onboardingActive && targetProfileId) {
    const onboardingValue = input.trim();
    if (state.onboardingField === "agent") {
      state.onboardingField = "user";
      if (onboardingValue) {
        useProfileStore.setState((s) => ({
          profiles: s.profiles.map((profile) =>
            profile.id === targetProfileId
              ? { ...profile, name: onboardingValue, updatedAt: Date.now() }
              : profile
          ),
        }));
        void useProfileStore
          .getState()
          .updateProfile(targetProfileId, { name: onboardingValue });
      }
    } else {
      state.onboardingField = "agent";
      if (onboardingValue) {
        useProfileStore.setState((s) => ({
          profiles: s.profiles.map((profile) =>
            profile.id === targetProfileId
              ? { ...profile, userName: onboardingValue, updatedAt: Date.now() }
              : profile
          ),
        }));
        void useProfileStore
          .getState()
          .updateProfile(targetProfileId, { userName: onboardingValue });
      }
    }
  }

  const rtSnapshot = useRuntimeStore.getState().profileRuntime[targetProfileId];
  if (rtSnapshot?.pendingToolConfirm) {
    await writeToWebAgent(targetProfileId, `${input}\n`);
    useRuntimeStore.getState().setPendingToolConfirm(targetProfileId, false);
    return;
  }

  if (!state.agentReadyForInput) {
    useRuntimeStore.getState().enqueueInput(targetProfileId, input);
    write(`\r\n\x1b[90m▸ Queued for next turn (${input.slice(0, 80)})\x1b[0m\r\n`);
    return;
  }

  state.agentReadyForInput = false;
  useRuntimeStore.getState().setAwaitingResponse(targetProfileId, true);
  await writeToWebAgent(targetProfileId, `${input}\n`);
}

export async function initialize(): Promise<void> {
  await runLegacySnapshotMigration();
  await useProfileStore.getState().loadProfiles();

  const granted = await requestPersistentStorage();
  useRuntimeStore.getState().setStoragePersistent(granted);

  const savedKeys = await loadApiKeys();
  const credentialKeys = omitDeprecatedCredentialKeys(savedKeys);
  if (Object.keys(credentialKeys).length > 0) {
    useSettingsStore.getState().loadApiKeys(credentialKeys);
    write("\x1b[90m✓ Credentials restored\x1b[0m\n");
  } else if (Object.keys(savedKeys).length > 0) {
    useSettingsStore.getState().loadApiKeys({});
  }

  startStorageMonitoring();

  useSettingsStore.subscribe(async (state) => {
    await saveApiKeys(state.apiKeys);
  });
}

/** Start the Web Agent for a profile (or currently selected if not specified) */
export async function startAgent(profileId?: string): Promise<void> {
  const ps = useProfileStore.getState();
  await ps.loadProfiles();

  const targetProfileId = profileId ?? ps.activeProfileId;
  if (profileId && profileId !== ps.activeProfileId) {
    ps.setActiveProfile(profileId);
  }

  const profile = ps.profiles.find((p) => p.id === targetProfileId);
  if (!profile) {
    write("\x1b[31m✗ No profile selected.\x1b[0m\n");
    return;
  }

  const agentState = getOrCreateAgentState(profile.id);
  // Chain onto the per-profile lifecycle mutex so this call waits for any in-progress stop.
  let resolveOwnSlot!: () => void;
  const previousSlot = agentState.lifecycleMutex;
  agentState.lifecycleMutex = new Promise<void>((resolve) => {
    resolveOwnSlot = resolve;
  });

  try {
    await previousSlot;

    flushTerminalTypewriter(profile.id, getTerminal);

    if (runningProfileIds.has(profile.id)) {
      write("\x1b[90m▸ Agent already running for this profile.\x1b[0m\n");
      return;
    }

    const rt = useRuntimeStore.getState();
    const settings = useSettingsStore.getState();
    rt.clearToolCalls(profile.id);
    rt.resetModelContext(profile.id);
    rt.setAwaitingResponse(profile.id, false);
    rt.clearQueuedInputs(profile.id);
    rt.setPendingToolConfirm(profile.id, false);
    rt.setArtifactOffer(profile.id, null);
    rt.setClarifyOffer(profile.id, null);
    rt.setOnboardingActive(profile.id, false);
    agentState.agentReadyForInput = false;
    if (!runningProfileIds.has(profile.id) && runningProfileIds.size >= MAX_CONCURRENT_AGENTS) {
      write(
        `\x1b[33m▸ Concurrent agent cap (${MAX_CONCURRENT_AGENTS}) reached. Stop one before launching another.\x1b[0m\n`
      );
      return;
    }

    const globalApiKeys = settings.apiKeys;
    const profileCreds = await loadProfileCredentials(profile.id);
    const mergedProviderApiKey =
      profileCreds.apiKey?.trim() || globalApiKeys[profile.provider]?.trim() || "";
    const mergedCustomBaseUrl =
      profileCreds.customBaseUrl?.trim() || globalApiKeys.custom_baseurl?.trim() || "";

    // Build channel env vars from channel manifests
    const channelEnv: Record<string, string> = {};
    for (const ch of CHANNELS) {
      const token = profileCreds.channelTokens?.[ch.id]?.trim();
      if (token && ch.auth?.envVar) {
        channelEnv[ch.auth.envVar] = token;
      }
    }

    const apiKeys: Record<string, string> = {
      ...globalApiKeys,
      [profile.provider]: mergedProviderApiKey,
      custom_baseurl: mergedCustomBaseUrl,
      ...channelEnv,
    };

    const providerConfig = LLM_PROVIDERS.find((provider) => provider.id === profile.provider);
    const providerRequiresUserApiKey = providerConfig?.requiresUserApiKey ?? true;
    const hasEffectiveKey = !!mergedProviderApiKey;
    if (providerRequiresUserApiKey && !hasEffectiveKey) {
      write(
        "\x1b[33m⚠ Missing API key for this agent. Click Edit (pencil icon) to configure it.\x1b[0m\n"
      );
    }

    try {
      rt.setError(profile.id, null);
      rt.setRuntimeStatus(profile.id, "booting");
      await startWebAgent({
        profile,
        apiKeys,
        ptySize: getPtySizeForProfile(profile.id),
        onOutput: (d) => writeToProfile(profile.id, d),
        onNodeVersion: (v) => useRuntimeStore.getState().setNodeVersion(v),
        onProfileNameChange: (name) => {
          void useProfileStore.getState().updateProfile(profile.id, { name });
        },
        onUserNameChange: (userName) => {
          void useProfileStore.getState().updateProfile(profile.id, { userName });
        },
        onToolCall: (toolName) => {
          useRuntimeStore.getState().pushToolCall(profile.id, toolName);
        },
        onPendingToolConfirmation: (pid) => {
          useRuntimeStore.getState().setPendingToolConfirm(pid, true);
        },
        onArtifactOffer: (pid, payload) => {
          useRuntimeStore.getState().setArtifactOffer(pid, payload);
        },
        onClarifyOffer: (pid, payload) => {
          useRuntimeStore.getState().setClarifyOffer(pid, payload);
        },
        onContextUpdate: ({ modelId, contextWindowTokens, estimatedPromptTokens }) => {
          const state = useRuntimeStore.getState();
          state.setModelContext(profile.id, { modelId, contextWindowTokens });
          state.setEstimatedPromptTokens(profile.id, estimatedPromptTokens);
        },
        onPromptReady: () => {
          void onAgentPromptReady(profile.id);
        },
        onAwaitingResponse: () => {
          useRuntimeStore.getState().setAwaitingResponse(profile.id, true);
        },
        onOnboardingStateChange: (active) => {
          agentState.onboardingActive = active;
          agentState.onboardingField = "agent";
          useRuntimeStore.getState().setOnboardingActive(profile.id, active);
        },
        onStatusChange: (status) => {
          const s = useRuntimeStore.getState();
          if (status === "booting") {
            s.setRuntimeStatus(profile.id, "booting");
            s.setProfileRunning(profile.id, true);
            runningProfileIds.add(profile.id);
          }
          else if (status === "running") {
            s.setRuntimeStatus(profile.id, "running");
            s.setProfileRunning(profile.id, true);
            s.markWebContainerWarm();
            runningProfileIds.add(profile.id);
          } else if (status === "stopped") {
            s.setRuntimeStatus(profile.id, "stopped");
            s.setProfileRunning(profile.id, false);
            s.setAwaitingResponse(profile.id, false);
            s.clearQueuedInputs(profile.id);
            s.setPendingToolConfirm(profile.id, false);
            s.setArtifactOffer(profile.id, null);
            s.setClarifyOffer(profile.id, null);
            s.setOnboardingActive(profile.id, false);
            runningProfileIds.delete(profile.id);
            agentState.agentReadyForInput = false;
            agentState.onboardingActive = false;
            agentState.onboardingField = "agent";
            resetAgentTerminalHint(profile.id);
          } else if (status === "error") {
            s.setError(profile.id, "Web Agent runtime error");
            s.setProfileRunning(profile.id, false);
            s.setOnboardingActive(profile.id, false);
            s.setPendingToolConfirm(profile.id, false);
            s.setArtifactOffer(profile.id, null);
            s.setClarifyOffer(profile.id, null);
            runningProfileIds.delete(profile.id);
          }
        },
      });
      void refreshStorageUsage({ warn: true });
    } catch (err) {
      const message = (err as Error).message;
      write(`\x1b[31m✗ Failed to start: ${message}\x1b[0m\n`);
      const rt = useRuntimeStore.getState();
      rt.setRuntimeStatus(profile.id, "error");
      rt.setError(profile.id, message);
      rt.setAwaitingResponse(profile.id, false);
      rt.clearQueuedInputs(profile.id);
      rt.setPendingToolConfirm(profile.id, false);
      rt.setArtifactOffer(profile.id, null);
      rt.setClarifyOffer(profile.id, null);
      rt.setProfileRunning(profile.id, false);
      rt.setOnboardingActive(profile.id, false);
      runningProfileIds.delete(profile.id);
      agentState.agentReadyForInput = false;
      agentState.onboardingActive = false;
      agentState.onboardingField = "agent";
      resetAgentTerminalHint(profile.id);
    }
  } finally {
    resolveOwnSlot();
  }
}

/** Internal stop implementation — must only be called while already holding the mutex slot. */
async function _stopAgentUnsafe(profileId: string): Promise<void> {
  if (!runningProfileIds.has(profileId)) return;
  const id = profileId;
  runningProfileIds.delete(id);
  flushTerminalTypewriter(id, getTerminal);
  await stopWebAgent(id);
  flushTerminalTypewriter(id, getTerminal);
  const state = getOrCreateAgentState(id);
  resetAgentTerminalHint(id);
  const rt = useRuntimeStore.getState();
  rt.setRuntimeStatus(id, "stopped");
  rt.setProfileRunning(id, false);
  rt.setAwaitingResponse(id, false);
  rt.clearQueuedInputs(id);
  rt.clearToolCalls(id);
  rt.resetModelContext(id);
  rt.setOnboardingActive(id, false);
  rt.setPendingToolConfirm(id, false);
  rt.setArtifactOffer(id, null);
  rt.setClarifyOffer(id, null);
  state.agentReadyForInput = false;
  state.onboardingActive = false;
  state.onboardingField = "agent";
}

export async function stopAgent(profileId?: string): Promise<void> {
  const targetProfileId = profileId ?? activeProfileId;
  if (!targetProfileId || !runningProfileIds.has(targetProfileId)) {
    return;
  }
  const agentState = getOrCreateAgentState(targetProfileId);
  let resolveOwnSlot!: () => void;
  const previousSlot = agentState.lifecycleMutex;
  agentState.lifecycleMutex = new Promise<void>((resolve) => {
    resolveOwnSlot = resolve;
  });
  try {
    await previousSlot;
    await _stopAgentUnsafe(targetProfileId);
  } finally {
    resolveOwnSlot();
  }
}

export async function refreshStorageUsage(
  options: { warn?: boolean } = {}
): Promise<{ used: number; quota: number; percentage: number }> {
  const estimate = await getStorageEstimate();
  useRuntimeStore.getState().setStorageUsed(estimate.used);

  if (options.warn && estimate.percentage > STORAGE_WARNING_PERCENT) {
    const now = Date.now();
    if (now - lastStorageWarningAt > STORAGE_WARNING_THROTTLE_MS) {
      lastStorageWarningAt = now;
      write(
        `\x1b[33m⚠ Browser storage usage at ${estimate.percentage.toFixed(0)}% ` +
          `(${formatBytes(estimate.used)} of ${formatBytes(estimate.quota)}). ` +
          `This includes agent snapshots plus Nodebox/runtime cache.\x1b[0m\n`
      );
    }
  }

  return estimate;
}

function startStorageMonitoring(): void {
  if (storageCheckInterval) clearInterval(storageCheckInterval);

  const check = async () => {
    await refreshStorageUsage({ warn: true });
  };

  check();
  storageCheckInterval = setInterval(check, 30_000);
}

export function stopStorageMonitoring(): void {
  if (storageCheckInterval) {
    clearInterval(storageCheckInterval);
    storageCheckInterval = null;
  }
}
