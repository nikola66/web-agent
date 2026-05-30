/**
 * Agent turn execution: main LLM loop with tool calls, streaming, and auto-continuation.
 */

import * as memoryServices from "./memory/index.js";
import {
  buildMemoryContextBlock,
  buildSkillsContextBlock,
  cleanupSnapshotsNotReferenced,
  createTurnInlineBudgetState,
  promoteLearning,
  recordToolFailure,
  saveCompressedToolResults,
  saveReflection,
  saveRun,
  sanitizeMessagesMissingSnapshotRefs,
  unwrapSnapshotReadFileExecutions,
} from "./memory/index.js";
import {
  buildOpenAiToolDefinitions,
  getToolNamesAsync,
  loadToolCatalog,
  runTools,
} from "./tools/registry.js";
import {
  appendToolGuardrailGuidance,
  executionResultText,
  readToolLoopGuardrailConfig,
  ToolCallGuardrailController,
  toolGuardrailSyntheticResult,
} from "./tools/tool-loop-guardrails.js";
import { createToolContext, type CreateToolContextInput } from "./tools/context.js";
import {
  emitContextUpdate,
} from "./identity/onboarding.js";
import {
  loadSystemPrompt,
} from "./state/persistence.js";
import { buildWorkspaceMapBlock } from "./workspace-map.js";
import {
  createToolAwareStreamWriter,
  estimateMessagesTokens,
  estimateToolSchemaTokens,
  extractClarifyMarkers,
  extractJsonToolCallPayloads,
  extractMarkerTools,
  extractLooseCallToolLines,
  extractPlainToolCommandLines,
  extractLongcatToolCallPayloads,
  extractDsmlToolCallPayloads,
  extractFunctionXmlToolCallPayloads,
  extractToolCallTagPayloads,
  liveMirrorVisibleGap,
  normalizeToolCalls,
  sanitizeAssistantVisibleText,
  streamOpenAI,
} from "./llm/streaming.js";
import { reasoningPreviewSupportedForModel } from "./llm/model-quirks.js";
import { reasoningPreviewEnabled } from "./llm/provider-config.js";
import {
  bold,
  cyan,
  dim,
  normalizeLatexInlineSymbols,
  prefixBlock,
  renderMarkdownToAnsi,
} from "./terminal-format.js";
import { isDebugLogEnabled, logDebugEvent } from "./logging/debug-log.js";
import { createReflectionFromRun, derivePromotableLearning } from "./reflection.js";
import {
  estimateTaskComplexity,
  detectMultistepTaskPattern,
  buildSuggestedTodoChecklist,
  buildMultiStepGateHint,
  isPlanningModePrompt,
  extractExactResponseTokens,
  repairExactResponseText,
  isResearchIntent,
  inputSuggestsMultimodal,
  inputSuggestsArchive,
  inputSuggestsDocument,
  buildFileHandlingContextPrefix,
  MIN_RESEARCH_FETCHES,
  MIN_RESEARCH_SEARCHES,
  buildPlanExecutionContextPrefix,
  buildExecutionContinuationContextPrefix,
  isExecutionContinuationIntent,
  isSkillInstallIntent,
  focusToolNamesForIntent,
  buildSkillInstallContextPrefix,
  buildApiCallContextPrefix,
  buildComposioSaasContextPrefix,
  SKILL_INSTALL_PIVOT_NUDGE,
  skillBulkSaveAllUrlItemsFailed,
  webFetchTargetsRegistryUrl,
} from "./turn-sequencing.js";
import { buildExecutionGuidanceBlock } from "./execution-guidance.js";
import {
  getCachedSystemPrompt,
  invalidateSystemPromptCache,
  setCachedSystemPrompt,
} from "./system-prompt-cache.js";
import { buildMemoryLayerGuidanceBlock } from "./memory-guidance.js";
import { buildCapabilityRouterBlock } from "./capability-router.js";
import {
  invalidateToolCapabilityIndexCache,
  resolveToolCapabilityIndexBlock,
} from "./tool-capability-index.js";
import {
  ensureDefaultToolPolicy,
  loadToolPolicy,
  resolveInitialActiveToolNames,
  resolvePolicyToolNames,
  canUnlockTool,
  TOOL_GROUPS,
  type ToolPolicyConfig,
} from "./tools/tool-policy-config.js";
import { resolveSkillPrimaryToolsForSlug } from "./memory/skills.js";
import {
  buildContinuationNudge,
  buildEmptyRecoveryUserMessage,
  buildEmptyResponseRecoveryUserMessage,
  buildSyntheticEmptyAssistantMessage,
  buildThinkingPrefillAssistantMessage,
  shouldContinueThinkingPrefill,
  MAX_THINKING_PREFILL_CONTINUATIONS,
  cronJobIdsFromListResult,
  cronRegisterJobIdFromArgs,
  looksLikeFalseManualCronPromise,
  shouldContinueCronVerification,
  shouldContinueEmptyAfterTools,
  shouldContinueEmptyResponse,
  shouldContinueIncompleteTodosAsync,
  shouldContinueIncompletePublishDeliverable,
  shouldContinueContentShareDeliverable,
  shouldContinueUnparsedToolMarkup,
  buildContentShareContinuationNudge,
  buildContentShareFallbackVisible,
  shouldApplyContentShareFallback,
  shouldContinueIntermediateAck,
  shouldContinuePostToolStall,
  shouldContinuePreToolPromiseStall,
  shouldContinueSnapshotReadStall,
  shouldContinueApiDiscoveryStall,
  shouldContinueFindSkillsDelivery,
  shouldContinueTruncation,
  partitionToolsForTruncatedContentDeferral,
  truncatedWriteDeferMessage,
  resolveTurnStopReason,
  isFindSkillsModeUserMessage,
} from "./turn-continuation.js";
import { dropTrailingEmptyResponseScaffolding, popTrailingInternalScaffolding, sanitizeMessagesForLlm } from "./message-sanitizer.js";
import {
  getCompactionThresholdTokens,
  maybeCompactHistory,
  pruneConversationForMidTurn,
} from "./context-compression.js";
import { errorMessage } from "./utils.js";
import { WS } from "./constants.js";
import {
  createAssistantTranscriptEvent,
  createReasoningPreviewTranscriptEvent,
  createSystemLineTranscriptEvent,
  formatSkippedToolsTranscript,
  shortenReasoningPreview,
} from "./transcript.js";
import { emitTranscriptEvent } from "./transcript-delivery.js";
import {
  summarizeToolExecutions,
  createRunId,
  toolExecutionKey,
} from "./stream-output.js";
import {
  evaluateBackgroundReviewTrigger,
  noteForegroundMemoryWrite,
  noteForegroundSkillWrite,
  noteToolIteration,
  noteUserTurnStarted,
  scheduleBackgroundReview,
} from "./background-review.js";

const MAX_AGENT_ROUNDS = Math.max(1, Number(typeof process !== "undefined" ? process.env?.WEBAGENT_MAX_AGENT_ROUNDS : undefined) || 90);
const MAX_TODO_GATE_CONTINUATIONS = 2;
const REASONING_PREVIEW_START = "<<<WEBAGENT_REASONING_PREVIEW>>>";
const REASONING_PREVIEW_END = "<<<END_WEBAGENT_REASONING_PREVIEW>>>";
const REASONING_PREVIEW_THROTTLE_MS = 200;

function createReasoningPreviewController(opts: {
  turnMeta: Record<string, unknown>;
  mirrorTerminal: boolean;
  round: number;
  enabled?: boolean;
}) {
  let acc = "";
  let lastEmitAt = 0;
  let cleared = false;
  const enabled = opts.enabled !== false;

  const emit = async (text: string, done = false) => {
    if (!enabled || (cleared && !done)) return;
    const preview = shortenReasoningPreview(text);
    await emitTranscriptEvent(
      opts.turnMeta,
      createReasoningPreviewTranscriptEvent({
        text: preview,
        done,
        round: opts.round,
      })
    );
    if (opts.mirrorTerminal) {
      const payload = JSON.stringify({ text: preview, done });
      process.stdout.write(`${REASONING_PREVIEW_START}${payload}${REASONING_PREVIEW_END}`);
    }
  };

  const scheduleEmit = () => {
    const now = Date.now();
    if (now - lastEmitAt < REASONING_PREVIEW_THROTTLE_MS) return;
    lastEmitAt = now;
    void emit(acc);
  };

  return {
    onReasoningDelta(chunk: string) {
      if (!enabled || cleared || !chunk) return;
      acc += chunk;
      scheduleEmit();
    },
    clear() {
      if (cleared) return;
      cleared = true;
      void emit("", true);
    },
    flush() {
      if (cleared) return;
      lastEmitAt = Date.now();
      void emit(acc, true);
    },
  };
}

function resolveMaxAgentRounds(turnMeta: Record<string, unknown>): number {
  const custom = Number(turnMeta?.maxAgentRounds);
  if (Number.isFinite(custom) && custom > 0) return Math.floor(custom);
  return MAX_AGENT_ROUNDS;
}

