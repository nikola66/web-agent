/**
 * Agent turn execution: main LLM loop with tool calls, streaming, and turn-judge continuation.
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
  createLoopGuardState,
  guardBeforeToolBatch,
  updateLoopGuardAfterResults,
} from "./tools/loop-guardrails.js";
import { createToolContext, type CreateToolContextInput } from "./tools/context.js";
import {
  emitContextUpdate,
} from "./identity/onboarding.js";
import {
  loadSystemPrompt,
} from "./state/persistence.js";
import {
  createToolAwareStreamWriter,
  estimateMessagesTokens,
  extractJsonToolCallPayloads,
  extractMarkerTools,
  extractPlainToolCommandLines,
  extractToolCallTagPayloads,
  normalizeToolCalls,
  sanitizeAssistantVisibleText,
  streamOpenAI,
} from "./llm/streaming.js";
import {
  bold,
  cyan,
  dim,
  prefixBlock,
  renderMarkdownToAnsi,
} from "./terminal-format.js";
import { logDebugEvent } from "./logging/debug-log.js";
import { createReflectionFromRun, derivePromotableLearning } from "./reflection.js";
import {
  estimateTaskComplexity,
  isPlanningModePrompt,
  repairExactResponseText,
  MIN_RESEARCH_FETCHES,
  MIN_RESEARCH_SEARCHES,
  resolveApprovedPlanExecutionGoal,
  shouldSuppressActionPlanAutoContinue,
} from "./turn-sequencing.js";
import { errorMessage } from "./utils.js";
import { WS } from "./constants.js";
import {
  createGoalLoopTranscriptEvent,
  createAssistantTranscriptEvent,
  createSystemLineTranscriptEvent,
  formatSkippedToolsTranscript,
} from "./transcript.js";
import { emitTranscriptEvent } from "./transcript-delivery.js";
import {
  emitLoopStopLine,
  resolveMaxAutoContinueNudges,
  shouldSuppressPostToolNudgeFromExecutions,
} from "./turn-budget.js";
import {
  fetchTurnJudgeDecisionForShadow,
  judgeTurnState,
  resolveTurnJudgeRuntimeFlags,
  type TurnJudgeDecision,
} from "./turn-judge-client.js";
import { buildGenericContinuationNudge, buildTurnJudgePayload } from "./turn-judge-payload.js";
import {
  summarizeToolExecutions,
  writeStdoutSmoothed,
  createRunId,
  toolExecutionKey,
  getPreviousUserMessageContent,
} from "./stream-output.js";
import { buildPlanModeUserPrompt } from "./planning-slash.js";

const MAX_AGENT_ROUNDS = Math.max(1, Number(typeof process !== "undefined" ? process.env?.WEBAGENT_MAX_AGENT_ROUNDS : undefined) || 64);
const MAX_PLAN_GOAL_CONTINUATIONS = 20;
const MAX_TOOL_RESULT_INLINE_CHARS = Math.max(
  200,
  Number(process.env.WEBAGENT_MAX_TOOL_RESULT_INLINE_CHARS) || 10_000
);

function emitTurnJudgeLine(decision: TurnJudgeDecision) {
  const pct = Math.round(decision.confidence * 100);
  const label = /label:(\w+)/i.exec(decision.reason)?.[1];
  const modelNote =
    label && decision.source === "fallback" && label.toUpperCase() !== decision.action.toUpperCase()
      ? ` · model=${label}`
      : "";
  process.stdout.write(
    dim(`▸ turn judge · ${decision.action} (${decision.source}, ${pct}%) — ${decision.reason}${modelNote}\n\n`)
  );
}

let _cachedSystemPrompt: string | null = null;
let _cachedToolNames: string[] | null = null;

export function invalidateSystemPromptCache(): void {
  _cachedSystemPrompt = null;
}

export function invalidateToolNamesCache(): void {
  _cachedToolNames = null;
}

/** Serialize terminal turns and inbound channel turns (Telegram, etc.). */
export function createTurnMutex() {
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
  if (!_cachedSystemPrompt) _cachedSystemPrompt = await loadSystemPrompt();
  const sys = _cachedSystemPrompt;
  const memoryBlock = await buildMemoryContextBlock();
  const skillsBlock = await buildSkillsContextBlock();
  const toolCatalog = await loadToolCatalog();
  const openAiTools = await buildOpenAiToolDefinitions(toolCatalog);
  const streamTools = turnMeta?.textOnly === true ? [] : openAiTools;
  if (!_cachedToolNames) _cachedToolNames = await getToolNamesAsync();
  const toolNames = _cachedToolNames;
  const safeMessages = await sanitizeMessagesMissingSnapshotRefs(messages);
  type ChatTurnMsg = { role?: string; content?: unknown };
  const safeList = safeMessages as ChatTurnMsg[];
  const originalUserInput = String(
    turnInputStr ||
      [...safeList].reverse().find((message) => message.role === "user")?.content ||
      ""
  ).trim();
  const previousUserMessage = getPreviousUserMessageContent(safeList);
  const approvedPlanGoal = resolveApprovedPlanExecutionGoal({
    currentUserContent: originalUserInput,
    priorUserContent: previousUserMessage,
    textOnly: !!turnMeta?.textOnly,
  });
  const toolHint =
    "\n\nTools: prefer native tool calls and respect each tool's schema (especially `required` fields). For files/URLs/shell/external/memory data, use tools first, then answer. Never copy terminal status lines (e.g. lines starting with ✓ or parenthetical summaries) into tool arguments—use real paths, URLs, and queries only. When the user asks for a sequence (for example, testing tools one by one), continue step-by-step without waiting for another user nudge: after you announce a step, immediately emit the corresponding tool call. No fake <tool_call> markup. Text fallback: <<<TOOL>>>{\"name\":\"read_file\",\"arguments\":{\"path\":\"relative/path\"}}<<<END>>>. Memory example: <<<TOOL>>>{\"name\":\"memory_save\",\"arguments\":{\"key\":\"user_timezone\",\"value\":\"America/New_York\"}}<<<END>>> — never call memory_save without both `key` and `value`. Tool results (compact JSON batches): each entry may contain `result` (full inlined payload when it stayed under the size cap — read this first) or `result_ref` (workspace-relative spill file such as \"memory/snapshots/run_xxx_r0_0.json\" when the payload was too large — call read_file on that exact path only). Never call read_file on memory/snapshots/run_* paths when `result` is already present or when no `result_ref` was supplied. If read_file fails or snapshot files disappeared, rerun the originating tool (`web_fetch`, etc.)." +
    "\n\nExact text discipline: when the user asks for an exact string, token, filename, identifier, code symbol, JSON key, or command output, copy it byte-for-byte. Preserve underscores, hyphens, slashes, capitalization, digits, punctuation, and spacing. Never normalize or prettify exact tokens such as FOO_BAR_TOKEN." +
    "\n\nTopic discipline: when the user's latest message changes the subject or starts a new request, treat that as the active task. Do not continue earlier plans, files, or tools from older turns unless the user explicitly asks you to resume them." +
    "\n\nContinuation discipline: when a multi-step task is in progress, do not stop after narrating intent. If you write phrases like \"Next:\", \"Now I'll…\", \"Let me check…\", \"Step 3:\", or any forward-looking plan, the very same response must include the actual tool call that performs that step — not just the description. Only stop and produce a final answer when (a) the task is fully complete, (b) you need a piece of information only the user can provide, or (c) you have hit an unrecoverable error. \"I'll keep reading\" or \"Next: list the directory\" without the corresponding tool call is a bug." +
    `\n\nResearch discipline: for find/discover/list/who posts about requests, call \`skill_view\` with \`open-web-research\` first. Fan out many \`web_search\` queries (topic × region × platform) and \`web_fetch\` top URLs before synthesizing. After any \`web_search\` batch, the next tools must be \`web_fetch\` on at least two result URLs (YouTube channel/video pages first). Never state that none exist without at least two \`web_fetch\` calls on URLs from results. Treat sparse niche-keyword hits as inconclusive—not proof nothing exists. Do not ask the user what to do next until at least ${MIN_RESEARCH_SEARCHES} searches and ${MIN_RESEARCH_FETCHES} fetches are done.` +
    "\n\nSkill discipline: skills are procedural knowledge, separate from memory facts. The prompt contains only a compact skills index; call skill_view before relying on detailed skill instructions. After a repeatable workflow, errors you recovered from, or a user saying \"remember this\", draft and save with `skill_save` or `skill_manage` as soon as the content is ready—no separate approval step unless the user declined. Use skill_delete when removing a saved skill (confirmation required) and skill_bulk_save when installing or creating two or more skills in one request (one confirmation for the batch). For **remote SKILL.md installation** only: use `skill_bulk_save` with HTTPS URLs (top-level `url`, `urls`, or `items: [{ url }]`) or `skill_manage` with `action: install_url` / `import_url` for a single URL—never `run_shell`, `npx`, `git clone`, or workspace writes to mimic a skill installer. GitHub repo home pages are not fetchable as skills; discover per-file raw HTTPS `SKILL.md` URLs (e.g. `web_fetch` on the GitHub tree API), then `skill_bulk_save` with `urls`, at most 75 URLs per call (repeat if needed)." +
    "\n\n`run_shell` discipline: **not** a catch-all executor—use dedicated tools first (`grep`, `read_file`, `list_dir`, `find_files`, `web_fetch`, `web_search`, `system_info`, skill/memory tools, etc.). Do not use `run_shell` for skill installs, arbitrary downloads, package managers (`npx`/`npm`/`pip`) when another tool or the user's local terminal is appropriate, or git workflows unless the user explicitly needs a host command you cannot replace. **Nodebox** (`WEBAGENT_RUNTIME=nodebox`): there is **no** POSIX shell—only invocations that start with `node ` (no `sh -c`, pipes, or external binaries); failures here usually mean you picked the wrong tool. **Host** shell: `sh -c` applies; host scheduling via `crontab`/`at` is blocked—use `cron_register`." +
    "\n\nDeliverable discipline: prefer GitHub-flavored Markdown pipe tables over Unicode box-drawing tables in assistant-visible text. When you call `artifact_present`, do not dump the entire document body again in chat afterward — a one-line summary plus a pointer to the artifact/download is enough." +
    "\n\nWiki vault discipline: use `wiki_setup` to create the PARA + Obsidian scaffold (default `.webagent/knowledge-vault/`). Legacy `knowledge-vault/` folders migrate automatically when `root_path` is omitted. Use `wiki_sync` to push runtime facts/session/learnings into `Resources/KnowledgeVault/` after setup. Use `wiki_search` when the user asks to search the vault or when `memory_search`/`memory_recall` are insufficient. Natural-language equivalents for `/wiki_setup`, `/wiki_sync`, `/wiki_search` should trigger the same tools." +
    "\n\nWorkspace layout: for multi-file greenfield work, new demos, spikes, or test harnesses, `make_dir` under `projects/<purpose-slug>/` (keep) or `work/<purpose-slug>/` (scratch) **before** adding files—then keep all new paths under that tree. For new isolated efforts, call `skill_view` with `project-scaffold` first when layout is unclear. Also put exports, scraped data, and ad-hoc outputs there—not loose files at the workspace root." +
    "\n\nScheduling & cron: recurring jobs and daily digests must use `cron_register` (writes `.cronjobs.json`; heartbeat-driven). Always ask how the user wants results delivered and set `delivery`: `silent` (minimal logs only), `terminal` (agent terminal / optional `notifyChannel` for Telegram), or `email` (digest via Resend — needs `deliveryEmailTo`). Do not use `run_shell` with host `crontab`/`at` — they are blocked in this environment." +
    " Names: " +
    toolNames.join(", ") +
    ".";

  const fullMessages = [
    { role: "system", content: sys + memoryBlock + skillsBlock + toolHint },
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
    services: { memory: memoryServices, ...(turnMeta?.services ?? {}) },
    ask: typeof turnMeta?.ask === "function" ? turnMeta.ask : null,
    onTranscript: typeof turnMeta?.onTranscript === "function" ? turnMeta.onTranscript : null,
    autoApprove:
      typeof turnMeta?.autoApprove === "boolean"
        ? turnMeta.autoApprove
        : String(process.env.WEBAGENT_AUTO_APPROVE_TOOLS || "").trim() === "1",
  } as CreateToolContextInput);

  let round = 0;
  let autoContinueNudges = 0;
  let executedToolsInTurn = false;
  let webSearchCountInTurn = 0;
  let webFetchCountInTurn = 0;
  const maxAutoContinueNudges = resolveMaxAutoContinueNudges(originalUserInput);
  const successfulToolKeysInTurn = new Set<string>();
  let conv = [...fullMessages];

  const complexityEstimate = estimateTaskComplexity(originalUserInput);
  let injectedPlanningGate = false;
  if (!turnMeta?.textOnly && originalUserInput && !isPlanningModePrompt(originalUserInput)) {
    if (complexityEstimate.tier === "plan") {
      for (let i = conv.length - 1; i >= 0; i--) {
        const row = conv[i] as ChatTurnMsg;
        if (row.role === "user") {
          conv[i] = { ...row, content: buildPlanModeUserPrompt(originalUserInput) };
          injectedPlanningGate = true;
          break;
        }
      }
    } else if (complexityEstimate.tier === "todo") {
      const hint =
        "[Gate] Multi-step task: call `todo_write` first with a minimal checklist (exactly one item `in_progress`), then execute.";
      for (let i = conv.length - 1; i >= 0; i--) {
        const row = conv[i] as ChatTurnMsg;
        if (row.role === "user") {
          const cur = typeof row.content === "string" ? row.content : "";
          conv[i] = { ...row, content: `${hint}\n\n${cur}` };
          break;
        }
      }
    }
  }
  const usedPlanningGate = injectedPlanningGate || isPlanningModePrompt(originalUserInput);
  const fallbackApprovedPlanGoalActive =
    !!approvedPlanGoal &&
    (/^Execute approved plan at /.test(approvedPlanGoal) ||
      /^Execute the most recent approved plan in /.test(approvedPlanGoal));
  if (fallbackApprovedPlanGoalActive) {
    conv.push({
      role: "user",
      content:
        "[Approved plan execution context] The user already approved execution of an existing plan. Do not ask them to restate or paste the plan again. If the user message includes `plans/*.md` or legacy `.webagent/plans/*.md`, read that file first. Otherwise list `plans/`, pick the newest markdown plan file; if none, check `.webagent/plans/`, then execute.",
    });
  }

  const agentName = process.env.WEBAGENT_AGENT_NAME || process.env.WEBAGENT_PROFILE_NAME || "Agent";
  let turnHeaderPrinted = false;
  const loopGuard = createLoopGuardState();
  let lastToolExecutions: Array<Record<string, unknown>> = [];
  try {
    const { enabled: turnJudgeEnabled, shadowOnly: turnJudgeShadowOnly } =
      resolveTurnJudgeRuntimeFlags();

    let planGoalContinuationsUsed = 0;
    if (approvedPlanGoal) {
      const preview =
        approvedPlanGoal.length > 140 ? `${approvedPlanGoal.slice(0, 140)}…` : approvedPlanGoal;
      process.stdout.write(dim(`◇ Plan goal · active — ${preview}\n`));
      await emitTranscriptEvent(
        turnMeta,
        createGoalLoopTranscriptEvent({
          phase: "invoked",
          goal: approvedPlanGoal,
          maxContinuations: MAX_PLAN_GOAL_CONTINUATIONS,
        }),
        {}
      );
    }
    while (round < MAX_AGENT_ROUNDS) {
      if (turnController.signal.aborted) {
        run.errors.push("turn aborted");
        break;
      }
      round++;
      const roundStartedAt = Date.now();
      emitContextUpdate({
        modelId: cfg.model || null,
        contextWindowTokens: cfg.contextWindowTokens ?? null,
        estimatedPromptTokens: estimateMessagesTokens(conv),
      });
      let acc = "";
      let streamedVisible = "";
      const streamWriter = createToolAwareStreamWriter((chunk) => {
        if (!chunk) return;
        streamedVisible += chunk;
      });
      const onDelta = (c) => {
        acc += c;
        streamWriter.push(c);
      };
      let streamResult;
      let streamAborted = false;
      try {
        streamResult = await streamOpenAI(conv, cfg, onDelta, streamTools, {
          signal: turnController.signal,
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
        emitLoopStopLine("stream_aborted");
        break;
      }
      streamWriter.flush();
      const combined = streamResult?.text || acc;
      const markerParsed = extractMarkerTools(combined);
      const toolCallTagParsed = extractToolCallTagPayloads(markerParsed.visible);
      const nativeOrMarkerCount =
        (streamResult?.toolCalls?.length || 0) + markerParsed.tools.length + toolCallTagParsed.tools.length;
      const jsonFallbackParsed = nativeOrMarkerCount === 0
        ? extractJsonToolCallPayloads(toolCallTagParsed.visible, toolNames)
        : { tools: [], visible: toolCallTagParsed.visible };
      const jsonFallbackCalls = jsonFallbackParsed.tools;
      const plainCommandParsed =
        nativeOrMarkerCount === 0 && jsonFallbackCalls.length === 0
          ? extractPlainToolCommandLines(jsonFallbackParsed.visible, toolNames)
          : { tools: [], visible: jsonFallbackParsed.visible };
      const rawToolCalls = [
        ...(streamResult?.toolCalls || []),
        ...markerParsed.tools,
        ...toolCallTagParsed.tools,
        ...jsonFallbackCalls,
        ...plainCommandParsed.tools,
      ];
      let { normalized: tools, rejected } = normalizeToolCalls(rawToolCalls, toolNames);
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
      let visible = sanitizeAssistantVisibleText(plainCommandParsed.visible, toolNames);
      if (!visible.trim() && streamResult?.sawReasoning && !tools.length) {
        visible =
          "The model returned internal reasoning tokens but no visible answer. Try again or choose a non-reasoning model.";
      }
      if (!visible.trim() && streamedVisible.trim()) {
        visible = sanitizeAssistantVisibleText(streamedVisible, toolNames);
      }
      visible = repairExactResponseText(originalUserInput, visible);
      if (visible.trim()) {
        run.final_visible_assistant_text = visible;
        const rendered = renderMarkdownToAnsi(visible, { toolCatalog });
        let branchBelowName = false;
        if (!turnHeaderPrinted) {
          if (round > 1) process.stdout.write("\n");
          process.stdout.write(`${bold(cyan(agentName))}\n`);
          turnHeaderPrinted = true;
          branchBelowName = true;
        } else if (round > 1) {
          process.stdout.write("\n");
        }
        const block = prefixBlock(rendered, branchBelowName);
        await writeStdoutSmoothed(`${block}\n\n`);
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
      }
      conv.push({ role: "assistant", content: visible });

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
        process.stdout.write(
          dim(
            `▸ skipped ${rejected.length} invalid tool call(s): ${rejected
              .map((r) => r.reason)
              .join(", ")}\n`
          )
        );
        await emitTranscriptEvent(
          turnMeta,
          createSystemLineTranscriptEvent({
            round,
            text: formatSkippedToolsTranscript(rejected),
          }),
          { round }
        );
      }

      if (tools.length && executedToolsInTurn && visible.trim().length > 0) {
        const stalePayload = buildTurnJudgePayload({
          conv,
          executedToolsInTurn,
          autoContinueNudges,
          maxAutoContinueNudges,
          webSearchCountInTurn,
          webFetchCountInTurn,
          lastToolExecutions,
          pendingToolNames: tools.map((t) => t.name),
          round,
          maxRounds: MAX_AGENT_ROUNDS,
          textOnly: !!turnMeta?.textOnly,
          planMode: usedPlanningGate,
          suppressTopicPivot: shouldSuppressActionPlanAutoContinue(
            originalUserInput,
            previousUserMessage
          ),
          approvedPlanGoal,
          totalToolCallsInTurn: run.tool_calls.length,
        });
        if (turnJudgeShadowOnly) {
          const shadowDecision = await fetchTurnJudgeDecisionForShadow(
            stalePayload,
            turnController.signal
          );
          if (shadowDecision) {
            await logDebugEvent("turn_judge_decision_shadow", {
              round,
              phase: "post_tool_stale",
              action: shadowDecision.action,
              confidence: shadowDecision.confidence,
              reason: shadowDecision.reason,
              latencyMs: shadowDecision.latencyMs,
            });
          }
        }
        if (turnJudgeEnabled) {
          const decision = await judgeTurnState(stalePayload, turnController.signal);
          await logDebugEvent("turn_judge_decision", {
            round,
            phase: "post_tool_stale",
            action: decision.action,
            confidence: decision.confidence,
            reason: decision.reason,
            source: decision.source,
            latencyMs: decision.latencyMs,
          });
          emitTurnJudgeLine(decision);
          if (decision.action === "stop" || decision.action === "ask_user") {
            run.rejected_tool_calls.push(
              ...tools.map((tool) => ({
                name: tool.name,
                reason: "turn_judge_final_answer",
              }))
            );
            await logDebugEvent("skipped_post_final_tool_calls", {
              round,
              toolCount: tools.length,
              toolNames: tools.map((tool) => tool.name),
              visiblePreview: String(visible || "").slice(0, 200),
            });
            await logDebugEvent("turn_completed", {
              round,
              durationMs: Date.now() - roundStartedAt,
              continued: false,
              skippedPostFinalTools: tools.length,
            });
            emitLoopStopLine("post_tool_turn_judge_skipped_tools");
            break;
          }
        }
      }

      if (!tools.length) {
        if (!turnMeta?.textOnly) {
          const loopPayload = buildTurnJudgePayload({
            conv,
            executedToolsInTurn,
            autoContinueNudges,
            maxAutoContinueNudges,
            webSearchCountInTurn,
            webFetchCountInTurn,
            lastToolExecutions,
            round,
            maxRounds: MAX_AGENT_ROUNDS,
            textOnly: !!turnMeta?.textOnly,
            planMode: usedPlanningGate,
            suppressTopicPivot: shouldSuppressActionPlanAutoContinue(
              originalUserInput,
              previousUserMessage
            ),
            approvedPlanGoal,
            totalToolCallsInTurn: run.tool_calls.length,
          });

          if (turnJudgeShadowOnly) {
            const shadowDecision = await fetchTurnJudgeDecisionForShadow(
              loopPayload,
              turnController.signal
            );
            if (shadowDecision) {
              await logDebugEvent("turn_judge_decision_shadow", {
                round,
                phase: "no_tool",
                action: shadowDecision.action,
                confidence: shadowDecision.confidence,
                reason: shadowDecision.reason,
                latencyMs: shadowDecision.latencyMs,
              });
            }
          }

          if (turnJudgeEnabled) {
            const decision = await judgeTurnState(loopPayload, turnController.signal);
            await logDebugEvent("turn_judge_decision", {
              round,
              phase: "no_tool",
              action: decision.action,
              confidence: decision.confidence,
              reason: decision.reason,
              source: decision.source,
              latencyMs: decision.latencyMs,
            });
            emitTurnJudgeLine(decision);

            if (
              decision.action === "continue" &&
              !executedToolsInTurn &&
              shouldSuppressActionPlanAutoContinue(originalUserInput, previousUserMessage)
            ) {
              await logDebugEvent("turn_completed", {
                round,
                durationMs: Date.now() - roundStartedAt,
                continued: false,
                topicPivotSuppress: true,
              });
              emitLoopStopLine("topic_pivot_no_continue");
              break;
            }

            if (decision.action === "continue") {
              if (approvedPlanGoal) {
                planGoalContinuationsUsed += 1;
                if (planGoalContinuationsUsed > MAX_PLAN_GOAL_CONTINUATIONS) {
                  process.stdout.write(
                    dim(`◇ Plan goal · paused — continuation budget (${MAX_PLAN_GOAL_CONTINUATIONS})\n`)
                  );
                  await emitTranscriptEvent(
                    turnMeta,
                    createGoalLoopTranscriptEvent({
                      phase: "paused",
                      goal: approvedPlanGoal,
                      reason: "budget",
                      continuationsUsed: planGoalContinuationsUsed,
                      maxContinuations: MAX_PLAN_GOAL_CONTINUATIONS,
                      round,
                    }),
                    { round }
                  );
                  await logDebugEvent("turn_completed", {
                    round,
                    durationMs: Date.now() - roundStartedAt,
                    continued: false,
                    plan_goal_loop_stop: "budget",
                  });
                  emitLoopStopLine("plan_goal_budget");
                  break;
                }
                process.stdout.write(
                  dim(`◇ Plan goal · continuing (${planGoalContinuationsUsed}/${MAX_PLAN_GOAL_CONTINUATIONS})\n`)
                );
                await emitTranscriptEvent(
                  turnMeta,
                  createGoalLoopTranscriptEvent({
                    phase: "continue",
                    goal: approvedPlanGoal,
                    continuationsUsed: planGoalContinuationsUsed,
                    maxContinuations: MAX_PLAN_GOAL_CONTINUATIONS,
                    round,
                  }),
                  { round }
                );
                conv.push({
                  role: "user",
                  content:
                    `[Continuing toward approved plan goal] Goal: ${approvedPlanGoal}\n\nTake the next concrete step now. Prefer tools where needed and keep working until this goal is fully satisfied.`,
                });
                await logDebugEvent("turn_auto_continue_nudge", {
                  round,
                  nudgeIndex: planGoalContinuationsUsed,
                  reason: decision.reason,
                  visiblePreview: String(visible || "").slice(0, 200),
                });
                await logDebugEvent("turn_completed", {
                  round,
                  durationMs: Date.now() - roundStartedAt,
                  continued: true,
                  plan_goal_loop: "continue",
                  turn_judge: decision.action,
                });
                continue;
              }

              if (autoContinueNudges >= maxAutoContinueNudges) {
                process.stdout.write(
                  dim(
                    `▸ auto-continue cap reached (${autoContinueNudges}/${maxAutoContinueNudges} nudges); stopping. Increase WEBAGENT_MAX_AUTO_CONTINUE_NUDGES to allow more recovery nudges.\n`
                  )
                );
                emitLoopStopLine("auto_continue_cap");
                await logDebugEvent("turn_completed", {
                  round,
                  durationMs: Date.now() - roundStartedAt,
                  continued: false,
                  autoContinueCap: true,
                });
                break;
              }

              autoContinueNudges += 1;
              conv.push({
                role: "user",
                content: buildGenericContinuationNudge(originalUserInput, decision),
              });
              await logDebugEvent("turn_auto_continue_nudge", {
                round,
                nudgeIndex: autoContinueNudges,
                reason: decision.reason,
                visiblePreview: String(visible || "").slice(0, 200),
              });
              await logDebugEvent("turn_completed", {
                round,
                durationMs: Date.now() - roundStartedAt,
                continued: true,
                turn_judge: decision.action,
              });
              continue;
            }

            if (approvedPlanGoal && decision.action === "stop") {
              process.stdout.write(
                dim(`◇ Plan goal · done — ${String(decision.reason).slice(0, 200)}\n`)
              );
              await emitTranscriptEvent(
                turnMeta,
                createGoalLoopTranscriptEvent({
                  phase: "done",
                  goal: approvedPlanGoal,
                  reason: decision.reason || "",
                  continuationsUsed: planGoalContinuationsUsed,
                  maxContinuations: MAX_PLAN_GOAL_CONTINUATIONS,
                  round,
                }),
                { round }
              );
            }

            await logDebugEvent("turn_completed", {
              round,
              durationMs: Date.now() - roundStartedAt,
              continued: false,
            });
            emitLoopStopLine(
              decision.action === "ask_user"
                ? "ask_user"
                : executedToolsInTurn
                  ? "post_tool_no_continue"
                  : "no_tools_no_continue"
            );
            break;
          }

          if (shouldSuppressPostToolNudgeFromExecutions(lastToolExecutions)) {
            await logDebugEvent("turn_completed", {
              round,
              durationMs: Date.now() - roundStartedAt,
              continued: false,
              suppressedPostToolNudge: true,
            });
            emitLoopStopLine("suppressed_post_tool_nudge");
            break;
          }

          if (
            executedToolsInTurn &&
            !visible.trim() &&
            autoContinueNudges < maxAutoContinueNudges
          ) {
            autoContinueNudges += 1;
            conv.push({
              role: "user",
              content: buildGenericContinuationNudge(originalUserInput, {
                action: "continue",
                confidence: 1,
                reason: "empty_after_tools_fallback",
                source: "disabled",
              }),
            });
            await logDebugEvent("turn_auto_continue_nudge", {
              round,
              nudgeIndex: autoContinueNudges,
              reason: "empty_after_tools_fallback",
              visiblePreview: String(visible || "").slice(0, 200),
            });
            await logDebugEvent("turn_completed", {
              round,
              durationMs: Date.now() - roundStartedAt,
              continued: true,
              turn_judge_fallback: true,
            });
            continue;
          }

          if (approvedPlanGoal && String(visible || "").trim()) {
            if (planGoalContinuationsUsed >= MAX_PLAN_GOAL_CONTINUATIONS) {
              process.stdout.write(
                dim(`◇ Plan goal · paused — continuation budget (${MAX_PLAN_GOAL_CONTINUATIONS})\n`)
              );
              await emitTranscriptEvent(
                turnMeta,
                createGoalLoopTranscriptEvent({
                  phase: "paused",
                  goal: approvedPlanGoal,
                  reason: "budget",
                  continuationsUsed: planGoalContinuationsUsed,
                  maxContinuations: MAX_PLAN_GOAL_CONTINUATIONS,
                  round,
                }),
                { round }
              );
              await logDebugEvent("turn_completed", {
                round,
                durationMs: Date.now() - roundStartedAt,
                continued: false,
                plan_goal_loop_stop: "budget",
              });
              emitLoopStopLine("plan_goal_budget");
              break;
            }
            planGoalContinuationsUsed += 1;
            process.stdout.write(
              dim(`◇ Plan goal · continuing (${planGoalContinuationsUsed}/${MAX_PLAN_GOAL_CONTINUATIONS})\n`)
            );
            await emitTranscriptEvent(
              turnMeta,
              createGoalLoopTranscriptEvent({
                phase: "continue",
                goal: approvedPlanGoal,
                continuationsUsed: planGoalContinuationsUsed,
                maxContinuations: MAX_PLAN_GOAL_CONTINUATIONS,
                round,
              }),
              { round }
            );
            conv.push({
              role: "user",
              content:
                `[Continuing toward approved plan goal] Goal: ${approvedPlanGoal}\n\nTake the next concrete step now. Prefer tools where needed and keep working until this goal is fully satisfied.`,
            });
            await logDebugEvent("turn_completed", {
              round,
              durationMs: Date.now() - roundStartedAt,
              continued: true,
              plan_goal_loop: "continue_fallback",
            });
            continue;
          }
        }

        await logDebugEvent("turn_completed", {
          round,
          durationMs: Date.now() - roundStartedAt,
          continued: false,
        });
        emitLoopStopLine(
          executedToolsInTurn ? "post_tool_no_continue" : "no_tools_no_continue"
        );
        break;
      }

      if (turnController.signal.aborted) {
        run.errors.push("turn aborted");
        await logDebugEvent("turn_aborted_before_tools", { round, toolCount: tools.length });
        break;
      }

      const guardCheck = guardBeforeToolBatch(loopGuard, tools);
      if (!guardCheck.ok) {
        run.errors.push(guardCheck.reason);
        process.stdout.write(dim(`▸ ${guardCheck.reason}\n`));
        await logDebugEvent("loop_guard_halt_before_tools", { round, reason: guardCheck.reason });
        await emitTranscriptEvent(
          turnMeta,
          createSystemLineTranscriptEvent({ round, text: guardCheck.reason }),
          { round }
        );
        emitLoopStopLine("loop_guard");
        break;
      }

      const exec = await runTools(tools, turnCtx, toolCatalog);
      lastToolExecutions = exec;
      if (exec.length > 0) executedToolsInTurn = true;
      for (let i = 0; i < tools.length; i++) {
        const tname = String(tools[i]?.name || "");
        if (!exec[i]?.error) {
          successfulToolKeysInTurn.add(toolExecutionKey(tools[i]));
          if (tname === "web_search") webSearchCountInTurn += 1;
          if (tname === "web_fetch") webFetchCountInTurn += 1;
        }
      }
      const guardWarn = updateLoopGuardAfterResults(loopGuard, tools, exec);
      if (guardWarn) {
        process.stdout.write(dim(`${guardWarn}\n`));
      }
      run.tool_calls.push(
        ...tools.map((tool) => ({
          name: tool.name,
          arguments: tool.arguments,
        }))
      );
      run.tool_results.push(...exec.map((item) => ({
        tool: String(item.tool ?? ""),
        status: item.error ? "error" : "ok",
        error: item.error != null ? String(item.error) : undefined,
      })));
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
      await logDebugEvent("turn_tool_results", {
        round,
        toolCount: tools.length,
        resultCount: exec.length,
        errors: exec.filter((item) => item?.error).length,
      });
      conv.push({
        role: "user",
        content: "Tool results (compact JSON):\n" + JSON.stringify(summarized, null, 2),
      });
      await logDebugEvent("turn_completed", {
        round,
        durationMs: Date.now() - roundStartedAt,
        continued: true,
      });
      if (turnController.signal.aborted) {
        run.errors.push("turn aborted");
        await logDebugEvent("turn_aborted_after_tools", { round, toolCount: tools.length });
        break;
      }
    }
    await logDebugEvent("agent_turn_finished", {
      rounds: round,
      emittedMessages: conv.slice(fullMessages.length).length,
    });
    if (round >= MAX_AGENT_ROUNDS && !turnController.signal.aborted) {
      run.errors.push(`agent round cap reached (${MAX_AGENT_ROUNDS})`);
      emitLoopStopLine(`max_rounds (${MAX_AGENT_ROUNDS})`);
      await logDebugEvent("agent_turn_round_cap_reached", {
        rounds: round,
        maxRounds: MAX_AGENT_ROUNDS,
        autoContinueNudges,
        maxAutoContinueNudges,
      });
    }
    run.status = turnController.signal.aborted ? "aborted" : "completed";
    run.rounds = round;
    run.duration_ms = Date.now() - runStartedAt;
    run.completed_at = new Date().toISOString();
    await persistCompletedRun(run);
    return conv.slice(fullMessages.length);
  } catch (error) {
    run.status = "failed";
    run.rounds = round;
    run.duration_ms = Date.now() - runStartedAt;
    run.completed_at = new Date().toISOString();
    run.errors.push(errorMessage(error));
    await persistCompletedRun(run).catch(() => {});
    throw error;
  } finally {
    if (currentTurnController === turnController) currentTurnController = null;
  }
}
