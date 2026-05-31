import { HIDDEN_STREAM_MARKERS, LLM_REQUEST_TIMEOUT_MS } from "../constants.js";
import { ipcProxyStreamRequest } from "../ipc.js";
import { logDebugEvent } from "../logging/debug-log.js";
import {
  sanitizeHeadersForFetch,
  shouldUseNodeboxLlmProxy,
  withRuntimeSubscriptionProfileHeader,
} from "./http-utils.js";
import { llmChatCompletionExtras, reasoningPreviewEnabled } from "./provider-config.js";
import { resolveStreamMaxTokens } from "./model-quirks.js";
import { classifyLlmProviderError, formatClassifiedLlmError } from "./llm-error-classifier.js";
import {
  parseToolArguments,
  repairLooseToolCallObject,
  mergeFlatToolCallArguments,
  repairToolCallArgumentsJson,
} from "../tools/argument-normalization.js";
import { parseWriteFileToolArguments, salvageWriteFileArgumentsFromRawJson } from "../tools/write-file-args.js";
import { levenshtein } from "../utils.js";
import { normalizeSkillToolCall, resolveLegacySkillToolName } from "../tools/skill-tool-normalize.js";
import { StreamingThinkScrubber } from "./think-scrubber.js";

type LlmRequestOptions = {
  signal?: AbortSignal;
  onReasoningDelta?: (chunk: string) => void;
};

type ToolCallPayload = {
  name: string;
  arguments: Record<string, unknown>;
};

type JsonValueSpan = {
  start: number;
  end: number;
  text: string;
};

type HiddenStreamMarker = {
  start: string;
  end: string;
};

type LlmProviderConfig = {
  provider?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  extraHeaders?: Record<string, string>;
};


/** External-host tool names → web-agent built-ins (only when target is registered). */
const CROSS_HOST_TOOL_ALIASES: Record<string, string> = {
  read: "read_file",
  readfile: "read_file",
  write: "write_file",
  writefile: "write_file",
  createfile: "write_file",
  edit: "edit_file",
  strreplace: "edit_file",
  strreplaceeditor: "edit_file",
  searchreplace: "edit_file",
  strreplacebasededittool: "edit_file",
  webfetch: "web_fetch",
  fetch: "web_fetch",
  httpget: "web_fetch",
  httprequest: "web_fetch",
  geturl: "web_fetch",
  curl: "web_fetch",
  websearch: "web_search",
  searchweb: "web_search",
  glob: "find_files",
  findfiles: "find_files",
  listdir: "list_dir",
  listdirectory: "list_dir",
  ls: "list_dir",
  grep: "grep",
  ripgrep: "grep",
  tree: "browse_workspace",
  browse: "browse_workspace",
  browseworkspace: "browse_workspace",
  bash: "run_shell",
  shell: "run_shell",
  terminal: "run_shell",
  runterminalcmd: "run_shell",
  executecommand: "run_shell",
  runcommand: "run_shell",
  applypatch: "apply_patch",
  multiedit: "multi_edit",
  todowrite: "todo_write",
  runpython: "run_python",
  python: "run_python",
  movefile: "move_file",
  deletefile: "delete_file",
  skillview: "skill",
  skilllist: "skill",
  skillmanage: "skill",
  skillsave: "skill",
  skillcreate: "skill",
  skillpatch: "skill",
  skilledit: "skill",
  skillbulksave: "skill",
  skillbulkimport: "skill",
  bulkskillimport: "skill",
  bulkimport: "skill",
  bulkimportskills: "skill",
};

function normalizeToolAliasKey(name: string): string {
  return String(name || "").trim().toLowerCase().replace(/[_\-\s.]/g, "");
}

function resolveCrossHostToolAlias(name: string, set: Set<string>): string | null {
  const trimmed = String(name || "").trim();
  if (!trimmed) return null;
  const keys = [normalizeToolAliasKey(trimmed), normalizeToolAliasKey(trimmed.split(/[./]/).pop() || "")];
  for (const key of keys) {
    if (!key) continue;
    const target = CROSS_HOST_TOOL_ALIASES[key];
    if (target && set.has(target)) return target;
  }
  return null;
}

/** Map duplicated/typo tool names (`find_find_files`) to a registered built-in. */
export function resolveKnownToolName(name: string, knownTools: Iterable<string>): string {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "";
  const set = knownTools instanceof Set ? knownTools : new Set(knownTools);
  if (set.has(trimmed)) return trimmed;
  const legacySkill = resolveLegacySkillToolName(trimmed, set);
  if (legacySkill !== trimmed && set.has(legacySkill)) return legacySkill;
  const lower = trimmed.toLowerCase();
  if (set.has("skill")) {
    if (lower === "write_file" && !set.has("write_file")) return "skill";
    if (
      [
        "skill_save",
        "skill_create",
        "skill_patch",
        "skill_edit",
        "skill_list",
        "skill_view",
        "skill_manage",
        "skill_bulk_save",
        "skill_bulk_import",
        "bulk_import",
        "bulk_import_skills",
      ].includes(lower)
    ) {
      return "skill";
    }
  }
  for (const tool of set) {
    if (lower === tool.toLowerCase()) return tool;
  }
  for (const tool of set) {
    const prefix = tool.split("_")[0];
    if (trimmed === `${prefix}_${tool}`) return tool;
  }
  const aliased = resolveCrossHostToolAlias(trimmed, set);
  if (aliased) return aliased;
  const close = [...set].filter(
    (tool) => trimmed.length <= tool.length + 6 && levenshtein(trimmed, tool) <= 2
  );
  if (close.length === 1) return close[0];
  return trimmed;
}

const STREAM_CHUNK_TIMEOUT_MS = 45_000;
/** Never treat sub-second read waits as an idle stall (avoids bogus "0s" near total deadline). */
const STREAM_STALL_FLOOR_MS = 1_000;
const STREAM_TOTAL_TIMEOUT_MS = Math.max(
  LLM_REQUEST_TIMEOUT_MS,
  Number(process.env.WEBAGENT_STREAM_TOTAL_TIMEOUT_MS) ||
    Number(process.env.WEBAGENT_IPC_STREAM_TIMEOUT_MS) ||
    240_000
);

export function getIpcLlmBodyMaxBytes() {
  const n = Number(process.env.WEBAGENT_IPC_LLM_BODY_MAX_BYTES);
  if (Number.isFinite(n) && n >= 100_000) return Math.floor(n);
  return 3_000_000;
}

const HTTP_RETRY_MAX_ATTEMPTS = Math.max(1, Math.min(8, Number(process.env.WEBAGENT_HTTP_MAX_ATTEMPTS) || 3));
const HTTP_RETRY_BASE_MS = Math.max(50, Number(process.env.WEBAGENT_HTTP_RETRY_BASE_MS) || 500);
const HTTP_RETRY_MAX_MS = Math.max(HTTP_RETRY_BASE_MS, Number(process.env.WEBAGENT_HTTP_RETRY_MAX_MS) || 8000);
const HTTP_RETRY_JITTER_RATIO = Math.min(0.5, Math.max(0, Number(process.env.WEBAGENT_HTTP_RETRY_JITTER) || 0.2));

/** Retries on initial connect / first response (stream + non-stream), not schema/tool rejections. */
const TRANSIENT_LLM_HTTP_STATUSES = new Set([429, 500, 502, 503, 504, 524]);

function getLlmInitialHttpMaxAttempts() {
  return Math.max(1, Math.min(6, Number(process.env.WEBAGENT_STREAM_HTTP_MAX_ATTEMPTS) || 3));
}

/** Shared heuristics: dropped TLS/socket, fetch failures, IPC proxy errors. */
function retryableNodeOrFetchError(err, signal) {
  if (!err || signal?.aborted) return false;
  if (err?.name === "AbortError") return false;
  const code = err.code;
  if (code === "ECONNRESET" || code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "EPIPE") {
    return true;
  }
  const msg = String(err?.message || err);
  const fromCause = err?.cause ? String(err.cause?.message || err.cause) : "";
  const haystack = `${msg} ${fromCause}`;
  if (/econnreset|econnrefused|etimedout|socket hang up|unexpected end|premature close|network/i.test(haystack)) {
    return true;
  }
  if (/ipc proxy stream|ipc proxy request/i.test(haystack)) return true;
  return (
    msg.includes("Forced fetch failure") ||
    msg.includes("Failed to fetch") ||
    msg.includes("NetworkError") ||
    msg.includes("Load failed") ||
    err?.name === "TypeError"
  );
}

