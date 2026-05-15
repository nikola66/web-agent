import { HIDDEN_STREAM_MARKERS, LLM_REQUEST_TIMEOUT_MS } from "../constants.js";
import { ipcProxyStreamRequest } from "../ipc.js";
import { logDebugEvent } from "../logging/debug-log.js";

const STREAM_CHUNK_TIMEOUT_MS = 45_000;
/** Never treat sub-second read waits as an idle stall (avoids bogus "0s" near total deadline). */
const STREAM_STALL_FLOOR_MS = 1_000;
const STREAM_TOTAL_TIMEOUT_MS = Math.max(
  LLM_REQUEST_TIMEOUT_MS,
  Number(process.env.WEBAGENT_STREAM_TOTAL_TIMEOUT_MS) || 240_000
);

const HTTP_RETRY_MAX_ATTEMPTS = Math.max(1, Math.min(8, Number(process.env.WEBAGENT_HTTP_MAX_ATTEMPTS) || 3));
const HTTP_RETRY_BASE_MS = Math.max(50, Number(process.env.WEBAGENT_HTTP_RETRY_BASE_MS) || 500);
const HTTP_RETRY_MAX_MS = Math.max(HTTP_RETRY_BASE_MS, Number(process.env.WEBAGENT_HTTP_RETRY_MAX_MS) || 8000);
const HTTP_RETRY_JITTER_RATIO = Math.min(0.5, Math.max(0, Number(process.env.WEBAGENT_HTTP_RETRY_JITTER) || 0.2));

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
  return new Promise((r) => setTimeout(r, ms));
}

function formatStreamIdleWait(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "0ms";
  if (n < 1500) return `${Math.round(n)}ms`;
  return `${Math.round(n / 1000)}s`;
}

function sanitizeHeadersForFetch(headers = {}) {
  const out = {};
  for (const [rawName, rawValue] of Object.entries(headers || {})) {
    const name = String(rawName || "").trim();
    if (!name) continue;
    const value = String(rawValue ?? "");
    // Some fetch implementations validate headers as ByteString (0-255 only).
    // Strip out out-of-range code points so user/model unicode in profile/config
    // headers cannot crash request construction.
    const byteSafeValue = value.replace(/[^\x00-\xFF]/g, "");
    out[name] = byteSafeValue;
  }
  return out;
}

export function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(String(text).length / 4));
}

export function estimateMessagesTokens(messages) {
  let total = 0;
  for (const msg of messages || []) {
    total += 4;
    total += estimateTokens(msg.role || "");
    total += estimateTokens(msg.content || "");
  }
  return total + 2;
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = LLM_REQUEST_TIMEOUT_MS, label = "LLM request") {
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
  const { signal: _externalSignal, ...fetchOptions } = options || {};
  let forcedFailuresLeft = Math.max(0, Math.min(32, Math.floor(Number(process.env.WEBAGENT_FORCE_HTTP_FAIL) || 0)));

  const isAbortError = (err) => err?.name === "AbortError";
  const isRetryableNetworkError = (err) => {
    if (externalSignal?.aborted) return false;
    const msg = String(err?.message || err);
    return (
      msg.includes("Forced fetch failure") ||
      msg.includes("Failed to fetch") ||
      msg.includes("NetworkError") ||
      msg.includes("Load failed") ||
      err?.name === "TypeError"
    );
  };

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
      return await fetch(targetUrl, { ...fetchOptions, signal: controller.signal });
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
  let lastErr = null;
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
  throw new Error(`${label} failed (${url}): ${lastError || String(lastErr?.message || lastErr)}`);
}

