import fs from "node:fs/promises";
import {
  AGENT_MD,
  CHECKPOINTS_DIR,
  HEARTBEAT_INTERVAL_MS,
  SOUL_MD,
  USER_MD,
  workspaceStatePath,
} from "../constants.js";
import { dim, green, red } from "../terminal-format.js";
import { emailTool } from "../tools/email-tools.js";
import { ensureParentDir } from "../workspace-paths.js";
import { errorMessage } from "../utils.js";

/** Heartbeat cron result routing — must match `cron_register` tool schema. */
const CRON_DELIVERY_MODES = new Set(["silent", "terminal", "email"]);
const CRON_JOB_ARGUMENT_RESERVED_KEYS = new Set([
  "id",
  "tool",
  "action",
  "steps",
  "delivery",
  "everyMinutes",
  "enabled",
  "notifyChannel",
  "retryCount",
  "retryDelayMinutes",
  "deliveryEmailTo",
  "deliveryEmailSubject",
  "lastRunAt",
  "retryAttempts",
  "nextRetryAt",
]);
const CRON_STEP_ARGUMENT_RESERVED_KEYS = new Set([
  ...CRON_JOB_ARGUMENT_RESERVED_KEYS,
  "name",
]);

/** Strip invisible Unicode and trim — models sometimes emit ZWSP/BOM in `tool` fields. */
export function sanitizeCronToolToken(s) {
  return String(s ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

function asPlainObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return null;
}

function normalizeCronArguments(value, reservedKeys) {
  const obj = asPlainObject(value);
  if (!obj) return {};
  const nested = asPlainObject(obj.arguments) ?? {};
  const lifted = Object.fromEntries(
    Object.entries(obj).filter(
      ([key, entry]) => key !== "arguments" && !reservedKeys.has(key) && entry !== undefined
    )
  );
  return { ...lifted, ...nested };
}

function hasCronArgumentPayload(value, reservedKeys) {
  const obj = asPlainObject(value);
  if (!obj) return false;
  if (Object.prototype.hasOwnProperty.call(obj, "arguments")) return true;
  return Object.keys(obj).some(
    (key) => key !== "arguments" && !reservedKeys.has(key) && obj[key] !== undefined
  );
}

export function normalizeCronJobArguments(job) {
  return normalizeCronArguments(job, CRON_JOB_ARGUMENT_RESERVED_KEYS);
}

export function normalizeCronStepArguments(step) {
  return normalizeCronArguments(step, CRON_STEP_ARGUMENT_RESERVED_KEYS);
}

export function hasCronJobArgumentPayload(job) {
  return hasCronArgumentPayload(job, CRON_JOB_ARGUMENT_RESERVED_KEYS);
}

function normalizeCronDelivery(incoming, existingEntry: Record<string, unknown> = {}) {
  const raw = String(incoming ?? "").trim().toLowerCase();
  if (raw && !CRON_DELIVERY_MODES.has(raw)) {
    throw new Error(
      `cron_register delivery must be one of: silent, terminal, email (got "${String(incoming).trim()}").`
    );
  }
  if (CRON_DELIVERY_MODES.has(raw)) return raw;
  const prev = String(existingEntry.delivery ?? "").trim().toLowerCase();
  if (CRON_DELIVERY_MODES.has(prev)) return prev;
  return "terminal";
}

export function cronStepToolName(step) {
  const fromTool = sanitizeCronToolToken(step?.tool);
  if (fromTool) return fromTool;
  return sanitizeCronToolToken(step?.action);
}

function getJobDelivery(job) {
  const d = String(job?.delivery ?? "").trim().toLowerCase();
  return CRON_DELIVERY_MODES.has(d) ? d : "terminal";
}

function cronSafeJsonPreview(value) {
  try {
    const s =
      value === undefined
        ? "undefined"
        : JSON.stringify(value, (_, v) => (typeof v === "bigint" ? String(v) : v), 2);
    return s.length > 6000 ? `${s.slice(0, 6000)}\n…` : s;
  } catch {
    return String(value).slice(0, 6000);
  }
}

function formatCronDetail(results) {
  if (!Array.isArray(results) || results.length === 0) return "";
  try {
    const j = JSON.stringify(results, null, 2);
    return j.length > 3500 ? `${j.slice(0, 3500)}\n…` : j;
  } catch {
    return "";
  }
}

const CRON_EMAIL_TEXT_MAX = 50000;
const CRON_EMAIL_HTML_MAX = 50000;

function truncateCronEmailText(s) {
  if (s.length <= CRON_EMAIL_TEXT_MAX) return s;
  return `${s.slice(0, CRON_EMAIL_TEXT_MAX - 40)}\n\n[Truncated…]`;
}

function cronStepOutputTruncated(resultStr) {
  return typeof resultStr === "string" && resultStr.endsWith("\n…");
}

function escapeHtmlEmail(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderCronEmailHtml(jobId, brief, results, detailCount, footerHtml) {
  const id = escapeHtmlEmail(jobId);
  const summary = escapeHtmlEmail(brief);
  let stepsList = '<ul style="margin:8px 0 16px;padding-left:20px">';
  for (let i = 0; i < results.length; i++) {
    const tool = escapeHtmlEmail(String(results[i]?.tool ?? ""));
    const resStr = String(results[i]?.result ?? "");
    const mark = cronStepOutputTruncated(resStr)
      ? ' <span style="color:#666">(output truncated)</span>'
      : "";
    stepsList += `<li><strong>${tool}</strong>${mark}</li>`;
  }
  stepsList += "</ul>";
  let details = "";
  const n = Math.max(0, Math.min(detailCount, results.length));
  for (let i = 0; i < n; i++) {
    const tool = escapeHtmlEmail(String(results[i]?.tool ?? ""));
    const pre = escapeHtmlEmail(String(results[i]?.result ?? ""));
    details += `<details style="margin-bottom:12px;border:1px solid #ddd;border-radius:6px;padding:8px"><summary style="cursor:pointer;font-weight:600">Step ${i + 1}: ${tool}</summary><pre style="margin:8px 0 0;white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.4">${pre}</pre></details>`;
  }
  const footer = footerHtml ? `<div style="margin-top:16px">${footerHtml}</div>` : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="font-family:system-ui,sans-serif;line-height:1.45;max-width:720px;margin:16px"><h2 style="margin:0 0 12px">Cron job</h2><p style="margin:0 0 8px"><strong>Job:</strong> ${id}</p><p style="margin:0 0 16px"><strong>Summary:</strong> ${summary}</p><h3 style="margin:16px 0 8px;font-size:16px">Steps</h3>${stepsList}<h3 style="margin:16px 0 8px;font-size:16px">Full outputs</h3>${details}${footer}</body></html>`;
}

function fitCronEmailHtml(jobId, brief, results) {
  const nSteps = results.length;
  for (let k = nSteps; k >= 1; k--) {
    const footer =
      k < nSteps
        ? `<p style="color:#666;font-size:14px;margin:0">HTML shows the first ${k} step output(s); plain text includes all.</p>`
        : "";
    const html = renderCronEmailHtml(jobId, brief, results, k, footer);
    if (html.length <= CRON_EMAIL_HTML_MAX) return html;
  }
  const fallback = renderCronEmailHtml(
    jobId,
    brief,
    results,
    0,
    `<p style="color:#666;font-size:14px;margin:0">Step outputs omitted from HTML (body too large); use the plain-text part.</p>`
  );
  return fallback.length <= CRON_EMAIL_HTML_MAX
    ? fallback
    : `${fallback.slice(0, CRON_EMAIL_HTML_MAX - 40)}…`;
}

/** Plain-text + HTML digest for cron success emails (not the raw JSON array used for terminal/Telegram). */
function buildCronEmailBodies(jobId, brief, results) {
  const safeId = String(jobId ?? "");
  const safeBrief = String(brief ?? "");
  if (!Array.isArray(results) || results.length === 0) {
    const text = truncateCronEmailText(
      [`Cron job: ${safeId}`, `Summary: ${safeBrief}`, "", "Results:", "(no structured results)"].join("\n")
    );
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="font-family:system-ui,sans-serif;line-height:1.45;max-width:720px;margin:16px"><h2 style="margin:0 0 12px">Cron job</h2><p style="margin:0 0 8px"><strong>Job:</strong> ${escapeHtmlEmail(
      safeId
    )}</p><p style="margin:0 0 16px"><strong>Summary:</strong> ${escapeHtmlEmail(
      safeBrief
    )}</p><p style="margin:0;color:#666">(no structured results)</p></body></html>`;
    return { text, html };
  }
  const textLines = [`Cron job: ${safeId}`, `Summary: ${safeBrief}`, "", "Steps:"];
  for (let i = 0; i < results.length; i++) {
    const tool = String(results[i]?.tool ?? "");
    const resStr = String(results[i]?.result ?? "");
    const mark = cronStepOutputTruncated(resStr) ? " (output truncated)" : "";
    textLines.push(`  • ${tool}${mark}`);
  }
  textLines.push("", "Full outputs:");
  for (let i = 0; i < results.length; i++) {
    const tool = String(results[i]?.tool ?? "");
    const resStr = String(results[i]?.result ?? "");
    textLines.push(`--- Step ${i + 1}: ${tool} ---`);
    textLines.push(resStr);
    textLines.push("");
  }
  return {
    text: truncateCronEmailText(textLines.join("\n")),
    html: fitCronEmailHtml(safeId, safeBrief, results),
  };
}

/** Shown to the model in every system prompt; answer only when the user asks about credits or origins. */
const PRODUCT_ATTRIBUTION = `## Web Agent credits

If the user asks who built Web Agent, who created you, your authors, or similar: say it was created by nikola66 together with the aratech team in Dubai, United Arab Emirates. Do not volunteer this in unrelated replies.`;

export async function loadHistory() {
  const historyPath = workspaceStatePath(".webagent/history.json");
  try {
    const raw = await fs.readFile(historyPath, "utf8");
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

export async function saveHistory(messages) {
  const historyPath = workspaceStatePath(".webagent/history.json");
  await ensureParentDir(historyPath);
  await fs.writeFile(historyPath, JSON.stringify(messages, null, 2), "utf8");
}

export async function fileExists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export async function loadSystemPrompt() {
  const fallback = process.env.WEBAGENT_PERSONALITY || "You are a helpful assistant.";
  let agent = "";
  let user = "";
  let soul = "";
  try {
    agent = await fs.readFile(AGENT_MD, "utf8");
  } catch {
    agent = fallback;
  }
  try {
    user = await fs.readFile(USER_MD, "utf8");
  } catch {
    user = "";
  }
  try {
    soul = await fs.readFile(SOUL_MD, "utf8");
  } catch {
    soul = "";
  }
  return [agent, soul, user, PRODUCT_ATTRIBUTION]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}

async function loadHeartbeatState() {
  const heartbeatStatePath = workspaceStatePath(".webagent/heartbeat-state.json");
  try {
    const raw = await fs.readFile(heartbeatStatePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    /* ignore */
  }
  return { lastHeartbeatAt: 0 };
}

async function saveHeartbeatState(state) {
  const heartbeatStatePath = workspaceStatePath(".webagent/heartbeat-state.json");
  await ensureParentDir(heartbeatStatePath);
  await fs.writeFile(heartbeatStatePath, JSON.stringify(state, null, 2), "utf8");
}

export async function loadCronJobs() {
  const cronjobsPath = workspaceStatePath(".webagent/cronjobs.json");
  try {
    const raw = await fs.readFile(cronjobsPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.jobs)) return parsed;
  } catch {
    /* ignore */
  }
  return { jobs: [] };
}

async function saveCronJobs(cron) {
  const cronjobsPath = workspaceStatePath(".webagent/cronjobs.json");
  await ensureParentDir(cronjobsPath);
  await fs.writeFile(cronjobsPath, JSON.stringify(cron, null, 2), "utf8");
}

/**
 * Remove a job by `id` from `.webagent/cronjobs.json`. Used when `cron_register` is called with `action: "remove"`.
 */
export async function removeCronJob(id: string) {
  const trimmed = String(id ?? "").trim();
  if (!trimmed) throw new Error("cron_register remove requires `id` (string).");

  const cron = await loadCronJobs();
  const jobs = Array.isArray(cron.jobs) ? [...cron.jobs] : [];
  const idx = jobs.findIndex((j) => j && String(j.id) === trimmed);
  if (idx < 0) {
    throw new Error(`cron_register remove: unknown id "${trimmed}".`);
  }
  jobs.splice(idx, 1);
  await saveCronJobs({ jobs });
  return { ok: true, id: trimmed, removed: true, jobsRegistered: jobs.length };
}

/**
 * Merge or append a single job by `id`. Used by the `cron_register` tool.
 */
export async function upsertCronJob(job) {
  const id = String(job?.id || "").trim();
  if (!id) throw new Error("cron_register requires `id` (string).");

  const hasSteps = Array.isArray(job?.steps) && job.steps.length > 0;
  const toolName = sanitizeCronToolToken(job?.tool);
  if (!hasSteps && !toolName) throw new Error("cron_register requires `tool` or `steps`.");

  const everyRaw = Number(job?.everyMinutes ?? 30);
  const everyMinutes = Math.max(1, Number.isFinite(everyRaw) ? everyRaw : 30);
  const enabled = job?.enabled !== false;

  const retryRaw = Number(job?.retryCount ?? 0);
  const retryCount = Math.max(0, Math.min(3, Number.isFinite(retryRaw) ? retryRaw : 0));
  const retryDelayRaw = Number(job?.retryDelayMinutes ?? 5);
  const retryDelayMinutes = Math.max(1, Math.min(60, Number.isFinite(retryDelayRaw) ? retryDelayRaw : 5));
  const notifyChannel = typeof job?.notifyChannel === "string" ? job.notifyChannel.trim() : "";

  const cron = await loadCronJobs();
  const jobs = Array.isArray(cron.jobs) ? [...cron.jobs] : [];
  const idx = jobs.findIndex((j) => j && String(j.id) === id);
  const base = idx >= 0 && jobs[idx] && typeof jobs[idx] === "object" ? jobs[idx] : {};
  const baseToolName = sanitizeCronToolToken(base.tool);
  const args = normalizeCronJobArguments(job);
  const preserveExistingArgs =
    !hasSteps && !hasCronJobArgumentPayload(job) && toolName && toolName === baseToolName;
  const delivery = normalizeCronDelivery(job?.delivery, base);

  const deliveryEmailToRaw =
    typeof job?.deliveryEmailTo === "string" ? job.deliveryEmailTo.trim() : "";
  const deliveryEmailSubjectRaw =
    typeof job?.deliveryEmailSubject === "string" ? job.deliveryEmailSubject.trim() : "";

  if (delivery === "email") {
    const to = deliveryEmailToRaw || String(base.deliveryEmailTo ?? "").trim();
    if (!to) {
      throw new Error(
        "cron_register with delivery 'email' requires deliveryEmailTo (recipient email address)."
      );
    }
  }

  const entry = {
    ...base,
    id,
    enabled,
    everyMinutes,
    delivery,
    ...(hasSteps
      ? {
          steps: job.steps.map((step) => {
            const tool = cronStepToolName(step);
            const stepArgs = normalizeCronStepArguments(step);
            return { tool, arguments: stepArgs };
          }),
        }
      : {
          tool: toolName,
          arguments: preserveExistingArgs ? normalizeCronJobArguments(base) : args,
        }),
    notifyChannel,
    retryCount,
    retryDelayMinutes,
    lastRunAt:
      idx >= 0 && jobs[idx].lastRunAt != null ? Number(jobs[idx].lastRunAt) : Number(base.lastRunAt || 0),
    retryAttempts: base.retryAttempts ?? 0,
    nextRetryAt: base.nextRetryAt ?? 0,
  };

  if (delivery === "email") {
    const to = deliveryEmailToRaw || String(base.deliveryEmailTo ?? "").trim();
    entry.deliveryEmailTo = to;
    entry.deliveryEmailSubject =
      deliveryEmailSubjectRaw ||
      (typeof base.deliveryEmailSubject === "string" && base.deliveryEmailSubject.trim()
        ? base.deliveryEmailSubject.trim()
        : "");
  } else {
    delete entry.deliveryEmailTo;
    delete entry.deliveryEmailSubject;
  }
  if (idx >= 0) jobs[idx] = entry;
  else jobs.push({ ...entry, lastRunAt: 0, retryAttempts: 0, nextRetryAt: 0 });
  await saveCronJobs({ jobs });
  return {
    ok: true,
    id,
    everyMinutes,
    delivery,
    ...(hasSteps ? { steps: job.steps.length } : { tool: toolName }),
    jobsRegistered: jobs.length,
  };
}

async function runCronJobSteps(job, runTool) {
  const results: { tool: string; result: string }[] = [];
  const record = (name, out) => {
    results.push({ tool: name, result: cronSafeJsonPreview(out) });
  };

  const steps = Array.isArray(job.steps) ? job.steps : null;
  if (steps) {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepTool = cronStepToolName(step);
      if (!stepTool) throw new Error(`step ${i + 1}: missing tool name`);
      const stepArgs =
        step.arguments && typeof step.arguments === "object" && !Array.isArray(step.arguments)
          ? step.arguments
          : {};
      const out = await runTool(stepTool, stepArgs);
      record(stepTool, out);
    }
    return { brief: `${steps.length} step(s)`, results };
  }
  const toolName = String(job.tool || "").trim();
  if (!toolName) throw new Error("missing tool name");
  const args =
    job.arguments && typeof job.arguments === "object" && !Array.isArray(job.arguments)
      ? job.arguments
      : {};
  const out = await runTool(toolName, args);
  record(toolName, out);
  return { brief: toolName, results };
}

async function dispatchCronNotification(job, summaryBrief, detailText = "") {
  // notifyChannel format: "telegram:<chatId>" (e.g. "telegram:123456789")
  try {
    const spec = String(job.notifyChannel || "").trim();
    const [channelId, chatId] = spec.split(":");
    if (channelId === "telegram" && chatId) {
      const token = String(process.env.WEBAGENT_TELEGRAM_BOT_TOKEN || "").trim();
      if (!token) return;
      const { sendTelegramMessage } = await import("../channels/telegram.js");
      const detail = String(detailText || "").trim();
      let msg =
        detail.length > 0
          ? `⏱️ Cron '${job.id}' completed.\nSummary: ${summaryBrief}\n\n${detail}`
          : `⏱️ Cron '${job.id}' completed. ${summaryBrief}`;
      if (msg.length > 4096) msg = `${msg.slice(0, 4090)}…`;
      await sendTelegramMessage(token, chatId, msg);
    }
  } catch {
    /* notification is best-effort */
  }
}

async function dispatchCronEmail(job, outcome) {
  const to = String(job.deliveryEmailTo || "").trim();
  if (!to) throw new Error("deliveryEmailTo missing");
  const subject =
    String(job.deliveryEmailSubject || "").trim() || `Cron '${job.id}' completed`;
  const { text, html } = buildCronEmailBodies(job.id, outcome.brief, outcome.results);
  await emailTool(
    {
      action: "send",
      to,
      subject,
      text,
      html,
    },
    { env: process.env }
  );
}

async function deliverCronSuccess(job, outcome) {
  const delivery = getJobDelivery(job);
  const brief = outcome.brief;
  const detail = formatCronDetail(outcome.results);

  if (delivery === "silent") {
    process.stdout.write(dim(`▸ cron '${job.id || "job"}' completed (${brief})\n`));
    return;
  }

  if (delivery === "terminal") {
    process.stdout.write(green(`▸ cron '${job.id || "unnamed"}' ran (${brief})\n`));
    if (job.notifyChannel) await dispatchCronNotification(job, brief, detail);
    return;
  }

  try {
    await dispatchCronEmail(job, outcome);
    process.stdout.write(dim(`▸ cron '${job.id || "unnamed"}' completed (email sent)\n`));
  } catch (e) {
    process.stdout.write(
      red(
        `▸ cron '${job.id || "unnamed"}' ran (${brief}) but email delivery failed: ${errorMessage(e)}\n`
      )
    );
  }
}

function deliverCronFailure(job, err) {
  const delivery = getJobDelivery(job);
  const msg = errorMessage(err);
  if (delivery === "silent") {
    process.stdout.write(dim(`▸ cron '${job.id || "unknown"}' failed: ${msg}\n`));
    return;
  }
  process.stdout.write(red(`▸ cron '${job.id || "unknown"}' failed: ${msg}\n`));
}

export async function runHeartbeatTick(
  runTool,
  reason = "interval",
  opts: { shouldSkipTick?: () => boolean } = {}
) {
  const now = Date.now();
  const state = await loadHeartbeatState();
  const elapsed = now - Number(state.lastHeartbeatAt || 0);
  if (elapsed < HEARTBEAT_INTERVAL_MS) return;

  if (typeof opts.shouldSkipTick === "function" && opts.shouldSkipTick()) return;

  state.lastHeartbeatAt = now;
  await saveHeartbeatState(state);
  process.stdout.write(dim(`🫀 heartbeat: checking periodic tasks (${reason})...\n`));

  const cron = await loadCronJobs();
  if (!Array.isArray(cron.jobs) || cron.jobs.length === 0) {
    process.stdout.write(dim("▸ no cron jobs registered\n\n"));
    return;
  }

  let ran = 0;
  let dirty = false;
  for (const job of cron.jobs) {
    if (!job || typeof job !== "object" || job.enabled === false) continue;
    const everyMinutes = Math.max(1, Number(job.everyMinutes || 30));
    const lastRunAt = Number(job.lastRunAt || 0);
    const nextRetryAt = Number(job.nextRetryAt || 0);

    const dueByInterval = now - lastRunAt >= everyMinutes * 60 * 1000;
    const dueByRetry = nextRetryAt > 0 && now >= nextRetryAt;
    if (!dueByInterval && !dueByRetry) continue;

    try {
      const outcome = await runCronJobSteps(job, runTool);
      job.lastRunAt = now;
      job.retryAttempts = 0;
      job.nextRetryAt = 0;
      dirty = true;
      ran++;
      await deliverCronSuccess(job, outcome);
    } catch (e) {
      const retryCount = Math.max(0, Number(job.retryCount || 0));
      const retryAttempts = Number(job.retryAttempts || 0);
      deliverCronFailure(job, e);
      if (retryAttempts < retryCount) {
        const retryDelayMinutes = Math.max(1, Number(job.retryDelayMinutes || 5));
        job.retryAttempts = retryAttempts + 1;
        job.nextRetryAt = now + retryDelayMinutes * 60 * 1000;
        process.stdout.write(
          dim(`▸ retry ${job.retryAttempts}/${retryCount} scheduled in ${retryDelayMinutes}m\n`)
        );
      } else {
        job.retryAttempts = 0;
        job.nextRetryAt = 0;
        job.lastRunAt = now;
      }
      dirty = true;
    }
  }

  if (dirty) await saveCronJobs(cron);
  process.stdout.write(dim(`▸ heartbeat done, ran ${ran} job(s)\n\n`));
}

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

function checkpointPath(name) {
  const slug = String(name || "").replace(/[^\w\-]/g, "_").slice(0, 64) || `ckpt_${Date.now()}`;
  return `${CHECKPOINTS_DIR}/${slug}.json`;
}

export async function saveCheckpoint(name, messages) {
  const slug = String(name || "").replace(/[^\w\-]/g, "_").slice(0, 64) || `ckpt_${Date.now()}`;
  const path = `${CHECKPOINTS_DIR}/${slug}.json`;
  await fs.mkdir(CHECKPOINTS_DIR, { recursive: true });
  await fs.writeFile(path, JSON.stringify(messages, null, 2), "utf8");
  return { ok: true, name: slug, path, messageCount: messages.length };
}

export async function loadCheckpoint(name) {
  const path = checkpointPath(name);
  const raw = await fs.readFile(path, "utf8");
  const j = JSON.parse(raw);
  return Array.isArray(j) ? j : [];
}

export async function listCheckpoints() {
  try {
    await fs.mkdir(CHECKPOINTS_DIR, { recursive: true });
    const entries = await fs.readdir(CHECKPOINTS_DIR);
    const results: { name: string; createdAt: string; sizeBytes: number }[] = [];
    for (const entry of entries.filter((e) => e.endsWith(".json"))) {
      try {
        const stat = await fs.stat(`${CHECKPOINTS_DIR}/${entry}`);
        results.push({
          name: entry.replace(/\.json$/, ""),
          createdAt: stat.mtime.toISOString(),
          sizeBytes: stat.size,
        });
      } catch { /* skip */ }
    }
    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}