/** Mulberry32 PRNG for decorrelated jitter (shared with computeRetryDelay). */
function mulberry32(seedU32) {
  return function next() {
    let t = (seedU32 += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Jittered exponential backoff: min(base * 2^attempt, max) + U(0, jitterRatio * delay).
 * `attempt` is 0-based (first retry delay uses attempt 0).
 */
export function computeRetryDelay(attempt) {
  const a = Math.max(0, Math.floor(Number(attempt) || 0));
  const seed = (Date.now() ^ (a * 0x9e3779b9)) >>> 0;
  const rng = mulberry32(seed);
  const capped = Math.min(HTTP_RETRY_BASE_MS * 2 ** a, HTTP_RETRY_MAX_MS);
  return capped + Math.floor(rng() * HTTP_RETRY_JITTER_RATIO * capped);
}

function sleepMs(ms) {
  const delay = Math.max(0, Number(ms) || 0);
  return new Promise((r) => setTimeout(r, delay));
}

function formatStreamIdleWait(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "0ms";
  if (n < 1500) return `${Math.round(n)}ms`;
  return `${Math.round(n / 1000)}s`;
}

export function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(String(text).length / 4));
}

function stringifyForEstimate(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

export function estimateMessageTokens(msg) {
  // Content may be a string, an array of multimodal parts, or null with the
  // payload carried in tool_calls. Stringify non-string shapes so array/tool
  // content (including base64 image data) is counted instead of collapsing to
  // "[object Object]" — undercounting here would suppress context compression
  // exactly when messages are largest.
  return (
    4 +
    estimateTokens(msg?.role || "") +
    estimateTokens(stringifyForEstimate(msg?.content)) +
    (msg?.tool_calls ? estimateTokens(stringifyForEstimate(msg.tool_calls)) : 0)
  );
}

export function estimateMessagesTokens(messages) {
  let total = 0;
  for (const msg of messages || []) total += estimateMessageTokens(msg);
  return total + 2;
}

export function estimateToolSchemaTokens(tools) {
  if (!Array.isArray(tools) || !tools.length) return 0;
  try {
    return estimateTokens(JSON.stringify(tools));
  } catch {
    return 0;
  }
}

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = LLM_REQUEST_TIMEOUT_MS,
  label = "LLM request"
) {
  const toAlternateLoopbackUrl = (inputUrl) => {
    try {
      const parsed = new URL(String(inputUrl || ""));
      if (parsed.hostname === "127.0.0.1") {
        parsed.hostname = "localhost";
        return parsed.toString();
      }
      if (parsed.hostname === "localhost") {
        parsed.hostname = "127.0.0.1";
        return parsed.toString();
      }
    } catch {
      /* ignore malformed URL */
    }
    return null;
  };

  const externalSignal = options?.signal || null;
  const { signal: _externalSignal, headers: rawHeaders, ...fetchOptions } = options || {};
  const headers = withRuntimeSubscriptionProfileHeader(
    url,
    sanitizeHeadersForFetch((rawHeaders as Record<string, unknown>) || {})
  );
  let forcedFailuresLeft = Math.max(0, Math.min(32, Math.floor(Number(process.env.WEBAGENT_FORCE_HTTP_FAIL) || 0)));

  const isAbortError = (err) => err?.name === "AbortError";
  const isRetryableNetworkError = (err) => retryableNodeOrFetchError(err, externalSignal);

  async function singleFetch(targetUrl, attemptIndex) {
    if (forcedFailuresLeft > 0) {
      forcedFailuresLeft -= 1;
      await logDebugEvent("llm_http_forced_failure", { label, url: targetUrl, attemptIndex }).catch(() => {});
      throw new TypeError("Forced fetch failure (WEBAGENT_FORCE_HTTP_FAIL)");
    }
    const controller = new AbortController();
    const abortFromExternal = () => {
      try {
        controller.abort(externalSignal?.reason);
      } catch {
        controller.abort();
      }
    };
    if (externalSignal?.aborted) abortFromExternal();
    else externalSignal?.addEventListener?.("abort", abortFromExternal, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(targetUrl, { ...fetchOptions, headers, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener?.("abort", abortFromExternal);
    }
  }

  await logDebugEvent("llm_http_request_start", {
    label,
    url,
    method: options.method || "GET",
    timeoutMs,
  });

  let lastError = "";
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < HTTP_RETRY_MAX_ATTEMPTS; attempt++) {
    if (externalSignal?.aborted) {
      throw new Error(`${label} aborted`);
    }
    if (attempt > 0) {
      const delayMs = computeRetryDelay(attempt - 1);
      await logDebugEvent("llm_http_retry_backoff", {
        label,
        url,
        attempt,
        delayMs,
        maxAttempts: HTTP_RETRY_MAX_ATTEMPTS,
      }).catch(() => {});
      await sleepMs(delayMs);
    }
    try {
      return await singleFetch(url, attempt);
    } catch (err) {
      lastErr = err;
      if (isAbortError(err)) {
        if (externalSignal?.aborted) throw new Error(`${label} aborted`);
        throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
      }
      const primaryError = String(err?.message || err);
      lastError = primaryError;
      const alternateUrl = toAlternateLoopbackUrl(url);
      if (alternateUrl && isRetryableNetworkError(err)) {
        try {
          await logDebugEvent("llm_http_retry_loopback", {
            label,
            url,
            alternateUrl,
            reason: primaryError,
            attempt,
          }).catch(() => {});
          return await singleFetch(alternateUrl, attempt);
        } catch (alternateErr) {
          lastErr = alternateErr;
          if (isAbortError(alternateErr)) {
            if (externalSignal?.aborted) throw new Error(`${label} aborted`);
            throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
          }
          lastError = `${primaryError}; loopback: ${String(alternateErr?.message || alternateErr)}`;
          if (!isRetryableNetworkError(alternateErr) || attempt === HTTP_RETRY_MAX_ATTEMPTS - 1) {
            throw new Error(
              `${label} failed (${url}); retry (${alternateUrl}) also failed. ` +
                `primary: ${primaryError}; retry: ${String(alternateErr?.message || alternateErr)}`
            );
          }
        }
      } else if (!isRetryableNetworkError(err) || attempt === HTTP_RETRY_MAX_ATTEMPTS - 1) {
        throw new Error(`${label} failed (${url}): ${lastError}`);
      }
      await logDebugEvent("llm_http_retry_network", {
        label,
        url,
        reason: primaryError,
        attempt,
        willRetry: attempt < HTTP_RETRY_MAX_ATTEMPTS - 1,
      }).catch(() => {});
    }
  }
  throw new Error(
    `${label} failed (${url}): ${lastError || (lastErr instanceof Error ? lastErr.message : String(lastErr || ""))}`
  );
}

function formatProviderError(provider, status, bodyText) {
  return formatClassifiedLlmError(classifyLlmProviderError(status, bodyText, provider));
}

/** Body suggests the provider/gateway rejected OpenAI-style `tools` — surfaced for operators (no silent retry without tools). */
function looksLikeToolParameterRejection(status, bodyText) {
  if (!(status === 400 || status === 404 || status === 422)) return false;
  const text = String(bodyText || "").toLowerCase();
  return (
    text.includes("tool") &&
    (text.includes("unsupported") ||
      text.includes("not support") ||
      text.includes("invalid") ||
      text.includes("unknown"))
  );
}

function toolsCapabilityHint(toolCount, status, bodyText) {
  if (!toolCount) return "";
  if (looksLikeToolParameterRejection(status, bodyText)) {
    return ` (${toolCount} tool definition(s) were sent; this runtime requires a chat/completions API that accepts OpenAI-style \`tools\`. The response suggests tools/functions are not supported — switch provider/model or fix the gateway.)`;
  }
  if ((status >= 500 && status < 600) || !Number.isFinite(status) || status === 0) {
    return ` (${toolCount} tools in request; HTTP ${Number.isFinite(status) && status ? status : "?"}. 5xx/empty bodies are usually upstream or network—retry; only 4xx with “tool” errors imply missing tool support.)`;
  }
  return ` (${toolCount} tool definition(s) were sent.)`;
}

type StreamToolAccEntry = { id: string; name: string; arguments: string };

function nextStreamToolSlot(nextSlot: { value: number }): number {
  return nextSlot.value++;
}

export function assembleStreamToolCalls(toolAcc: Map<number, StreamToolAccEntry>) {
  return [...toolAcc.values()]
    .map((call) => {
      const name = String(call.name || "").trim();
      if (!name) return null;
      const repaired = repairToolCallArgumentsJson(call.arguments || "{}", name);
      return { name, arguments: repaired };
    })
    .filter((call): call is { name: string; arguments: string } => call !== null);
}

function extractReasoningDeltaText(value) {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object") {
    const content = value.content ?? value.text ?? value.reasoning;
    if (typeof content === "string" && content) return content;
  }
  return "";
}

function parseOpenAiStreamPayload(
  payload,
  toolAcc: Map<number, StreamToolAccEntry>,
  lastIdAtIdx: Map<number, string>,
  activeSlotByIdx: Map<number, number>,
  nextSlot: { value: number },
  onContent,
  onReasoning
) {
  const choices = Array.isArray(payload?.choices) ? payload.choices : [];
  let sawReasoning = false;
  let finishReason = null;
  for (const choice of choices) {
    const fr = choice?.finish_reason;
    if (fr) finishReason = fr;
    const delta = choice?.delta || {};
    const content = delta.content;
    if (typeof content === "string" && content) onContent(content);
    const reasoningText =
      extractReasoningDeltaText(delta.reasoning_content) ||
      extractReasoningDeltaText(delta.reasoning);
    if (reasoningText) {
      sawReasoning = true;
      if (typeof onReasoning === "function") onReasoning(reasoningText);
    }
    const streamedCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const call of streamedCalls) {
      const rawIdx = Number.isInteger(call?.index) ? call.index : 0;
      const deltaId = String(call?.id || "");
      if (!activeSlotByIdx.has(rawIdx)) activeSlotByIdx.set(rawIdx, rawIdx);
      if (
        deltaId &&
        lastIdAtIdx.has(rawIdx) &&
        lastIdAtIdx.get(rawIdx) !== deltaId
      ) {
        activeSlotByIdx.set(rawIdx, nextStreamToolSlot(nextSlot));
      }
      if (deltaId) lastIdAtIdx.set(rawIdx, deltaId);
      const idx = activeSlotByIdx.get(rawIdx)!;
      const current = toolAcc.get(idx) || { id: "", name: "", arguments: "" };
      if (call?.id) current.id = call.id;
      if (call?.function?.name) current.name = call.function.name;
      if (typeof call?.function?.arguments === "string") current.arguments += call.function.arguments;
      toolAcc.set(idx, current);
    }
  }
  return { sawReasoning, finishReason };
}

