/**
 * Agent bootstrap: main loop, REPL, heartbeat, onboarding, command dispatch.
 */

import fs from "node:fs/promises";
import { processStdinChunk } from "./ipc.js";
import { takeFramedUserInput } from "./user-input-framing.js";
import {
  AGENT_MD,
  HEARTBEAT_INTERVAL_MS,
  USER_MD,
  WS,
  workspaceStatePath,
} from "./constants.js";
import {
  getToolNamesAsync,
  loadToolCatalog,
  runTools,
} from "./tools/registry.js";
import { createToolContext } from "./tools/context.js";
import * as memoryServices from "./memory/index.js";
import {
  acknowledgeJobEvents,
  buildJobEventsPrompt,
  cleanupSnapshotsNotReferenced,
  drainPendingJobEvents,
  sanitizeMessagesMissingSnapshotRefs,
} from "./memory/index.js";
import {
  fileExists,
  listCheckpoints,
  loadCheckpoint,
  loadHistory,
  loadSystemPrompt,
  runHeartbeatTick,
  saveCheckpoint,
  saveHistory,
} from "./state/persistence.js";
import {
  cleanSetupName,
  emitContextUpdate,
  emitProfileUpdate,
  emitUserUpdate,
  parseUserNameFromUserMd,
  runFirstRunSetup,
  synchronizeIdentityFiles,
} from "./identity/onboarding.js";
import { fetchContextWindow, resolveLlm } from "./llm/provider-config.js";
import { fetchWithTimeout } from "./llm/streaming.js";
import {
  clearEchoedPrompt,
  dim,
  green,
  pink,
  R,
  red,
  renderBanner,
  renderMarkdownToAnsi,
  renderUserBlock,
} from "./terminal-format.js";
import { getDebugLogPath, logDebugEvent } from "./logging/debug-log.js";
import { notifyMigrationsApplied, runPendingMigrations } from "./migrations/index.js";
import { buildToolRowsFromCatalog } from "./slash-command-views.js";
import { formatHelpForSurface, runSkillsSlashCommand } from "./channel-outbound.js";
import { SLASH_COMMANDS } from "./commands.js";
import { resolveSlashUserMessage } from "./slash-routing.js";
import {
  compactHistory,
  formatCompactionNotice,
  maybeCompactHistory,
} from "./context-compression.js";
import { startChannelSidecar } from "./channels/index.js";
import { errorMessage } from "./utils.js";
import { createRunId } from "./stream-output.js";
import {
  archiveCurrentHistoryForSessionSearch,
  buildStartupGreetingContext,
} from "./startup-context.js";
import {
  agentTurn,
  createTurnMutex,
  abortCurrentTurn,
  subscribeActiveTurnAbort,
} from "./turn.js";

const MAX_AUTO_JOB_EVENT_TURNS = Math.max(1, Number(typeof process !== "undefined" ? process.env?.WEBAGENT_MAX_AUTO_JOB_EVENT_TURNS : undefined) || 2);
const AUTO_JOB_EVENT_COOLDOWN_MS = Math.max(
  1000,
  Number(typeof process !== "undefined" ? process.env?.WEBAGENT_AUTO_JOB_EVENT_COOLDOWN_MS : undefined) || 5000
);

const STARTUP_AWAITING_MARKER = "<<<WEBAGENT_AWAITING_RESPONSE>>>";