function formatProviderError(provider, status, bodyText) {
  let providerMessage = "";
  try {
    const parsed = JSON.parse(String(bodyText || ""));
    if (typeof parsed?.error === "string") providerMessage = parsed.error.trim();
  } catch {
    /* ignore non-JSON error bodies */
  }
  if (providerMessage) return providerMessage;
  const details = String(bodyText || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  return `${provider} API ${status}: ${details || "empty error response"}`;
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

function toolsCapabilityHint(provider, toolCount, status, bodyText) {
  if (!toolCount) return "";
  const base =
    ` (${toolCount} tool definition(s) were sent; this runtime requires a chat/completions API that accepts OpenAI-style \`tools\`.)`;
  if (looksLikeToolParameterRejection(status, bodyText)) {
    return `${base} The response suggests tools/functions are not supported — switch provider/model or fix the gateway.`;
  }
  return base;
}

function parseOpenAiStreamPayload(payload, toolAcc, onContent) {
  const choices = Array.isArray(payload?.choices) ? payload.choices : [];
  let sawReasoning = false;
  for (const choice of choices) {
    const delta = choice?.delta || {};
    const content = delta.content;
    if (typeof content === "string" && content) onContent(content);
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
      sawReasoning = true;
    }
    const streamedCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const call of streamedCalls) {
      const idx = Number.isInteger(call?.index) ? call.index : 0;
      const current = toolAcc.get(idx) || { id: "", name: "", arguments: "" };
      if (call?.id) current.id = call.id;
      if (call?.function?.name) current.name = call.function.name;
      if (typeof call?.function?.arguments === "string") current.arguments += call.function.arguments;
      toolAcc.set(idx, current);
    }
  }
  return { sawReasoning };
}

function shouldUseIpcStream(endpoint) {
  if (String(process.env.WEBAGENT_RUNTIME || "").trim() !== "nodebox") return false;
  const appOrigin = String(process.env.WEBAGENT_APP_ORIGIN || "").trim().replace(/\/$/, "");
  return !!(appOrigin && String(endpoint || "").startsWith(`${appOrigin}/api/llm/`));
}

export async function streamOpenAI(messages, cfg, onDelta, tools, options = {}) {
  const headers = sanitizeHeadersForFetch({
    "Content-Type": "application/json",
    ...cfg.extraHeaders,
  });
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const toolList = Array.isArray(tools) ? tools : [];
  const withToolsBody =
    toolList.length > 0
      ? {
          model: cfg.model,
          messages,
          stream: true,
          max_tokens: 8192,
          tools: toolList,
          tool_choice: "auto",
          stream_options: { include_usage: true },
        }
      : {
          model: cfg.model,
          messages,
          stream: true,
          max_tokens: 8192,
          stream_options: { include_usage: true },
        };
  const endpoint = `${cfg.baseUrl}/chat/completions`;
  const startedAt = Date.now();
  await logDebugEvent("llm_stream_start", {
    provider: cfg.provider,
    kind: "openai-compatible",
    model: cfg.model,
    endpoint,
    messageCount: messages.length,
    toolCount: toolList.length,
  });
  const STREAM_HTTP_MAX_ATTEMPTS = Math.max(1, Math.min(6, Number(process.env.WEBAGENT_STREAM_HTTP_MAX_ATTEMPTS) || 3));
  const transientStreamStatus = new Set([429, 502, 503, 504, 524]);
  const useIpcStream = shouldUseIpcStream(endpoint);
  let buf = "";
  let full = "";
  let sawReasoning = false;
  const toolAcc = new Map();
  const parseData = (data) => {
    if (data === "[DONE]") return;
    try {
      const parsed = parseOpenAiStreamPayload(JSON.parse(data), toolAcc, (content) => {
        full += content;
        onDelta(content);
      });
      sawReasoning = sawReasoning || parsed.sawReasoning;
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
    if (useIpcStream) {
      let meta = { status: 0, statusText: "", contentType: "" };
      full = "";
      sawReasoning = false;
      toolAcc.clear();
      buf = "";
      await ipcProxyStreamRequest(
        { method: "POST", url: endpoint, headers, body: JSON.stringify(withToolsBody) },
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
          return full;
        },
        body: null,
      };
    } else {
      res = await fetchWithTimeout(
        endpoint,
        { method: "POST", headers, body: JSON.stringify(withToolsBody), signal: options.signal },
        LLM_REQUEST_TIMEOUT_MS,
        `${cfg.provider} chat request`
      );
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
        transientStreamStatus.has(res.status) &&
        !looksLikeToolParameterRejection(res.status, firstError) &&
        httpAttempt < STREAM_HTTP_MAX_ATTEMPTS - 1,
    });
    const retryable =
      transientStreamStatus.has(res.status) && !looksLikeToolParameterRejection(res.status, firstError);
    if (!retryable || httpAttempt === STREAM_HTTP_MAX_ATTEMPTS - 1) {
      const hint = toolsCapabilityHint(cfg.provider, toolCount, res.status, firstError);
      throw new Error(`${formatProviderError(cfg.provider, res.status, firstError)}${hint}`);
    }
  }
  /* eslint-enable no-await-in-loop */
  if (useIpcStream) {
    const toolCalls = [...toolAcc.values()].map((call) => ({
      name: call.name,
      arguments: call.arguments || "{}",
    }));
    await logDebugEvent("llm_stream_complete", {
      provider: cfg.provider,
      durationMs: Date.now() - startedAt,
      outputChars: full.length,
      toolCalls: toolCalls.length,
      sawReasoning,
      transport: "ipc_stream",
    });
    return { text: full, toolCalls, sawReasoning };
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
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `${cfg.provider} stream stalled: no chunks received for ${formatStreamIdleWait(
                  perReadTimeoutMs
                )}`
              )
            ),
          perReadTimeoutMs
        )
      ),
    ]);
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
  const toolCalls = [...toolAcc.values()].map((call) => ({
    name: call.name,
    arguments: call.arguments || "{}",
  }));
  await logDebugEvent("llm_stream_complete", {
    provider: cfg.provider,
    durationMs: Date.now() - startedAt,
    outputChars: full.length,
    toolCalls: toolCalls.length,
    sawReasoning,
  });
  return { text: full, toolCalls, sawReasoning };
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
    /<invoke\b[\s\S]*?<\/invoke>/gi,
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
  const t = String(line || "");
  if (exactNameRe?.test(t)) return true;
  return PSEUDO_TOOL_LINE_GENERIC_RE.test(t);
}