export async function streamOpenAI(
  messages: unknown,
  cfg: LlmProviderConfig,
  onDelta: (chunk: string) => void,
  tools: unknown,
  options: LlmRequestOptions = {}
) {
  const headers = sanitizeHeadersForFetch({
    "Content-Type": "application/json",
    ...(cfg.extraHeaders || {}),
  });
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const toolList = Array.isArray(tools) ? tools : [];
  const requestExtras = llmChatCompletionExtras(cfg.provider, { stream: true, model: cfg.model });
  const maxTokens = resolveStreamMaxTokens(cfg);
  const withToolsBody =
    toolList.length > 0
      ? {
          model: cfg.model,
          messages,
          stream: true,
          max_tokens: maxTokens,
          tools: toolList,
          tool_choice: "auto",
          ...requestExtras,
        }
      : {
          model: cfg.model,
          messages,
          stream: true,
          max_tokens: maxTokens,
          ...requestExtras,
        };
  const endpoint = `${cfg.baseUrl}/chat/completions`;
  const startedAt = Date.now();
  await logDebugEvent("llm_stream_start", {
    provider: cfg.provider,
    kind: "openai-compatible",
    model: cfg.model,
    endpoint,
    messageCount: Array.isArray(messages) ? messages.length : 0,
    toolCount: toolList.length,
  });
  const STREAM_HTTP_MAX_ATTEMPTS = getLlmInitialHttpMaxAttempts();
  const useIpcStream = shouldUseNodeboxLlmProxy(endpoint);
  let buf = "";
  const fullParts: string[] = [];
  let sawReasoning = false;
  let finishReason = null;
  const toolAcc = new Map<number, StreamToolAccEntry>();
  const lastIdAtIdx = new Map<number, string>();
  const activeSlotByIdx = new Map<number, number>();
  const nextSlot = { value: 1 };
  const onReasoningDelta = typeof options.onReasoningDelta === "function" ? options.onReasoningDelta : null;
  const thinkScrubber = new StreamingThinkScrubber({
    onReasoningDelta: onReasoningDelta || undefined,
  });
  const onContent = (content) => {
    fullParts.push(content);
    const visible = thinkScrubber.feed(content);
    if (visible) onDelta(visible);
  };
  const onReasoning = (chunk) => {
    if (onReasoningDelta) onReasoningDelta(chunk);
  };
  const parseData = (data) => {
    if (data === "[DONE]") return;
    try {
      const parsed = parseOpenAiStreamPayload(
        JSON.parse(data),
        toolAcc,
        lastIdAtIdx,
        activeSlotByIdx,
        nextSlot,
        onContent,
        onReasoning
      );
      sawReasoning = sawReasoning || parsed.sawReasoning;
      if (parsed.finishReason) finishReason = parsed.finishReason;
    } catch {
      /* ignore malformed SSE payloads */
    }
  };
  const consumeTextChunk = (text) => {
    buf += String(text || "");
    const parts = buf.split("\n");
    buf = parts.pop() || "";
    for (const line of parts) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      parseData(s.slice(5).trim());
    }
  };
  let res;
  let firstError = "";
  const serializedBody = JSON.stringify(withToolsBody);
  const ipcBodyMaxBytes = getIpcLlmBodyMaxBytes();
  if (useIpcStream && Buffer.byteLength(serializedBody, "utf8") > ipcBodyMaxBytes) {
    throw new Error(
      `LLM request body too large for IPC (${Buffer.byteLength(serializedBody, "utf8")} bytes, cap ${ipcBodyMaxBytes}). ` +
        "Context grew too large mid-turn — use list_digest/result_ref from tool output, run /compact, or narrow the task; do not refetch full API collections."
    );
  }
  for (let httpAttempt = 0; httpAttempt < STREAM_HTTP_MAX_ATTEMPTS; httpAttempt++) {
    if (httpAttempt > 0) {
      const d = computeRetryDelay(httpAttempt - 1);
      await logDebugEvent("llm_stream_http_retry_backoff", {
        provider: cfg.provider,
        attempt: httpAttempt,
        delayMs: d,
      }).catch(() => {});
      await sleepMs(d);
    }
    /* eslint-disable no-await-in-loop */
    try {
      if (useIpcStream) {
        let meta = { status: 0, statusText: "", contentType: "" };
        fullParts.length = 0;
        sawReasoning = false;
        finishReason = null;
        toolAcc.clear();
        lastIdAtIdx.clear();
        activeSlotByIdx.clear();
        nextSlot.value = 1;
        thinkScrubber.reset();
        buf = "";
        await ipcProxyStreamRequest(
          { method: "POST", url: endpoint, headers, body: serializedBody },
          {
            timeoutMs: STREAM_TOTAL_TIMEOUT_MS,
            signal: options.signal,
            onStart: (payload) => {
              meta = {
                status: Number((payload as { status?: number })?.status ?? 0),
                statusText: String((payload as { statusText?: string })?.statusText ?? ""),
                contentType: String((payload as { contentType?: string })?.contentType ?? ""),
              };
            },
            onChunk: consumeTextChunk,
          }
        );
        for (const line of buf.split("\n")) {
          const s = line.trim();
          if (!s.startsWith("data:")) continue;
          parseData(s.slice(5).trim());
        }
        res = {
          ok: meta.status >= 200 && meta.status < 300,
          status: meta.status,
          async text() {
            return fullParts.join("");
          },
          body: null,
        };
      } else {
        res = await fetchWithTimeout(
          endpoint,
          { method: "POST", headers, body: serializedBody, signal: options.signal },
          LLM_REQUEST_TIMEOUT_MS,
          `${cfg.provider} chat request`
        );
      }
    } catch (err) {
      if (options.signal?.aborted) {
        throw new Error(`${cfg.provider} stream aborted`);
      }
      await logDebugEvent("llm_stream_initial_throw", {
        provider: cfg.provider,
        httpAttempt,
        error: String(err?.message || err),
        willRetry:
          httpAttempt < STREAM_HTTP_MAX_ATTEMPTS - 1 &&
          retryableNodeOrFetchError(err, options.signal),
      }).catch(() => {});
      if (
        httpAttempt < STREAM_HTTP_MAX_ATTEMPTS - 1 &&
        retryableNodeOrFetchError(err, options.signal)
      ) {
        continue;
      }
      throw err;
    }
    if (res.ok) break;
    firstError = await res.text();
    const toolCount = toolList.length;
    await logDebugEvent("llm_stream_initial_error", {
      provider: cfg.provider,
      status: res.status,
      attemptedWithTools: toolCount > 0,
      error: firstError,
      httpAttempt,
      willRetry:
        TRANSIENT_LLM_HTTP_STATUSES.has(res.status) &&
        !looksLikeToolParameterRejection(res.status, firstError) &&
        httpAttempt < STREAM_HTTP_MAX_ATTEMPTS - 1,
    });
    const retryable =
      TRANSIENT_LLM_HTTP_STATUSES.has(res.status) && !looksLikeToolParameterRejection(res.status, firstError);
    if (!retryable || httpAttempt === STREAM_HTTP_MAX_ATTEMPTS - 1) {
      const classified = classifyLlmProviderError(res.status, firstError, cfg.provider);
      const hint = toolsCapabilityHint(toolCount, res.status, firstError);
      throw new Error(`${formatClassifiedLlmError(classified, hint)}`);
    }
  }
  /* eslint-enable no-await-in-loop */
  const finishStreamAssembly = () => {
    const tail = thinkScrubber.flush();
    if (tail) onDelta(tail);
    return {
      text: fullParts.join(""),
      toolCalls: assembleStreamToolCalls(toolAcc),
      sawReasoning,
      finishReason,
    };
  };
  if (useIpcStream) {
    const assembled = finishStreamAssembly();
    await logDebugEvent("llm_stream_complete", {
      provider: cfg.provider,
      durationMs: Date.now() - startedAt,
      outputChars: assembled.text.length,
      toolCalls: assembled.toolCalls.length,
      sawReasoning: assembled.sawReasoning,
      finishReason: assembled.finishReason,
      transport: "ipc_stream",
    });
    return assembled;
  }
  if (!res.body) {
    throw new Error(`${cfg.provider} stream response missing body`);
  }
  const reader = res.body.getReader();
  const abortStream = () => {
    try {
      reader.cancel(options.signal?.reason).catch?.(() => {});
    } catch {
      /* ignore best-effort stream cancellation */
    }
  };
  if (options.signal?.aborted) abortStream();
  else options.signal?.addEventListener?.("abort", abortStream, { once: true });
  const dec = new TextDecoder();
  const streamDeadlineAt = Date.now() + STREAM_TOTAL_TIMEOUT_MS;
  async function readNextChunk() {
    if (options.signal?.aborted) {
      throw new Error(`${cfg.provider} stream aborted`);
    }
    const remainingMs = streamDeadlineAt - Date.now();
    if (remainingMs <= 0) {
      throw new Error(
        `${cfg.provider} stream exceeded total timeout of ${Math.round(STREAM_TOTAL_TIMEOUT_MS / 1000)}s`
      );
    }
    const chunkBudget = Math.min(STREAM_CHUNK_TIMEOUT_MS, remainingMs);
    const perReadTimeoutMs = Math.min(remainingMs, Math.max(STREAM_STALL_FLOOR_MS, chunkBudget));
    let timer;
    try {
      return await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `${cfg.provider} stream stalled: no chunks received for ${formatStreamIdleWait(
                    perReadTimeoutMs
                  )}`
                )
              ),
            perReadTimeoutMs
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  try {
    while (true) {
      const { done, value } = await readNextChunk();
      if (options.signal?.aborted) {
        throw new Error(`${cfg.provider} stream aborted`);
      }
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n");
      buf = parts.pop() || "";
      for (const line of parts) {
        const s = line.trim();
        if (!s.startsWith("data:")) continue;
        parseData(s.slice(5).trim());
      }
    }
    for (const line of buf.split("\n")) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      parseData(s.slice(5).trim());
    }
  } finally {
    options.signal?.removeEventListener?.("abort", abortStream);
  }
  const assembled = finishStreamAssembly();
  await logDebugEvent("llm_stream_complete", {
    provider: cfg.provider,
    durationMs: Date.now() - startedAt,
    outputChars: assembled.text.length,
    toolCalls: assembled.toolCalls.length,
    sawReasoning: assembled.sawReasoning,
    finishReason: assembled.finishReason,
  });
  return assembled;
}

