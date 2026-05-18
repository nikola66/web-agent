/**
 * Shell execution and file management tools.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  ROOT,
  WS,
} from "../../constants.js";
import {
  resolveWorkspacePath,
  assertAllowedWorkspaceWritePath,
  ensureParentDir,
  shellCwd,
  toWorkspaceRelative,
} from "../../workspace-paths.js";
import { withPathHints } from "./path-hints.js";
import { ipcSpawnRequest } from "../../ipc.js";

const WATCH_MIN_INTERVAL_MS = 15_000;
const WATCH_STRIKE_LIMIT = 3;
const backgroundWatchState = new Map();
const backgroundJobs = new Map();

function createJobId() {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function shouldEmitWatchMatch(jobId) {
  const now = Date.now();
  const state = backgroundWatchState.get(jobId) || {
    cooldownUntil: 0,
    strikeCandidate: false,
    consecutiveStrikes: 0,
  };
  if (state.cooldownUntil > now) {
    if (!state.strikeCandidate) {
      state.strikeCandidate = true;
      state.consecutiveStrikes += 1;
    }
    backgroundWatchState.set(jobId, state);
    return { emit: false, disable: state.consecutiveStrikes >= WATCH_STRIKE_LIMIT };
  }
  if (state.cooldownUntil > 0 && !state.strikeCandidate) {
    state.consecutiveStrikes = 0;
  }
  state.cooldownUntil = now + WATCH_MIN_INTERVAL_MS;
  state.strikeCandidate = false;
  backgroundWatchState.set(jobId, state);
  return { emit: true, disable: false };
}

function hostSchedulingBlockedReason(command) {
  const c = String(command || "");
  if (/\bcrontab\b/i.test(c)) {
    return "Host crontab is unavailable in WebContainer. Register jobs with cron_register (writes .cronjobs.json); see HEARTBEAT.md.";
  }
  if (/(?:^|[|;&\n])\s*at\s+(?:now|midnight|noon|teatime|[\+\d])/i.test(c)) {
    return "The at(1) scheduler is unavailable in WebContainer. Use cron_register and heartbeat-driven jobs instead.";
  }
  if (/(?:^|[|;&\n])\s*(?:atq|batch)\b/i.test(c)) {
    return "at/batch queue commands are unavailable in WebContainer. Use cron_register instead.";
  }
  return null;
}

function parseShellLineArgs(input) {
  const args = [];
  let cur = "";
  let quote = null;
  let esc = false;
  const str = String(input || "");
  for (const ch of str) {
    if (esc) {
      cur += ch;
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        args.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (quote) throw new Error("run_shell: unclosed quote in node command arguments.");
  if (cur) args.push(cur);
  return args;
}

/**
 * Parse `node …` CLI args for Nodebox. Most execution goes through adapter IPC + shell.runCommand;
 * plain `node -v` / `--version` is answered from `process.version` in-process (see runShellViaNodeboxIpc).
 */
function parseNodeboxNodeArgv(command) {
  const trimmed = String(command || "").trim();
  if (!/^node\b/i.test(trimmed)) {
    throw new Error(
      "run_shell (Nodebox): no OS shell — only `node …` is supported (spawned without `sh -c`). " +
        "Use the `grep` tool, `read_file`, `web_fetch`, or write a small `node -e` script; avoid pipes and external binaries here. " +
        "Do not put generic `run_shell` steps in heartbeat cron on Nodebox."
    );
  }
  /** `\s*` after `node` so `node -v` works (not only `node -v` with mandatory space). */
  const rest = trimmed.replace(/^node\b\s*/i, "").trim();
  if (!rest) {
    throw new Error("run_shell (Nodebox): `node` needs arguments (for example `node --version` or `node -e \"…\"`).");
  }
  const argv = parseShellLineArgs(rest);
  if (!argv.length) {
    throw new Error("run_shell (Nodebox): missing `node` arguments after parsing.");
  }
  return argv.map((a) => String(a));
}