export async function main() {
  let cfg = await resolveLlm();
  const toolCatalog = await loadToolCatalog();
  const toolRows = buildToolRowsFromCatalog(toolCatalog);
  let _rlLineBuffer = "";
  process.stdin.setEncoding?.("utf8");
  function drainBufferedStopCommands() {
    while (true) {
      const nl = _rlLineBuffer.indexOf("\n");
      if (nl === -1) return;
      const line = _rlLineBuffer.slice(0, nl).replace(/\r$/, "").trim();
      if (line !== "/stop") return;
      if (!abortCurrentTurn("user_stopped")) return;
      _rlLineBuffer = _rlLineBuffer.slice(nl + 1);
    }
  }
  process.stdin.on?.("data", (chunk) => {
    _rlLineBuffer += processStdinChunk(String(chunk));
    drainBufferedStopCommands();
  });
  function _rlReadLine() {
    return new Promise((resolve) => {
      const tryConsume = () => {
        const framed = takeFramedUserInput(_rlLineBuffer);
        if (framed?.kind === "incomplete") {
          process.stdin.once?.("data", tryConsume);
          return;
        }
        if (framed?.kind === "complete") {
          _rlLineBuffer = framed.rest;
          resolve(framed.line);
          return;
        }
        const nl = _rlLineBuffer.indexOf("\n");
        if (nl !== -1) {
          const line = _rlLineBuffer.slice(0, nl).replace(/\r$/, "");
          _rlLineBuffer = _rlLineBuffer.slice(nl + 1);
          resolve(line);
        } else {
          process.stdin.once?.("data", tryConsume);
        }
      };
      tryConsume();
    });
  }
  const rl = {
    question: (prompt) => { process.stdout.write?.(prompt); return _rlReadLine(); },
    close: () => {},
  };

  if (!cfg) {
    process.stdout.write(red("✗ No LLM API key configured.\n"));
    await new Promise(() => {});
  }
  await logDebugEvent("runtime_started", {
    provider: cfg.provider,
    model: cfg.model,
    contextWindowTokens: cfg.contextWindowTokens ?? null,
    debugLogPath: getDebugLogPath(),
  });

  try {
    const migrationSummary = await runPendingMigrations();
    if (migrationSummary.applied.length || migrationSummary.failed.length) {
      await logDebugEvent("migrations_run", migrationSummary);
    }
    await notifyMigrationsApplied(migrationSummary, (chunk) =>
      process.stdout.write(chunk)
    );
  } catch (err) {
    await logDebugEvent("migrations_runner_crashed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const turnMutex = createTurnMutex();
  const heartbeatSkipOpts = { shouldSkipTick: () => turnMutex.isBusy(), cfg };

  const heartbeatRunTool = async (toolName, args) => {
    const heartbeatController = new AbortController();
    const heartbeatCtx = createToolContext({
      runId: "heartbeat",
      cwd: WS,
      signal: heartbeatController.signal,
      timeoutMs: 120_000,
      env: process.env,
      services: { memory: memoryServices },
    });
    const [result] = await runTools(
      [{ name: toolName, arguments: args }],
      heartbeatCtx,
      toolCatalog
    );
    if (result?.error) throw new Error(result.error);
    return result?.result;
  };
  const heartbeatHandle = setInterval(() => {
    runHeartbeatTick(heartbeatRunTool, "timer", heartbeatSkipOpts).catch((err) => {
      process.stdout.write(red(`heartbeat error: ${errorMessage(err)}\n`));
    });
  }, HEARTBEAT_INTERVAL_MS);
  const STARTUP_HEARTBEAT_DEFER_MS = 5000;
  setTimeout(() => {
    runHeartbeatTick(heartbeatRunTool, "startup", heartbeatSkipOpts).catch((err) => {
      process.stdout.write(red(`heartbeat error: ${errorMessage(err)}\n`));
    });
  }, STARTUP_HEARTBEAT_DEFER_MS);
  cfg.contextWindowTokens = await fetchContextWindow(cfg, fetchWithTimeout);

  const hasAgent = await fileExists(AGENT_MD);
  const hasUser = await fileExists(USER_MD);
  const onboardingResult =
    !hasAgent || !hasUser ? await runFirstRunSetup(rl, fileExists) : null;

  const profileName = cleanSetupName(
    onboardingResult?.agentName || process.env.WEBAGENT_PROFILE_NAME,
    "Agent"
  );
  const userMd = await fs.readFile(USER_MD, "utf8").catch(() => "");
  const existingUserName = cleanSetupName(
    onboardingResult?.userName ||
      process.env.WEBAGENT_USER_NAME ||
      parseUserNameFromUserMd(userMd),
    "User"
  );
  process.env.WEBAGENT_PROFILE_NAME = profileName;
  await synchronizeIdentityFiles(profileName, existingUserName);
  process.env.WEBAGENT_AGENT_NAME = profileName;
  process.env.WEBAGENT_USER_NAME = existingUserName;
  emitProfileUpdate(profileName);
  emitUserUpdate(existingUserName);
  emitContextUpdate({
    modelId: cfg.model || null,
    contextWindowTokens: cfg.contextWindowTokens ?? null,
    estimatedPromptTokens: 0,
  });

  const refreshHistoryWithLatestSystemPrompt = async (currentHistory) => {
    const systemPrompt = await loadSystemPrompt();
    if (!currentHistory.length) return [{ role: "system", content: systemPrompt }];
    if (currentHistory[0]?.role !== "system") {
      return [{ role: "system", content: systemPrompt }, ...currentHistory];
    }
    return [{ role: "system", content: systemPrompt }, ...currentHistory.slice(1)];
  };

  renderBanner(cfg);
  let history = await refreshHistoryWithLatestSystemPrompt([]);
  let userDisplayName = cleanSetupName(process.env.WEBAGENT_USER_NAME, "You");
  let lastAutoJobEventAt = 0;

  const wrappedAgentTurn = (messages, cfgIn, meta) =>
    turnMutex.run(() => agentTurn(messages, cfgIn, meta));

  const channelAbort = new AbortController();
  const noop = () => {};
  let channelSidecar = { stop: noop };
  let channelSidecarStarted = false;
  const startBootedChannelSidecar = () => {
    if (channelSidecarStarted) return;
    channelSidecarStarted = true;
    channelSidecar = startChannelSidecar({
      signal: channelAbort.signal,
      agentTurn: wrappedAgentTurn,
      cfg,
      abortTurn: abortCurrentTurn,
      writeStderrStyled: (line) => process.stdout.write(red(`${line}\n`)),
    });
  };

  const turnAsk = async ({ kind = "input", prompt = "" } = {}) => {
    const raceQuestion = (label, onAbort) =>
      new Promise((resolve) => {
        let settled = false;
        let unsub = () => {};
        const finish = (value) => {
          if (settled) return;
          settled = true;
          unsub();
          resolve(value);
        };
        unsub = subscribeActiveTurnAbort(() => finish(onAbort));
        rl.question(label).then(
          (answer) => finish(answer),
          () => finish(null)
        );
      });
    if (kind === "approval") {
      const label = `${pink("❯")}${R} ${dim("✅")} ${green("y")}${dim("/yes")} ${dim("·")} ${dim("❌")} ${green("n")}${R} `;
      try {
        const answer = await raceQuestion(label, "");
        const trimmed = String(answer || "").trim();
        return /^y(es)?$/i.test(trimmed);
      } catch {
        return null;
      }
    }
    const label = `${prompt} `;
    try {
      const answer = await raceQuestion(label, null);
      if (answer == null) return null;
      return String(answer || "").trim();
    } catch {
      return null;
    }
  };

  const warnCompactionFailed = async (message, err) => {
    console.log(red(`${message}\n`));
    if (err) {
      const detail = errorMessage(err);
      if (detail && !message.includes(detail)) {
        const clip = detail.length > 600 ? `${detail.slice(0, 600)}…` : detail;
        console.log(dim(`  ${clip}\n`));
      }
    }
  };

  const applyCompactionResult = async (result) => {
    if (!result?.changed) return false;
    history = result.messages;
    await saveHistory(history);
    emitContextUpdate({
      modelId: cfg.model || null,
      contextWindowTokens: cfg.contextWindowTokens ?? null,
      estimatedPromptTokens: result.afterTokens,
    });
    console.log(dim(`${formatCompactionNotice(result)}\n`));
    return true;
  };

  const maybeCompactRuntimeHistory = async () => {
    const result = await maybeCompactHistory(history, cfg, {
      onWarning: warnCompactionFailed,
    });
    await applyCompactionResult(result);
    return result;
  };

  const forceCompactRuntimeHistory = async () => {
    const result = await compactHistory(history, cfg, {
      onWarning: warnCompactionFailed,
    });
    if (await applyCompactionResult(result)) return result;
    if (result.reason === "not_enough_history" || result.reason === "below_threshold") {
      console.log(dim("Not enough history to compact.\n"));
    }
    return result;
  };

  let startupGreetingUserPushed = false;
  try {
    process.stdout.write(`${STARTUP_AWAITING_MARKER}\n`);
    const priorContext = await buildStartupGreetingContext();
    const rawFirst = userDisplayName.split(/\s+/)[0] || "";
    const genericFirst = new Set(["you", "user", ""]);
    const warmName = genericFirst.has(rawFirst.trim().toLowerCase()) ? "" : rawFirst.trim();
    const userPrompt = priorContext
      ? [
          "Session startup — you speak first.",
          warmName ? `Address ${warmName} naturally by name once.` : "Use a warm, natural hello (do not use the placeholder word \"User\" as their name).",
          "PRIOR_CONTEXT is from the last session (recent chat, session notes, and a little saved memory). Welcome them back and continue naturally from where things left off.",
          "You MUST reference one specific task, thread, or detail from PRIOR_CONTEXT (paraphrase; no quotes; no role labels like \"User:\" or \"Session note:\").",
          "If work looked unfinished, briefly acknowledge it and offer to pick up — never imply a blank slate.",
          "Keep it to 1–2 friendly sentences. No lists or bullets.",
          "Do not mention tools, APIs, system prompts, reboots, or that you read context.",
          "",
          "PRIOR_CONTEXT:",
          priorContext,
        ].join("\n")
      : [
          "Session startup — you speak first.",
          warmName ? `Greet ${warmName} warmly by name.` : "Offer a warm hello (do not call them \"User\" unless that is truly their name).",
          "No saved memory loaded yet — keep it welcoming and open-ended in 1–2 short sentences.",
          "No lists. Do not mention tools or prompts.",
        ].join("\n");
    history.push({ role: "user", content: userPrompt });
    startupGreetingUserPushed = true;
    history = await sanitizeMessagesMissingSnapshotRefs(history);
    await cleanupSnapshotsNotReferenced(history).catch(() => {});
    const runId = createRunId();
    const tail = await wrappedAgentTurn(history, cfg, {
      runId,
      input: userPrompt,
      ask: turnAsk,
      autoApprove: true,
      textOnly: true,
    });
    history.pop();
    history.push({ role: "user", content: "(session opened)" });
    for (const m of tail) history.push(m);
    history = await sanitizeMessagesMissingSnapshotRefs(history);
    await saveHistory(history);
    await logDebugEvent("history_saved", {
      messageCount: history.length,
    });
  } catch (e) {
    if (startupGreetingUserPushed) history.pop();
    process.stdout.write(red(errorMessage(e)) + "\n");
    await logDebugEvent("startup_greeting_failed", { error: errorMessage(e) });
  } finally {
    process.stdout.write("<<<WEBAGENT_INPUT_READY>>>\n");
    startBootedChannelSidecar();
  }

  const processPendingJobEvents = async () => {
    const now = Date.now();
    if (now - lastAutoJobEventAt < AUTO_JOB_EVENT_COOLDOWN_MS) return;
    const pending = await drainPendingJobEvents(10);
    if (!pending.length) return;
    const batches = [];
    for (let i = 0; i < pending.length && batches.length < MAX_AUTO_JOB_EVENT_TURNS; i += 5) {
      batches.push(pending.slice(i, i + 5));
    }
    for (const batch of batches) {
      const prompt = buildJobEventsPrompt(batch);
      if (!prompt.trim()) continue;
      history.push({ role: "user", content: prompt });
      await maybeCompactRuntimeHistory();
      const runId = createRunId();
      const tail = await wrappedAgentTurn(history, cfg, {
        runId,
        input: prompt,
        ask: turnAsk,
        autoApprove: true,
      });
      for (const message of tail) history.push(message);
      await logDebugEvent("auto_job_event_turn", {
        runId,
        eventCount: batch.length,
      });
      await acknowledgeJobEvents(batch.map((item) => item.id));
      lastAutoJobEventAt = Date.now();
    }
    await saveHistory(history);
  };

  const handleSkillsCommand = async (input) => {
    await runSkillsSlashCommand(input, "terminal", (msg) => console.log(msg));
    return true;
  };

  while (true) {
    const line = await rl.question(pink("❯ ") + R);
    let input = (line || "").trim();
    if (!input) continue;
    clearEchoedPrompt(input);
    await logDebugEvent("user_input_received", {
      input,
      profile: process.env.WEBAGENT_PROFILE_NAME || null,
      user: process.env.WEBAGENT_USER_NAME || null,
    });
    if (input === "/exit") {
      channelAbort.abort();
      channelSidecar.stop();
      clearInterval(heartbeatHandle);
      break;
    }
    if (input === "/clear") {
      await archiveCurrentHistoryForSessionSearch(history).catch(() => {});
      history = await refreshHistoryWithLatestSystemPrompt([]);
      history = await sanitizeMessagesMissingSnapshotRefs(history);
      await cleanupSnapshotsNotReferenced(history).catch(() => {});
      await saveHistory(history);
      emitContextUpdate({
        modelId: cfg.model || null,
        contextWindowTokens: cfg.contextWindowTokens ?? null,
        estimatedPromptTokens: 0,
      });
      console.log(dim("Conversation cleared (identity unchanged).\n"));
      continue;
    }
    if (input === "/help") {
      console.log(formatHelpForSurface("terminal", SLASH_COMMANDS, toolRows));
      continue;
    }
    if (input === "/compact") {
      await forceCompactRuntimeHistory();
      continue;
    }
    if (input === "/skills" || input.startsWith("/skills ")) {
      await handleSkillsCommand(input);
      continue;
    }
    if (input === "/stop") {
      if (abortCurrentTurn("user_stopped")) {
        console.log(dim("Stopping current run…"));
      } else {
        console.log(dim("No active run to interrupt."));
      }
      continue;
    }
    if (input.startsWith("/checkpoint")) {
      const name = input.slice("/checkpoint".length).trim() || `ckpt_${Date.now()}`;
      const result = await saveCheckpoint(name, history);
      console.log(dim(`Checkpoint saved: ${result.name} (${result.messageCount} messages)\n`));
      continue;
    }
    if (input.startsWith("/rollback")) {
      const name = input.slice("/rollback".length).trim();
      if (!name) {
        const checkpoints = await listCheckpoints();
        if (!checkpoints.length) {
          console.log(dim("No checkpoints saved. Use /checkpoint [name] to create one.\n"));
        } else {
          console.log(
            dim(
              "Saved checkpoints:\n" +
                checkpoints
                  .map((c) => `  ${c.name}  (${c.createdAt.slice(0, 10)}, ${Math.round(c.sizeBytes / 1024)}KB)`)
                  .join("\n") +
                "\nUse /rollback <name> to restore.\n"
            )
          );
        }
        continue;
      }
      try {
        const restored = await loadCheckpoint(name);
        history = await refreshHistoryWithLatestSystemPrompt(restored);
        await saveHistory(history);
        console.log(dim(`Rolled back to checkpoint '${name}' (${history.length} messages).\n`));
      } catch {
        console.log(red(`Checkpoint '${name}' not found. Use /rollback to list available checkpoints.\n`));
      }
      continue;
    }

    const displayInput = input;
    const rewritten = await resolveSlashUserMessage(input);
    if (rewritten !== null) {
      input = rewritten;
    }

    userDisplayName = cleanSetupName(process.env.WEBAGENT_USER_NAME, userDisplayName || "You");
    renderUserBlock(displayInput, userDisplayName, cleanSetupName);

    history.push({ role: "user", content: input });
    await maybeCompactRuntimeHistory();
    try {
      history = await sanitizeMessagesMissingSnapshotRefs(history);
      await cleanupSnapshotsNotReferenced(history).catch(() => {});
      const runId = createRunId();
      const tail = await wrappedAgentTurn(history, cfg, { runId, input, ask: turnAsk });
      for (const m of tail) history.push(m);
      history = await sanitizeMessagesMissingSnapshotRefs(history);
      await saveHistory(history);
      await logDebugEvent("history_saved", {
        messageCount: history.length,
      });
      await processPendingJobEvents();
    } catch (e) {
      process.stdout.write(red(errorMessage(e)) + "\n");
      await logDebugEvent("turn_error", { error: errorMessage(e) });
      history.pop();
    } finally {
      process.stdout.write("<<<WEBAGENT_INPUT_READY>>>\n");
    }
  }
  rl.close();
}