/** DeepSeek DSML uses fullwidth ｜ (U+FF5C); some gateways mirror ASCII |. */
const DSML_PIPE = "[|｜]";
const DSML_OPEN = `<${DSML_PIPE}DSML${DSML_PIPE}`;
const DSML_CLOSE = `<\\/${DSML_PIPE}DSML${DSML_PIPE}`;

function parseDsmlInvokeInner(name: string, inner: string): ToolCallPayload | null {
  const toolName = String(name || "").trim();
  if (!toolName) return null;
  const args: Record<string, unknown> = {};
  const paramRe = new RegExp(
    `${DSML_OPEN}parameter\\s+name="([^"]+)"[^>]*>([\\s\\S]*?)${DSML_CLOSE}parameter>`,
    "gi"
  );
  let m;
  while ((m = paramRe.exec(inner))) {
    const key = String(m[1] || "").trim();
    if (key) args[key] = String(m[2] || "").trim();
  }
  return { name: toolName, arguments: args };
}

export function extractDsmlToolCallPayloads(text: string) {
  const tools: ToolCallPayload[] = [];
  const input = String(text || "");
  const blockRe = new RegExp(`${DSML_OPEN}tool_calls>([\\s\\S]*?)${DSML_CLOSE}tool_calls>`, "gi");
  const invokeRe = new RegExp(
    `${DSML_OPEN}invoke\\s+name="([^"]+)"[^>]*>([\\s\\S]*?)${DSML_CLOSE}invoke>`,
    "gi"
  );
  let blockMatch;
  while ((blockMatch = blockRe.exec(input))) {
    const block = blockMatch[1];
    invokeRe.lastIndex = 0;
    let invokeMatch;
    while ((invokeMatch = invokeRe.exec(block))) {
      const call = parseDsmlInvokeInner(invokeMatch[1], invokeMatch[2]);
      if (call) tools.push(call);
    }
  }
  if (tools.length === 0) {
    invokeRe.lastIndex = 0;
    let invokeMatch;
    while ((invokeMatch = invokeRe.exec(input))) {
      const call = parseDsmlInvokeInner(invokeMatch[1], invokeMatch[2]);
      if (call) tools.push(call);
    }
  }
  let visible = input.replace(blockRe, "");
  visible = visible.replace(invokeRe, "");
  visible = visible.replace(
    new RegExp(`${DSML_OPEN}parameter\\s+[^>]*>[\\s\\S]*?${DSML_CLOSE}parameter>`, "gi"),
    ""
  );
  return { tools, visible: visible.trimEnd() };
}

