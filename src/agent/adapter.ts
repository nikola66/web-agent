/**
 * Web Agent adapter — mounts a single Node script into Nodebox (no npm install).
 */

import {
  getNodebox,
  getNodeVersion,
  runNodeboxShellCommand,
  spawnProcess,
  type NodeboxProcess,
  type SpawnPtySize,
} from "@/runtimes/webcontainer/boot";
import {
  hasWorkspaceSnapshot,
  restoreFilesystem,
  saveWorkspaceSnapshot,
} from "@/runtimes/webcontainer/filesystem-sync";
import type { Profile } from "@/core/profiles";
import { getPersonalityDisplayLabelForPrompt } from "@/core/personalities";
import { clearAll } from "@/core/persistence";
import {
  consumeWorkspaceCleanOnceInUrl,
  getWorkspaceCleanModeFromUrl,
} from "@/core/workspace";
import {
  BROWSER_AGENT_PROVIDERS,
  BROWSER_AGENT_PROVIDERS_JSON,
  DEFAULT_BROWSER_AGENT_PROVIDER_ID,
} from "@/core/browseragent";
import { CAPABILITY_RUNTIME_FILES, CAPABILITY_SUMMARY_JSON } from "@/capabilities";
import { CHANNEL_CATALOG_JSON, CHANNELS } from "@/core/channels";
import { DEFAULT_PROVIDER_ID, PROVIDER_CATALOG_JSON, PROVIDERS } from "@/core/providers";
import { loopGuardEnvForRuntime, readLoopGuardThresholds } from "./loop-guard-config.js";
import heartbeatSource from "./runtime/HEARTBEAT.md?raw";
import soulSource from "./runtime/SOUL.md?raw";
import { TOOL_CATALOG_JSON } from "./tool-catalog";
import runtimeAgentSource from "../../dist/agent-runtime/agent.js?raw";
import runtimeConstantsSource from "../../dist/agent-runtime/constants.js?raw";
import runtimeReflectionSource from "../../dist/agent-runtime/reflection.js?raw";
import runtimeTurnSequencingSource from "../../dist/agent-runtime/turn-sequencing.js?raw";
import runtimeUtilsSource from "../../dist/agent-runtime/utils.js?raw";
import runtimeBootstrapSource from "../../dist/agent-runtime/bootstrap.js?raw";
import runtimeTurnSource from "../../dist/agent-runtime/turn.js?raw";
import runtimeStreamOutputSource from "../../dist/agent-runtime/stream-output.js?raw";
import runtimeLoopGuardSource from "../../dist/agent-runtime/loop-guard.js?raw";
import runtimeContextCompressionSource from "../../dist/agent-runtime/context-compression.js?raw";
import runtimePlanningSlashSource from "../../dist/agent-runtime/planning-slash.js?raw";
import runtimeWikiSlashSource from "../../dist/agent-runtime/wiki-slash.js?raw";
import runtimeTerminalFormatSource from "../../dist/agent-runtime/terminal-format.js?raw";
import runtimeToolResultPreviewSource from "../../dist/agent-runtime/tool-result-preview.js?raw";
import runtimeTranscriptSource from "../../dist/agent-runtime/transcript.js?raw";
import runtimeTranscriptDeliverySource from "../../dist/agent-runtime/transcript-delivery.js?raw";
import runtimeWorkspacePathsSource from "../../dist/agent-runtime/workspace-paths.js?raw";
import runtimeCommandsSource from "../../dist/agent-runtime/commands.js?raw";
import runtimeSlashCommandViewsSource from "../../dist/agent-runtime/slash-command-views.js?raw";
import runtimeChannelOutboundSource from "../../dist/agent-runtime/channel-outbound.js?raw";
import runtimeOnboardingSource from "../../dist/agent-runtime/identity/onboarding.js?raw";
import runtimeProviderConfigSource from "../../dist/agent-runtime/llm/provider-config.js?raw";
import runtimeStreamingSource from "../../dist/agent-runtime/llm/streaming.js?raw";
import runtimeDebugLogSource from "../../dist/agent-runtime/logging/debug-log.js?raw";
import runtimePrivacySource from "../../dist/agent-runtime/privacy.js?raw";
import { normalizeLaunchMode, sanitizeForLogs } from "./runtime/privacy";
import runtimeMemorySource from "../../dist/agent-runtime/memory/index.js?raw";
import runtimeMemorySqlSource from "../../dist/agent-runtime/memory/sql.js?raw";
import runtimeMemoryRunsSource from "../../dist/agent-runtime/memory/runs.js?raw";
import runtimeMemoryJobsSource from "../../dist/agent-runtime/memory/jobs.js?raw";
import runtimeMemorySnapshotsSource from "../../dist/agent-runtime/memory/snapshots.js?raw";
import runtimeMemoryReflectionSource from "../../dist/agent-runtime/memory/reflection.js?raw";
import runtimeMemoryFactsSource from "../../dist/agent-runtime/memory/facts.js?raw";
import runtimeMemoryToolStatsSource from "../../dist/agent-runtime/memory/tool-stats.js?raw";
import runtimeMemoryLearningsSource from "../../dist/agent-runtime/memory/learnings.js?raw";
import runtimeMemorySkillsSource from "../../dist/agent-runtime/memory/skills.js?raw";
import runtimeMemoryContextBlocksSource from "../../dist/agent-runtime/memory/context-blocks.js?raw";
/** Nodebox copies this string at agent start — it is `dist/`, not `src/`; run `npm run build:embed-runtime` after changing runtime TS. */
import runtimePersistenceSource from "../../dist/agent-runtime/state/persistence.js?raw";
import runtimeMigrationsIndexSource from "../../dist/agent-runtime/migrations/index.js?raw";
import runtimeMigrationsTypesSource from "../../dist/agent-runtime/migrations/types.js?raw";
import runtimeMigrationsStateSource from "../../dist/agent-runtime/migrations/state.js?raw";
import runtimeMigrationsRunnerSource from "../../dist/agent-runtime/migrations/runner.js?raw";
import runtimeMigrationsRegistrySource from "../../dist/agent-runtime/migrations/registry.js?raw";
import runtimeMigration001Source from "../../dist/agent-runtime/migrations/001-relocate-state-files.js?raw";
import runtimeMigrationsNotifySource from "../../dist/agent-runtime/migrations/notify.js?raw";
import runtimeChannelDispatcherSource from "../../dist/agent-runtime/channels/dispatcher.js?raw";
import runtimeChannelIndexSource from "../../dist/agent-runtime/channels/index.js?raw";
import runtimeChannelTelegramSource from "../../dist/agent-runtime/channels/telegram.js?raw";
import runtimeIpcSource from "../../dist/agent-runtime/ipc.js?raw";
import runtimeUserInputFramingSource from "../../dist/agent-runtime/user-input-framing.js?raw";
import sqlWasmRuntimeSource from "sql.js/dist/sql-wasm.js?raw";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";