/**
 * Whole-line shell-like tool hints (`list_dir .`, `web_search foo`).
 * Multi-arg tools such as cron_register are not supported here — use provider tool_calls or <<<TOOL>>> JSON.
 */
function parsePlainToolCommandLine(line, toolNames) {
  const names = Array.isArray(toolNames) ? new Set(toolNames) : new Set();
  const match = String(line || "").match(/^\s*([a-z][a-z0-9_]{1,48})\s+(.+?)\s*$/i);
  if (!match) return null;
  const name = match[1];
  if (!names.has(name)) return null;
  let arg = match[2].trim();
  if (!arg || /^[`'"]?$/.test(arg)) return null;
  arg = arg.replace(/^['"`]|['"`]$/g, "");
  if (/^(read_file|list_dir|tree|make_dir|delete_file)$/i.test(name)) {
    return { name, arguments: { path: arg } };
  }
  if (name === "run_shell") {
    return { name, arguments: { command: arg } };
  }
  if (name === "web_search" || name === "memory_search") {
    return { name, arguments: { query: arg } };
  }
  if (name === "web_fetch") {
    return { name, arguments: { url: arg } };
  }
  return null;
}

function findJsonValueSpans(text) {
  const input = String(text || "");
  const spans = [];
  const stack = [];
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

function collectToolCallsFromJsonValue(value, toolNames, out = []) {
  const knownTools = toolNames?.length ? new Set(toolNames) : null;
  const addCall = (call, allowNameOnly = false) => {
    const fn = call?.function || {};
    const explicitToolShape =
      allowNameOnly ||
      knownTools ||
      typeof call?.tool === "string" ||
      typeof fn?.name === "string";
    const name = normalizeJsonToolName(call);
    if (!explicitToolShape || !name || (knownTools && !knownTools.has(name))) return false;
    out.push({
      name,
      arguments: fn?.arguments ?? call?.arguments ?? call?.args ?? {},
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
  const calls = value.tool_calls || value.toolCalls;
  if (Array.isArray(calls)) {
    for (const call of calls) added = addCall(call, true) || added;
  }
  if (value.tool_call) added = collectToolCallsFromJsonValue(value.tool_call, toolNames, out) || added;
  if (value.toolCall) added = collectToolCallsFromJsonValue(value.toolCall, toolNames, out) || added;
  if (normalizeJsonToolName(value)) added = addCall(value) || added;
  return added;
}

export function extractJsonToolCallPayloads(text, toolNames) {
  const tools = [];
  const removableSpans = [];
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

export function extractPlainToolCommandLines(text, toolNames) {
  const tools = [];
  const visibleLines = [];
  for (const line of String(text || "").split("\n")) {
    const parsed = parsePlainToolCommandLine(line, toolNames);
    if (parsed) tools.push(parsed);
    else visibleLines.push(line);
  }
  return { tools, visible: visibleLines.join("\n").trimEnd() };
}

export function stripModelControlTokens(text) {
  if (!text) return "";
  return String(text)
    .replace(/<[^>\n]*\|[^>\n]*>/g, "")
    .trim();
}

/** Some gateways stream the word `thought` on its own line in `content` while hiding real reasoning elsewhere. */
export function stripReasoningPlaceholderLines(text) {
  return String(text || "")
    .split("\n")
    .filter((line) => line.trim().toLowerCase() !== "thought")
    .join("\n");
}

/** @param {string[]} [knownToolNames] — adds exact-name matches; generic `name{"k":…}` lines strip even when [] */
export function sanitizeAssistantVisibleText(text, knownToolNames) {
  const withoutMarkers = String(text || "")
    .replace(/<<<\s*TOOL\s*>>>[\s\S]*?<<<\s*END\s*>>>/gi, "")
    .replace(/<<<\s*CLARIFY\s*>>>[\s\S]*?<<<\s*END\s*>>>/gi, "")
    .trim();
  let out = stripXmlToolArtifacts(withoutMarkers).trim();
  const names = Array.isArray(knownToolNames) ? knownToolNames : [];
  out = stripJsonToolCallPayloads(out, names).trim();
  out = extractPlainToolCommandLines(out, names).visible.trim();
  out = stripPseudoToolCallLines(out, names).trim();
  out = stripModelControlTokens(out).trim();
  out = stripReasoningPlaceholderLines(out).trim();
  return out;
}

export function extractMarkerTools(text) {
  const re = /<<<\s*TOOL\s*>>>\s*([\s\S]*?)\s*<<<\s*END\s*>>>/gi;
  const tools = [];
  let m;
  while ((m = re.exec(text))) {
    const payload = m[1].trim();
    try {
      tools.push(JSON.parse(payload));
    } catch {
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
  const visible = text.replace(re, "").trimEnd();
  return { tools, visible };
}

export function extractToolCallTagPayloads(text) {
  const re = /<TOOLCALL>\s*([\s\S]*?)\s*<\/TOOLCALL>/gi;
  const tools = [];
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

export function extractJsonToolCallsFromText(text) {
  return extractJsonToolCallPayloads(text).tools;
}

export function normalizeToolCalls(
  rawCalls: unknown,
  toolNames: unknown
): {
  normalized: Array<{ name: string; arguments: Record<string, unknown> }>;
  rejected: Array<{ reason: string; call: unknown }>;
} {
  const knownTools = new Set(toolNames || []);
  const normalized: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const rejected: Array<{ reason: string; call: unknown }> = [];
  const MAX_TOOL_CALLS_PER_TURN = 16;
  for (const raw of rawCalls || []) {
    if (normalized.length >= MAX_TOOL_CALLS_PER_TURN) {
      rejected.push({ reason: "too_many_calls", call: raw });
      continue;
    }
    const name = String(raw?.name || "").trim();
    if (!name) {
      rejected.push({ reason: "missing_name", call: raw });
      continue;
    }
    if (!knownTools.has(name)) {
      rejected.push({ reason: "unknown_tool", call: raw });
      continue;
    }
    let args = raw?.arguments;
    if (typeof args === "string") {
      const trimmed = args.trim();
      if (!trimmed) args = {};
      else {
        try {
          args = JSON.parse(trimmed);
        } catch {
          rejected.push({ reason: "invalid_arguments_json", call: raw });
          continue;
        }
      }
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) args = {};
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
    }
    if (name === "run_shell" && !args.command && typeof args.cmd === "string") {
      args.command = args.cmd;
    }
    // Deduplicate: same tool + same serialized args within one round = duplicate emission
    // (happens when model uses both native tool_calls and <<<TOOL>>> markers).
    const key = `${name}:${JSON.stringify(args)}`;
    if (normalized.some((c) => `${c.name}:${JSON.stringify(c.arguments)}` === key)) {
      rejected.push({ reason: "duplicate_call", call: raw });
      continue;
    }
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

export function createToolAwareStreamWriter(writeChunk) {
  let buffer = "";
  let insideToolBlock = null;
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
        let nextMarker = null;
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
      if (insideToolBlock && (insideHiddenAccum.length > 0 || buffer.length > 0)) {
        writeChunk(insideHiddenAccum + buffer);
      } else if (!insideToolBlock && buffer.length > 0) {
        writeChunk(buffer);
      }
      buffer = "";
      insideToolBlock = null;
      insideHiddenAccum = "";
    },
  };
}