export function stripDsmlToolMarkup(text: string): string {
  return extractDsmlToolCallPayloads(text).visible;
}

export function looksLikeUnparsedPlainToolHints(text: string): boolean {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (PLAIN_TOOL_NAME_RE.test(lines[i])) return true;
    if (TRAILING_PLAIN_TOOL_LINE_RE.test(lines[i])) return true;
  }
  return false;
}

const UNPARSED_DSML_TOOL_MARKUP_RE = new RegExp(`${DSML_OPEN}(?:tool_calls|invoke|parameter)`, "i");

export function looksLikeUnparsedToolMarkup(text: string): boolean {
  const raw = String(text || "");
  if (UNPARSED_DSML_TOOL_MARKUP_RE.test(raw)) return true;
  if (/<[^>\n]*[|｜][^>\n]*DSML[^>\n]*>/i.test(raw)) return true;
  if (/<invoke\b[\s\S]*?<\/invoke>/i.test(raw)) return true;
  if (/<parameter\b[\s\S]*?<\/parameter>/i.test(raw)) return true;
  if (/<function>\s*[\s\S]*?<\/function>/i.test(raw)) return true;
  if (/<function_name>/i.test(raw)) return true;
  if (/<(read_file|write_file|edit_file|artifact_present|grep|browse_workspace|list_dir|find_files|make_dir|delete_file|web_search|web_fetch|run_shell)\b[^>]*>[\s\S]*?<\/\1>/i.test(raw)) {
    return true;
  }
  if (looksLikeUnparsedPlainToolHints(raw)) return true;
  return false;
}

export function stripPlainToolHintLines(text: string): string {
  const lines = String(text || "").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (PLAIN_TOOL_NAME_RE.test(trimmed)) {
      const next = (lines[i + 1] ?? "").trim();
      if (next && (next === "." || /^[a-z0-9_./~-]+$/i.test(next))) {
        i++;
      }
      continue;
    }
    if (TRAILING_PLAIN_TOOL_LINE_RE.test(trimmed)) continue;
    if (/^\.\s*$/.test(trimmed)) continue;
    out.push(lines[i]);
  }
  return out.join("\n").trim();
}

export function stripMarkupForContinuationHeuristics(text: string): string {
  let out = stripDsmlToolMarkup(String(text || ""));
  out = stripPlainToolHintLines(out);
  out = stripXmlToolArtifacts(out);
  out = stripModelControlTokens(out);
  return out.trim();
}

export function stripXmlToolArtifacts(text) {
  if (!text) return "";
  const patterns = [
    /<tool_call>[\s\S]*?<\/tool_call>/gi,
    /<TOOLCALL>[\s\S]*?<\/TOOLCALL>/gi,
    /<tool_use>[\s\S]*?<\/tool_use>/gi,
    /<result>[\s\S]*?<\/result>/gi,
    /<param(?:eter)?\b[^>]*>[\s\S]*?<\/param(?:eter)?>/gi,
    /<tool_code>[\s\S]*?<\/tool_code>/gi,
    /<StartToolCall>[\s\S]*?<\/StartToolCall>/gi,
    /<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/gi,
    /<longcat_tool_call>[\s\S]*?<\/longcat_tool_call>/gi,
    /<function>[\s\S]*?<\/function>/gi,
    /<invoke\b[\s\S]*?<\/invoke>/gi,
    /<(read_file|write_file|edit_file|artifact_present|grep|browse_workspace|list_dir|find_files|make_dir|delete_file|web_search|web_fetch|run_shell)\b[^>]*>[\s\S]*?<\/\1>/gi,
  ];
  let out = String(text);
  for (const pattern of patterns) out = out.replace(pattern, "");
  return out;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-line pseudo tool calls models emit instead of real tool_calls / markers.
 * - Exact registry names: `list_dir{"path":"."}`
 * - Typos / camelCase: `readfile{"path":"x.md"}` (not `read_file`)
 * Shallow `{...}` only (no nested braces); requires a JSON-like `"key":` inside.
 */
const PSEUDO_TOOL_LINE_GENERIC_RE =
  /^\s*[a-z][a-z0-9_]{1,48}\s*\{[^}]*"[\w$]+"\s*:\s*[^}]+\}\s*$/i;

function lineLooksLikePseudoToolCall(line, exactNameRe) {
  const t = String(line || "").replace(/^call:\s*tool\s*/i, "").trim();
  if (exactNameRe?.test(t)) return true;
  if (/^call:\s*tool\s*\{/i.test(String(line || ""))) return true;
  return PSEUDO_TOOL_LINE_GENERIC_RE.test(t);
}

/**
 * Whole-line shell-like tool hints (`list_dir .`, `web_search foo`).
 * Multi-arg tools such as cron_register are not supported here — use provider tool_calls or <<<TOOL>>> JSON.
 */
const PLAIN_TOOL_NAME_RE =
  /^(tree|list_dir|read_file|write_file|browse_workspace|grep|find_files|web_search|web_fetch|make_dir|delete_file|run_shell|memory_search)$/i;

const TRAILING_PLAIN_TOOL_LINE_RE =
  /^\s*(.+?)\s+(read_file|write_file|tree|list_dir|browse_workspace|grep|find_files)\s*$/i;

function mergeSplitPlainToolCommandLines(text: string): string {
  const lines = String(text || "").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i].trim();
    const next = (lines[i + 1] ?? "").trim();
    if (
      PLAIN_TOOL_NAME_RE.test(cur) &&
      next &&
      (next === "." || /^[a-z0-9_./~-]+$/i.test(next))
    ) {
      out.push(`${cur} ${next}`);
      i++;
      continue;
    }
    out.push(lines[i]);
  }
  return out.join("\n");
}

function resolvePlainToolPayload(
  name: string,
  arg: string,
  names: Set<string>
): ToolCallPayload | null {
  const lower = String(name || "").trim().toLowerCase();
  const pathArg = String(arg || "").trim() || ".";
  if (lower === "tree") {
    if (names.has("tree")) return { name: "tree", arguments: { path: pathArg } };
    if (names.has("browse_workspace")) {
      return { name: "browse_workspace", arguments: { action: "tree", path: pathArg } };
    }
    return null;
  }
  if (lower === "list_dir") {
    if (names.has("list_dir")) return { name: "list_dir", arguments: { path: pathArg } };
    if (names.has("browse_workspace")) {
      return { name: "browse_workspace", arguments: { action: "list", path: pathArg } };
    }
    return null;
  }
  if (lower === "find_files") {
    if (names.has("find_files")) return { name: "find_files", arguments: { pattern: pathArg } };
    if (names.has("browse_workspace")) {
      return { name: "browse_workspace", arguments: { action: "find", path: ".", pattern: pathArg } };
    }
    return null;
  }
  if (!names.has(lower) && !names.has(name)) return null;
  const resolved = names.has(name) ? name : lower;
  if (/^(read_file|list_dir|make_dir|delete_file)$/i.test(resolved)) {
    return { name: resolved, arguments: { path: pathArg } };
  }
  if (resolved === "run_shell") return { name: resolved, arguments: { command: pathArg } };
  if (resolved === "web_search" || resolved === "memory_search") {
    return { name: resolved, arguments: { query: pathArg } };
  }
  if (resolved === "web_fetch") return { name: resolved, arguments: { url: pathArg } };
  if (resolved === "browse_workspace") {
    return { name: "browse_workspace", arguments: { action: "list", path: pathArg } };
  }
  return null;
}

function parseTrailingPlainToolLine(line: string, names: Set<string>): ToolCallPayload | null {
  const m = String(line || "").match(TRAILING_PLAIN_TOOL_LINE_RE);
  if (!m) return null;
  const hint = String(m[1] || "").trim();
  const tool = String(m[2] || "").trim().toLowerCase();
  if (/[/\\]|\.[a-z0-9]{1,8}$/i.test(hint)) {
    return resolvePlainToolPayload(tool, hint, names);
  }
  if (tool === "read_file" && names.has("browse_workspace")) {
    const token = hint.split(/\s+/).find((w) => w.length > 3) || hint;
    return {
      name: "browse_workspace",
      arguments: { action: "find", path: ".", pattern: `*${token}*` },
    };
  }
  return null;
}