const runtimeToolSources = import.meta.glob("../../dist/agent-runtime/tools/**/*.js", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

export type OutputHandler = (data: string) => void;

export interface AgentStartOptions {
  profile: Profile;
  apiKeys: Record<string, string>;
  onOutput: OutputHandler;
  onStatusChange: (status: "booting" | "running" | "stopped" | "error") => void;
  onNodeVersion?: (version: string) => void;
  onProfileNameChange?: (name: string) => void;
  onUserNameChange?: (name: string) => void;
  onToolCall?: (toolName: string) => void;
  onContextUpdate?: (payload: {
    modelId: string | null;
    contextWindowTokens: number | null;
    estimatedPromptTokens: number;
  }) => void;
  onPromptReady?: () => void;
  /** Emitted by runtime before slow LLM work with no user message (startup greeting). Shows Thinking… until input-ready. */
  onAwaitingResponse?: () => void;
  onOnboardingStateChange?: (active: boolean) => void;
  /** Emitted after a guarded tool asks for stdin approval (`y`/…). */
  onPendingToolConfirmation?: (profileId: string) => void;
  /** Markdown artifact surfaced via `artifact_present` tool markers. */
  onArtifactOffer?: (
    profileId: string,
    payload: { title: string; filename: string; markdown: string },
  ) => void;
  /** Clarification UX: structured prompt from <<<CLARIFY>>> markers (skill-driven). */
  onClarifyOffer?: (
    profileId: string,
    payload: { question: string; options: string[]; openEnded: boolean },
  ) => void;
  ptySize?: SpawnPtySize;
}

const agentProcesses = new Map<string, NodeboxProcess>();
const lastResizes = new Map<string, SpawnPtySize>();

const DEFAULT_PTY: SpawnPtySize = { cols: 120, rows: 40 };
const STARTUP_TIMEOUT_MS = 20_000;
const BOOT_TIMEOUT_MS = 90_000;
const PROFILE_UPDATE_START = "<<<WEBAGENT_PROFILE_UPDATE>>>";
const PROFILE_UPDATE_END = "<<<END_WEBAGENT_PROFILE_UPDATE>>>";
const USER_UPDATE_START = "<<<WEBAGENT_USER_UPDATE>>>";
const USER_UPDATE_END = "<<<END_WEBAGENT_USER_UPDATE>>>";
const ONBOARDING_START = "<<<WEBAGENT_ONBOARDING_START>>>";
const ONBOARDING_END = "<<<WEBAGENT_ONBOARDING_END>>>";
const CONTEXT_UPDATE_START = "<<<WEBAGENT_CONTEXT_UPDATE>>>";
const CONTEXT_UPDATE_END = "<<<END_WEBAGENT_CONTEXT_UPDATE>>>";
const TOOL_CONFIRM_START = "<<<WEBAGENT_TOOL_CONFIRM>>>";
const TOOL_CONFIRM_END = "<<<END_WEBAGENT_TOOL_CONFIRM>>>";
const ARTIFACT_PRESENT_START = "<<<WEBAGENT_ARTIFACT>>>";
const ARTIFACT_PRESENT_END = "<<<END_WEBAGENT_ARTIFACT>>>";
const CLARIFY_PROMPT_START = "<<<CLARIFY>>>";
const CLARIFY_PROMPT_END = "<<<END>>>";
/** Emitted when the runtime begins work before visible streaming (e.g. startup greeting). Stripped from terminal output. */
const AWAITING_RESPONSE_LINE = "<<<WEBAGENT_AWAITING_RESPONSE>>>";
/** Emitted when the agent is ready for the next user message (turn finished or failed). Not shown in the terminal. */
const INPUT_READY_LINE = "<<<WEBAGENT_INPUT_READY>>>";
const PROXY_REQ_PREFIX = "<<<WEBAGENT_PROXY_REQ:";
const PROXY_REQ_END = "<<<END_WEBAGENT_PROXY_REQ>>>";
const PROXY_RESP_PREFIX = "<<<WEBAGENT_PROXY_RESP:";
const PROXY_RESP_END = "<<<END_WEBAGENT_PROXY_RESP>>>";
const PROXY_STREAM_REQ_PREFIX = "<<<WEBAGENT_PROXY_STREAM_REQ:";
const PROXY_STREAM_REQ_END = "<<<END_WEBAGENT_PROXY_STREAM_REQ>>>";
const PROXY_STREAM_START_PREFIX = "<<<WEBAGENT_PROXY_STREAM_START:";
const PROXY_STREAM_START_END = "<<<END_WEBAGENT_PROXY_STREAM_START>>>";
const PROXY_STREAM_CHUNK_PREFIX = "<<<WEBAGENT_PROXY_STREAM_CHUNK:";
const PROXY_STREAM_CHUNK_END = "<<<END_WEBAGENT_PROXY_STREAM_CHUNK>>>";
const PROXY_STREAM_END_PREFIX = "<<<WEBAGENT_PROXY_STREAM_END:";
const PROXY_STREAM_END_END = "<<<END_WEBAGENT_PROXY_STREAM_END>>>";
const SPAWN_REQ_PREFIX = "<<<WEBAGENT_SPAWN_REQ:";
const SPAWN_REQ_END = "<<<END_WEBAGENT_SPAWN_REQ>>>";
const SPAWN_RESP_PREFIX = "<<<WEBAGENT_SPAWN_RESP:";
const SPAWN_RESP_END = "<<<END_WEBAGENT_SPAWN_RESP>>>";
const LOOP_GUARD_REQ_PREFIX = "<<<WEBAGENT_LOOP_GUARD_REQ:";
const LOOP_GUARD_REQ_END = "<<<END_WEBAGENT_LOOP_GUARD_REQ>>>";
const LOOP_GUARD_RESP_PREFIX = "<<<WEBAGENT_LOOP_GUARD_RESP:";
const LOOP_GUARD_RESP_END = "<<<END_WEBAGENT_LOOP_GUARD_RESP>>>";
/** Emitted by agent runtime before exit(1); parsed so the terminal can show the message. */
const FATAL_ERROR_START = "<<<WEBAGENT_FATAL_ERROR>>>";
const FATAL_ERROR_END = "<<<END_WEBAGENT_FATAL_ERROR>>>";
const TOOL_CALL_LINE_RE = /^\s*▸\s+([a-z0-9_]+)\s+/;
const ONBOARDING_PROMPT_RE = /(Agent name \[[^\]]*\]:\s*$|Your name \[[^\]]*\]:\s*$)/m;
const ONBOARDING_SAVED_LINE_RE = /Saved AGENT\.md for (.+?) and USER\.md for (.+?)\./;
// Nodebox prints a welcome/feedback banner on every boot — suppress it entirely.
const NODEBOX_BANNER_RE = /Hi there![\s\S]*?Thanks for using Nodebox!/;
// Nodebox leaks process.exit() stack traces into stdout — strip them.
const NODEBOX_EXIT_TRACE_RE = /Error: Process\.exit called[\s\S]*?(?=\n\n|\n▸|\n✓|\n✗|$)/;

function encodeIpcPayload(payload: unknown): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

function decodeIpcPayload<T = unknown>(payload: string): T {
  return JSON.parse(decodeURIComponent(escape(atob(String(payload || ""))))) as T;
}
/**
 * If every token looks like a Node CLI flag, do not pass workspace `cwd` into `shell.runCommand`.
 * With cwd set to `/nodebox/workspace/<id>`, Nodebox can mis-resolve and try to load `<cwd>/nodebox`
 * for `node --version` / `node -v`.
 */
function nodeboxSpawnArgvNeedsWorkspaceCwd(argv: string[]): boolean {
  return argv.some((a) => {
    const s = String(a ?? "").trim();
    if (!s) return false;
    return !s.startsWith("-");
  });
}