function filterToolNames(allNames: string[], turnMeta: Record<string, unknown>): string[] {
  const allowed = turnMeta?.allowedToolNames;
  if (!Array.isArray(allowed) || !allowed.length) return allNames;
  const set = new Set(allowed.map((name) => String(name || "").trim()).filter(Boolean));
  return allNames.filter((name) => set.has(name));
}

function emitTurnStopLine(message: string): void {
  if (!isDebugLogEnabled()) return;
  if (message === "completed") return;
  process.stdout.write(dim(`▸ stopped: ${message}\n\n`));
}

async function logTurnStopReason(
  reason: string,
  extra?: { round?: number; continuationRecoveriesFired?: number }
): Promise<void> {
  await logDebugEvent("turn_stop_reason", {
    reason,
    round: extra?.round,
    continuationRecoveriesFired: extra?.continuationRecoveriesFired,
  });
}

const REASONING_ONLY_NO_VISIBLE_MSG =
  "The model returned internal reasoning tokens but no visible answer. Try again or choose a non-reasoning model.";

const MAX_TOOL_RESULT_INLINE_CHARS = Math.max(
  200,
  Number(process.env.WEBAGENT_MAX_TOOL_RESULT_INLINE_CHARS) || 48_000
);

let _cachedToolNames: string[] | null = null;
let _openAiToolsCacheKey: string | null = null;
let _openAiToolsCache: Awaited<ReturnType<typeof buildOpenAiToolDefinitions>> | null = null;

const STATIC_TOOL_DISCIPLINE =
  "\n\nTools: prefer native tool calls and respect each tool's schema (especially `required` fields). For files/URLs/shell/external/memory data, use tools first, then answer. Never copy terminal status lines (e.g. lines starting with ✓ or parenthetical summaries) into tool arguments—use real paths, URLs, and queries only. When the user asks for a sequence (for example, testing tools one by one), continue step-by-step without waiting for another user nudge: after you announce a step, immediately emit the corresponding tool call. No fake <tool_call> markup. Text fallback: <<<TOOL>>>{\"name\":\"read_file\",\"arguments\":{\"path\":\"relative/path\"}}<<<END>>>. Memory example: <<<TOOL>>>{\"name\":\"memory_save\",\"arguments\":{\"key\":\"user_timezone\",\"value\":\"America/New_York\"}}<<<END>>> — never call memory_save without both `key` and `value`. Tool results (compact JSON batches): each entry may contain `result` (inlined payload — use this first) or `result_ref` (spill under `memory/snapshots/` — read_file that exact path once; auto-unwrapped). Never list/grep/find_files under `memory/snapshots/` or `memory/runs/` for API data — `memory/runs/` is agent logs only. If spill files are stale/nested/missing, rerun the originating tool (`web_fetch`, `web_post`, etc.) or `session_search` for chat context — not run_shell head/tail on memory paths." +
  "\n\nExact text discipline: when the user asks for an exact string, token, filename, identifier, code symbol, JSON key, or command output, copy it byte-for-byte. Preserve underscores, hyphens, slashes, capitalization, digits, punctuation, and spacing. Never normalize or prettify exact tokens such as FOO_BAR_TOKEN." +
  "\n\nTopic discipline: when the user's latest message changes the subject or starts a new request, treat that as the active task. Do not continue earlier plans, files, or tools from older turns unless the user explicitly asks you to resume them." +
  "\n\nSkill discipline: skills are procedural knowledge, separate from memory facts. The **Tool capability index** lists every tool (active and deferred), including ## MCP sections for configured `mcp_*` servers. Follow the **Capability router** below for task routing; call `skill` (action=view) on the listed hub before detailed work. MCP: servers in `.webagent/mcp-servers.json` are discovered at startup; `mcp_*` tools are deferred—unlock via post-reload session unlock or `tool_activate` after `mcp_reload`. Memory layer boundaries are in **Memory layers**; saving or installing skills: `skill` (action=view) **`web-agent-skill`**. Prefer GitHub-flavored Markdown pipe tables in assistant-visible text." +
  "\n\nCron discipline: heartbeat jobs in `.webagent/cronjobs.json` run only on heartbeat ticks while the tab is open (`everyMinutes` + `lastRunAt`); there is no manual cron run tool. `cron_register` refresh reschedules—it does not execute the job unless a heartbeat tick is due at that moment. If the user wants work now, run the job step tools in this chat (or invoke the relevant skill)—never claim to \"run the cron manually\". Before explaining cron timing or where output goes, call `cron_list` or `skill` (action=view) **`heartbeat-cron`** and cite `outputDestination`, `nextEligibleAtMs`, and `schedulingNote` from tool output. Delivery: Silent (logs only), Web UI (`delivery: terminal`), Web UI + Telegram (`terminal` + `notifyChannel`), Email (`delivery: email` + `deliveryEmailTo`)." +
  "\n\nArchive discipline: `extract_archive` / `archive_list` are read-only. There is no `create_archive` tool. To bundle files into a `.zip`, use `run_python` with stdlib `zipfile`, write to `work/<slug>/` or `projects/<slug>/`, verify with `archive_list`, deliver with `artifact_present`. Do not invent `create_archive`, use shell `zip`, or substitute a `.txt` concat unless the user explicitly accepts non-zip delivery.";

export { invalidateSystemPromptCache } from "./system-prompt-cache.js";

function catalogSchemaFingerprint(catalog: Record<string, { inputSchema?: unknown } | undefined>) {
  return Object.keys(catalog)
    .sort()
    .map((name) => `${name}:${JSON.stringify(catalog[name]?.inputSchema ?? null)}`)
    .join("|");
}

function isSkillMutatingToolCall(toolName: string, args: Record<string, unknown>): boolean {
  const tname = String(toolName || "").trim();
  if (/^skill_(save|manage|bulk_save)$/.test(tname)) return true;
  if (tname !== "skill") return false;
  const action = String(args.action || "").trim().toLowerCase();
  return action === "bulk" || action === "manage";
}

export function invalidateToolNamesCache(): void {
  _cachedToolNames = null;
  _openAiToolsCacheKey = null;
  _openAiToolsCache = null;
  invalidateToolCapabilityIndexCache();
  void import("./llm/tool-schema-sanitizer.js").then((m) => m.invalidateSanitizedSchemaCache?.());
}

const sessionUnlockedTools = new Set<string>();

export function unlockSessionTools(names: Iterable<string>): void {
  for (const name of names) {
    const trimmed = String(name || "").trim();
    if (trimmed) sessionUnlockedTools.add(trimmed);
  }
}

/** Serialize terminal turns and inbound channel turns (Telegram, etc.). */
function createTurnMutex() {
  let tail = Promise.resolve();
  let busy = false;
  return {
    run(fn) {
      busy = true;
      const next = tail
        .then(() => Promise.resolve().then(fn))
        .finally(() => {
          busy = false;
        });
      tail = next.catch(() => {});
      return next;
    },
    isBusy() {
      return busy;
    },
  };
}

let sharedTurnMutex: ReturnType<typeof createTurnMutex> | null = null;

/** Process-wide mutex for agent turns (terminal, channels, background review). */
export function getSharedTurnMutex() {
  if (!sharedTurnMutex) sharedTurnMutex = createTurnMutex();
  return sharedTurnMutex;
}

async function persistCompletedRun(run) {
  await saveRun(run);
  const reflection = createReflectionFromRun(run);
  await saveReflection(reflection);
  const learning = derivePromotableLearning(run, reflection.failure_categories || {});
  if (learning) {
    await promoteLearning({
      category: learning.category,
      statement: learning.statement,
      confidence: learning.confidence,
      sourceRunId: run.id,
      evidence: {
        tool_calls: Array.isArray(run.tool_calls) ? run.tool_calls.length : 0,
        failures: Array.isArray(run.tool_results) ? run.tool_results.filter((item) => item?.error).length : 0,
      },
    });
  }
}

// Module-level handle to the currently running turn's AbortController, so
// `/stop` (or other interrupt sources) can cancel in-flight tools.
let currentTurnController: AbortController | null = null;

export function abortCurrentTurn(reason = "user_stopped") {
  const controller = currentTurnController;
  if (!controller) return false;
  try {
    controller.abort(reason);
  } catch {
    controller.abort();
  }
  return true;
}

/** Unblocks `turnAsk` races when `/stop` aborts the in-flight turn mid-prompt. */
export function subscribeActiveTurnAbort(callback: () => void) {
  const controller = currentTurnController;
  if (!controller) return () => {};
  if (controller.signal.aborted) {
    try {
      callback();
    } catch {
      /* ignore */
    }
    return () => {};
  }
  const onAbort = () => {
    try {
      callback();
    } catch {
      /* ignore */
    }
  };
  controller.signal.addEventListener("abort", onAbort, { once: true });
  return () => controller.signal.removeEventListener("abort", onAbort);
}