function parsePlainToolCommandLine(line: string, toolNames?: string[]): ToolCallPayload | null {
  const names = new Set(Array.isArray(toolNames) ? toolNames : []);
  const trailing = parseTrailingPlainToolLine(line, names);
  if (trailing) return trailing;
  const match = String(line || "").match(/^\s*([a-z][a-z0-9_]{1,48})\s+(.+?)\s*$/i);
  if (!match) return null;
  const name = match[1];
  let arg = match[2].trim();
  if (!arg || /^[`'"]?$/.test(arg)) return null;
  arg = arg.replace(/^['"`]|['"`]$/g, "");
  return resolvePlainToolPayload(name, arg, names);
}

function findJsonValueSpans(text: string): JsonValueSpan[] {
  const input = String(text || "");
  const spans: JsonValueSpan[] = [];
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let start = -1;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      if (stack.length === 0) start = i;
      stack.push(ch);
      continue;
    }
    if (ch !== "}" && ch !== "]") continue;
    const open = stack[stack.length - 1];
    if ((ch === "}" && open !== "{") || (ch === "]" && open !== "[")) {
      stack.length = 0;
      start = -1;
      continue;
    }
    stack.pop();
    if (stack.length === 0 && start >= 0) {
      spans.push({ start, end: i + 1, text: input.slice(start, i + 1) });
      start = -1;
    }
  }
  return spans;
}

function parseJsonValueLoose(payload) {
  const raw = String(payload || "").trim();
  if (!raw) return null;
  const candidates = [
    raw,
    raw.replace(/[“”]/g, "\"").replace(/[‘’]/g, "'").replace(/,\s*([}\]])/g, "$1"),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* try the next repair candidate */
    }
  }
  return null;
}

function normalizeJsonToolName(value) {
  return String(value?.name || value?.tool || value?.function?.name || "").trim();
}

function collectToolCallsFromJsonValue(
  value: unknown,
  toolNames: string[] | undefined,
  out: ToolCallPayload[] = []
): boolean {
  const knownTools = toolNames?.length ? new Set(toolNames) : null;
  const addCall = (call: Record<string, unknown>, allowNameOnly = false): boolean => {
    const fn = (call?.function as Record<string, unknown> | undefined) || {};
    const explicitToolShape =
      allowNameOnly ||
      knownTools ||
      typeof call?.tool === "string" ||
      typeof fn?.name === "string";
    const name = normalizeJsonToolName(call);
    if (!explicitToolShape || !name || (knownTools && !knownTools.has(name))) return false;
    out.push({
      name,
      arguments: (fn?.arguments ?? call?.arguments ?? call?.args ?? {}) as Record<string, unknown>,
    });
    return true;
  };

  if (Array.isArray(value)) {
    let added = false;
    for (const item of value) added = collectToolCallsFromJsonValue(item, toolNames, out) || added;
    return added;
  }
  if (!value || typeof value !== "object") return false;

  let added = false;
  const calls = (value as Record<string, unknown>).tool_calls || (value as Record<string, unknown>).toolCalls;
  if (Array.isArray(calls)) {
    for (const call of calls) added = addCall(call as Record<string, unknown>, true) || added;
  }
  if ((value as Record<string, unknown>).tool_call) {
    added = collectToolCallsFromJsonValue((value as Record<string, unknown>).tool_call, toolNames, out) || added;
  }
  if ((value as Record<string, unknown>).toolCall) {
    added = collectToolCallsFromJsonValue((value as Record<string, unknown>).toolCall, toolNames, out) || added;
  }
  if (normalizeJsonToolName(value)) added = addCall(value as Record<string, unknown>) || added;
  return added;
}

export function extractJsonToolCallPayloads(text: string, toolNames?: string[]) {
  const tools: ToolCallPayload[] = [];
  const removableSpans: JsonValueSpan[] = [];
  for (const span of findJsonValueSpans(text)) {
    const parsed = parseJsonValueLoose(span.text);
    const beforeCount = tools.length;
    if (collectToolCallsFromJsonValue(parsed, toolNames, tools)) {
      removableSpans.push(span);
    } else {
      tools.length = beforeCount;
    }
  }
  let visible = String(text || "");
  for (const span of removableSpans.slice().reverse()) {
    visible = visible.slice(0, span.start) + visible.slice(span.end);
  }
  return { tools, visible: visible.trimEnd() };
}

export function stripPseudoToolCallLines(text, toolNames) {
  const names = (toolNames || [])
    .map((n) => escapeRegExp(String(n || "").trim()))
    .filter(Boolean);
  const exactNameRe =
    names.length > 0
      ? new RegExp(`^\\s*(?:${names.join("|")})\\s*\\{[^{}]*\\}\\s*$`, "i")
      : null;
  return String(text || "")
    .split("\n")
    .filter((line) => !lineLooksLikePseudoToolCall(line, exactNameRe))
    .join("\n");
}

export function stripJsonToolCallPayloads(text, toolNames) {
  return extractJsonToolCallPayloads(text, toolNames).visible;
}

export function extractPlainToolCommandLines(text: string, toolNames?: string[]) {
  const tools: ToolCallPayload[] = [];
  const visibleLines: string[] = [];
  const merged = mergeSplitPlainToolCommandLines(text);
  for (const line of merged.split("\n")) {
    const parsed = parsePlainToolCommandLine(line, toolNames);
    if (parsed) tools.push(parsed);
    else visibleLines.push(line);
  }
  return { tools, visible: visibleLines.join("\n").trimEnd() };
}

/** Lines like `call:tool{"name="find_find_files"arguments={...}`. */
export function extractLooseCallToolLines(text: string, toolNames?: string[]) {
  const known = toolNames?.length ? new Set(toolNames) : null;
  const tools: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const visibleLines: string[] = [];
  for (const line of String(text || "").split("\n")) {
    const trimmed = line.trim();
    if (!/^call:\s*tool/i.test(trimmed) && !/^(?:name|tool)\s*=/i.test(trimmed)) {
      visibleLines.push(line);
      continue;
    }
    const payload = trimmed.replace(/^call:\s*tool\s*/i, "").trim();
    const repaired = repairLooseToolCallObject(payload.startsWith("{") ? payload : `{${payload}}`);
    if (!repaired?.name) {
      visibleLines.push(line);
      continue;
    }
    const name = resolveKnownToolName(repaired.name, known || []);
    if (known && !known.has(name)) {
      visibleLines.push(line);
      continue;
    }
    tools.push({ name, arguments: repaired.arguments });
  }
  return { tools, visible: visibleLines.join("\n").trimEnd() };
}

export function stripModelControlTokens(text) {
  if (!text) return "";
  return String(text)
    .replace(/<[^>\n]*[|｜][^>\n]*>/g, "")
    .trim();
}

/** Some gateways stream the word `thought` on its own line in `content` while hiding real reasoning elsewhere. */
export function stripReasoningPlaceholderLines(text) {
  return String(text || "")
    .split("\n")
    .filter((line) => line.trim().toLowerCase() !== "thought")
    .join("\n");
}

/** Pull `<<<CLARIFY>>>` host markers out of model text; emit blocks on stdout separately from visible chat. */
export function extractClarifyMarkers(text: string) {
  const re = /<<<\s*CLARIFY\s*>>>[\s\S]*?<<<\s*END\s*>>>/gi;
  const blocks: string[] = [];
  const raw = String(text || "");
  let m;
  while ((m = re.exec(raw))) {
    blocks.push(m[0]);
  }
  const visible = raw.replace(re, "").trimEnd();
  return { blocks, visible };
}

/** Remove truncated <<<TOOL>>> / <<<CLARIFY>>> marker bytes models emit without <<<END>>>. */
export function stripOrphanToolMarkerArtifacts(text: string): string {
  let out = String(text || "");
  out = out.replace(/<<<\s*TOOL\s*>>>[\s\S]*$/gi, "");
  out = out.replace(/<<<\s*CLARIFY\s*>>>[\s\S]*$/gi, "");
  out = out.replace(/^\s*<<<\s*TOOL\s*>>>[^\n]*$/gim, "");
  return out.trimEnd();
}