/** Normalize `-v` / Unicode minus so version probes match reliably. */
function normalizeNodeboxCliArgv(argv) {
  return argv.map((a) => {
    let s = String(a);
    s = s.replace(/^\u2212/, "-").replace(/^\u2013/, "-").replace(/^\u2014/, "-");
    if (s === "-v") s = "--version";
    return s;
  });
}

function spawnShellCommand(command, spawnOptions) {
  const win = process.platform === "win32";
  if (win) {
    const comspec = process.env.ComSpec || "cmd.exe";
    return spawn(comspec, ["/d", "/s", "/c", command], {
      ...spawnOptions,
      shell: false,
      windowsHide: true,
    });
  }
  return spawn("/bin/sh", ["-c", command], { ...spawnOptions, shell: false });
}

export async function makeDirTool({ path: rel }, ctx) {
  if (!rel || typeof rel !== "string") {
    throw new Error("make_dir requires `path` (string).");
  }
  let createdPath = rel;
  await withPathHints(async () => {
    const abs = resolveWorkspacePath(ctx, rel);
    createdPath = toWorkspaceRelative(abs);
    if (abs !== ROOT) await fs.mkdir(abs, { recursive: true });
  }, ctx, rel);
  return { ok: true, path: createdPath };
}

export async function deleteFileTool({ path: rel }, ctx) {
  if (!rel || typeof rel !== "string") {
    throw new Error("delete_file requires `path` (string).");
  }
  await withPathHints(
    async () => fs.rm(resolveWorkspacePath(ctx, rel), { recursive: false, force: true }),
    ctx,
    rel
  );
  return { ok: true };
}

export async function moveFileTool({ from, to }, ctx) {
  await withPathHints(async () => {
    const a = resolveWorkspacePath(ctx, from);
    const b = resolveWorkspacePath(ctx, to);
    assertAllowedWorkspaceWritePath(b);
    await ensureParentDir(b);
    await fs.rename(a, b);
  }, ctx, from);
  return { ok: true };
}

async function runShellViaNodeboxIpc(command, cwd, ctxCwd, effectiveTimeoutMs, ctxSignal) {
  let argvStrings = normalizeNodeboxCliArgv(parseNodeboxNodeArgv(command));
  /** Same JS VM as `system_info` — Nodebox `shell.runCommand` + cwd can throw resolving `…/nodebox`. */
  if (argvStrings.length === 1 && argvStrings[0] === "--version") {
    const v = typeof process.version === "string" ? process.version : "unknown";
    const line = v.startsWith("v") ? `${v}\n` : `v${v}\n`;
    return { stdout: line, stderr: "", exit_code: 0, signal: null };
  }
  const resolvedCwd = shellCwd(cwd ?? ctxCwd);
  let tmpScriptPath = null;
  const dashE = argvStrings.indexOf("-e");
  const dashEval = argvStrings.indexOf("--eval");
  const evalIdx = dashE >= 0 ? dashE : dashEval;
  if (evalIdx >= 0 && evalIdx + 1 < argvStrings.length) {
    const scriptBody = argvStrings[evalIdx + 1];
    tmpScriptPath = path.join(
      resolvedCwd,
      `.webagent/tmp/rs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.js`
    );
    await fs.mkdir(path.dirname(tmpScriptPath), { recursive: true });
    await fs.writeFile(tmpScriptPath, scriptBody, "utf8");
    argvStrings = [...argvStrings.slice(0, evalIdx), tmpScriptPath, ...argvStrings.slice(evalIdx + 2)];
  }
  const payload = {
    command: "node",
    args: argvStrings,
    cwd: resolvedCwd,
    timeout_ms: effectiveTimeoutMs,
  };
  if (ctxSignal?.aborted) {
    throw Object.assign(new Error("run_shell aborted before start"), { name: "AbortError" });
  }
  try {
    const raw = await ipcSpawnRequest(payload);
    if (!raw || typeof raw !== "object") {
      throw new Error("run_shell: invalid IPC response");
    }
    if (!raw.ok) {
      throw new Error(String(raw.error || "run_shell failed"));
    }
    return {
      stdout: String(raw.stdout ?? ""),
      stderr: String(raw.stderr ?? ""),
      exit_code: Number(raw.exit_code ?? 0),
      signal: null,
    };
  } finally {
    if (tmpScriptPath) await fs.unlink(tmpScriptPath).catch(() => {});
  }
}

