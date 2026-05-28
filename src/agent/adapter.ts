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
import { executePythonInNodebox } from "@/runtimes/webcontainer/python";
import {
  hasWorkspaceSnapshot,
  restoreFilesystem,
  saveWorkspaceSnapshot,
} from "@/runtimes/webcontainer/filesystem-sync";
import { activeProfileModel, type Profile } from "@/core/profiles";
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
import { isSubscriptionLlmUrl } from "@/core/subscription-auth-client";
import { toolGuardrailsEnvForRuntime } from "./tool-guardrails-config.js";
import { getMcpHost, shutdownMcpHost } from "@/core/mcp/host";
import { probeMcpServer } from "@/core/mcp/server-task";
import type { McpServerConfig, McpServersConfig } from "@/core/mcp/types";
import { parseMcpServersConfig, resolveServerConfig } from "@/core/mcp/config";
import heartbeatSource from "./runtime/HEARTBEAT.md?raw";
import soulSource from "./runtime/SOUL.md?raw";
import { TOOL_CATALOG_JSON } from "./tool-catalog";
import { normalizeLaunchMode, sanitizeForLogs } from "./runtime/privacy";
import sqlWasmRuntimeSource from "sql.js/dist/sql-wasm.js?raw";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";

/** Built embed-runtime tree — single source for Nodebox copy (run `npm run build:embed-runtime` after TS edits). */
const runtimeModuleSources = import.meta.glob("../../dist/agent-runtime/**/*.js", {
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
  /** Artifact surfaced via `artifact_present` tool markers. */
  onArtifactOffer?: (
    profileId: string,
    payload: {
      title: string;
      filename: string;
      kind: import("@/core/artifact-preview").ArtifactKind;
      path?: string;
      markdown?: string;
    },
  ) => void;
  /** Clarification UX: structured prompt from <<<CLARIFY>>> markers (skill-driven). */
  onClarifyOffer?: (
    profileId: string,
    payload: { question: string; options: string[]; openEnded: boolean },
  ) => void;
  onSelfImprovementSummary?: (
    profileId: string,
    payload: { summary: string; kind?: string | null; source?: string | null; at?: string },
  ) => void;
  ptySize?: SpawnPtySize;
}

const agentProcesses = new Map<string, NodeboxProcess>();

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
const SELF_IMPROVEMENT_START = "<<<WEBAGENT_SELF_IMPROVEMENT>>>";
const SELF_IMPROVEMENT_END = "<<<END_WEBAGENT_SELF_IMPROVEMENT>>>";
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
const PYTHON_REQ_PREFIX = "<<<WEBAGENT_PYTHON_REQ:";
const PYTHON_REQ_END = "<<<END_WEBAGENT_PYTHON_REQ>>>";
const PYTHON_RESP_PREFIX = "<<<WEBAGENT_PYTHON_RESP:";
const PYTHON_RESP_END = "<<<END_WEBAGENT_PYTHON_RESP>>>";
const STT_REQ_PREFIX = "<<<WEBAGENT_STT_REQ:";
const STT_REQ_END = "<<<END_WEBAGENT_STT_REQ>>>";
const STT_RESP_PREFIX = "<<<WEBAGENT_STT_RESP:";
const STT_RESP_END = "<<<END_WEBAGENT_STT_RESP>>>";
const MCP_REQ_PREFIX = "<<<WEBAGENT_MCP_REQ:";
const MCP_REQ_END = "<<<END_WEBAGENT_MCP_REQ>>>";
const MCP_RESP_PREFIX = "<<<WEBAGENT_MCP_RESP:";
const MCP_RESP_END = "<<<END_WEBAGENT_MCP_RESP>>>";
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
const AGENT_OUTPUT_BUFFER_MAX = 512 * 1024;
const SNAPSHOT_WARN_THROTTLE_MS = 5 * 60_000;
const snapshotWarnLastAt = new Map<string, number>();
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

function stripRenderedPrompt(input: string): string {
  return input
    .replace(/\x1b\[38;2;251;117;252m❯\s\x1b\[0m(?:\x1b\[0m)?/g, "")
    .replace(/(^|\r?\n)❯\s/g, "$1");
}

function trimChunk(text: string): string {
  if (text.length <= DEBUG_LOG_CHUNK_MAX) return text;
  return `${text.slice(0, DEBUG_LOG_CHUNK_MAX)}…[truncated:${text.length}]`;
}

function maybeEmitThrottledSnapshotWarn(profileId: string, onOutput: OutputHandler): void {
  const now = Date.now();
  const last = snapshotWarnLastAt.get(profileId) ?? 0;
  if (now - last < SNAPSHOT_WARN_THROTTLE_MS) return;
  snapshotWarnLastAt.set(profileId, now);
  onOutput("\x1b[33m▸ Workspace snapshot save failed — changes may not persist after reload.\x1b[0m\n");
}

function capAgentOutputBuffer(
  buffer: string,
  onFlush: (chunk: string) => void
): string {
  if (buffer.length <= AGENT_OUTPUT_BUFFER_MAX) return buffer;
  const lastMarker = Math.max(buffer.lastIndexOf("<<<WEBAGENT_"), buffer.lastIndexOf(PROXY_REQ_PREFIX));
  if (lastMarker > 0) {
    const safe = buffer.slice(0, lastMarker);
    if (safe.length > 0) {
      const rendered = stripRenderedPrompt(safe);
      if (rendered) onFlush(rendered);
    }
    return buffer.slice(lastMarker);
  }
  const rendered = stripRenderedPrompt(buffer);
  if (rendered) onFlush(rendered);
  return "";
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

  const toolPolicyPath = `${workspaceDir}/.webagent/tool-policy.json`;
  try {
    await emulator.fs.readFile(toolPolicyPath);
  } catch {
    await emulator.fs.mkdir(`${workspaceDir}/.webagent`, { recursive: true });
    await emulator.fs.writeFile(
      toolPolicyPath,
      `${JSON.stringify(
        {
          allow: [
            "group:core",
            "group:filesystem_mutate",
            "group:memory",
            "group:session",
            "group:skills",
          ],
          deny: [],
          auto: { composio: "when_configured" },
        },
        null,
        2
      )}\n`
    );
  }
}

async function writeRuntimeSources(profileId: string): Promise<void> {
  const emulator = await getNodebox();
  const webagentDir = `/workspace/${profileId}/.webagent`;

  await emulator.fs.mkdir(webagentDir, { recursive: true });
  await emulator.fs.mkdir(`${webagentDir}/vendor`, { recursive: true });

  await emulator.fs.writeFile(
    `${webagentDir}/package.json`,
    JSON.stringify({ name: "@webagent/runtime", private: true, type: "module" })
  );

  for (const [sourcePath, content] of Object.entries(runtimeModuleSources)) {
    const rel = sourcePath.replace(/^.*dist\/agent-runtime\//, "");
    if (!rel) continue;
    const target = `${webagentDir}/${rel}`;
    const parent = rel.split("/").slice(0, -1).join("/");
    if (parent) await emulator.fs.mkdir(`${webagentDir}/${parent}`, { recursive: true });
    await emulator.fs.writeFile(target, content);
  }

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

function withSubscriptionProfileHeader(
  profileId: string,
  url: string,
  headers: Record<string, string> | undefined
): Record<string, string> {
  const next = { ...(headers ?? {}) };
  if (isSubscriptionLlmUrl(url)) {
    next["x-webagent-profile-id"] = profileId;
  }
  return next;
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
    WEBAGENT_PROFILE_ID: profileId,
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
    ...toolGuardrailsEnvForRuntime(import.meta.env),
  };
  const personalityLabel = getPersonalityDisplayLabelForPrompt(profile.personality);
  if (personalityLabel) env.WEBAGENT_PERSONALITY_LABEL = personalityLabel;
  const modelOverride = activeProfileModel(profile, activeProvider?.model?.trim() ?? "");
  if (modelOverride) env.WEBAGENT_MODEL = modelOverride;

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
    ["WEBAGENT_COMPOSIO_API_KEY", "composio_api_key"],
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

async function handleMcpIpcRequest(
  profileId: string,
  profileWorkspaceDir: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const action = String(body.action || "").trim();
  const env =
    body.env && typeof body.env === "object"
      ? Object.fromEntries(
          Object.entries(body.env as Record<string, unknown>)
            .filter(([, v]) => v != null)
            .map(([k, v]) => [String(k), String(v)])
        )
      : {};
  const config = parseMcpServersConfig(body.config) as McpServersConfig;
  const host = getMcpHost(profileId, {
    spawn: spawnProcess,
    workspaceCwd: profileWorkspaceDir,
  });

  try {
    if (action === "discover") {
      const tools = await host.discover(config, env);
      return { ok: true, tools, status: host.getStatus() };
    }
    if (action === "reload") {
      const diff = await host.reload(config, env);
      return { ok: true, tools: host.listDiscoveredTools(), diff, status: host.getStatus() };
    }
    if (action === "call") {
      const server = String(body.server || "").trim();
      const tool = String(body.tool || "").trim();
      const args =
        body.args && typeof body.args === "object" && !Array.isArray(body.args)
          ? (body.args as Record<string, unknown>)
          : {};
      const timeoutMs =
        typeof body.timeout_ms === "number" && Number.isFinite(body.timeout_ms)
          ? body.timeout_ms
          : undefined;
      const result = await host.callTool(server, tool, args, timeoutMs);
      return { ok: true, result };
    }
    if (action === "probe") {
      const name = String(body.name || "").trim();
      const inline = body.server_config;
      if (inline && typeof inline === "object" && !Array.isArray(inline)) {
        const resolved = resolveServerConfig(inline as McpServerConfig, env);
        const tools = await probeMcpServer(name, resolved, {
          spawn: spawnProcess,
          workspaceCwd: profileWorkspaceDir,
        });
        return { ok: true, tools };
      }
      const tools = await host.probe(name, config, env);
      return { ok: true, tools };
    }
    if (action === "status") {
      return { ok: true, status: host.getStatus(), tools: host.listDiscoveredTools() };
    }
    if (action === "shutdown") {
      await shutdownMcpHost(profileId);
      return { ok: true };
    }
    return { ok: false, error: `unknown_mcp_action:${action || "?"}` };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
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
    onSelfImprovementSummary,
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

  // Warm whisper STT model off the critical path so the first transcription
  // isn't paying for WASM + weights download synchronously.
  const idleSchedule = (cb: () => void) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(cb, { timeout: 12_000 });
      return;
    }
    setTimeout(cb, 12_000);
  };
  idleSchedule(() => {
    void import("@/core/voice/stt-client.js")
      .then((mod) => mod.prefetchStt())
      .catch(async (e) => {
        const { formatTransformersError } = await import("./supervisor/transformers-env.js");
        console.warn(
          "[stt] prefetch failed — voice transcription may be slow until reload:",
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
        maybeEmitThrottledSnapshotWarn(profile.id, onOutput);
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
    const { data, nextCarry } = stripWebagentControlMarkerFromStream(
      inputReadyMarkerCarry,
      awaitingStrip.data,
      INPUT_READY_LINE,
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
    agentOutputBuffer = capAgentOutputBuffer(agentOutputBuffer, (chunk) => {
      onOutput(chunk);
      appendAdapterDebugLog(profile.id, "rendered_output_chunk", {
        bytes: chunk.length,
        chunk: trimChunk(chunk),
      });
    });
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
      const selfImprovementStart = agentOutputBuffer.indexOf(SELF_IMPROVEMENT_START);
      const proxyReqStart = agentOutputBuffer.indexOf(PROXY_REQ_PREFIX);
      const proxyStreamReqStart = agentOutputBuffer.indexOf(PROXY_STREAM_REQ_PREFIX);
      const spawnReqStart = agentOutputBuffer.indexOf(SPAWN_REQ_PREFIX);
      const pythonReqStart = agentOutputBuffer.indexOf(PYTHON_REQ_PREFIX);
      const sttReqStart = agentOutputBuffer.indexOf(STT_REQ_PREFIX);
      const mcpReqStart = agentOutputBuffer.indexOf(MCP_REQ_PREFIX);
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
        selfImprovementStart,
        proxyReqStart,
        proxyStreamReqStart,
        spawnReqStart,
        pythonReqStart,
        sttReqStart,
        mcpReqStart,
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
            kind?: string;
            path?: string;
            markdown?: string;
          };
          const markdown = typeof parsed?.markdown === "string" ? parsed.markdown.trim() : "";
          const path = typeof parsed?.path === "string" ? parsed.path.trim() : "";
          if (markdown || path) {
            onArtifactOffer?.(profile.id, {
              title: String(parsed.title || "Document").trim() || "Document",
              filename: String(parsed.filename || "artifact.md").trim() || "artifact.md",
              kind: (parsed.kind as import("@/core/artifact-preview").ArtifactKind) || "markdown",
              ...(path ? { path } : {}),
              ...(markdown ? { markdown: String(parsed.markdown || "") } : {}),
            });
          }
        } catch {
          /* ignore malformed */
        }
        agentOutputBuffer = agentOutputBuffer.slice(end + ARTIFACT_PRESENT_END.length);
        continue;
      }

      if (agentOutputBuffer.startsWith(SELF_IMPROVEMENT_START)) {
        const end = agentOutputBuffer.indexOf(SELF_IMPROVEMENT_END);
        if (end < 0) break;
        const payload = agentOutputBuffer.slice(SELF_IMPROVEMENT_START.length, end).trim();
        agentOutputBuffer = agentOutputBuffer.slice(end + SELF_IMPROVEMENT_END.length);
        try {
          const parsed = JSON.parse(payload) as {
            summary?: string;
            kind?: string | null;
            source?: string | null;
            at?: string;
          };
          const summary = String(parsed.summary || "").trim();
          if (summary) {
            onSelfImprovementSummary?.(profile.id, {
              summary,
              kind: parsed.kind ?? null,
              source: parsed.source ?? null,
              at: parsed.at,
            });
          }
        } catch {
          /* ignore malformed */
        }
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
              method?: string;
              url: string;
              headers?: Record<string, string>;
              body?: string | null;
              bodyEncoding?: string;
              binaryResponse?: boolean;
            };
            const proxyHeaders = withSubscriptionProfileHeader(profile.id, req.url, req.headers);
            const res = await fetch("/api/proxy", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                method: req.method ?? "GET",
                url: req.url,
                headers: proxyHeaders,
                body: req.body ?? null,
                bodyEncoding: req.bodyEncoding,
                binaryResponse: req.binaryResponse,
              }),
            });
            const data = await res.json();
            if (data?.error) {
              respPayload = JSON.stringify({ error: String(data.error) });
              await agentProcess.write(
                `${PROXY_RESP_PREFIX}${reqId}>>>${respPayload}${PROXY_RESP_END}`
              );
              return;
            }
            const PROXY_BODY_CAP = 100_000;
            let body = String(data?.body ?? "");
            let truncated = Boolean(data?.truncated);
            if (!data?.bodyEncoding && body.length > PROXY_BODY_CAP) {
              body = body.slice(0, PROXY_BODY_CAP);
              truncated = true;
            }
            respPayload = JSON.stringify({
              status: Number(data?.status ?? res.status),
              statusText: String(data?.statusText ?? ""),
              body,
              contentType: String(data?.contentType ?? ""),
              bodyEncoding: data?.bodyEncoding,
              ...(truncated
                ? {
                    truncated: true,
                    truncated_at_chars: Number(data?.truncated_at_chars) || PROXY_BODY_CAP,
                  }
                : {}),
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
              textBodyCap?: number;
            }>(reqBody);
            const proxyHeaders = withSubscriptionProfileHeader(profile.id, req.url, req.headers);
            const res = await fetch("/api/proxy", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                method: req.method ?? "GET",
                url: req.url,
                headers: proxyHeaders,
                body: req.body ?? null,
              }),
            });
            const data = (await res.json()) as {
              error?: string;
              status?: number;
              statusText?: string;
              contentType?: string;
              body?: string;
              truncated?: boolean;
              truncated_at_chars?: number;
            };
            if (data?.error) {
              await writeStreamEvent(
                PROXY_STREAM_END_PREFIX,
                { error: String(data.error) },
                PROXY_STREAM_END_END
              );
              return;
            }
            await writeStreamEvent(
              PROXY_STREAM_START_PREFIX,
              {
                status: Number(data?.status ?? res.status),
                statusText: String(data?.statusText ?? ""),
                contentType: String(data?.contentType ?? ""),
              },
              PROXY_STREAM_START_END
            );
            const textBodyCap = Number(req.textBodyCap);
            const streamCap =
              Number.isFinite(textBodyCap) && textBodyCap > 0 ? Math.floor(textBodyCap) : 0;
            let streamed = 0;
            const writeCappedChunk = async (chunk: string) => {
              if (!chunk) return;
              if (!streamCap) {
                await writeStreamEvent(PROXY_STREAM_CHUNK_PREFIX, { chunk }, PROXY_STREAM_CHUNK_END);
                return;
              }
              const room = streamCap - streamed;
              if (room <= 0) return;
              const slice = chunk.slice(0, room);
              streamed += slice.length;
              await writeStreamEvent(PROXY_STREAM_CHUNK_PREFIX, { chunk: slice }, PROXY_STREAM_CHUNK_END);
            };
            const text = String(data?.body ?? "");
            const CHUNK = 16_384;
            for (let i = 0; i < text.length; i += CHUNK) {
              if (streamCap && streamed >= streamCap) break;
              await writeCappedChunk(text.slice(i, i + CHUNK));
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
              env?: Record<string, string>;
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
              const spawnEnv =
                req.env && typeof req.env === "object"
                  ? Object.fromEntries(
                      Object.entries(req.env)
                        .filter(([k, v]) => String(k || "").trim() && v != null)
                        .map(([k, v]) => [String(k), String(v)])
                    )
                  : undefined;
              const result = await runNodeboxShellCommand(cmd, args, {
                cwd: cwdForSpawn,
                timeoutMs,
                ...(Object.keys(spawnEnv || {}).length ? { env: spawnEnv } : {}),
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

      if (agentOutputBuffer.startsWith(PYTHON_REQ_PREFIX)) {
        const idEnd = agentOutputBuffer.indexOf(">>>", PYTHON_REQ_PREFIX.length);
        if (idEnd < 0) break;
        const reqId = agentOutputBuffer.slice(PYTHON_REQ_PREFIX.length, idEnd);
        const bodyStart = idEnd + 3;
        const bodyEnd = agentOutputBuffer.indexOf(PYTHON_REQ_END, bodyStart);
        if (bodyEnd < 0) break;
        const reqBody = agentOutputBuffer.slice(bodyStart, bodyEnd);
        agentOutputBuffer = agentOutputBuffer.slice(bodyEnd + PYTHON_REQ_END.length);
        void (async () => {
          let respPayload: string;
          try {
            const req = JSON.parse(reqBody) as {
              code?: string;
              path?: string;
              cwd?: string;
              args?: string[];
              env?: Record<string, string>;
              packages?: string[];
              micropip_packages?: string[];
              timeout_ms?: number;
            };
            const result = await executePythonInNodebox(req, profileWorkspaceDir);
            respPayload = JSON.stringify(result);
          } catch (e) {
            respPayload = JSON.stringify({
              ok: false,
              error: String((e as Error)?.message ?? e),
            });
          }
          await agentProcess.write(`${PYTHON_RESP_PREFIX}${reqId}>>>${respPayload}${PYTHON_RESP_END}`);
        })();
        continue;
      }

      if (agentOutputBuffer.startsWith(MCP_REQ_PREFIX)) {
        const idEnd = agentOutputBuffer.indexOf(">>>", MCP_REQ_PREFIX.length);
        if (idEnd < 0) break;
        const reqId = agentOutputBuffer.slice(MCP_REQ_PREFIX.length, idEnd);
        const bodyStart = idEnd + 3;
        const bodyEnd = agentOutputBuffer.indexOf(MCP_REQ_END, bodyStart);
        if (bodyEnd < 0) break;
        const reqBody = agentOutputBuffer.slice(bodyStart, bodyEnd);
        agentOutputBuffer = agentOutputBuffer.slice(bodyEnd + MCP_REQ_END.length);
        void (async () => {
          let respPayload: string;
          try {
            const req = JSON.parse(reqBody) as Record<string, unknown>;
            const result = await handleMcpIpcRequest(profile.id, profileWorkspaceDir, req);
            respPayload = JSON.stringify(result);
          } catch (e) {
            respPayload = JSON.stringify({
              ok: false,
              error: String((e as Error)?.message ?? e),
            });
          }
          await agentProcess.write(`${MCP_RESP_PREFIX}${reqId}>>>${respPayload}${MCP_RESP_END}`);
        })();
        continue;
      }

      if (agentOutputBuffer.startsWith(STT_REQ_PREFIX)) {
        const idEnd = agentOutputBuffer.indexOf(">>>", STT_REQ_PREFIX.length);
        if (idEnd < 0) break;
        const reqId = agentOutputBuffer.slice(STT_REQ_PREFIX.length, idEnd);
        const bodyStart = idEnd + 3;
        const bodyEnd = agentOutputBuffer.indexOf(STT_REQ_END, bodyStart);
        if (bodyEnd < 0) break;
        const reqBody = agentOutputBuffer.slice(bodyStart, bodyEnd);
        agentOutputBuffer = agentOutputBuffer.slice(bodyEnd + STT_REQ_END.length);
        void (async () => {
          let respPayload: string;
          const { formatTransformersError } = await import("./supervisor/transformers-env.js");
          try {
            const req = JSON.parse(reqBody) as { audioBase64?: string; mime?: string };
            const b64 = String(req.audioBase64 ?? "");
            if (!b64) throw new Error("STT request missing audioBase64.");
            const binary = atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const { transcribeBytes } = await import("@/core/voice/stt-client.js");
            const text = await transcribeBytes(bytes, req.mime || "audio/wav");
            respPayload = JSON.stringify({ ok: true, text });
          } catch (e) {
            respPayload = JSON.stringify({
              ok: false,
              error: formatTransformersError(e),
            });
          }
          await agentProcess.write(`${STT_RESP_PREFIX}${reqId}>>>${respPayload}${STT_RESP_END}`);
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
  await shutdownMcpHost(profileId).catch(() => {});
  const agentProcess = agentProcesses.get(profileId);
  if (!agentProcess) {
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
}

export async function writeToWebAgent(profileId: string, data: string): Promise<boolean> {
  const agentProcess = agentProcesses.get(profileId);
  if (!agentProcess) return false;
  try {
    await agentProcess.write(data);
    return true;
  } catch {
    return false;
  }
}

export function resizeAgentPty(_profileId: string, _dimensions: SpawnPtySize): void {
  // Nodebox does not support PTY resize
}

export function isWebAgentRunning(profileId: string): boolean {
  return agentProcesses.has(profileId);
}
