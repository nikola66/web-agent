/**
 * Agent bootstrap: main loop, REPL, heartbeat, onboarding, command dispatch.
 */

import fs from "node:fs/promises";
import { processStdinChunk } from "./ipc.js";
import {
  AGENT_MD,
  HEARTBEAT_INTERVAL_MS,
  USER_MD,
  WS,
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
  drainPendingJobEvents,
  listSkills,
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
  sanitizeMessagesMissingSnapshotRefs,
  cleanupSnapshotsNotReferenced,
} from "./memory/index.js";
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
  bold,
  clearEchoedPrompt,
  cyan,
  dim,
  pink,
  R,
  red,
  renderBanner,
  renderMarkdownToAnsi,
  renderUserBlock,
} from "./terminal-format.js";
import { getDebugLogPath, logDebugEvent } from "./logging/debug-log.js";
import {
  buildToolRowsFromCatalog,
  renderHelpView,
  renderSkillsView,
} from "./slash-command-views.js";
import { SLASH_COMMANDS } from "./commands.js";
import {
  compactHistory,
  formatCompactionNotice,
  maybeCompactHistory,
} from "./context-compression.js";
import { startChannelSidecar } from "./channels/index.js";
import { errorMessage } from "./utils.js";
import { createRunId } from "./stream-output.js";
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

function commandSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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

  const heartbeatRunTool = async (toolName, args) => {
    const heartbeatController = new AbortController();
    const heartbeatCtx = createToolContext({
      runId: "heartbeat",
      cwd: WS,
      signal: heartbeatController.signal,
      timeoutMs: 60_000,
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
    runHeartbeatTick(heartbeatRunTool, "timer").catch((err) => {
      process.stdout.write(red(`heartbeat error: ${errorMessage(err)}\n`));
    });
  }, HEARTBEAT_INTERVAL_MS);
  const STARTUP_HEARTBEAT_DEFER_MS = 5000;
  setTimeout(() => {
    runHeartbeatTick(heartbeatRunTool, "startup").catch((err) => {
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
  let history = await refreshHistoryWithLatestSystemPrompt(await loadHistory());
  let userDisplayName = cleanSetupName(process.env.WEBAGENT_USER_NAME, "You");
  let lastAutoJobEventAt = 0;

  const turnMutex = createTurnMutex();
  const wrappedAgentTurn = (messages, cfgIn, meta) =>
    turnMutex.run(() => agentTurn(messages, cfgIn, meta));

  const channelAbort = new AbortController();
  const channelSidecar = startChannelSidecar({
    signal: channelAbort.signal,
    agentTurn: wrappedAgentTurn,
    cfg,
    abortTurn: abortCurrentTurn,
    writeStderrStyled: (line) => process.stdout.write(red(`${line}\n`)),
  });

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
      const label = `${pink("❯")}${R} `;
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

  const printSkills = async (query = "") => {
    const skills = await listSkills({ query });
    console.log(renderSkillsView(skills, { query }));
  };

  const handleSkillsCommand = async (input) => {
    const rest = input.slice("/skills".length).trim();
    if (!rest || rest.startsWith("search ")) {
      await printSkills(rest.startsWith("search ") ? rest.slice("search ".length).trim() : rest);
      return true;
    }
    if (rest.startsWith("install ") || rest.startsWith("import ")) {
      const url = rest.replace(/^(install|import)\s+/, "").trim();
      if (!url) {
        console.log(red("Usage: /skills install <https-url-to-SKILL.md>\n"));
        return true;
      }
      const result = await memoryServices.manageSkill({ action: "install_url", url });
      if (result?.blocked) {
        console.log(red(`Skill import blocked: ${(result.dangerous || []).join(", ")}\n`));
      } else {
        console.log(dim(`Installed skill /${result.slug} from ${result.source || url}\n`));
      }
      return true;
    }
    await printSkills(rest);
    return true;
  };

  const skillInvocationPrompt = async (input) => {
    if (!input.startsWith("/") || input.startsWith("//")) return null;
    const token = input.split(/\s+/)[0].slice(1);
    const reserved = new Set(["help", "clear", "compact", "checkpoint", "rollback", "skills", "stop", "exit"]);
    if (!token || reserved.has(token)) return null;
    const skills = await listSkills();
    const skill = skills.find((item) => item.slug === token || commandSlug(item.name) === token);
    if (!skill) return null;
    const task = input.slice(token.length + 1).trim();
    return [
      `The user invoked the installed skill "${skill.name}" (slug: ${skill.slug}).`,
      `First call skill_view with {"name":"${skill.slug}"} to load the full SKILL.md, then use it for this task.`,
      task ? `Task: ${task}` : "Task: Use this skill for the next appropriate workflow and ask one concise clarifying question only if required.",
    ].join("\n");
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
      await fs.rm(AGENT_MD, { force: true });
      await fs.rm(USER_MD, { force: true });
      process.env.WEBAGENT_AGENT_NAME = cleanSetupName(
        process.env.WEBAGENT_PROFILE_NAME,
        "Agent"
      );
      process.env.WEBAGENT_USER_NAME = "User";
      const clearOnboarding = await runFirstRunSetup(rl, fileExists);
      const nextAgentName = cleanSetupName(
        clearOnboarding?.agentName || process.env.WEBAGENT_PROFILE_NAME,
        "Agent"
      );
      const nextUserName = cleanSetupName(
        clearOnboarding?.userName || process.env.WEBAGENT_USER_NAME,
        "User"
      );
      process.env.WEBAGENT_PROFILE_NAME = nextAgentName;
      process.env.WEBAGENT_AGENT_NAME = nextAgentName;
      process.env.WEBAGENT_USER_NAME = nextUserName;
      emitProfileUpdate(nextAgentName);
      emitUserUpdate(nextUserName);
      userDisplayName = cleanSetupName(nextUserName, "You");
      await synchronizeIdentityFiles(nextAgentName, nextUserName);
      history = await refreshHistoryWithLatestSystemPrompt([]);
      await saveHistory(history);
      console.log(dim("History and onboarding identity reset.\n"));
      continue;
    }
    if (input === "/help") {
      console.log(renderHelpView(SLASH_COMMANDS, toolRows));
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

    const skillPrompt = await skillInvocationPrompt(input);
    const displayInput = input;
    if (skillPrompt) input = skillPrompt;

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