export async function agentTurn(
  messages: unknown[],
  cfg: Record<string, unknown>,
  turnMeta: Record<string, unknown> = {}
) {
  const turnRunId =
    typeof turnMeta.runId === "string" && turnMeta.runId.trim() ? turnMeta.runId : createRunId();
  const turnInputStr = typeof turnMeta.input === "string" ? turnMeta.input : "";
  const run: {
    id: string;
    goal: string;
    input: string;
    started_at: string;
    status: string;
    duration_ms: number;
    rounds: number;
    tool_calls: Array<{ name: string; arguments?: unknown }>;
    rejected_tool_calls: Array<{ name: string; reason: string }>;
    tool_results: Array<{ tool: string; status: string; error?: string }>;
    errors: string[];
    final_visible_assistant_text: string;
    completed_at?: string;
  } = {
    id: turnRunId,
    goal: turnInputStr,
    input: turnInputStr,
    started_at: new Date().toISOString(),
    status: "running",
    duration_ms: 0,
    rounds: 0,
    tool_calls: [],
    rejected_tool_calls: [],
    tool_results: [],
    errors: [],
    final_visible_assistant_text: "",
  };
  const runStartedAt = Date.now();
  if (!getCachedSystemPrompt()) {
    setCachedSystemPrompt((await loadSystemPrompt()) + STATIC_TOOL_DISCIPLINE);
  }
  const sys = getCachedSystemPrompt()!;
  if (!_cachedToolNames) _cachedToolNames = await getToolNamesAsync();
  const allToolNames = _cachedToolNames;
  const safeMessages = await sanitizeMessagesMissingSnapshotRefs(messages);
  type ChatTurnMsg = { role?: string; content?: unknown };
  const safeList = safeMessages as ChatTurnMsg[];
  const originalUserInput = String(
    turnInputStr ||
      [...safeList].reverse().find((message) => message.role === "user")?.content ||
      ""
  ).trim();
  await ensureDefaultToolPolicy();
  const toolPolicy: ToolPolicyConfig | null = await loadToolPolicy();
  const toolCatalog = await loadToolCatalog();
  const policyToolNames = resolvePolicyToolNames(allToolNames, toolPolicy, process.env);
  const indexPolicyNames = filterToolNames(policyToolNames, turnMeta);
  const filteredPolicyNames = focusToolNamesForIntent(indexPolicyNames, originalUserInput);
  const unlockedTools = new Set<string>(sessionUnlockedTools);
  // Pre-unlock deferred file-handling groups when the turn references a binary
  // file or media so the dedicated tool is active on the same turn instead of
  // forcing a tool_activate hop (attachments may live in content arrays, not the
  // input string): multimodal (image/audio/video/YouTube), archives (ZIP/TAR),
  // documents (PDF/DOCX). Without this the agent never sees extract_archive and
  // flails with run_python zipfile (JsProxy errors in Pyodide).
  const recentTurnContent = safeList
    .slice(-4)
    .map((message) =>
      typeof message?.content === "string" ? message.content : JSON.stringify(message?.content ?? "")
    )
    .join("\n");
  const fileSignalBlob = `${originalUserInput}\n${recentTurnContent}`;
  if (!turnMeta?.textOnly) {
    const groupsToSeed: string[] = [];
    if (inputSuggestsMultimodal(fileSignalBlob)) groupsToSeed.push("multimodal");
    if (inputSuggestsArchive(fileSignalBlob) || isSkillInstallIntent(originalUserInput)) {
      groupsToSeed.push("archives");
    }
    if (inputSuggestsDocument(fileSignalBlob)) groupsToSeed.push("documents");
    for (const group of groupsToSeed) {
      for (const name of TOOL_GROUPS[group] || []) {
        if (canUnlockTool(name, toolCatalog, allToolNames, toolPolicy, process.env)) unlockedTools.add(name);
      }
    }
  }
  let activeToolNames = resolveInitialActiveToolNames(
    filteredPolicyNames,
    toolCatalog,
    allToolNames,
    toolPolicy,
    process.env,
    unlockedTools
  );
  const memoryBlock = await buildMemoryContextBlock({ goal: originalUserInput });
  const skillsBlock = await buildSkillsContextBlock(activeToolNames);
  let toolIndexBlock = await resolveToolCapabilityIndexBlock({
    catalog: toolCatalog,
    policyToolNames: indexPolicyNames,
    activeToolNames,
  });
  let capabilityRouterBlock = await buildCapabilityRouterBlock(activeToolNames);
  const buildActiveCatalog = (names: string[]) =>
    Object.fromEntries(Object.entries(toolCatalog).filter(([name]) => names.includes(name)));
  const rebuildStreamTools = async (names: string[]) => {
    if (turnMeta?.textOnly === true) return [];
    return buildOpenAiToolDefinitions(buildActiveCatalog(names));
  };
  let streamTools = await rebuildStreamTools(activeToolNames);
  let streamToolsKey = `${activeToolNames.join(",")}::${catalogSchemaFingerprint(buildActiveCatalog(activeToolNames))}`;
  const planExecutionPrefix =
    !turnMeta?.textOnly && originalUserInput
      ? buildPlanExecutionContextPrefix(originalUserInput)
      : null;
  const continuationPrefix =
    !turnMeta?.textOnly && originalUserInput
      ? buildExecutionContinuationContextPrefix(originalUserInput)
      : null;
  const skillInstallPrefix =
    !turnMeta?.textOnly && originalUserInput
      ? buildSkillInstallContextPrefix(originalUserInput)
      : null;
  const apiCallPrefix =
    !turnMeta?.textOnly && originalUserInput
      ? buildApiCallContextPrefix(originalUserInput)
      : null;
  const composioSaasPrefix =
    !turnMeta?.textOnly && originalUserInput
      ? buildComposioSaasContextPrefix(originalUserInput)
      : null;
  const fileHandlingPrefix = !turnMeta?.textOnly
    ? buildFileHandlingContextPrefix(fileSignalBlob)
    : null;
  const refreshActiveToolState = async () => {
    activeToolNames = resolveInitialActiveToolNames(
      filteredPolicyNames,
      toolCatalog,
      allToolNames,
      toolPolicy,
      process.env,
      unlockedTools
    );
    const nextKey = `${activeToolNames.join(",")}::${catalogSchemaFingerprint(buildActiveCatalog(activeToolNames))}`;
    if (nextKey !== streamToolsKey) {
      streamToolsKey = nextKey;
      streamTools = await rebuildStreamTools(activeToolNames);
    }
    const activeState = turnCtx.services?.activeToolNamesState as { list?: string[] } | undefined;
    if (activeState) activeState.list = activeToolNames;
    const systemRow = conv[0] as ChatTurnMsg | undefined;
    if (systemRow?.role === "system") {
      const refreshedSkills = await buildSkillsContextBlock(activeToolNames);
      toolIndexBlock = await resolveToolCapabilityIndexBlock({
        catalog: toolCatalog,
        policyToolNames: indexPolicyNames,
        activeToolNames,
      });
      capabilityRouterBlock = await buildCapabilityRouterBlock(activeToolNames);
      systemRow.content =
        sys +
        buildWorkspaceMapBlock() +
        memoryBlock +
        toolIndexBlock +
        capabilityRouterBlock +
        refreshedSkills +
        buildExecutionGuidanceBlock(cfg) +
        buildMemoryLayerGuidanceBlock(activeToolNames);
    }
  };

  const applyFindSkillsDeliveryLock = async () => {
    if (findSkillsDeliveryContinuations <= 0) return;
    if (!isFindSkillsModeUserMessage(originalUserInput)) return;
    const locked = activeToolNames.filter((n) => n !== "web_search" && n !== "web_fetch");
    if (locked.length === activeToolNames.length) return;
    activeToolNames = locked;
    streamToolsKey = `${activeToolNames.join(",")}::${catalogSchemaFingerprint(buildActiveCatalog(activeToolNames))}`;
    streamTools = await rebuildStreamTools(activeToolNames);
    const activeState = turnCtx.services?.activeToolNamesState as { list?: string[] } | undefined;
    if (activeState) activeState.list = activeToolNames;
  };

  const noteToolUnlocksFromResults = async (
    exec: Array<Record<string, unknown>>,
    calls: Array<{ name?: string; arguments?: unknown }>
  ) => {
    let changed = false;
    for (const item of exec) {
      if (item?.error) continue;
      const tname = String(item?.tool || "");
      const call = calls.find((row) => String(row?.name || "") === tname);
      if (tname === "tool_activate") {
        const activated = String((item.result as { activated?: string } | undefined)?.activated || "").trim();
        if (activated && canUnlockTool(activated, toolCatalog, allToolNames, toolPolicy, process.env)) {
          unlockedTools.add(activated);
          changed = true;
        }
        continue;
      }
      if (tname !== "skill") continue;
      const callAction = String(
        (call?.arguments as { action?: string })?.action ||
          (item.result as { action?: string } | undefined)?.action ||
          ""
      )
        .trim()
        .toLowerCase();
      if (callAction && callAction !== "view") continue;
      const result = item.result as { primary_tools?: string[]; slug?: string } | undefined;
      const fromResult = Array.isArray(result?.primary_tools) ? result.primary_tools : [];
      const slug = String(result?.slug || (call?.arguments as { name?: string })?.name || "").trim();
      const primaryTools = fromResult.length ? fromResult : (slug ? await resolveSkillPrimaryToolsForSlug(slug) : []);
      for (const toolName of primaryTools) {
        if (!canUnlockTool(toolName, toolCatalog, allToolNames, toolPolicy, process.env)) continue;
        if (!unlockedTools.has(toolName)) {
          unlockedTools.add(toolName);
          changed = true;
        }
      }
    }
    if (changed) await refreshActiveToolState();
  };

  const fullMessages = [
    {
      role: "system",
      content:
        sys +
        buildWorkspaceMapBlock() +
        memoryBlock +
        toolIndexBlock +
        capabilityRouterBlock +
        skillsBlock +
        buildExecutionGuidanceBlock(cfg) +
        buildMemoryLayerGuidanceBlock(activeToolNames),
    },
    ...safeList.filter((m) => m.role !== "system"),
  ];

  const turnController = new AbortController();
  currentTurnController = turnController;
  const turnCtx = createToolContext({
    sessionId: process.env.WEBAGENT_SESSION_ID || null,
    runId: run.id,
    cwd: WS,
    signal: turnController.signal,
    env: process.env,
    profile: {
      agentName: process.env.WEBAGENT_AGENT_NAME || process.env.WEBAGENT_PROFILE_NAME || null,
      userName: process.env.WEBAGENT_USER_NAME || null,
      providerId: (cfg.provider as string | undefined) ?? null,
      modelId: (cfg.model as string | undefined) ?? null,
    },
    services: {
      memory: memoryServices,
      activeToolNamesState: { list: activeToolNames },
      ...(turnMeta?.services ?? {}),
    },
    ask: typeof turnMeta?.ask === "function" ? turnMeta.ask : null,
    onTranscript: typeof turnMeta?.onTranscript === "function" ? turnMeta.onTranscript : null,
    skipTerminalOutput: turnMeta?.skipTerminalOutput === true,
    autoApprove:
      typeof turnMeta?.autoApprove === "boolean"
        ? turnMeta.autoApprove
        : String(process.env.WEBAGENT_AUTO_APPROVE_TOOLS || "").trim() === "1",
  } as CreateToolContextInput);

  let round = 0;
  let toolCallCountInTurn = 0;
  let executedToolsInTurn = false;
  let webSearchCountInTurn = 0;
  let webFetchCountInTurn = 0;
  let webDiscoveryCallsInTurn = 0;
  const researchIntent = isResearchIntent(originalUserInput);
  const successfulToolKeysInTurn = new Set<string>();
  let conv = [...fullMessages];

  const complexityEstimate = estimateTaskComplexity(originalUserInput);
  const maxAgentRounds = resolveMaxAgentRounds(turnMeta);
  const quietTurn = turnMeta?.quiet === true;
  const skipTerminalOutput = turnMeta?.skipTerminalOutput === true;
  const mirrorTerminal = !quietTurn && !skipTerminalOutput;
  const skipBackgroundReview = turnMeta?.skipBackgroundReview === true || turnMeta?.backgroundReview === true;

  if (!turnMeta?.backgroundReview && !turnMeta?.textOnly) {
    noteUserTurnStarted();
  }
  let injectedPlanningGate = false;
  let usedTodoWriteInTurn = false;
  let todosSeededAtTurnStart = false;
  const multistepPattern = detectMultistepTaskPattern(originalUserInput);
  const suggestedTodos = buildSuggestedTodoChecklist(originalUserInput);
  const shouldInjectGate =
    !turnMeta?.textOnly &&
    originalUserInput &&
    !isPlanningModePrompt(originalUserInput) &&
    !isExecutionContinuationIntent(originalUserInput) &&
    (complexityEstimate.tier === "todo" ||
      complexityEstimate.tier === "plan" ||
      multistepPattern === "research_write_publish");

  if (
    !turnMeta?.textOnly &&
    !turnMeta?.backgroundReview &&
    multistepPattern === "research_write_publish" &&
    suggestedTodos?.length
  ) {
    try {
      const { todoWriteTool } = await import("./tools/remote-tools.js");
      await todoWriteTool({ todos: suggestedTodos }, turnCtx);
      usedTodoWriteInTurn = true;
      todosSeededAtTurnStart = true;
      await logDebugEvent("turn_multistep_todo_seeded", {
        pattern: multistepPattern,
        count: suggestedTodos.length,
      });
    } catch (err) {
      await logDebugEvent("turn_multistep_todo_seed_failed", {
        error: errorMessage(err),
      });
    }
  }

  if (shouldInjectGate) {
    const hint = buildMultiStepGateHint(originalUserInput, { preSeeded: usedTodoWriteInTurn });
    for (let i = conv.length - 1; i >= 0; i--) {
      const row = conv[i] as ChatTurnMsg;
      if (row.role === "user") {
        const cur = typeof row.content === "string" ? row.content : "";
        conv[i] = { ...row, content: `${hint}\n\n${cur}` };
        injectedPlanningGate = true;
        break;
      }
    }
  }
  const usedPlanningGateForSkill =
    injectedPlanningGate || isPlanningModePrompt(originalUserInput);
  if (planExecutionPrefix) {
    conv.push({ role: "user", content: planExecutionPrefix });
  }
  if (continuationPrefix) {
    conv.push({ role: "user", content: continuationPrefix });
  }
  if (skillInstallPrefix && skillInstallPrefix !== continuationPrefix) {
    conv.push({ role: "user", content: skillInstallPrefix });
  }
  if (apiCallPrefix && apiCallPrefix !== skillInstallPrefix && apiCallPrefix !== continuationPrefix) {
    conv.push({ role: "user", content: apiCallPrefix });
  }
  if (
    composioSaasPrefix &&
    composioSaasPrefix !== apiCallPrefix &&
    composioSaasPrefix !== skillInstallPrefix &&
    composioSaasPrefix !== continuationPrefix
  ) {
    conv.push({ role: "user", content: composioSaasPrefix });
  }
  if (fileHandlingPrefix) {
    conv.push({ role: "user", content: fileHandlingPrefix });
  }

  let skillMutatingCalledInTurn = false;
  let intermediateAckContinuations = 0;
  let emptyAfterToolsContinuations = 0;
  let emptyResponseContinuations = 0;
  let truncationContinuations = 0;
  let postToolStallContinuations = 0;
  let snapshotReadStallContinuations = 0;
  let apiDiscoveryStallContinuations = 0;
  let findSkillsDeliveryContinuations = 0;
  let preToolPromiseContinuations = 0;
  let cronVerifyContinuations = 0;
  let incompleteTodoContinuations = 0;
  let incompletePublishContinuations = 0;
  let contentShareContinuations = 0;
  let unparsedMarkupContinuations = 0;
  let thinkingPrefillContinuations = 0;
  let todoGateContinuations = 0;
  let allToolsRejectedContinuations = 0;
  let activeReasoningPreview: ReturnType<typeof createReasoningPreviewController> | null = null;
  const pendingCronRegisterIds = new Set<string>();
  let continuationRecoveriesFired = 0;
  let skillInstallPivotNudgeFired = false;
  const skillInstallIntent =
    isSkillInstallIntent(originalUserInput) || !!continuationPrefix || !!skillInstallPrefix;

  const agentName = process.env.WEBAGENT_AGENT_NAME || process.env.WEBAGENT_PROFILE_NAME || "Agent";
  let turnHeaderPrinted = false;
  const toolGuardrails = new ToolCallGuardrailController(readToolLoopGuardrailConfig());
  let lastToolExecutions: Array<Record<string, unknown>> = [];
  let midTurnPruneWarned = false;
  let midTurnCompacted = false;
  try {
    while (round < maxAgentRounds) {
      if (turnController.signal.aborted) {
        run.errors.push("turn aborted");
        await logTurnStopReason("turn_aborted", { round, continuationRecoveriesFired });
        break;
      }
      round++;
      const roundStartedAt = Date.now();
      await applyFindSkillsDeliveryLock();
      const convCharsBefore = conv.reduce((n, m) => n + String(m?.content || "").length, 0);
      const estTokensBefore = estimateMessagesTokens(conv);
      const midPrune = pruneConversationForMidTurn(conv, cfg);
      if (midPrune.changed) {
        conv = midPrune.messages;
        await logDebugEvent("turn_mid_context_prune", {
          round,
          reason: midPrune.reason,
          beforeTokens: midPrune.beforeTokens,
          afterTokens: midPrune.afterTokens,
          convCharLen: conv.reduce((n, m) => n + String(m?.content || "").length, 0),
        });
      } else if (!midTurnPruneWarned && estTokensBefore > Math.floor((cfg.contextWindowTokens ?? 128_000) * 0.7)) {
        midTurnPruneWarned = true;
        await logDebugEvent("turn_context_pressure", {
          round,
          estimatedPromptTokens: estTokensBefore + estimateToolSchemaTokens(streamTools),
          convCharLen: convCharsBefore,
        });
      }
      if (
        !midTurnCompacted &&
        !turnMeta?.textOnly &&
        estimateMessagesTokens(conv) >= getCompactionThresholdTokens(cfg)
      ) {
        const compacted = await maybeCompactHistory(conv, cfg);
        if (compacted.changed) {
          conv = compacted.messages;
          midTurnCompacted = true;
          await logDebugEvent("turn_mid_context_compaction", {
            round,
            beforeTokens: compacted.beforeTokens,
            afterTokens: compacted.afterTokens,
            reason: compacted.reason,
          });
        }
      }
      emitContextUpdate({
        modelId: cfg.model || null,
        contextWindowTokens: cfg.contextWindowTokens ?? null,
        estimatedPromptTokens:
          estimateMessagesTokens(conv) + estimateToolSchemaTokens(streamTools),
      });
      const accChunks: string[] = [];
      let streamedVisible = "";
      let liveMirrorStarted = false;
      activeReasoningPreview = createReasoningPreviewController({
        turnMeta,
        mirrorTerminal,
        round,
        enabled: reasoningPreviewEnabled() && reasoningPreviewSupportedForModel(cfg),
      });
      const streamWriter = createToolAwareStreamWriter((chunk) => {
        if (!chunk) return;
        streamedVisible += chunk;
        if (!mirrorTerminal || quietTurn) return;
        if (!liveMirrorStarted) {
          liveMirrorStarted = true;
          if (!turnHeaderPrinted) {
            turnHeaderPrinted = true;
            process.stdout.write(`${bold(cyan(agentName))}\n`);
          } else if (round > 1) {
            process.stdout.write("\n");
          }
        }
        process.stdout.write(chunk);
      });
      const onDelta = (c) => {
        if (String(c || "").trim()) activeReasoningPreview?.clear();
        accChunks.push(c);
        streamWriter.push(c);
      };
      let streamResult;
      let streamAborted = false;
      try {
        streamResult = await streamOpenAI(sanitizeMessagesForLlm(conv), cfg, onDelta, streamTools, {
          signal: turnController.signal,
          onReasoningDelta: activeReasoningPreview.onReasoningDelta,
        });
      } catch (error) {
        if (!turnController.signal.aborted) throw error;
        streamAborted = true;
        run.errors.push("turn aborted");
        await logDebugEvent("turn_stream_aborted", {
          round,
          error: errorMessage(error),
        });
      }
      if (streamAborted) {
        activeReasoningPreview?.clear();
        await logTurnStopReason("stream_aborted", { round, continuationRecoveriesFired });
        emitTurnStopLine("stream_aborted");
        break;
      }
      streamWriter.flush();
      const combined = streamResult?.text || accChunks.join("");
      const clarifyParsed = extractClarifyMarkers(combined);
      for (const block of clarifyParsed.blocks) {
        if (mirrorTerminal) process.stdout.write(block);
      }
      const clarifyEmitted = clarifyParsed.blocks.length > 0;
      const bodyForTools = clarifyParsed.visible;
      const nativeStreamTools = streamResult?.toolCalls || [];
      const markerParsed = extractMarkerTools(bodyForTools);
      const longcatParsed = extractLongcatToolCallPayloads(markerParsed.visible);
      const toolCallTagParsed = extractToolCallTagPayloads(longcatParsed.visible);
      const functionXmlParsed = extractFunctionXmlToolCallPayloads(toolCallTagParsed.visible);
      const dsmlParsed = extractDsmlToolCallPayloads(functionXmlParsed.visible);
      const nativeOrMarkerCount =
        nativeStreamTools.length +
        markerParsed.tools.length +
        longcatParsed.tools.length +
        toolCallTagParsed.tools.length +
        functionXmlParsed.tools.length +
        dsmlParsed.tools.length;
      const jsonFallbackParsed =
        nativeOrMarkerCount === 0
          ? extractJsonToolCallPayloads(dsmlParsed.visible, activeToolNames)
          : { tools: [], visible: dsmlParsed.visible };
      const jsonFallbackCalls = jsonFallbackParsed.tools;
      const looseCallParsed =
        nativeOrMarkerCount === 0 && jsonFallbackCalls.length === 0
          ? extractLooseCallToolLines(jsonFallbackParsed.visible, activeToolNames)
          : { tools: [], visible: jsonFallbackParsed.visible };
      const plainCommandParsed =
        nativeOrMarkerCount === 0 &&
        jsonFallbackCalls.length === 0 &&
        looseCallParsed.tools.length === 0
          ? extractPlainToolCommandLines(looseCallParsed.visible, activeToolNames)
          : { tools: [], visible: looseCallParsed.visible };
      const rawToolCalls = [
        ...nativeStreamTools,
        ...markerParsed.tools,
        ...longcatParsed.tools,
        ...toolCallTagParsed.tools,
        ...functionXmlParsed.tools,
        ...dsmlParsed.tools,
        ...jsonFallbackCalls,
        ...looseCallParsed.tools,
        ...plainCommandParsed.tools,
      ];
      const visibleSource = plainCommandParsed.visible;
      if (nativeStreamTools.length > 0 || rawToolCalls.length > 0) {
        activeReasoningPreview?.clear();
      }
      let { normalized: tools, rejected } = normalizeToolCalls(rawToolCalls, activeToolNames);
      if (clarifyEmitted) tools = [];
      const duplicateSuccessfulTools: typeof tools = [];
      tools = tools.filter((tool) => {
        const key = toolExecutionKey(tool);
        if (!successfulToolKeysInTurn.has(key)) return true;
        duplicateSuccessfulTools.push(tool);
        return false;
      });
      await logDebugEvent("turn_tool_parse", {
        round,
        rawToolCalls: rawToolCalls.length,
        normalizedToolCalls: tools.length,
        rejectedToolCalls: rejected.length,
        rejectedReasons: rejected.map((entry) => entry.reason),
        skippedAlreadySuccessfulToolCalls: duplicateSuccessfulTools.length,
      });
      const rawVisible = visibleSource.trim() ? visibleSource : streamedVisible;
      let visible = sanitizeAssistantVisibleText(rawVisible, activeToolNames);
      visible = normalizeLatexInlineSymbols(repairExactResponseText(originalUserInput, visible));
      const reasoningOnlyNoVisible =
        !visible.trim() && !!streamResult?.sawReasoning && !tools.length;
      if (visible.trim()) thinkingPrefillContinuations = 0;
      if ((visible.trim() || clarifyEmitted) && !quietTurn) {
        run.final_visible_assistant_text = visible;
        const rendered = visible.trim() ? renderMarkdownToAnsi(visible) : "";
        let branchBelowName = false;
        if (!turnHeaderPrinted) {
          branchBelowName = true;
          turnHeaderPrinted = true;
          if (mirrorTerminal) {
            if (round > 1) process.stdout.write("\n");
            process.stdout.write(`${bold(cyan(agentName))}\n`);
          }
        } else if (mirrorTerminal && round > 1) {
          process.stdout.write("\n");
        }
        if (rendered) {
          const block = prefixBlock(rendered, branchBelowName);
          if (mirrorTerminal) {
            if (liveMirrorStarted) {
              const gap = liveMirrorVisibleGap(streamedVisible, visible);
              if (gap) process.stdout.write(gap);
              process.stdout.write("\n\n");
            } else {
              process.stdout.write(`${block}\n\n`);
            }
          }
          await emitTranscriptEvent(
            turnMeta,
            createAssistantTranscriptEvent({
              round,
              agentName,
              text: visible,
              branchBelowName,
              renderedText: block,
            }),
            { round, visiblePreview: visible.slice(0, 200) }
          );
          await logDebugEvent("assistant_visible_output", {
            round,
            agentName,
            visibleText: visible,
            renderedAnsi: rendered,
          });
        } else if (clarifyEmitted && mirrorTerminal) {
          process.stdout.write(
            `${prefixBlock(dim("Choose an option in the panel above the input."), branchBelowName)}\n\n`
          );
        }
      }
      if (visible.trim() || tools.length > 0) {
        popTrailingInternalScaffolding(conv);
      }
      conv.push({ role: "assistant", content: visible });

      if (clarifyEmitted) {
        await logDebugEvent("turn_clarify_offer", {
          round,
          blockCount: clarifyParsed.blocks.length,
        });
        await logTurnStopReason("clarify_offer", { round, continuationRecoveriesFired });
        emitTurnStopLine("clarify_offer");
        break;
      }

      if (rejected.length > 0) {
        for (const entry of rejected) {
          const call = entry.call as { name?: string } | undefined;
          const rejectedName = String(call?.name || "unknown").trim() || "unknown";
          run.rejected_tool_calls.push({
            name: rejectedName,
            reason: entry.reason,
          });
          await recordToolFailure(rejectedName).catch(() => {});
        }
        if (mirrorTerminal) {
          process.stdout.write(
            dim(
              `▸ skipped ${rejected.length} invalid tool call(s): ${rejected
                .map((r) => r.reason)
                .join(", ")}\n`
            )
          );
        }
        await emitTranscriptEvent(
          turnMeta,
          createSystemLineTranscriptEvent({
            round,
            text: formatSkippedToolsTranscript(rejected),
          }),
          { round }
        );

        // All calls were rejected (unknown tool names from imported skills on other
        // platforms — e.g. str_replace_editor, computer, ReadFile). Inject a recovery
        // nudge so the model retries with the correct built-in tool names instead of
        // stopping with post_tool_no_continue.
        const allUnknown = tools.length === 0 && rejected.every((r) => r.reason === "unknown_tool");
        const findSkillsMode = isFindSkillsModeUserMessage(originalUserInput);
        const maxAllToolsRejected = findSkillsMode ? 5 : 2;
        if (allUnknown && allToolsRejectedContinuations < maxAllToolsRejected) {
          allToolsRejectedContinuations++;
          continuationRecoveriesFired++;
          const rejectedNames = rejected.map((r) => {
            const c = r.call as { name?: string } | undefined;
            return String(c?.name || "unknown").trim();
          });
          if (conv.length && (conv[conv.length - 1] as ChatTurnMsg).role === "assistant") {
            conv.pop();
          }
          conv.push(buildSyntheticEmptyAssistantMessage());
          conv.push({
            role: "user",
            content: buildContinuationNudge("all_tools_rejected", {
              rejectedToolNames: rejectedNames,
              findSkillsMode,
            }),
          });
          await logDebugEvent("turn_all_tools_rejected_continuation", {
            round,
            count: allToolsRejectedContinuations,
            rejectedNames,
          });
          continue;
        }
      }

      if (!tools.length) {
        if (
          shouldContinueIntermediateAck(
            originalUserInput,
            visible,
            conv,
            executedToolsInTurn,
            intermediateAckContinuations
          )
        ) {
          intermediateAckContinuations++;
          continuationRecoveriesFired++;
          conv.pop();
          conv.push({ role: "assistant", content: visible });
          conv.push({ role: "user", content: buildContinuationNudge("intermediate_ack") });
          await logDebugEvent("turn_intermediate_ack_continuation", {
            round,
            count: intermediateAckContinuations,
            visiblePreview: String(visible || "").slice(0, 200),
          });
          continue;
        }
        if (
          shouldContinueEmptyAfterTools(visible, executedToolsInTurn, emptyAfterToolsContinuations)
        ) {
          emptyAfterToolsContinuations++;
          continuationRecoveriesFired++;
          if (conv.length && (conv[conv.length - 1] as ChatTurnMsg).role === "assistant") {
            conv.pop();
          }
          conv.push(buildSyntheticEmptyAssistantMessage());
          conv.push(buildEmptyRecoveryUserMessage());
          await logDebugEvent("turn_empty_after_tools_continuation", {
            round,
            count: emptyAfterToolsContinuations,
          });
          continue;
        }
        if (
          shouldContinueThinkingPrefill(
            visible,
            !!streamResult?.sawReasoning,
            tools.length,
            thinkingPrefillContinuations
          )
        ) {
          thinkingPrefillContinuations++;
          continuationRecoveriesFired++;
          if (conv.length && (conv[conv.length - 1] as ChatTurnMsg).role === "assistant") {
            conv.pop();
          }
          conv.push(buildThinkingPrefillAssistantMessage());
          await logDebugEvent("turn_thinking_prefill_continuation", {
            round,
            count: thinkingPrefillContinuations,
          });
          continue;
        }
        if (shouldContinueEmptyResponse(visible, emptyResponseContinuations)) {
          emptyResponseContinuations++;
          continuationRecoveriesFired++;
          if (conv.length && (conv[conv.length - 1] as ChatTurnMsg).role === "assistant") {
            conv.pop();
          }
          conv.push(buildSyntheticEmptyAssistantMessage());
          conv.push(buildEmptyResponseRecoveryUserMessage());
          await logDebugEvent("turn_empty_response_continuation", {
            round,
            count: emptyResponseContinuations,
          });
          continue;
        }
        if (
          shouldContinueUnparsedToolMarkup(combined, tools.length, unparsedMarkupContinuations)
        ) {
          unparsedMarkupContinuations++;
          continuationRecoveriesFired++;
          conv.push({
            role: "user",
            content: buildContinuationNudge("unparsed_tool_markup"),
          });
          await logDebugEvent("turn_unparsed_tool_markup_continuation", {
            round,
            count: unparsedMarkupContinuations,
          });
          continue;
        }
        if (shouldContinueTruncation(streamResult?.finishReason, truncationContinuations)) {
          truncationContinuations++;
          continuationRecoveriesFired++;
          conv.push({ role: "user", content: buildContinuationNudge("truncation") });
          await logDebugEvent("turn_truncation_continuation", {
            round,
            count: truncationContinuations,
            finishReason: streamResult?.finishReason,
          });
          continue;
        }
        if (
          shouldContinueSnapshotReadStall(
            visible,
            executedToolsInTurn,
            lastToolExecutions,
            snapshotReadStallContinuations
          )
        ) {
          snapshotReadStallContinuations++;
          continuationRecoveriesFired++;
          conv.push({ role: "user", content: buildContinuationNudge("snapshot_read_stall") });
          await logDebugEvent("turn_snapshot_read_stall_continuation", {
            round,
            count: snapshotReadStallContinuations,
            visiblePreview: String(visible || "").slice(0, 200),
          });
          continue;
        }
        if (
          shouldContinueContentShareDeliverable(
            originalUserInput,
            run.tool_calls,
            executedToolsInTurn,
            visible,
            contentShareContinuations,
            lastToolExecutions
          )
        ) {
          contentShareContinuations++;
          continuationRecoveriesFired++;
          conv.push({
            role: "user",
            content: buildContentShareContinuationNudge(contentShareContinuations, lastToolExecutions),
          });
          await logDebugEvent("turn_content_share_continuation", {
            round,
            count: contentShareContinuations,
            visiblePreview: String(visible || "").slice(0, 200),
          });
          continue;
        }
        if (shouldContinuePostToolStall(visible, executedToolsInTurn, postToolStallContinuations)) {
          postToolStallContinuations++;
          continuationRecoveriesFired++;
          conv.push({
            role: "user",
            content: buildContinuationNudge("post_tool_stall", {
              falseManualCron: looksLikeFalseManualCronPromise(visible),
              continuationCount: postToolStallContinuations + 1,
            }),
          });
          await logDebugEvent("turn_post_tool_stall_continuation", {
            round,
            count: postToolStallContinuations,
            visiblePreview: String(visible || "").slice(0, 200),
          });
          continue;
        }
        if (
          shouldContinueApiDiscoveryStall(
            originalUserInput,
            visible,
            executedToolsInTurn,
            lastToolExecutions,
            apiDiscoveryStallContinuations
          )
        ) {
          apiDiscoveryStallContinuations++;
          continuationRecoveriesFired++;
          conv.push({ role: "user", content: buildContinuationNudge("api_discovery_stall") });
          await logDebugEvent("turn_api_discovery_stall_continuation", {
            round,
            count: apiDiscoveryStallContinuations,
            visiblePreview: String(visible || "").slice(0, 200),
          });
          continue;
        }
        if (
          shouldContinueFindSkillsDelivery(
            originalUserInput,
            visible,
            executedToolsInTurn,
            webDiscoveryCallsInTurn,
            findSkillsDeliveryContinuations
          )
        ) {
          findSkillsDeliveryContinuations++;
          continuationRecoveriesFired++;
          conv.push({ role: "user", content: buildContinuationNudge("find_skills_delivery") });
          await applyFindSkillsDeliveryLock();
          await logDebugEvent("turn_find_skills_delivery_continuation", {
            round,
            count: findSkillsDeliveryContinuations,
            visiblePreview: String(visible || "").slice(0, 200),
          });
          continue;
        }
        if (
          shouldContinuePreToolPromiseStall(
            visible,
            conv,
            executedToolsInTurn,
            preToolPromiseContinuations
          )
        ) {
          preToolPromiseContinuations++;
          continuationRecoveriesFired++;
          conv.push({
            role: "user",
            content: buildContinuationNudge("pre_tool_promise", {
              continuationCount: preToolPromiseContinuations + 1,
            }),
          });
          await logDebugEvent("turn_pre_tool_promise_continuation", {
            round,
            count: preToolPromiseContinuations,
            visiblePreview: String(visible || "").slice(0, 200),
          });
          continue;
        }
        if (shouldContinueCronVerification(pendingCronRegisterIds, cronVerifyContinuations)) {
          cronVerifyContinuations++;
          continuationRecoveriesFired++;
          conv.push({
            role: "user",
            content: buildContinuationNudge("cron_verify", {
              pendingCronIds: [...pendingCronRegisterIds],
            }),
          });
          await logDebugEvent("turn_cron_verify_continuation", {
            round,
            count: cronVerifyContinuations,
            pendingCronIds: [...pendingCronRegisterIds],
          });
          continue;
        }
        const incompleteTodoGate = await shouldContinueIncompleteTodosAsync(
          originalUserInput,
          executedToolsInTurn,
          incompleteTodoContinuations,
          visible,
          { todosSeededAtTurnStart, usedTodoWriteInTurn }
        );
        if (incompleteTodoGate.continue) {
          incompleteTodoContinuations++;
          continuationRecoveriesFired++;
          conv.push({
            role: "user",
            content: buildContinuationNudge("incomplete_todos", {
              openTodos: incompleteTodoGate.stats.open,
              totalTodos: incompleteTodoGate.stats.total,
            }),
          });
          await logDebugEvent("turn_incomplete_todos_continuation", {
            round,
            count: incompleteTodoContinuations,
            open: incompleteTodoGate.stats.open,
            total: incompleteTodoGate.stats.total,
          });
          continue;
        }
        if (
          shouldContinueIncompletePublishDeliverable(
            originalUserInput,
            run.tool_calls,
            executedToolsInTurn,
            visible,
            incompletePublishContinuations
          )
        ) {
          incompletePublishContinuations++;
          continuationRecoveriesFired++;
          conv.push({
            role: "user",
            content: buildContinuationNudge("incomplete_publish"),
          });
          await logDebugEvent("turn_incomplete_publish_continuation", {
            round,
            count: incompletePublishContinuations,
            toolCalls: run.tool_calls.length,
          });
          continue;
        }
        if (
          shouldApplyContentShareFallback(
            originalUserInput,
            executedToolsInTurn,
            contentShareContinuations,
            visible,
            lastToolExecutions
          )
        ) {
          const fallbackVisible = buildContentShareFallbackVisible(lastToolExecutions);
          if (fallbackVisible) {
            visible = fallbackVisible;
            run.final_visible_assistant_text = fallbackVisible;
            if (conv.length && (conv[conv.length - 1] as ChatTurnMsg).role === "assistant") {
              conv[conv.length - 1] = { role: "assistant", content: fallbackVisible };
            }
            if (!quietTurn && fallbackVisible.trim() && mirrorTerminal) {
              if (!turnHeaderPrinted) {
                process.stdout.write(`${bold(cyan(agentName))}\n`);
                turnHeaderPrinted = true;
              } else {
                process.stdout.write("\n");
              }
              process.stdout.write(`${prefixBlock(renderMarkdownToAnsi(fallbackVisible), false)}\n\n`);
            }
            await emitTranscriptEvent(
              turnMeta,
              createAssistantTranscriptEvent({
                round,
                agentName,
                text: fallbackVisible,
                branchBelowName: false,
              }),
              { round, visiblePreview: fallbackVisible.slice(0, 200) }
            );
            await logDebugEvent("turn_content_share_fallback", {
              round,
              contentShareContinuations,
            });
            await logTurnStopReason("completed", { round, continuationRecoveriesFired });
            emitTurnStopLine("completed");
            break;
          }
        }
        let stopReason = resolveTurnStopReason(visible, executedToolsInTurn);
        const deliveredVisible = String(run.final_visible_assistant_text || "").trim();
        const reasoningStopEligible =
          (stopReason === "no_tools_no_continue" || stopReason === "post_tool_no_continue") &&
          reasoningOnlyNoVisible &&
          thinkingPrefillContinuations >= MAX_THINKING_PREFILL_CONTINUATIONS;
        if (reasoningStopEligible) {
          if (deliveredVisible && deliveredVisible !== REASONING_ONLY_NO_VISIBLE_MSG) {
            stopReason = "completed";
            if (
              conv.length &&
              (conv[conv.length - 1] as ChatTurnMsg).role === "assistant" &&
              !String(visible || "").trim()
            ) {
              conv[conv.length - 1] = { role: "assistant", content: deliveredVisible };
            }
          } else {
            stopReason = "reasoning_only_no_visible";
            visible = REASONING_ONLY_NO_VISIBLE_MSG;
            run.final_visible_assistant_text = visible;
            if (conv.length && (conv[conv.length - 1] as ChatTurnMsg).role === "assistant") {
              conv[conv.length - 1] = { role: "assistant", content: visible };
            }
            if (!quietTurn && visible.trim()) {
              if (mirrorTerminal) {
                if (!turnHeaderPrinted) {
                  process.stdout.write(`${bold(cyan(agentName))}\n`);
                  turnHeaderPrinted = true;
                } else {
                  process.stdout.write("\n");
                }
                const rendered = renderMarkdownToAnsi(visible);
                process.stdout.write(`${prefixBlock(rendered, false)}\n\n`);
              }
            }
          }
        }
        await logDebugEvent("turn_completed", {
          round,
          durationMs: Date.now() - roundStartedAt,
          continued: false,
          stopReason,
          continuationRecoveriesFired,
          reasoningOnlyNoVisible,
        });
        await logTurnStopReason(stopReason, { round, continuationRecoveriesFired });
        emitTurnStopLine(stopReason);
        break;
      }

      if (turnController.signal.aborted) {
        activeReasoningPreview?.clear();
        run.errors.push("turn aborted");
        await logDebugEvent("turn_aborted_before_tools", { round, toolCount: tools.length });
        await logTurnStopReason("turn_aborted_before_tools", { round, continuationRecoveriesFired });
        break;
      }

      if (
        injectedPlanningGate &&
        !usedTodoWriteInTurn &&
        tools.length > 0 &&
        todoGateContinuations < MAX_TODO_GATE_CONTINUATIONS &&
        !tools.every((t) => String(t.name || "") === "todo_write")
      ) {
        todoGateContinuations++;
        continuationRecoveriesFired++;
        if (conv.length && (conv[conv.length - 1] as ChatTurnMsg).role === "assistant") {
          conv.pop();
        }
        conv.push(buildSyntheticEmptyAssistantMessage());
        conv.push({
          role: "user",
          content:
            buildMultiStepGateHint(originalUserInput) +
            " Do not call web_search, web_fetch, write_file, or other tools until todo_write succeeds.",
        });
        await logDebugEvent("turn_todo_gate_continuation", {
          round,
          count: todoGateContinuations,
          blockedTools: tools.map((t) => t.name),
        });
        continue;
      }

      const truncatedWritePartition = partitionToolsForTruncatedContentDeferral(
        streamResult?.finishReason,
        tools,
        truncationContinuations
      );
      const deferTruncatedWrites = truncatedWritePartition.defer.length > 0;
      if (deferTruncatedWrites) {
        truncationContinuations++;
        continuationRecoveriesFired++;
      }
      const deferredToolKeys = new Set(
        truncatedWritePartition.defer.map((tool) => toolExecutionKey(tool))
      );

      const runnableTools: typeof tools = [];
      const exec: Array<Record<string, unknown>> = [];
      let guardrailHalt = false;
      const deferMessage = truncatedWriteDeferMessage();

      activeReasoningPreview?.clear();

      for (const tool of tools) {
        if (deferTruncatedWrites && deferredToolKeys.has(toolExecutionKey(tool))) {
          exec.push({
            tool: tool.name,
            error: deferMessage,
            result: JSON.stringify({ error: deferMessage, deferred: true, reason: "truncated_content" }),
          });
          await logDebugEvent("turn_truncated_write_deferred", {
            round,
            count: truncationContinuations,
            finishReason: streamResult?.finishReason,
            tool: tool.name,
          });
          if (mirrorTerminal) {
            process.stdout.write(dim(`▸ deferred ${tool.name}: output token limit truncated arguments\n`));
          }
          continue;
        }
        const args =
          tool.arguments && typeof tool.arguments === "object" && !Array.isArray(tool.arguments)
            ? (tool.arguments as Record<string, unknown>)
            : {};
        const before = toolGuardrails.beforeCall(tool.name, args);
        if (before.action === "block") {
          exec.push({
            tool: tool.name,
            error: before.message,
            result: toolGuardrailSyntheticResult(before),
            guardrail: before.code,
          });
          await logDebugEvent("tool_guardrail_block", {
            round,
            tool: tool.name,
            code: before.code,
            count: before.count,
          });
          if (mirrorTerminal) {
            process.stdout.write(dim(`▸ tool guardrail blocked ${tool.name}: ${before.message}\n`));
          }
          continue;
        }
        runnableTools.push(tool);
        exec.push({ __pending: true, tool: tool.name });
      }

      const runResults =
        runnableTools.length > 0 ? await runTools(runnableTools, turnCtx, toolCatalog) : [];
      let resultIdx = 0;
      for (let i = 0; i < exec.length; i++) {
        if (!exec[i]?.__pending) continue;
        const tool = runnableTools[resultIdx];
        const result = runResults[resultIdx] ?? {
          tool: tool?.name ?? "unknown",
          error: "missing tool result",
        };
        resultIdx++;
        const args =
          tool.arguments && typeof tool.arguments === "object" && !Array.isArray(tool.arguments)
            ? (tool.arguments as Record<string, unknown>)
            : {};
        const failed = !!result.error;
        const after = toolGuardrails.afterCall(
          tool.name,
          args,
          executionResultText(result),
          failed
        );
        if (after.action === "warn" || after.action === "halt") {
          const guided = appendToolGuardrailGuidance(executionResultText(result), after);
          if (result.error != null) {
            result.error = guided;
          } else {
            result.result = guided;
          }
          if (mirrorTerminal) {
            process.stdout.write(dim(`▸ tool guardrail ${after.code} (${tool.name})\n`));
          }
          await logDebugEvent("tool_guardrail_warning", {
            round,
            tool: tool.name,
            code: after.code,
            count: after.count,
          });
        }
        if (after.action === "halt") {
          guardrailHalt = true;
        }
        exec[i] = result;
      }

      lastToolExecutions = exec;
      await noteToolUnlocksFromResults(exec, tools);
      if (exec.length > 0) {
        executedToolsInTurn = true;
        toolCallCountInTurn += exec.length;
      }
      if (exec.length > 0 && !turnMeta?.backgroundReview) noteToolIteration();
      for (let i = 0; i < tools.length; i++) {
        const tname = String(tools[i]?.name || "");
        const item = exec[i];
        if (tname === "web_search" || tname === "web_fetch") webDiscoveryCallsInTurn += 1;
        if (!item?.error) {
          successfulToolKeysInTurn.add(toolExecutionKey(tools[i]));
          const args =
            tools[i].arguments && typeof tools[i].arguments === "object" && !Array.isArray(tools[i].arguments)
              ? (tools[i].arguments as Record<string, unknown>)
              : {};
          if (tname === "web_search") webSearchCountInTurn += 1;
          if (tname === "web_fetch") webFetchCountInTurn += 1;
          if (tname === "todo_write") usedTodoWriteInTurn = true;
          if (isSkillMutatingToolCall(tname, args) && !turnMeta?.backgroundReview) {
            noteForegroundSkillWrite();
            skillMutatingCalledInTurn = true;
          }
          if (tname === "memory_save" && !turnMeta?.backgroundReview) noteForegroundMemoryWrite();
          if (tname === "cron_register") {
            const jobId = cronRegisterJobIdFromArgs(args);
            if (jobId) pendingCronRegisterIds.add(jobId);
          }
          if (tname === "cron_list") {
            const listedIds = cronJobIdsFromListResult(item?.result);
            for (const id of [...pendingCronRegisterIds]) {
              if (listedIds.has(id)) pendingCronRegisterIds.delete(id);
            }
          }
        }
      }
      run.tool_calls.push(
        ...tools.map((tool) => ({
          name: tool.name,
          arguments: tool.arguments,
        }))
      );
      const execForCompress = unwrapSnapshotReadFileExecutions(exec);
      const turnInlineBudget = createTurnInlineBudgetState();
      const snapshotRefs = await saveCompressedToolResults({
        runId: run.id,
        round,
        executions: execForCompress,
        inlineCharBudget: MAX_TOOL_RESULT_INLINE_CHARS,
        turnInlineBudget,
      });
      const summarized = summarizeToolExecutions(execForCompress, snapshotRefs);
      const mappedResults = summarized.map((row, index) => {
        const item = execForCompress[index];
        const base = {
          tool: String(row.tool ?? item?.tool ?? ""),
          status: row.status === "error" ? "error" : "ok",
          error: row.error != null ? String(row.error) : undefined,
        };
        if (row.result_ref) {
          return {
            ...base,
            result_ref: row.result_ref,
            summary: row.summary,
            ...(row.list_digest ? { list_digest: row.list_digest } : {}),
          };
        }
        return { ...base, result: item?.result };
      });
      run.tool_results.push(...mappedResults);
      if (typeof turnMeta?.onToolResults === "function") {
        try {
          turnMeta.onToolResults(mappedResults);
        } catch {
          /* ignore review callback errors */
        }
      }
      await logDebugEvent("turn_tool_results", {
        round,
        toolCount: tools.length,
        resultCount: exec.length,
        errors: exec.filter((item) => item?.error).length,
      });
      conv.push({
        role: "user",
        content: "Tool results (compact JSON):\n" + JSON.stringify(summarized),
      });
      if (guardrailHalt) {
        const reason = toolGuardrails.haltDecision?.message || "Tool loop guardrail halt";
        run.errors.push(reason);
        await logDebugEvent("tool_guardrail_halt_after_tools", { round, reason });
        await emitTranscriptEvent(
          turnMeta,
          createSystemLineTranscriptEvent({ round, text: reason }),
          { round }
        );
        await logTurnStopReason("tool_guardrail", { round, continuationRecoveriesFired });
        emitTurnStopLine("tool_guardrail");
        break;
      }
      if (
        researchIntent &&
        webFetchCountInTurn < MIN_RESEARCH_FETCHES &&
        tools.length > 0 &&
        tools.every((tool) => tool.name === "web_search")
      ) {
        conv.push({
          role: "user",
          content:
            "Research reminder: your last step was search-only. Run web_fetch on at least two URLs from those results (YouTube channel or video pages first) before concluding.",
        });
      }
      if (
        !skillInstallPivotNudgeFired &&
        skillInstallIntent &&
        skillBulkSaveAllUrlItemsFailed(exec) &&
        !webFetchTargetsRegistryUrl(tools, exec)
      ) {
        skillInstallPivotNudgeFired = true;
        conv.push({ role: "user", content: SKILL_INSTALL_PIVOT_NUDGE });
      }
      await logDebugEvent("turn_completed", {
        round,
        durationMs: Date.now() - roundStartedAt,
        continued: true,
      });
      if (turnController.signal.aborted) {
        run.errors.push("turn aborted");
        await logDebugEvent("turn_aborted_after_tools", { round, toolCount: tools.length });
        await logTurnStopReason("turn_aborted_after_tools", { round, continuationRecoveriesFired });
        break;
      }
    }
    await logDebugEvent("agent_turn_finished", {
      rounds: round,
      emittedMessages: conv.slice(fullMessages.length).length,
    });
    if (round >= maxAgentRounds && !turnController.signal.aborted) {
      run.errors.push(`agent round cap reached (${maxAgentRounds})`);
      await logTurnStopReason(`max_rounds (${maxAgentRounds})`, {
        round,
        continuationRecoveriesFired,
      });
      emitTurnStopLine(`max_rounds (${maxAgentRounds})`);
      await logDebugEvent("agent_turn_round_cap_reached", {
        rounds: round,
        maxRounds: maxAgentRounds,
      });
      if (!quietTurn && !turnMeta?.textOnly) {
        try {
          conv.push({
            role: "user",
            content:
              "[Round limit reached] Summarize progress, blockers, and the next concrete step briefly. Do not call tools.",
          });
          const graceStream = await streamOpenAI(
            sanitizeMessagesForLlm(conv),
            cfg,
            () => {},
            [],
            { signal: turnController.signal }
          );
          const graceVisible = sanitizeAssistantVisibleText(
            graceStream?.text || "",
            activeToolNames
          );
          if (graceVisible.trim()) {
            run.final_visible_assistant_text = graceVisible;
            conv.push({ role: "assistant", content: graceVisible });
            const rendered = renderMarkdownToAnsi(graceVisible);
            if (rendered && mirrorTerminal) {
              process.stdout.write(`${prefixBlock(rendered, false)}\n\n`);
            }
            await emitTranscriptEvent(
              turnMeta,
              createAssistantTranscriptEvent({
                round,
                agentName,
                text: graceVisible,
                branchBelowName: false,
              }),
              { round, visiblePreview: graceVisible.slice(0, 200) }
            );
          }
        } catch (graceError) {
          await logDebugEvent("turn_max_rounds_grace_failed", {
            error: errorMessage(graceError),
          });
        }
      }
    }
    run.status = turnController.signal.aborted ? "aborted" : "completed";
    run.rounds = round;
    run.duration_ms = Date.now() - runStartedAt;
    run.completed_at = new Date().toISOString();
    if (!turnMeta?.backgroundReview) {
      await persistCompletedRun(run);
    }
    if (!skipBackgroundReview && !turnMeta?.textOnly) {
      const reviewTrigger = evaluateBackgroundReviewTrigger({
        status: run.status,
        aborted: turnController.signal.aborted,
        executedToolsInTurn,
        skillMutatingCalled: skillMutatingCalledInTurn,
        usedTodoWrite: usedTodoWriteInTurn,
        usedPlanningGate: usedPlanningGateForSkill,
        estimatedStepsOverSix: complexityEstimate.estimatedSteps > 6,
        toolRoundCount: round,
        toolCallCount: toolCallCountInTurn,
        inputText: originalUserInput,
        finalVisibleText: run.final_visible_assistant_text,
        availableToolNames: allToolNames,
      });
      if (reviewTrigger.kind) {
        scheduleBackgroundReview({
          kind: reviewTrigger.kind,
          messagesSnapshot: conv,
          cfg,
          runId: run.id,
          onSummary:
            typeof turnMeta?.onSelfImprovementSummary === "function"
              ? (turnMeta.onSelfImprovementSummary as (summary: string) => void | Promise<void>)
              : undefined,
        });
      }
    }
    return dropTrailingEmptyResponseScaffolding(conv.slice(fullMessages.length));
  } catch (error) {
    run.status = "failed";
    run.rounds = round;
    run.duration_ms = Date.now() - runStartedAt;
    run.completed_at = new Date().toISOString();
    run.errors.push(errorMessage(error));
    await persistCompletedRun(run).catch(() => {});
    throw error;
  } finally {
    activeReasoningPreview?.clear();
    if (currentTurnController === turnController) currentTurnController = null;
  }
}