function salvageOrphanMarkerToolPayload(payload: string): Record<string, unknown> | null {
  const raw = String(payload || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  const name = raw.match(/"name"\s*:\s*"([^"]+)"/)?.[1]?.trim();
  if (!name) return null;
  const argsMatch = raw.match(/"arguments"\s*:\s*(\{[\s\S]*)/);
  if (argsMatch) {
    try {
      const repaired = repairToolCallArgumentsJson(argsMatch[1], name);
      return { name, arguments: parseToolArguments(repaired, name) };
    } catch {
      /* fall through */
    }
  }
  return { name, arguments: {} };
}

/** @param knownToolNames — adds exact-name matches; generic `name{"k":…}` lines strip even when [] */
export function sanitizeAssistantVisibleText(text: string, knownToolNames?: string[]) {
  const withoutMarkers = stripOrphanToolMarkerArtifacts(
    String(text || "")
      .replace(/<<<\s*TOOL\s*>>>[\s\S]*?<<<\s*END\s*>>>/gi, "")
      .replace(/<<<\s*CLARIFY\s*>>>[\s\S]*?<<<\s*END\s*>>>/gi, "")
      .trim()
  );
  let out = stripDsmlToolMarkup(withoutMarkers).trim();
  out = stripXmlToolArtifacts(out).trim();
  const names = Array.isArray(knownToolNames) ? knownToolNames : [];
  out = stripJsonToolCallPayloads(out, names).trim();
  out = extractLooseCallToolLines(out, names).visible.trim();
  out = extractPlainToolCommandLines(out, names).visible.trim();
  out = stripPseudoToolCallLines(out, names).trim();
  out = stripModelControlTokens(out).trim();
  out = stripReasoningPlaceholderLines(out).trim();
  return out;
}

export function extractMarkerTools(text: string) {
  const re = /<<<\s*TOOL\s*>>>\s*([\s\S]*?)\s*<<<\s*END\s*>>>/gi;
  const tools: Array<Record<string, unknown>> = [];
  let m;
  while ((m = re.exec(text))) {
    const payload = m[1].trim();
    try {
      tools.push(JSON.parse(payload));
    } catch {
      const salvaged = salvageWriteFileArgumentsFromRawJson(payload);
      const explicitName = payload.match(/"name"\s*:\s*"([^"]+)"/)?.[1];
      if (salvaged && (!explicitName || explicitName === "write_file")) {
        tools.push({ name: explicitName || "write_file", arguments: salvaged });
        continue;
      }
      try {
        const repaired = payload
          .replace(/[“”]/g, '"')
          .replace(/[‘’]/g, "'")
          .replace(/,\s*([}\]])/g, "$1");
        tools.push(JSON.parse(repaired));
      } catch {
        const name = payload.match(/"name"\s*:\s*"([^"]+)"/)?.[1];
        if (!name) continue;
        const argsMatch = payload.match(/"arguments"\s*:\s*(\{[\s\S]*\})/);
        if (!argsMatch) {
          tools.push({ name, arguments: {} });
          continue;
        }
        try {
          tools.push({ name, arguments: JSON.parse(argsMatch[1]) });
        } catch {
          tools.push({ name, arguments: {} });
        }
      }
    }
  }
  for (const orphan of extractOrphanMarkerTools(text)) {
    if (orphan?.name) tools.push(orphan);
  }
  const visible = stripOrphanToolMarkerArtifacts(text.replace(re, "").trimEnd());
  return { tools, visible };
}

function extractOrphanMarkerTools(text: string) {
  const re = /<<<\s*TOOL\s*>>>\s*([\s\S]*?)(?=<<<\s*TOOL\s*>>>|$)/gi;
  const tools: Array<Record<string, unknown>> = [];
  let m;
  const raw = String(text || "");
  while ((m = re.exec(raw))) {
    const segment = String(m[1] || "");
    if (/<<<\s*END\s*>>>/i.test(segment)) continue;
    const salvaged = salvageOrphanMarkerToolPayload(segment);
    if (salvaged?.name) tools.push(salvaged);
  }
  return tools;
}

function parseLongcatToolCallPayload(payload) {
  const raw = String(payload || "").trim();
  if (!raw) return null;
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      const calls = Array.isArray(parsed) ? parsed : [parsed];
      return calls.map((call) => ({
        name: String(call?.name || "").trim(),
        arguments: call?.arguments ?? {},
      })).filter((call) => call.name);
    } catch {
      /* fall through to name/arg-key format */
    }
  }
  const keys = [...raw.matchAll(/<longcat_arg_key>\s*([\s\S]*?)\s*<\/longcat_arg_key>/gi)].map(
    (m) => String(m[1] || "").trim()
  );
  const vals = [...raw.matchAll(/<longcat_arg_value>\s*([\s\S]*?)\s*<\/longcat_arg_value>/gi)].map(
    (m) => String(m[1] || "").trim()
  );
  const args = {};
  for (let i = 0; i < keys.length; i++) {
    if (keys[i]) args[keys[i]] = vals[i] ?? "";
  }
  const namePart = raw
    .replace(/<longcat_arg_key>[\s\S]*?<\/longcat_arg_key>/gi, "")
    .replace(/<longcat_arg_value>[\s\S]*?<\/longcat_arg_value>/gi, "")
    .trim();
  const name = namePart.split(/\s+/)[0]?.trim() || "";
  if (!name) return null;
  return [{ name, arguments: args }];
}

export function extractLongcatToolCallPayloads(text: string) {
  const re = /<longcat_tool_call>\s*([\s\S]*?)\s*<\/longcat_tool_call>/gi;
  const tools: ToolCallPayload[] = [];
  let m;
  while ((m = re.exec(String(text || "")))) {
    const parsed = parseLongcatToolCallPayload(m[1]);
    if (!parsed) continue;
    for (const call of parsed) tools.push(call);
  }
  const visible = String(text || "").replace(re, "").trimEnd();
  return { tools, visible };
}

export function extractToolCallTagPayloads(text: string) {
  const re = /<TOOLCALL>\s*([\s\S]*?)\s*<\/TOOLCALL>/gi;
  const tools: ToolCallPayload[] = [];
  let m;
  while ((m = re.exec(String(text || "")))) {
    const payload = String(m[1] || "").trim();
    if (!payload) continue;
    try {
      const parsed = JSON.parse(payload);
      const calls = Array.isArray(parsed) ? parsed : [parsed];
      for (const call of calls) {
        tools.push({ name: call?.name || "", arguments: call?.arguments ?? {} });
      }
    } catch {
      /* ignore malformed TOOLCALL payload */
    }
  }
  const visible = String(text || "").replace(re, "").trimEnd();
  return { tools, visible };
}