export function runShellTool(
  { command, cwd, timeout_ms, background = false, watch_patterns = [], notify_on_complete = true } = {},
  ctx
) {
  if (!command || typeof command !== "string") {
    return Promise.reject(new Error("run_shell requires `command` (string)."));
  }
  const blocked = hostSchedulingBlockedReason(command);
  if (blocked) return Promise.reject(new Error(blocked));
  const ctxCwd = ctx?.cwd ?? WS;
  const ctxTimeout = Number(ctx?.timeoutMs);
  const argTimeout = Number(timeout_ms);
  const candidates = [
    Number.isFinite(argTimeout) && argTimeout > 0 ? argTimeout : null,
    Number.isFinite(ctxTimeout) && ctxTimeout > 0 ? ctxTimeout : null,
  ].filter((n) => n !== null);
  const effectiveTimeoutMs = candidates.length ? Math.min(...candidates) : 120_000;
  const ctxSignal = ctx?.signal;
  const memory = ctx?.services?.memory;
  const watchPatterns = Array.isArray(watch_patterns)
    ? watch_patterns.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  if (process.env.WEBAGENT_RUNTIME === "nodebox") {
    if (background) {
      return Promise.reject(
        new Error(
          "run_shell (Nodebox): background mode is not supported. Omit `background` or use a full Node runtime."
        )
      );
    }
    return runShellViaNodeboxIpc(command, cwd, ctxCwd, effectiveTimeoutMs, ctxSignal);
  }

  if (background) {
    return new Promise((resolve, reject) => {
      const child = spawnShellCommand(command, {
        cwd: shellCwd(cwd ?? ctxCwd),
      });
      const jobId = createJobId();
      let completed = false;
      const startedAt = new Date().toISOString();
      const markFailedStart = async (error) => {
        if (!memory) return;
        await memory
          .upsertJob({
            job_id: jobId,
            run_id: ctx?.runId || null,
            tool_name: "run_shell",
            status: "failed",
            command,
            cwd: cwd ?? ctxCwd,
            started_at: startedAt,
            completed_at: new Date().toISOString(),
            notify_policy: notify_on_complete ? "completion" : "none",
          })
          .catch(() => {});
        await memory
          .enqueueJobEvent({
            jobId,
            eventType: "failed",
            payload: { error: String(error?.message || error || "run_shell failed to start") },
          })
          .catch(() => {});
      };
      const finish = async (eventType, payload = {}) => {
        if (completed) return;
        completed = true;
        backgroundJobs.delete(jobId);
        const completedAt = new Date().toISOString();
        await memory
          ?.upsertJob({
            job_id: jobId,
            run_id: ctx?.runId || null,
            tool_name: "run_shell",
            status: eventType === "completed" ? "completed" : "failed",
            command,
            cwd: cwd ?? ctxCwd,
            started_at: startedAt,
            completed_at: completedAt,
            notify_policy: notify_on_complete ? "completion" : "none",
          })
          .catch(() => {});
        if (notify_on_complete || eventType === "failed") {
          await memory
            ?.enqueueJobEvent({
              jobId,
              eventType,
              payload,
            })
            .catch(() => {});
        }
      };

      memory
        ?.upsertJob({
          job_id: jobId,
          run_id: ctx?.runId || null,
          tool_name: "run_shell",
          status: "running",
          command,
          cwd: cwd ?? ctxCwd,
          started_at: startedAt,
          notify_policy: notify_on_complete ? "completion" : "none",
        })
        .catch(() => {});

      backgroundJobs.set(jobId, {
        pid: child.pid,
        command,
        startedAt,
        cwd: cwd ?? ctxCwd,
      });

      child.stdout?.on("data", (chunk) => {
        const text = String(chunk || "");
        memory?.appendJobLog(jobId, { stream: "stdout", text }).catch(() => {});
        if (!watchPatterns.length) return;
        const matchedPattern = watchPatterns.find((pattern) => text.includes(pattern));
        if (!matchedPattern) return;
        const gate = shouldEmitWatchMatch(jobId);
        if (gate.disable) {
          memory
            ?.enqueueJobEvent({
              jobId,
              eventType: "watch_disabled",
              payload: {
                reason: "watch rate limit strike limit reached",
                min_interval_ms: WATCH_MIN_INTERVAL_MS,
                strike_limit: WATCH_STRIKE_LIMIT,
              },
            })
            .catch(() => {});
          return;
        }
        if (!gate.emit) return;
        memory
          ?.enqueueJobEvent({
            jobId,
            eventType: "watch_match",
            payload: {
              pattern: matchedPattern,
              preview: text.replace(/\s+/g, " ").trim().slice(0, 300),
            },
          })
          .catch(() => {});
      });
      child.stderr?.on("data", (chunk) => {
        const text = String(chunk || "");
        memory?.appendJobLog(jobId, { stream: "stderr", text }).catch(() => {});
      });
      child.on("error", async (error) => {
        await markFailedStart(error);
        reject(error);
      });
      child.on("close", async (code, signal) => {
        await finish(code === 0 ? "completed" : "failed", {
          exit_code: code,
          signal: signal || null,
          error: code === 0 ? null : `run_shell exited with code ${code}`,
        });
      });
      resolve({
        background: true,
        job_id: jobId,
        pid: child.pid,
        status: "running",
      });
    });
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let killTimer = null;
    let abortListener = null;
    const child = spawnShellCommand(command, {
      cwd: shellCwd(cwd ?? ctxCwd),
    });
    let stdout = "";
    let stderr = "";

    const killChild = (signal) => {
      try {
        child.kill(signal || "SIGTERM");
      } catch {
        /* child may already be dead */
      }
    };

    const settle = (err, value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (killTimer !== null) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      if (abortListener && ctxSignal?.removeEventListener) {
        ctxSignal.removeEventListener("abort", abortListener);
        abortListener = null;
      }
      if (err) reject(err);
      else resolve(value);
    };

    if (ctxSignal) {
      if (ctxSignal.aborted) {
        killChild("SIGKILL");
        settle(Object.assign(new Error("run_shell aborted before start"), { name: "AbortError" }));
        return;
      }
      abortListener = () => {
        killChild("SIGTERM");
        killTimer = setTimeout(() => killChild("SIGKILL"), 1000);
        killTimer.unref?.();
        settle(Object.assign(new Error("run_shell aborted"), { name: "AbortError" }));
      };
      ctxSignal.addEventListener?.("abort", abortListener, { once: true });
    }

    if (effectiveTimeoutMs > 0) {
      timer = setTimeout(() => {
        killChild("SIGTERM");
        killTimer = setTimeout(() => killChild("SIGKILL"), 1000);
        killTimer.unref?.();
        settle(new Error(`run_shell timed out after ${effectiveTimeoutMs}ms`));
      }, effectiveTimeoutMs);
      timer.unref?.();
    }

    const OUTPUT_CAP = 512 * 1024;
    child.stdout?.on("data", (d) => { if (stdout.length < OUTPUT_CAP) stdout += d; });
    child.stderr?.on("data", (d) => { if (stderr.length < OUTPUT_CAP) stderr += d; });
    child.on("error", (err) => {
      settle(err);
    });
    child.on("close", (code, signal) => {
      settle(null, { stdout, stderr, exit_code: code, signal: signal || null });
    });
  });
}