const DEBUG_LOG_CHUNK_MAX = 2_000;
const VITE_LAUNCH_MODE = normalizeLaunchMode(String(import.meta.env.VITE_WEBAGENT_LAUNCH_MODE || ""));
const VITE_DEBUG_LOG_ENABLED = String(import.meta.env.VITE_WEBAGENT_DEBUG_LOG || "").trim() === "1";
const VITE_DEBUG_LOG_DIR = String(import.meta.env.VITE_WEBAGENT_DEBUG_LOG_DIR || "debug-logs").trim();
const RUNTIME_DEBUG_LOG_DIR = VITE_DEBUG_LOG_DIR.startsWith("/workspace/")
  ? VITE_DEBUG_LOG_DIR.slice("/workspace/".length)
  : VITE_DEBUG_LOG_DIR.replace(/^\//, "") || "debug-logs";
const ADAPTER_DEBUG_LOG_DIR = VITE_DEBUG_LOG_DIR.startsWith("/")
  ? VITE_DEBUG_LOG_DIR
  : `/workspace/${VITE_DEBUG_LOG_DIR.replace(/^\.?\//, "")}`;

const adapterDebugLogPaths = new Map<string, string>();
const adapterDebugPending = new Map<string, string[]>();
const adapterDebugFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const adapterDebugFlushPromises = new Map<string, Promise<void>>();

function scheduleDebugFlush(profileId: string): void {
  const debugPath = adapterDebugLogPaths.get(profileId);
  if (!VITE_DEBUG_LOG_ENABLED || !debugPath) return;
  if (adapterDebugFlushTimers.has(profileId)) return;
  const timer = setTimeout(() => {
    adapterDebugFlushTimers.delete(profileId);
    const pending = adapterDebugPending.get(profileId) ?? [];
    const batch = pending.splice(0);
    if (!batch.length) return;
    const previous = adapterDebugFlushPromises.get(profileId) ?? Promise.resolve();
    const next = previous
      .then(async () => {
        const emulator = await getNodebox();
        await emulator.fs.mkdir(ADAPTER_DEBUG_LOG_DIR, { recursive: true });
        // Append-only: read-then-write was loading the full log into memory each flush.
        const chunk = batch.join("");
        let existing = "";
        try { existing = await emulator.fs.readFile(debugPath, "utf8"); } catch { /* new file */ }
        // Keep only the last 256KB of the debug log to prevent unbounded growth.
        const combined = existing + chunk;
        const trimmed = combined.length > 256 * 1024 ? combined.slice(-256 * 1024) : combined;
        await emulator.fs.writeFile(debugPath, trimmed);
      })
      .catch(() => {
        /* best effort */
      });
    adapterDebugFlushPromises.set(profileId, next);
  }, 200);
  adapterDebugFlushTimers.set(profileId, timer);
}

function appendAdapterDebugLog(
  profileId: string,
  event: string,
  payload: Record<string, unknown> = {}
): void {
  const debugPath = adapterDebugLogPaths.get(profileId);
  if (!VITE_DEBUG_LOG_ENABLED || !debugPath) return;
  if (!adapterDebugPending.has(profileId)) {
    adapterDebugPending.set(profileId, []);
  }
  adapterDebugPending.get(profileId)!.push(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      source: "adapter",
      event,
      payload: sanitizeForLogs(payload),
    })}\n`
  );
  scheduleDebugFlush(profileId);
}

function stripAnsi(input: string): string {
  return input.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function stripWebagentControlMarkerFromStream(
  carry: string,
  chunk: string,
  marker: string,
  onMatch?: () => void
): { data: string; nextCarry: string } {
  let buf = carry + chunk;
  while (true) {
    const idx = buf.indexOf(marker);
    if (idx === -1) break;
    const before = buf.slice(0, idx);
    let afterIdx = idx + marker.length;
    if (buf[afterIdx] === "\r") afterIdx++;
    if (buf[afterIdx] === "\n") afterIdx++;
    buf = before + buf.slice(afterIdx);
    onMatch?.();
  }
  let hold = 0;
  const maxHold = Math.min(buf.length, marker.length - 1);
  for (let k = maxHold; k > 0; k--) {
    if (buf.slice(-k) === marker.slice(0, k)) {
      hold = k;
      break;
    }
  }
  const data = hold === 0 ? buf : buf.slice(0, -hold);
  const nextCarry = hold === 0 ? "" : buf.slice(-hold);
  return { data, nextCarry };
}

/**
 * Strip hidden input-ready markers from stdout without newline-gating the whole stream.
 * Newline-based buffering blocked prompt detection: the shell prints `❯ ` with no trailing \n
 * until the user types, so nothing reached promptParseBuffer and the UI stayed "working"/queued.
 */
function stripWebagentInputReadyFromStream(
  carry: string,
  chunk: string,
  onReady: () => void
): { data: string; nextCarry: string } {
  return stripWebagentControlMarkerFromStream(carry, chunk, INPUT_READY_LINE, onReady);
}

function stripRenderedPrompt(input: string): string {
  return input
    .replace(/\x1b\[38;2;251;117;252m❯\s\x1b\[0m(?:\x1b\[0m)?/g, "")
    .replace(/(^|\r?\n)❯\s/g, "$1");
}

function trimChunk(text: string): string {
  if (text.length <= DEBUG_LOG_CHUNK_MAX) return text;
  return `${text.slice(0, DEBUG_LOG_CHUNK_MAX)}…[truncated:${text.length}]`;
}

function formatBootTimeoutMessage(phase: "boot" | "reboot"): string {
  const offline =
    typeof navigator !== "undefined" && navigator.onLine === false;
  const firstLine =
    phase === "boot"
      ? "Nodebox boot timed out while downloading runtime assets."
      : "Nodebox reboot timed out after reset.";
  const networkHint = offline
    ? "Browser appears offline."
    : "Network may be slow or blocked by a firewall/content blocker.";
  return `${firstLine} ${networkHint} Verify access to CodeSandbox/Nodebox domains and retry launch.`;
}

async function ensureOnboardingFiles(profileId: string): Promise<void> {
  const emulator = await getNodebox();
  const workspaceDir = `/workspace/${profileId}`;

  try {
    await emulator.fs.readFile(`${workspaceDir}/HEARTBEAT.md`);
  } catch {
    await emulator.fs.writeFile(`${workspaceDir}/HEARTBEAT.md`, heartbeatSource);
  }

  try {
    await emulator.fs.readFile(`${workspaceDir}/SOUL.md`);
  } catch {
    await emulator.fs.writeFile(`${workspaceDir}/SOUL.md`, soulSource);
  }

  const cronjobsPath = `${workspaceDir}/.webagent/cronjobs.json`;
  try {
    await emulator.fs.readFile(cronjobsPath);
  } catch {
    await emulator.fs.mkdir(`${workspaceDir}/.webagent`, { recursive: true });
    await emulator.fs.writeFile(cronjobsPath, JSON.stringify({ jobs: [] }, null, 2));
  }
}

async function writeRuntimeSources(profileId: string): Promise<void> {
  const emulator = await getNodebox();
  const webagentDir = `/workspace/${profileId}/.webagent`;

  await emulator.fs.mkdir(webagentDir, { recursive: true });
  await emulator.fs.mkdir(`${webagentDir}/identity`, { recursive: true });
  await emulator.fs.mkdir(`${webagentDir}/llm`, { recursive: true });
  await emulator.fs.mkdir(`${webagentDir}/logging`, { recursive: true });
  await emulator.fs.mkdir(`${webagentDir}/memory`, { recursive: true });
  await emulator.fs.mkdir(`${webagentDir}/migrations`, { recursive: true });
  await emulator.fs.mkdir(`${webagentDir}/state`, { recursive: true });
  await emulator.fs.mkdir(`${webagentDir}/tools`, { recursive: true });
  await emulator.fs.mkdir(`${webagentDir}/channels`, { recursive: true });
  await emulator.fs.mkdir(`${webagentDir}/capabilities`, { recursive: true });
  await emulator.fs.mkdir(`${webagentDir}/vendor`, { recursive: true });

  // Required so Node.js treats .js files in this directory as ESM.
  await emulator.fs.writeFile(
    `${webagentDir}/package.json`,
    JSON.stringify({ name: "@webagent/runtime", private: true, type: "module" })
  );

  await emulator.fs.writeFile(`${webagentDir}/ipc.js`, runtimeIpcSource);
  await emulator.fs.writeFile(`${webagentDir}/user-input-framing.js`, runtimeUserInputFramingSource);
  await emulator.fs.writeFile(`${webagentDir}/agent.js`, runtimeAgentSource);
  await emulator.fs.writeFile(`${webagentDir}/constants.js`, runtimeConstantsSource);
  await emulator.fs.writeFile(`${webagentDir}/reflection.js`, runtimeReflectionSource);
  await emulator.fs.writeFile(`${webagentDir}/turn-sequencing.js`, runtimeTurnSequencingSource);
  await emulator.fs.writeFile(`${webagentDir}/utils.js`, runtimeUtilsSource);
  await emulator.fs.writeFile(`${webagentDir}/bootstrap.js`, runtimeBootstrapSource);
  await emulator.fs.writeFile(`${webagentDir}/turn.js`, runtimeTurnSource);
  await emulator.fs.writeFile(`${webagentDir}/stream-output.js`, runtimeStreamOutputSource);
  await emulator.fs.writeFile(`${webagentDir}/loop-guard.js`, runtimeLoopGuardSource);
  await emulator.fs.writeFile(`${webagentDir}/context-compression.js`, runtimeContextCompressionSource);
  await emulator.fs.writeFile(`${webagentDir}/planning-slash.js`, runtimePlanningSlashSource);
  await emulator.fs.writeFile(`${webagentDir}/wiki-slash.js`, runtimeWikiSlashSource);
  await emulator.fs.writeFile(`${webagentDir}/terminal-format.js`, runtimeTerminalFormatSource);
  await emulator.fs.writeFile(`${webagentDir}/tool-result-preview.js`, runtimeToolResultPreviewSource);
  await emulator.fs.writeFile(`${webagentDir}/transcript.js`, runtimeTranscriptSource);
  await emulator.fs.writeFile(`${webagentDir}/transcript-delivery.js`, runtimeTranscriptDeliverySource);
  await emulator.fs.writeFile(`${webagentDir}/commands.js`, runtimeCommandsSource);
  await emulator.fs.writeFile(`${webagentDir}/slash-command-views.js`, runtimeSlashCommandViewsSource);
  await emulator.fs.writeFile(`${webagentDir}/channel-outbound.js`, runtimeChannelOutboundSource);
  await emulator.fs.writeFile(`${webagentDir}/workspace-paths.js`, runtimeWorkspacePathsSource);
  await emulator.fs.writeFile(`${webagentDir}/privacy.js`, runtimePrivacySource);
  await emulator.fs.writeFile(`${webagentDir}/identity/onboarding.js`, runtimeOnboardingSource);
  await emulator.fs.writeFile(`${webagentDir}/llm/provider-config.js`, runtimeProviderConfigSource);
  await emulator.fs.writeFile(`${webagentDir}/llm/streaming.js`, runtimeStreamingSource);
  await emulator.fs.writeFile(`${webagentDir}/logging/debug-log.js`, runtimeDebugLogSource);
  await emulator.fs.writeFile(`${webagentDir}/memory/index.js`, runtimeMemorySource);
  await emulator.fs.writeFile(`${webagentDir}/memory/sql.js`, runtimeMemorySqlSource);
  await emulator.fs.writeFile(`${webagentDir}/memory/runs.js`, runtimeMemoryRunsSource);
  await emulator.fs.writeFile(`${webagentDir}/memory/jobs.js`, runtimeMemoryJobsSource);
  await emulator.fs.writeFile(`${webagentDir}/memory/snapshots.js`, runtimeMemorySnapshotsSource);
  await emulator.fs.writeFile(`${webagentDir}/memory/reflection.js`, runtimeMemoryReflectionSource);
  await emulator.fs.writeFile(`${webagentDir}/memory/facts.js`, runtimeMemoryFactsSource);
  await emulator.fs.writeFile(`${webagentDir}/memory/tool-stats.js`, runtimeMemoryToolStatsSource);
  await emulator.fs.writeFile(`${webagentDir}/memory/learnings.js`, runtimeMemoryLearningsSource);
  await emulator.fs.writeFile(`${webagentDir}/memory/skills.js`, runtimeMemorySkillsSource);
  await emulator.fs.writeFile(`${webagentDir}/memory/context-blocks.js`, runtimeMemoryContextBlocksSource);
  await emulator.fs.writeFile(`${webagentDir}/migrations/index.js`, runtimeMigrationsIndexSource);
  await emulator.fs.writeFile(`${webagentDir}/migrations/types.js`, runtimeMigrationsTypesSource);
  await emulator.fs.writeFile(`${webagentDir}/migrations/state.js`, runtimeMigrationsStateSource);
  await emulator.fs.writeFile(`${webagentDir}/migrations/runner.js`, runtimeMigrationsRunnerSource);
  await emulator.fs.writeFile(`${webagentDir}/migrations/registry.js`, runtimeMigrationsRegistrySource);
  await emulator.fs.writeFile(`${webagentDir}/migrations/001-relocate-state-files.js`, runtimeMigration001Source);
  await emulator.fs.writeFile(`${webagentDir}/migrations/notify.js`, runtimeMigrationsNotifySource);
  await emulator.fs.writeFile(`${webagentDir}/state/persistence.js`, runtimePersistenceSource);
  for (const [sourcePath, content] of Object.entries(runtimeToolSources)) {
    const rel = sourcePath.replace(/^.*dist\/agent-runtime\/tools\//, "tools/");
    const parent = rel.split("/").slice(0, -1).join("/");
    if (parent) await emulator.fs.mkdir(`${webagentDir}/${parent}`, { recursive: true });
    await emulator.fs.writeFile(`${webagentDir}/${rel}`, content);
  }
  await emulator.fs.writeFile(`${webagentDir}/channels/telegram.js`, runtimeChannelTelegramSource);
  await emulator.fs.writeFile(`${webagentDir}/channels/dispatcher.js`, runtimeChannelDispatcherSource);
  await emulator.fs.writeFile(`${webagentDir}/channels/index.js`, runtimeChannelIndexSource);
  await emulator.fs.writeFile(`${webagentDir}/vendor/sql-wasm.cjs`, sqlWasmRuntimeSource);

  const sqlWasmResponse = await fetch(sqlWasmUrl);
  if (!sqlWasmResponse.ok) {
    throw new Error(`Failed to load sql.js wasm asset (${sqlWasmResponse.status})`);
  }
  await emulator.fs.writeFile(
    `${webagentDir}/vendor/sql-wasm.wasm`,
    new Uint8Array(await sqlWasmResponse.arrayBuffer())
  );
}

async function writeCapabilitySources(profileId: string): Promise<void> {
  const emulator = await getNodebox();
  const capabilitiesDir = `/workspace/${profileId}/.webagent/capabilities`;
  await emulator.fs.rm(capabilitiesDir, { recursive: true, force: true });
  await emulator.fs.mkdir(capabilitiesDir, { recursive: true });
  for (const file of CAPABILITY_RUNTIME_FILES) {
    const cleanPath = file.path.replace(/^\/+/, "");
    const target = `${capabilitiesDir}/${cleanPath}`;
    const parent = target.split("/").slice(0, -1).join("/");
    await emulator.fs.mkdir(parent, { recursive: true });
    await emulator.fs.writeFile(target, file.content);
  }
  await emulator.fs.writeFile(
    `/workspace/${profileId}/.webagent/capabilities.json`,
    CAPABILITY_SUMMARY_JSON
  );
}


async function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = STARTUP_TIMEOUT_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildEnv(profileId: string, profile: Profile, apiKeys: Record<string, string>): Record<string, string> {
  const activeProvider = PROVIDERS.find((provider) => provider.id === profile.provider);
  const activeProviderId = activeProvider?.id || DEFAULT_PROVIDER_ID;
  const activeBrowserAgent =
    BROWSER_AGENT_PROVIDERS.find((provider) => provider.id === DEFAULT_BROWSER_AGENT_PROVIDER_ID) ??
    BROWSER_AGENT_PROVIDERS[0];
  const env: Record<string, string> = {
    HOME: "/tmp",
    TERM: "xterm-256color",
    FORCE_COLOR: "1",
    WEBAGENT_RUNTIME: "nodebox",
    WEBAGENT_APP_ORIGIN:
      typeof window !== "undefined" ? window.location.origin : "",
    WEBAGENT_PROFILE_NAME: profile.name,
    WEBAGENT_USER_NAME: profile.userName,
    WEBAGENT_PERSONALITY: profile.personality,
    WEBAGENT_PROVIDER: activeProviderId,
    WEBAGENT_BROWSER_AGENT:
      activeBrowserAgent?.id || DEFAULT_BROWSER_AGENT_PROVIDER_ID,
    WEBAGENT_LAUNCH_MODE: VITE_LAUNCH_MODE,
    WEBAGENT_MEMORY_ROOT: "memory",
    WEBAGENT_DEBUG_LOG: VITE_DEBUG_LOG_ENABLED ? "1" : "0",
    WEBAGENT_DEBUG_LOG_DIR: RUNTIME_DEBUG_LOG_DIR,
    ...loopGuardEnvForRuntime(import.meta.env),
  };
  const personalityLabel = getPersonalityDisplayLabelForPrompt(profile.personality);
  if (personalityLabel) env.WEBAGENT_PERSONALITY_LABEL = personalityLabel;
  if (profile.model?.trim()) env.WEBAGENT_MODEL = profile.model.trim();

  const assignIfPresent = (targetKey: string, sourceKey: string) => {
    const value = apiKeys[sourceKey]?.trim();
    if (value) env[targetKey] = value;
  };
  for (const provider of PROVIDERS) {
    const envVar = provider.apiKey?.envVar;
    const settingKey = provider.apiKey?.settingKey;
    if (envVar && settingKey) assignIfPresent(envVar, settingKey);
  }
  const customBaseUrlVar = activeProvider?.runtime?.customBaseUrlEnvVar;
  if (customBaseUrlVar) {
    assignIfPresent(customBaseUrlVar, `${activeProviderId}_baseurl`);
  }
  for (const provider of BROWSER_AGENT_PROVIDERS) {
    const envVar = provider.auth?.envVar;
    const settingKey = provider.auth?.settingKey;
    if (envVar && settingKey) assignIfPresent(envVar, settingKey);
  }

  const emailEnvMap: Array<[string, string]> = [
    ["WEBAGENT_RESEND_API_KEY", "resend_api_key"],
    ["WEBAGENT_RESEND_FROM", "resend_from"],
  ];
  for (const [envKey, settingKey] of emailEnvMap) {
    assignIfPresent(envKey, settingKey);
  }

  for (const channel of CHANNELS) {
    const envVar = channel.auth?.envVar;
    const settingKey = channel.auth?.settingKey;
    const value =
      (settingKey ? apiKeys[settingKey]?.trim() : "") || (envVar ? apiKeys[envVar]?.trim() : "");
    if (!envVar || !settingKey || !value) continue;
    env[envVar] = value;
    if (!env.WEBAGENT_CHANNEL) {
      env.WEBAGENT_CHANNEL = channel.id;
      if (channel.defaultPollTimeoutS) {
        env[`WEBAGENT_${channel.id.toUpperCase()}_POLL_TIMEOUT_S`] = String(channel.defaultPollTimeoutS);
      }
    }
  }

  return env;
}

export async function startWebAgent(options: AgentStartOptions): Promise<void> {
  const {
    profile,
    apiKeys,
    onOutput,
    onStatusChange,
    onNodeVersion,
    onProfileNameChange,
    onUserNameChange,
    onToolCall,
    onContextUpdate,
    onPromptReady,
    onAwaitingResponse,
    onOnboardingStateChange,
    onPendingToolConfirmation,
    onArtifactOffer,
    onClarifyOffer,
    ptySize = DEFAULT_PTY,
  } = options;
  if (agentProcesses.has(profile.id)) {
    throw new Error(`Agent already running for profile ${profile.id}`);
  }

  onStatusChange("booting");
  onOutput("\x1b[90m▸ Booting Nodebox…\x1b[0m\n");
  onOutput(
    "\x1b[90m  (First run can take a moment while runtime assets download.)\x1b[0m\n"
  );
  try {
    await withTimeout(getNodebox(), "Nodebox boot", BOOT_TIMEOUT_MS);
  } catch (err) {
    if ((err as Error)?.message?.includes("timed out")) {
      onOutput(`\x1b[33m▸ ${formatBootTimeoutMessage("boot")}\x1b[0m\n`);
    }
    onOutput(
      "\x1b[33m▸ Boot failed. Fix network/blockers first, then relaunch.\x1b[0m\n"
    );
    throw err;
  }

  onOutput("\x1b[90m▸ Checking Node runtime…\x1b[0m\n");
  const nodeVersion = await withTimeout(
    getNodeVersion(),
    "Node runtime check"
  );
  onNodeVersion?.(nodeVersion);
  const emulator = await getNodebox();

  const profileWorkspaceDir = `/workspace/${profile.id}`;
  const cleanMode = getWorkspaceCleanModeFromUrl();
  const forceClean = cleanMode !== null;
  if (forceClean) {
    onOutput(
      `\x1b[33m▸ ?clean${cleanMode === "once" ? "=once" : ""} detected — clearing profile snapshot and workspace\x1b[0m\n`
    );
    await withTimeout(
      (async () => {
        await clearAll(`profiles/${profile.id}/snapshot`);
        let names: string[] = [];
        try {
          names = await emulator.fs.readdir("/workspace");
        } catch {
          /* nothing to clear yet */
        }
        for (const name of names) {
          try {
            await emulator.fs.rm(`/workspace/${name}`, { recursive: true, force: true });
          } catch {
            /* best-effort */
          }
        }
      })(),
      "Forced workspace clean"
    );
    if (cleanMode === "once") {
      consumeWorkspaceCleanOnceInUrl();
    }
  }

  onOutput("\x1b[90m▸ Restoring workspace snapshot…\x1b[0m\n");
  let hadSnapshot = await hasWorkspaceSnapshot(profile.id);
  if (forceClean) hadSnapshot = false;
  let restoreCount = 0;
  const restored = await withTimeout(
    hadSnapshot
      ? restoreFilesystem(profile.id, {
          onProgress: () => { restoreCount++; },
        })
      : Promise.resolve(false),
    "Workspace restore"
  );
  if (restoreCount > 0) {
    onOutput(`\x1b[90m  restored ${restoreCount} file${restoreCount === 1 ? "" : "s"}\x1b[0m\n`);
  }

  if (!hadSnapshot) {
    await withTimeout(
      (async () => {
        const resetCandidates = [
          `${profileWorkspaceDir}/AGENT.md`,
          `${profileWorkspaceDir}/USER.md`,
          `${profileWorkspaceDir}/.webagent/history.json`,
          `${profileWorkspaceDir}/.webagent/todos.json`,
          `${profileWorkspaceDir}/.webagent/cronjobs.json`,
          `${profileWorkspaceDir}/.webagent/heartbeat-state.json`,
          `${profileWorkspaceDir}/.webagent/channel-state.json`,
          `${profileWorkspaceDir}/.webagent/session-memory.jsonl`,
          `${profileWorkspaceDir}/.webagent/migrations.json`,
          `${profileWorkspaceDir}/memory`,
        ];
        for (const path of resetCandidates) {
          await emulator.fs.rm(path, { recursive: true, force: true });
        }
      })(),
      "Workspace reset"
    );
    onOutput("\x1b[90m▸ New workspace for this profile\x1b[0m\n");
  } else if (!restored) {
    onOutput(
      "\x1b[33m▸ Existing snapshot was detected, but restore did not complete. Continuing with current workspace state.\x1b[0m\n"
    );
  }

  onOutput("\x1b[90m▸ Preparing runtime files…\x1b[0m\n");
  await withTimeout(
    (async () => {
      await emulator.fs.mkdir(profileWorkspaceDir, { recursive: true });
      await writeRuntimeSources(profile.id);
      await writeCapabilitySources(profile.id);
      await emulator.fs.writeFile(`${profileWorkspaceDir}/.webagent/tools.json`, TOOL_CATALOG_JSON);
      await emulator.fs.writeFile(`${profileWorkspaceDir}/.webagent/providers.json`, PROVIDER_CATALOG_JSON);
      await emulator.fs.writeFile(
        `${profileWorkspaceDir}/.webagent/browseragent.json`,
        BROWSER_AGENT_PROVIDERS_JSON
      );
      await emulator.fs.writeFile(`${profileWorkspaceDir}/.webagent/channels.json`, CHANNEL_CATALOG_JSON);
      await ensureOnboardingFiles(profile.id);
    })(),
    "Runtime preparation"
  );

  const env = buildEnv(profile.id, profile, apiKeys);
  const debugSessionId = `${Date.now()}-${profile.id}`;
  adapterDebugLogPaths.set(profile.id, `${ADAPTER_DEBUG_LOG_DIR}/${debugSessionId}.jsonl`);
  env.WEBAGENT_DEBUG_SESSION_ID = debugSessionId;
  appendAdapterDebugLog(profile.id, "session_start", {
    profileId: profile.id,
    provider: profile.provider,
    model: profile.model || null,
  });
  env.COLUMNS = String(ptySize.cols);
  env.LINES = String(ptySize.rows);

  onOutput("\x1b[38;2;251;117;252m▸ Starting Web Agent…\x1b[0m\n");

  lastResizes.delete(profile.id);
  const agentProcess = await withTimeout(
    spawnProcess("node", [".webagent/agent.js"], {
      env,
      cwd: profileWorkspaceDir,
      terminal: ptySize,
    }),
    "Agent process spawn"
  );
  agentProcesses.set(profile.id, agentProcess);
  onStatusChange("running");

  // Warm MobileBERT loop-guard model off the critical path so the first guard call
  // isn't paying for WASM + weights download synchronously.
  const idleSchedule = (cb: () => void) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(cb, { timeout: 12_000 });
      return;
    }
    setTimeout(cb, 12_000);
  };
  idleSchedule(() => {
    void import("./supervisor/index.js")
      .then((mod) => mod.prefetchClassifier())
      .catch(async (e) => {
        const { formatTransformersError } = await import("./supervisor/transformers-env.js");
        console.warn(
          "[loop-guard] prefetch failed — scoring may be unavailable until reload:",
          formatTransformersError(e)
        );
      });
  });

  let agentOutputBuffer = "";
  let toolParseLineBuffer = "";
  let promptParseBuffer = "";
  let snapshotSaveInFlight = false;
  let snapshotSaveQueued = false;
  let snapshotSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let onboardingParseBuffer = "";
  let lastOnboardingIdentity = "";
  let inputReadyMarkerCarry = "";
  let awaitingResponseMarkerCarry = "";
  const profileIdForSave = profile.id;

  const persistSnapshotNow = async (): Promise<void> => {
    if (snapshotSaveInFlight) {
      snapshotSaveQueued = true;
      return;
    }
    snapshotSaveInFlight = true;
    do {
      snapshotSaveQueued = false;
      try {
        await saveWorkspaceSnapshot(profileIdForSave);
      } catch {
        /* best-effort */
      }
    } while (snapshotSaveQueued);
    snapshotSaveInFlight = false;
  };

  const scheduleSnapshotSave = (): void => {
    if (snapshotSaveTimer) clearTimeout(snapshotSaveTimer);
    snapshotSaveTimer = setTimeout(() => {
      snapshotSaveTimer = null;
      void persistSnapshotNow();
    }, 5000);
  };

  const handleAgentOutput = (rawData: string) => {
    const awaitingStrip = stripWebagentControlMarkerFromStream(
      awaitingResponseMarkerCarry,
      rawData,
      AWAITING_RESPONSE_LINE,
      () => {
        onAwaitingResponse?.();
      }
    );
    awaitingResponseMarkerCarry = awaitingStrip.nextCarry;
    const { data, nextCarry } = stripWebagentInputReadyFromStream(
      inputReadyMarkerCarry,
      awaitingStrip.data,
      () => {
        onPromptReady?.();
        scheduleSnapshotSave();
      }
    );
    inputReadyMarkerCarry = nextCarry;

    // --- Onboarding saved detection ---
    onboardingParseBuffer += stripAnsi(data);
    if (onboardingParseBuffer.length > 4096) {
      onboardingParseBuffer = onboardingParseBuffer.slice(-1024);
    }
    const onboardingMatch = onboardingParseBuffer.match(ONBOARDING_SAVED_LINE_RE);
    if (onboardingMatch) {
      const nextAgentName = onboardingMatch[1]?.trim();
      const nextUserName = onboardingMatch[2]?.trim();
      const identityKey = `${nextAgentName}::${nextUserName}`;
      if (identityKey !== lastOnboardingIdentity) {
        if (nextAgentName) onProfileNameChange?.(nextAgentName);
        if (nextUserName) onUserNameChange?.(nextUserName);
        lastOnboardingIdentity = identityKey;
      }
      onboardingParseBuffer = onboardingParseBuffer.slice(
        onboardingMatch.index! + onboardingMatch[0].length
      );
    }

    // --- Tool call detection ---
    toolParseLineBuffer += data;
    const toolLines = toolParseLineBuffer.split("\n");
    toolParseLineBuffer = toolLines.pop() ?? "";
    for (const line of toolLines) {
      const plain = stripAnsi(line);
      const match = plain.match(TOOL_CALL_LINE_RE);
      const toolName = match?.[1];
      if (toolName && toolName !== "no") onToolCall?.(toolName);
    }

    // --- Prompt-ready detection ---
    promptParseBuffer += stripAnsi(data);
    if (promptParseBuffer.includes("❯ ") || ONBOARDING_PROMPT_RE.test(promptParseBuffer)) {
      onPromptReady?.();
      scheduleSnapshotSave();
      if (promptParseBuffer.includes("❯ ")) {
        const parts = promptParseBuffer.split("❯ ");
        promptParseBuffer = parts[parts.length - 1] ?? "";
      } else {
        promptParseBuffer = "";
      }
    } else if (promptParseBuffer.length > 1024) {
      promptParseBuffer = promptParseBuffer.slice(-256);
    }

    // --- IPC marker parsing ---
    agentOutputBuffer += data;
    // Strip Nodebox welcome banner whenever it fully accumulates in the buffer.
    if (agentOutputBuffer.includes("Thanks for using Nodebox!")) {
      agentOutputBuffer = agentOutputBuffer.replace(NODEBOX_BANNER_RE, "").replace(NODEBOX_BANNER_RE, "");
    }
    // Strip process.exit() stack traces leaked by Nodebox.
    if (agentOutputBuffer.includes("Process.exit called")) {
      agentOutputBuffer = agentOutputBuffer.replace(NODEBOX_EXIT_TRACE_RE, "");
    }
    while (agentOutputBuffer.length > 0) {
      const profileStart = agentOutputBuffer.indexOf(PROFILE_UPDATE_START);
      const userStart = agentOutputBuffer.indexOf(USER_UPDATE_START);
      const onboardingStart = agentOutputBuffer.indexOf(ONBOARDING_START);
      const onboardingEnd = agentOutputBuffer.indexOf(ONBOARDING_END);
      const contextStart = agentOutputBuffer.indexOf(CONTEXT_UPDATE_START);
      const toolConfirmStart = agentOutputBuffer.indexOf(TOOL_CONFIRM_START);
      const artifactStart = agentOutputBuffer.indexOf(ARTIFACT_PRESENT_START);
      const clarifyStart = agentOutputBuffer.indexOf(CLARIFY_PROMPT_START);
      const proxyReqStart = agentOutputBuffer.indexOf(PROXY_REQ_PREFIX);
      const proxyStreamReqStart = agentOutputBuffer.indexOf(PROXY_STREAM_REQ_PREFIX);
      const spawnReqStart = agentOutputBuffer.indexOf(SPAWN_REQ_PREFIX);
      const loopGuardReqStart = agentOutputBuffer.indexOf(LOOP_GUARD_REQ_PREFIX);
      const fatalStart = agentOutputBuffer.indexOf(FATAL_ERROR_START);
      const nextStartCandidates = [
        profileStart,
        userStart,
        onboardingStart,
        onboardingEnd,
        contextStart,
        toolConfirmStart,
        artifactStart,
        clarifyStart,
        proxyReqStart,
        proxyStreamReqStart,
        spawnReqStart,
        loopGuardReqStart,
        fatalStart,
      ].filter((v) => v >= 0);
      if (nextStartCandidates.length === 0) {
        break;
      }
      const nextStart = Math.min(...nextStartCandidates);
      if (nextStart > 0) {
        const renderedChunk = agentOutputBuffer.slice(0, nextStart);
        onOutput(renderedChunk);
        appendAdapterDebugLog(profile.id, "rendered_output_chunk", {
          bytes: renderedChunk.length,
          chunk: trimChunk(renderedChunk),
        });
        agentOutputBuffer = agentOutputBuffer.slice(nextStart);
      }

      if (agentOutputBuffer.startsWith(PROFILE_UPDATE_START)) {
        const end = agentOutputBuffer.indexOf(PROFILE_UPDATE_END);
        if (end < 0) break;
        const payload = agentOutputBuffer
          .slice(PROFILE_UPDATE_START.length, end)
          .trim();
        try {
          const parsed = JSON.parse(payload) as { name?: string };
          const nextName = parsed.name?.trim();
          if (nextName) onProfileNameChange?.(nextName);
        } catch {
          /* ignore malformed internal messages */
        }
        agentOutputBuffer = agentOutputBuffer.slice(
          end + PROFILE_UPDATE_END.length
        );
        continue;
      }

      if (agentOutputBuffer.startsWith(USER_UPDATE_START)) {
        const end = agentOutputBuffer.indexOf(USER_UPDATE_END);
        if (end < 0) break;
        const payload = agentOutputBuffer
          .slice(USER_UPDATE_START.length, end)
          .trim();
        try {
          const parsed = JSON.parse(payload) as { name?: string };
          const nextName = parsed.name?.trim();
          if (nextName) onUserNameChange?.(nextName);
        } catch {
          /* ignore malformed internal messages */
        }
        agentOutputBuffer = agentOutputBuffer.slice(
          end + USER_UPDATE_END.length
        );
        continue;
      }

      if (agentOutputBuffer.startsWith(ONBOARDING_START)) {
        onOnboardingStateChange?.(true);
        agentOutputBuffer = agentOutputBuffer.slice(ONBOARDING_START.length);
        continue;
      }

      if (agentOutputBuffer.startsWith(ONBOARDING_END)) {
        onOnboardingStateChange?.(false);
        agentOutputBuffer = agentOutputBuffer.slice(ONBOARDING_END.length);
        continue;
      }

      if (agentOutputBuffer.startsWith(CONTEXT_UPDATE_START)) {
        const end = agentOutputBuffer.indexOf(CONTEXT_UPDATE_END);
        if (end < 0) break;
        const payload = agentOutputBuffer
          .slice(CONTEXT_UPDATE_START.length, end)
          .trim();
        try {
          const parsed = JSON.parse(payload) as {
            modelId?: string | null;
            contextWindowTokens?: number | null;
            estimatedPromptTokens?: number;
          };
          onContextUpdate?.({
            modelId: parsed.modelId ?? null,
            contextWindowTokens:
              typeof parsed.contextWindowTokens === "number"
                ? parsed.contextWindowTokens
                : null,
            estimatedPromptTokens:
              typeof parsed.estimatedPromptTokens === "number"
                ? parsed.estimatedPromptTokens
                : 0,
          });
        } catch {
          /* ignore malformed internal messages */
        }
        agentOutputBuffer = agentOutputBuffer.slice(
          end + CONTEXT_UPDATE_END.length
        );
        continue;
      }

      if (agentOutputBuffer.startsWith(TOOL_CONFIRM_START)) {
        const end = agentOutputBuffer.indexOf(TOOL_CONFIRM_END);
        if (end < 0) break;
        try {
          const payload = agentOutputBuffer
            .slice(TOOL_CONFIRM_START.length, end)
            .trim();
          const parsed = JSON.parse(payload) as { tool?: string; summary?: string };
          appendAdapterDebugLog(profile.id, "tool_confirm_marker", {
            tool: parsed.tool,
            summaryPreview: String(parsed.summary || "").slice(0, 200),
          });
        } catch {
          /* ignore */
        }
        onPendingToolConfirmation?.(profile.id);
        agentOutputBuffer = agentOutputBuffer.slice(end + TOOL_CONFIRM_END.length);
        continue;
      }

      if (agentOutputBuffer.startsWith(CLARIFY_PROMPT_START)) {
        const end = agentOutputBuffer.indexOf(CLARIFY_PROMPT_END);
        if (end < 0) break;
        const payload = agentOutputBuffer.slice(CLARIFY_PROMPT_START.length, end).trim();
        try {
          const parsed = JSON.parse(payload) as {
            question?: string;
            options?: unknown;
            open_ended?: boolean;
          };
          const opts = Array.isArray(parsed.options)
            ? parsed.options.map((o) => String(o)).filter(Boolean)
            : [];
          onClarifyOffer?.(profile.id, {
            question: String(parsed.question || "Choose an option").trim(),
            options: opts,
            openEnded: Boolean(parsed.open_ended),
          });
        } catch {
          /* malformed clarify block */
        }
        agentOutputBuffer = agentOutputBuffer.slice(end + CLARIFY_PROMPT_END.length);
        continue;
      }

      if (agentOutputBuffer.startsWith(ARTIFACT_PRESENT_START)) {
        const end = agentOutputBuffer.indexOf(ARTIFACT_PRESENT_END);
        if (end < 0) break;
        const payload = agentOutputBuffer.slice(ARTIFACT_PRESENT_START.length, end).trim();
        try {
          const parsed = JSON.parse(payload) as {
            title?: string;
            filename?: string;
            markdown?: string;
          };
          if (parsed?.markdown && String(parsed.markdown).trim()) {
            onArtifactOffer?.(profile.id, {
              title: String(parsed.title || "Document").trim() || "Document",
              filename: String(parsed.filename || "artifact.md").trim() || "artifact.md",
              markdown: String(parsed.markdown || ""),
            });
          }
        } catch {
          /* ignore malformed */
        }
        agentOutputBuffer = agentOutputBuffer.slice(end + ARTIFACT_PRESENT_END.length);
        continue;
      }

      if (agentOutputBuffer.startsWith(FATAL_ERROR_START)) {
        const end = agentOutputBuffer.indexOf(FATAL_ERROR_END);
        if (end < 0) break;
        const raw = agentOutputBuffer.slice(FATAL_ERROR_START.length, end).trim();
        agentOutputBuffer = agentOutputBuffer.slice(end + FATAL_ERROR_END.length);
        try {
          const parsed = JSON.parse(raw) as {
            errName?: string;
            errMessage?: string;
            errStack?: string;
          };
          const msg =
            String(parsed?.errMessage || "unknown error").trim() || "unknown error";
          onOutput(`\x1b[31m▸ Bootstrap error: ${msg}\x1b[0m\n`);
          appendAdapterDebugLog(profile.id, "fatal_bootstrap", {
            errName: parsed?.errName,
            errMessagePreview: msg.slice(0, 500),
          });
        } catch {
          /* ignore malformed */
        }
        continue;
      }

      if (agentOutputBuffer.startsWith(PROXY_REQ_PREFIX)) {
        // Format: <<<WEBAGENT_PROXY_REQ:id>>>{json}<<<END_WEBAGENT_PROXY_REQ>>>
        const idEnd = agentOutputBuffer.indexOf(">>>", PROXY_REQ_PREFIX.length);
        if (idEnd < 0) break;
        const reqId = agentOutputBuffer.slice(PROXY_REQ_PREFIX.length, idEnd);
        const bodyStart = idEnd + 3;
        const bodyEnd = agentOutputBuffer.indexOf(PROXY_REQ_END, bodyStart);
        if (bodyEnd < 0) break;
        const reqBody = agentOutputBuffer.slice(bodyStart, bodyEnd);
        agentOutputBuffer = agentOutputBuffer.slice(bodyEnd + PROXY_REQ_END.length);
        // Handle asynchronously — make the fetch from browser page context (same-origin).
        void (async () => {
          let respPayload: string;
          try {
            const req = JSON.parse(reqBody) as {
              method?: string; url: string;
              headers?: Record<string, string>; body?: string | null;
            };
            const res = await fetch("/api/proxy", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ method: req.method ?? "GET", url: req.url, headers: req.headers ?? {}, body: req.body ?? null }),
            });
            const data = await res.json();
            respPayload = JSON.stringify({
              status: Number(data?.status ?? res.status),
              statusText: String(data?.statusText ?? ""),
              body: String(data?.body ?? ""),
              contentType: String(data?.contentType ?? ""),
            });
          } catch (e) {
            respPayload = JSON.stringify({ error: String((e as Error)?.message ?? e) });
          }
          await agentProcess.write(
            `${PROXY_RESP_PREFIX}${reqId}>>>${respPayload}${PROXY_RESP_END}`
          );
        })();
        continue;
      }

      if (agentOutputBuffer.startsWith(PROXY_STREAM_REQ_PREFIX)) {
        const idEnd = agentOutputBuffer.indexOf(">>>", PROXY_STREAM_REQ_PREFIX.length);
        if (idEnd < 0) break;
        const reqId = agentOutputBuffer.slice(PROXY_STREAM_REQ_PREFIX.length, idEnd);
        const bodyStart = idEnd + 3;
        const bodyEnd = agentOutputBuffer.indexOf(PROXY_STREAM_REQ_END, bodyStart);
        if (bodyEnd < 0) break;
        const reqBody = agentOutputBuffer.slice(bodyStart, bodyEnd);
        agentOutputBuffer = agentOutputBuffer.slice(bodyEnd + PROXY_STREAM_REQ_END.length);
        void (async () => {
          const writeStreamEvent = async (prefix: string, eventPayload: unknown, suffix: string) => {
            await agentProcess.write(`${prefix}${reqId}>>>${encodeIpcPayload(eventPayload)}${suffix}`);
          };
          try {
            const req = decodeIpcPayload<{
              method?: string;
              url: string;
              headers?: Record<string, string>;
              body?: string | null;
            }>(reqBody);
            const response = await fetch(req.url, {
              method: req.method ?? "GET",
              headers: req.headers ?? {},
              ...(req.body != null ? { body: req.body } : {}),
            });
            await writeStreamEvent(
              PROXY_STREAM_START_PREFIX,
              {
                status: response.status,
                statusText: response.statusText,
                contentType: response.headers.get("content-type") ?? "",
              },
              PROXY_STREAM_START_END
            );
            if (!response.body) {
              const text = await response.text().catch(() => "");
              if (text) {
                await writeStreamEvent(PROXY_STREAM_CHUNK_PREFIX, { chunk: text }, PROXY_STREAM_CHUNK_END);
              }
              await writeStreamEvent(PROXY_STREAM_END_PREFIX, { ok: true }, PROXY_STREAM_END_END);
              return;
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = decoder.decode(value, { stream: true });
              if (chunk) {
                await writeStreamEvent(PROXY_STREAM_CHUNK_PREFIX, { chunk }, PROXY_STREAM_CHUNK_END);
              }
            }
            const tail = decoder.decode();
            if (tail) {
              await writeStreamEvent(PROXY_STREAM_CHUNK_PREFIX, { chunk: tail }, PROXY_STREAM_CHUNK_END);
            }
            await writeStreamEvent(PROXY_STREAM_END_PREFIX, { ok: true }, PROXY_STREAM_END_END);
          } catch (e) {
            await writeStreamEvent(
              PROXY_STREAM_END_PREFIX,
              { error: String((e as Error)?.message ?? e) },
              PROXY_STREAM_END_END
            );
          }
        })();
        continue;
      }

      if (agentOutputBuffer.startsWith(SPAWN_REQ_PREFIX)) {
        const idEnd = agentOutputBuffer.indexOf(">>>", SPAWN_REQ_PREFIX.length);
        if (idEnd < 0) break;
        const reqId = agentOutputBuffer.slice(SPAWN_REQ_PREFIX.length, idEnd);
        const bodyStart = idEnd + 3;
        const bodyEnd = agentOutputBuffer.indexOf(SPAWN_REQ_END, bodyStart);
        if (bodyEnd < 0) break;
        const reqBody = agentOutputBuffer.slice(bodyStart, bodyEnd);
        agentOutputBuffer = agentOutputBuffer.slice(bodyEnd + SPAWN_REQ_END.length);
        void (async () => {
          let respPayload: string;
          try {
            const req = JSON.parse(reqBody) as {
              command?: string;
              args?: string[];
              cwd?: string;
              timeout_ms?: number;
            };
            const cmd = String(req.command || "").trim();
            const args = Array.isArray(req.args) ? req.args.map((a) => String(a)) : [];
            if (!cmd || !args.length) {
              respPayload = JSON.stringify({
                ok: false,
                error: "invalid_spawn_request",
              });
            } else {
              const timeoutMs =
                typeof req.timeout_ms === "number" && Number.isFinite(req.timeout_ms) && req.timeout_ms > 0
                  ? req.timeout_ms
                  : 120_000;
              const cwdRaw = req.cwd != null ? String(req.cwd).trim() : "";
              const cwdForSpawn =
                nodeboxSpawnArgvNeedsWorkspaceCwd(args) && cwdRaw ? cwdRaw : undefined;
              const result = await runNodeboxShellCommand(cmd, args, {
                cwd: cwdForSpawn,
                timeoutMs,
              });
              respPayload = JSON.stringify({
                ok: true,
                stdout: result.stdout,
                stderr: result.stderr,
                exit_code: result.exitCode,
              });
            }
          } catch (e) {
            respPayload = JSON.stringify({
              ok: false,
              error: String((e as Error)?.message ?? e),
            });
          }
          await agentProcess.write(`${SPAWN_RESP_PREFIX}${reqId}>>>${respPayload}${SPAWN_RESP_END}`);
        })();
        continue;
      }

      if (agentOutputBuffer.startsWith(LOOP_GUARD_REQ_PREFIX)) {
        const idEnd = agentOutputBuffer.indexOf(">>>", LOOP_GUARD_REQ_PREFIX.length);
        if (idEnd < 0) break;
        const reqId = agentOutputBuffer.slice(LOOP_GUARD_REQ_PREFIX.length, idEnd);
        const bodyStart = idEnd + 3;
        const bodyEnd = agentOutputBuffer.indexOf(LOOP_GUARD_REQ_END, bodyStart);
        if (bodyEnd < 0) break;
        const reqBody = agentOutputBuffer.slice(bodyStart, bodyEnd);
        agentOutputBuffer = agentOutputBuffer.slice(bodyEnd + LOOP_GUARD_REQ_END.length);
        void (async () => {
          let respPayload: string;
          const { decide } = await import("./supervisor/index.js");
          const { formatTransformersError } = await import("./supervisor/transformers-env.js");
          try {
            const req = JSON.parse(reqBody) as {
              messages?: Array<{ role?: string; content?: string }>;
              meta?: Record<string, unknown>;
            };
            const thresholds = readLoopGuardThresholds(import.meta.env);
            const result = await decide({
              messages: (req.messages || []).map((m) => ({
                role: String(m.role || ""),
                content: String(m.content || ""),
              })),
              maxMessages: thresholds.maxMessages,
              thresholds,
              meta: {
                userRequest: req.meta?.userRequest != null ? String(req.meta.userRequest) : undefined,
                webSearchCount:
                  typeof req.meta?.webSearchCount === "number" ? req.meta.webSearchCount : undefined,
                webFetchCount:
                  typeof req.meta?.webFetchCount === "number" ? req.meta.webFetchCount : undefined,
                toolsExecutedInTurn:
                  typeof req.meta?.toolsExecutedInTurn === "boolean"
                    ? req.meta.toolsExecutedInTurn
                    : undefined,
                pendingToolCalls: Array.isArray(req.meta?.pendingToolCalls)
                  ? req.meta.pendingToolCalls.map((n) => String(n))
                  : undefined,
              },
            });
            respPayload = JSON.stringify(result);
          } catch (e) {
            respPayload = JSON.stringify({
              decision: "continue",
              scores: { continue: 0, stop: 0, ask_user: 0 },
              reason: "scoring_unavailable",
              error: formatTransformersError(e),
            });
          }
          await agentProcess.write(
            `${LOOP_GUARD_RESP_PREFIX}${reqId}>>>${respPayload}${LOOP_GUARD_RESP_END}`
          );
        })();
        continue;
      }
    }

    if (agentOutputBuffer.length > 0 && !agentOutputBuffer.includes("<<<WEBAGENT_") && !agentOutputBuffer.includes(PROXY_REQ_PREFIX)) {
      const rendered = stripRenderedPrompt(agentOutputBuffer);
      onOutput(rendered);
      appendAdapterDebugLog(profile.id, "rendered_output_chunk", {
        bytes: rendered.length,
        chunk: trimChunk(rendered),
      });
      agentOutputBuffer = "";
    }
  };

  agentProcess.onData((data: string) => handleAgentOutput(data));

  agentProcess.exit.then(async (code) => {
    if (snapshotSaveTimer) {
      clearTimeout(snapshotSaveTimer);
      snapshotSaveTimer = null;
    }
    try {
      await persistSnapshotNow();
    } catch {
      /* best-effort */
    }
    if (code !== 0) {
      onOutput(`\x1b[31m▸ Agent stopped unexpectedly (exit ${code}). Restart from the sidebar.\x1b[0m\n`);
    }
    agentProcesses.delete(profile.id);
    lastResizes.delete(profile.id);
    adapterDebugLogPaths.delete(profile.id);
    adapterDebugPending.delete(profile.id);
    adapterDebugFlushPromises.delete(profile.id);
    const timer = adapterDebugFlushTimers.get(profile.id);
    if (timer) {
      clearTimeout(timer);
      adapterDebugFlushTimers.delete(profile.id);
    }
    onStatusChange("stopped");
  });
}

export async function stopWebAgent(profileId: string | null): Promise<void> {
  if (!profileId) return;
  const agentProcess = agentProcesses.get(profileId);
  if (!agentProcess) {
    lastResizes.delete(profileId);
    return;
  }
  try {
    await saveWorkspaceSnapshot(profileId, {
      onProgress: () => {
        /* silent */
      },
    });
  } catch {
    /* best-effort */
  }
  try {
    await agentProcess.kill();
  } catch {
    /* process may already be gone */
  }
  agentProcesses.delete(profileId);
  lastResizes.delete(profileId);
}

export async function writeToWebAgent(profileId: string, data: string): Promise<void> {
  const agentProcess = agentProcesses.get(profileId);
  if (!agentProcess) return;
  try {
    await agentProcess.write(data);
  } catch {
    /* ignore write errors */
  }
}

export function resizeAgentPty(_profileId: string, _dimensions: SpawnPtySize): void {
  // Nodebox does not support PTY resize
}

export function isWebAgentRunning(profileId: string): boolean {
  return agentProcesses.has(profileId);
}