function parseFunctionXmlBlock(inner: string): ToolCallPayload | null {
  const block = String(inner || "");
  const name =
    block.match(/<function_name>\s*([\s\S]*?)\s*<\/function_name>/i)?.[1]?.trim() || "";
  if (!name) return null;
  const argsRaw =
    block.match(
      /<function_(?:arguments|parameters)>\s*([\s\S]*?)\s*<\/function_(?:arguments|parameters)>/i
    )?.[1]?.trim() || "";
  let args: Record<string, unknown> = {};
  if (argsRaw) {
    try {
      const parsed = JSON.parse(argsRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      /* malformed function args */
    }
  }
  return { name, arguments: args };
}

export function extractFunctionXmlToolCallPayloads(text: string) {
  const re = /<function>\s*([\s\S]*?)\s*<\/function>/gi;
  const tools: ToolCallPayload[] = [];
  let m;
  while ((m = re.exec(String(text || "")))) {
    const parsed = parseFunctionXmlBlock(m[1]);
    if (parsed?.name) tools.push(parsed);
  }
  const visible = String(text || "").replace(re, "").trimEnd();
  return { tools, visible };
}

function parseNamedXmlToolBlock(name: string, inner: string): ToolCallPayload | null {
  const toolName = String(name || "").trim();
  if (!toolName) return null;
  const args: Record<string, unknown> = {};
  const childRe = /<([a-zA-Z_][\w.-]*)\b[^>]*>([\s\S]*?)<\/\1>/g;
  let child;
  while ((child = childRe.exec(String(inner || "")))) {
    const key = String(child[1] || "").trim();
    if (!key) continue;
    args[key] = String(child[2] || "").trim();
  }
  return { name: toolName, arguments: args };
}

/**
 * Big Pickle sometimes emits bare XML-shaped tool calls:
 * `<read_file><path>projects/x.md</path></read_file>`.
 */
export function extractNamedXmlToolCallPayloads(text: string, toolNames?: string[]) {
  const known = new Set(Array.isArray(toolNames) ? toolNames : []);
  const names = [...known]
    .filter((name) => /^[a-z][a-z0-9_]{1,48}$/i.test(String(name || "")))
    .sort((a, b) => b.length - a.length);
  if (!names.length) return { tools: [] as ToolCallPayload[], visible: String(text || "") };
  const nameAlternation = names.map(escapeRegExp).join("|");
  const re = new RegExp(`<(${nameAlternation})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, "gi");
  const input = String(text || "");
  const tools: ToolCallPayload[] = [];
  let m;
  while ((m = re.exec(input))) {
    const parsed = parseNamedXmlToolBlock(m[1], m[2]);
    if (parsed?.name) tools.push(parsed);
  }
  return { tools, visible: input.replace(re, "").trimEnd() };
}

export function normalizeToolCalls(
  rawCalls: unknown,
  toolNames: unknown
): {
  normalized: ToolCallPayload[];
  rejected: Array<{ reason: string; call: unknown }>;
} {
  const knownTools = new Set(Array.isArray(toolNames) ? (toolNames as string[]) : []);
  const normalized: ToolCallPayload[] = [];
  const rejected: Array<{ reason: string; call: unknown }> = [];
  const seenCallKeys = new Set<string>();
  const MAX_TOOL_CALLS_PER_TURN = 16;
  for (const raw of (Array.isArray(rawCalls) ? rawCalls : []) as Array<Record<string, unknown>>) {
    if (normalized.length >= MAX_TOOL_CALLS_PER_TURN) {
      rejected.push({ reason: "too_many_calls", call: raw });
      continue;
    }
    const rawName = String(raw?.name || "").trim();
    if (!rawName) {
      rejected.push({ reason: "missing_name", call: raw });
      continue;
    }
    let args: Record<string, unknown> = {};
    const rawArgs = raw?.arguments;
    let rawArgsWire = "";
    if (typeof rawArgs === "string") {
      const trimmed = rawArgs.trim();
      rawArgsWire = trimmed;
      args = trimmed ? parseToolArguments(trimmed, rawName) : {};
    } else if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
      args = rawArgs as Record<string, unknown>;
    }
    args = mergeFlatToolCallArguments(raw, args);
    if (rawName === "write_file") {
      const salvageWire =
        rawArgsWire || (Object.keys(args).length ? JSON.stringify({ ...raw, ...args }) : "");
      args = parseWriteFileToolArguments(salvageWire, args);
    }
    const resolved = resolveKnownToolName(rawName, knownTools);
    const normalizedSkill = normalizeSkillToolCall(resolved, args, rawName);
    const name = normalizedSkill.name;
    args = normalizedSkill.args;
    if (!knownTools.has(name)) {
      rejected.push({ reason: "unknown_tool", call: raw });
      continue;
    }
    // Common alias normalization (inspired by opencrabs param aliases).
    // Keeps tool handlers simple and improves cross-model reliability.
    if (name === "edit_file") {
      if (!Object.prototype.hasOwnProperty.call(args, "old") && typeof args.old_string === "string") {
        args.old = args.old_string;
      }
      if (!Object.prototype.hasOwnProperty.call(args, "new") && typeof args.new_string === "string") {
        args.new = args.new_string;
      }
    }
    if ((name === "read_file" || name === "write_file" || name === "edit_file") && !args.path) {
      if (typeof args.file === "string") args.path = args.file;
      else if (typeof args.file_path === "string") args.path = args.file_path;
      else if (typeof args.filepath === "string") args.path = args.filepath;
      else if (typeof args.target_file === "string") args.path = args.target_file;
    }
    if (name === "web_fetch" && !args.url) {
      if (typeof args.link === "string") args.url = args.link;
      else if (typeof args.href === "string") args.url = args.href;
      else if (typeof args.uri === "string") args.url = args.uri;
    }
    if (name === "run_shell" && !args.command && typeof args.cmd === "string") {
      args.command = args.cmd;
    }
    // Deduplicate: same tool + same serialized args within one round = duplicate emission
    // (happens when model uses both native tool_calls and <<<TOOL>>> markers).
    const key = `${name}:${JSON.stringify(args)}`;
    if (seenCallKeys.has(key)) {
      rejected.push({ reason: "duplicate_call", call: raw });
      continue;
    }
    seenCallKeys.add(key);
    normalized.push({ name, arguments: args });
  }
  return { normalized, rejected };
}

function longestToolPrefixSuffix(input) {
  let longest = 0;
  for (const marker of HIDDEN_STREAM_MARKERS) {
    const max = Math.min(input.length, marker.start.length - 1);
    for (let len = max; len > 0; len--) {
      if (marker.start.startsWith(input.slice(-len))) {
        longest = Math.max(longest, len);
        break;
      }
    }
  }
  return longest;
}

export function liveMirrorVisibleGap(streamed: string, final: string): string {
  const s = String(streamed || "").trimEnd();
  const f = String(final || "").trimEnd();
  if (!f || f.length <= s.length) return "";
  if (!s) return f;
  if (f.startsWith(s)) return f.slice(s.length);
  let i = 0;
  const limit = Math.min(s.length, f.length);
  while (i < limit && s.charCodeAt(i) === f.charCodeAt(i)) i += 1;
  if (i >= s.length) return f.slice(i);
  return "";
}

export function createToolAwareStreamWriter(writeChunk: (chunk: string) => void) {
  let buffer = "";
  let insideToolBlock: HiddenStreamMarker | null = null;
  /** Prefix of hidden tool-block bytes dropped while waiting for END (stream may end mid-block). */
  let insideHiddenAccum = "";

  return {
    push(chunk) {
      if (!chunk) return;
      buffer += chunk;
      while (buffer.length > 0) {
        if (insideToolBlock) {
          const toolEnd = buffer.indexOf(insideToolBlock.end);
          if (toolEnd < 0) {
            if (buffer.length > insideToolBlock.end.length) {
              const keep = insideToolBlock.end.length - 1;
              insideHiddenAccum += buffer.slice(0, buffer.length - keep);
              buffer = buffer.slice(-keep);
            }
            break;
          }
          buffer = buffer.slice(toolEnd + insideToolBlock.end.length);
          insideToolBlock = null;
          insideHiddenAccum = "";
          continue;
        }

        let nextToolStart = -1;
        let nextMarker: HiddenStreamMarker | null = null;
        for (const marker of HIDDEN_STREAM_MARKERS) {
          const idx = buffer.indexOf(marker.start);
          if (idx < 0) continue;
          if (nextToolStart < 0 || idx < nextToolStart) {
            nextToolStart = idx;
            nextMarker = marker;
          }
        }
        if (nextToolStart === 0 && nextMarker) {
          buffer = buffer.slice(nextMarker.start.length);
          insideToolBlock = nextMarker;
          insideHiddenAccum = "";
          continue;
        }
        if (nextToolStart > 0) {
          writeChunk(buffer.slice(0, nextToolStart));
          buffer = buffer.slice(nextToolStart);
          continue;
        }
        const overlap = longestToolPrefixSuffix(buffer);
        const safeLen = buffer.length - overlap;
        if (safeLen > 0) {
          writeChunk(buffer.slice(0, safeLen));
          buffer = buffer.slice(safeLen);
        }
        break;
      }
    },
    flush() {
      if (!insideToolBlock && buffer.length > 0) writeChunk(buffer);
      buffer = "";
      insideToolBlock = null;
      insideHiddenAccum = "";
    },
  };
}
