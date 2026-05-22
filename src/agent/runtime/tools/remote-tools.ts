import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import nodePath from "node:path";
import { ipcProxyRequest } from "../ipc.js";
import {
  BROWSER_AGENT_CATALOG_PATH,
  HEARTBEAT_INTERVAL_MS,
  MEMORY_CONVERSATIONS_DIR,
  MEMORY_RUNS_DIR,
  getWorkspaceRoot,
  workspaceStatePath,
} from "../constants.js";
import { logDebugEvent } from "../logging/debug-log.js";
import * as memoryModule from "../memory/index.js";
import { memoryPath } from "../memory/sql.js";
import { createTimeoutController } from "./context.js";
import { parseTinyFishFetchPayload } from "./tinyfish-fetch.js";
import { expandSkillBulkSaveArgs } from "./skill-bulk-args.js";
import {
  buildCronListSchedulingMeta,
  enrichCronJobForList,
} from "../cron-scheduling.js";
import {
  hasCronJobArgumentPayload,
  normalizeCronJobArguments,
  sanitizeCronToolToken,
} from "../state/persistence.js";

/** Loose tool / IPC JSON object shape (tool handlers read known keys with runtime checks). */
type ToolArgs = Record<string, unknown>;

type HttpProxySuccessJson = {
  ok: true;
  status: number;
  url: string;
  contentType: string;
  data: unknown;
  truncated?: true;
  truncated_at_chars?: number;
};

type HttpProxySuccessText = {
  ok: true;
  status: number;
  url: string;
  contentType: string;
  text: string;
  truncated?: true;
  truncated_at_chars?: number;
};

type HttpProxyFailure = {
  ok: false;
  status: number;
  url: string;
  contentType: string;
  data: unknown;
  error: string;
  recovery_hint?: string;
  truncated?: true;
  truncated_at_chars?: number;
};

export type HttpProxyResult = HttpProxySuccessJson | HttpProxySuccessText | HttpProxyFailure;

type BrowserCatalogProvider = {
  id: string;
  isDefault?: boolean;
  name?: string;
  auth?: { settingKey?: string; envVar?: string; headerName?: string };
  search?: { endpoint?: string; timeoutMs?: number };
  fetch?: { endpoint?: string; timeoutMs?: number };
};

function readProxyResponse(value: unknown): { status: number; body: string; contentType: string } {
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const status = Number(rec.status);
    const body = typeof rec.body === "string" ? rec.body : "";
    const contentType = typeof rec.contentType === "string" ? rec.contentType : "";
    return { status: Number.isFinite(status) ? status : 0, body, contentType };
  }
  return { status: 0, body: "", contentType: "" };
}

let browserAgentCatalogCache: BrowserCatalogProvider[] | null = null;

function ctxEnv(ctx) {
  return ctx?.env ?? process.env;
}

function memoryServices(ctx) {
  return ctx?.services?.memory ?? memoryModule;
}

async function loadBrowserAgentCatalog() {
  if (browserAgentCatalogCache) return browserAgentCatalogCache;
  try {
    const raw = await fs.readFile(BROWSER_AGENT_CATALOG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      browserAgentCatalogCache = parsed.filter(
        (provider) =>
          provider &&
          typeof provider === "object" &&
          typeof provider.id === "string"
      );
      return browserAgentCatalogCache;
    }
  } catch {
    /* fall through */
  }
  browserAgentCatalogCache = [];
  return browserAgentCatalogCache;
}

async function getBrowserAgentProvider(ctx) {
  const catalog = await loadBrowserAgentCatalog();
  const selectedId = String(ctxEnv(ctx).WEBAGENT_BROWSER_AGENT || "").trim();
  return (
    catalog.find((provider) => provider.id === selectedId) ||
    catalog.find((provider) => provider.isDefault) ||
    catalog[0] ||
    null
  );
}

function getBrowserAgentApiKeyOrThrow(provider, ctx) {
  const settingKey = provider?.auth?.settingKey;
  const envVar = provider?.auth?.envVar;
  const key = envVar ? String(ctxEnv(ctx)[envVar] || "").trim() : "";
  if (!key) {
    throw new Error(
      `${provider?.name || "Browser agent"} API key is required. Add \`${settingKey || "API key"}\` in Settings.`
    );
  }
  return key;
}

function normalizeProviderErrorStatus(status, bodyText, product, providerName = "Browser agent") {
  const details = String(bodyText || "").slice(0, 240);
  if (status === 401) return `${providerName} ${product} auth failed (401). Verify your API key in Settings.`;
  if (status === 403) return `${providerName} ${product} access denied (403). Check account access for ${product}.`;
  if (status === 429) return `${providerName} ${product} rate limit hit (429). Please retry shortly.`;
  if (status >= 500) return `${providerName} ${product} is unavailable (${status}). Retry with backoff.`;
  return `${providerName} ${product} request failed (${status}): ${details || "unknown error"}`;
}

function pickRemoteTimeoutMs(ctx, providerTimeoutMs, fallback = 150_000) {
  const ctxTimeout = Number(ctx?.timeoutMs);
  const candidates = [
    Number.isFinite(providerTimeoutMs) && providerTimeoutMs > 0 ? providerTimeoutMs : null,
    Number.isFinite(ctxTimeout) && ctxTimeout > 0 ? ctxTimeout : null,
  ].filter((n) => n !== null);
  return candidates.length ? Math.min(...candidates) : fallback;
}

/** Use a single geo code per request (models often pass "ae, sa"). */
export function normalizeSearchLocation(location: unknown): string | undefined {
  const raw = String(location ?? "").trim();
  if (!raw) return undefined;
  const parts = raw
    .split(/[,;|]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return parts[0] || undefined;
}

async function browserAgentSearch(provider, { query, location, language, page = 0 }, ctx) {
  const q = String(query || "").trim();
  if (!q) throw new Error("`query` is required for web_search.");
  const p = Number(page);
  if (!Number.isFinite(p) || p < 0 || p > 10) {
    throw new Error("`page` must be a number between 0 and 10.");
  }

  const key = getBrowserAgentApiKeyOrThrow(provider, ctx);
  const endpoint = String(provider?.search?.endpoint || "").trim();
  if (!endpoint) throw new Error(`${provider?.name || "Browser agent"} does not support web_search.`);
  const url = new URL(endpoint);
  url.searchParams.set("query", q);
  const loc = normalizeSearchLocation(location);
  if (loc) url.searchParams.set("location", loc);
  if (language) url.searchParams.set("language", String(language));
  if (page !== undefined && page !== null && String(page).trim() !== "") {
    url.searchParams.set("page", String(Math.trunc(p)));
  }

  const timeoutMs = pickRemoteTimeoutMs(ctx, Number(provider?.search?.timeoutMs), 60_000);
  const { signal, cleanup } = createTimeoutController({ ...(ctx || {}), timeoutMs });
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { [provider?.auth?.headerName || "X-API-Key"]: key },
      signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(normalizeProviderErrorStatus(res.status, body, "Search", provider?.name));
    }
    return await res.json();
  } finally {
    cleanup();
  }
}

async function browserAgentFetch(
  provider,
  url,
  ctx,
  { format = "markdown", method, requestBody }: { format?: string; method?: string; requestBody?: unknown } = {}
) {
  const key = getBrowserAgentApiKeyOrThrow(provider, ctx);
  const endpoint = String(provider?.fetch?.endpoint || "").trim();
  if (!endpoint) throw new Error(`${provider?.name || "Browser agent"} does not support web_fetch.`);
  const timeoutMs = pickRemoteTimeoutMs(ctx, Number(provider?.fetch?.timeoutMs), 150_000);
  const { signal, cleanup } = createTimeoutController({ ...(ctx || {}), timeoutMs });
  const providerName = provider?.name || "Browser agent";
  const requested = String(url || "").trim();

  const proxyCountry = String(
    ctxEnv(ctx).TINYFISH_FETCH_PROXY_COUNTRY || process.env.TINYFISH_FETCH_PROXY_COUNTRY || ""
  ).trim();

  async function postOnce(proxy_config) {
    const requestPayload = {
      urls: [url],
      format,
      ...(method ? { method } : {}),
      ...(requestBody !== undefined ? { body: requestBody } : {}),
      ...(proxy_config ? { proxy_config } : {}),
    };
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [provider?.auth?.headerName || "X-API-Key"]: key,
      },
      body: JSON.stringify(requestPayload),
      signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(normalizeProviderErrorStatus(res.status, body, "Fetch", providerName));
    }
    const payload = await res.json();
    return parseTinyFishFetchPayload(payload, requested, format, providerName);
  }

  try {
    let parsed = await postOnce(null);
    if (parsed.ok) return parsed.text;

    const errish = String(parsed.errorCode || parsed.error || "");
    const retriable =
      proxyCountry && /fetch_error|timeout|blocked|dns|network|econn/i.test(errish);
    if (retriable) {
      await logDebugEvent("tinyfish_fetch_proxy_retry", {
        url: requested.slice(0, 800),
        country: proxyCountry,
        firstError: parsed.error,
      });
      parsed = await postOnce({ country_code: proxyCountry });
      if (parsed.ok) return parsed.text;
    }
    throw new Error(parsed.error);
  } finally {
    cleanup();
  }
}

export async function proxyRequest(request, _ctx) {
  const { method = "GET", url, headers = {}, body = null } = request;
  return ipcProxyRequest({ method, url, headers, body });
}

export async function cronRegisterTool(args: ToolArgs = {}, ctx) {
  void ctx;
  const action = String(args?.action ?? "").trim().toLowerCase();
  if (action === "remove") {
    const { removeCronJob } = await import("../state/persistence.js");
    const id = String(args?.id ?? "").trim();
    return removeCronJob(id);
  }

  const { getToolNamesAsync } = await import("./registry.js");
  const { upsertCronJob } = await import("../state/persistence.js");
  const { assertCronStepsUseAllowedTools, normalizeCronRegisterSteps } = await import("./cron-register.js");
  const allowed = new Set(await getToolNamesAsync());
  const rawSteps = Array.isArray(args.steps) ? args.steps : null;
  if (rawSteps !== null && rawSteps.length > 0) {
    const steps = normalizeCronRegisterSteps(rawSteps);
    assertCronStepsUseAllowedTools(steps, allowed);
    return upsertCronJob({ ...args, steps });
  }
  const toolName = sanitizeCronToolToken(args.tool);
  if (!allowed.has(toolName)) {
    throw new Error(
      `cron_register: unknown tool "${toolName}". Valid names: ${[...allowed].sort().join(", ")}`
    );
  }
  return upsertCronJob(
    hasCronJobArgumentPayload(args)
      ? { ...args, tool: toolName, arguments: normalizeCronJobArguments(args) }
      : { ...args, tool: toolName }
  );
}

export async function cronListTool(_args, _ctx) {
  const { loadCronJobs } = await import("../state/persistence.js");
  const store = await loadCronJobs();
  const rawJobs = Array.isArray(store?.jobs) ? store.jobs : [];
  const now = Date.now();
  const jobs = rawJobs.map((job) => ({
    ...job,
    ...enrichCronJobForList(job, HEARTBEAT_INTERVAL_MS, now),
  }));
  return {
    success: true,
    ok: true,
    count: jobs.length,
    jobs,
    scheduling: buildCronListSchedulingMeta(HEARTBEAT_INTERVAL_MS),
    message: jobs.length ? `${jobs.length} cron job(s) registered.` : "No cron jobs registered.",
  };
}

function hasProviderApiKey(provider, ctx) {
  const envVar = provider?.auth?.envVar;
  if (!envVar) return false;
  return !!String(ctxEnv(ctx)[envVar] || "").trim();
}

/** Proxy body cap; exported for tests. */
export const WEB_FETCH_PROXY_BODY_CAP = 100_000;

/** Slice proxy response body to WEB_FETCH_PROXY_BODY_CAP and record truncation (test hook). */
export function sliceProxyFetchBody(body: unknown, cap = WEB_FETCH_PROXY_BODY_CAP) {
  const bodyStr = String(body ?? "");
  if (bodyStr.length <= cap) {
    return { text: bodyStr, truncated: false as const, truncated_at_chars: undefined as number | undefined };
  }
  return { text: bodyStr.slice(0, cap), truncated: true as const, truncated_at_chars: cap };
}

function normalizeHttpHeaders(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k || "").trim();
    if (!key || v == null) continue;
    out[key] = String(v);
  }
  return out;
}

function redactHttpHeadersForLog(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (/authorization|api[_-]?key|token|secret/i.test(k)) out[k] = "<redacted>";
    else out[k] = v.length > 80 ? `${v.slice(0, 80)}…` : v;
  }
  return out;
}

export function summarizeHttpErrorBody(data: unknown, status: number): string {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const rec = data as Record<string, unknown>;
    const errors = rec.errors;
    if (Array.isArray(errors) && errors.length) {
      const first = errors[0];
      if (first && typeof first === "object") {
        const msg = String((first as Record<string, unknown>).message || "").trim();
        if (msg) return msg;
      }
    }
    const err = rec.error;
    if (typeof err === "string" && err.trim()) return err.trim();
  }
  return `HTTP ${status}`;
}

export function graphqlSchemaRecoveryHint(data: unknown, status: number): string | undefined {
  if (status !== 400 && status !== 422) return undefined;
  const text = JSON.stringify(data || "");
  if (!/graphql|Cannot query field/i.test(text)) return undefined;
  return (
    "GraphQL root fields must match that API's schema — do not assume generic names. " +
    "Call skill_view on the relevant imported skill (and **`http-api`**) for discovery endpoints and query shape, " +
    "then fix field names from the error."
  );
}

/** 403/404 on a deep resource path — run skill discovery before guessing names. */
export function guessedResourceRecoveryHint(url: string, status: number): string | undefined {
  if (status !== 403 && status !== 404) return undefined;
  let segments = 0;
  try {
    segments = new URL(String(url || "")).pathname.split("/").filter(Boolean).length;
  } catch {
    const tail = String(url || "").split("?")[0]?.split("#")[0] ?? "";
    segments = tail.split("/").filter(Boolean).length;
    if (segments > 0) segments -= 1;
  }
  if (segments < 2) return undefined;
  return (
    "403/404 on a specific resource path often means wrong slug/id or missing permission — not a dead host. " +
    "Use skill_view on the relevant imported skill for discovery (list/metadata/health) before guessing resource names. " +
    "See skill_view **`http-api`**."
  );
}

function httpApiRecoveryHint(url: string, status: number, data: unknown): string | undefined {
  return graphqlSchemaRecoveryHint(data, status) ?? guessedResourceRecoveryHint(url, status);
}

export async function httpProxyCall(
  {
    method = "GET",
    url,
    headers = {},
    body = null,
  }: { method?: string; url: string; headers?: Record<string, string>; body?: string | null },
  ctx
): Promise<HttpProxyResult> {
  const normHeaders = normalizeHttpHeaders(headers);
  const m = String(method || "GET").toUpperCase();
  await logDebugEvent("http_proxy_call", {
    method: m,
    url: String(url).slice(0, 800),
    headers: redactHttpHeadersForLog(normHeaders),
  });
  const { status, body: respBody, contentType } = readProxyResponse(
    await proxyRequest({ method: m, url, headers: normHeaders, body }, ctx)
  );
  const ok = status >= 200 && status < 300;
  const sliced = sliceProxyFetchBody(respBody);
  const trimmed = sliced.text.trim();
  const looksJson =
    contentType.includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[");
  let parsedJson: unknown;
  if (looksJson) {
    try {
      parsedJson = JSON.parse(sliced.text);
    } catch {
      parsedJson = undefined;
    }
  }
  if (!ok) {
    if (parsedJson !== undefined) {
      const error = summarizeHttpErrorBody(parsedJson, status);
      const recovery_hint = httpApiRecoveryHint(url, status, parsedJson);
      return {
        ok: false as const,
        status,
        url,
        contentType,
        data: parsedJson,
        error,
        ...(recovery_hint ? { recovery_hint } : {}),
        ...(sliced.truncated ? { truncated: true, truncated_at_chars: sliced.truncated_at_chars } : {}),
      };
    }
    const detail = String(respBody || "").slice(0, 240);
    let msg = `HTTP request failed (${status}): ${detail || "unknown error"}`;
    const restHint = guessedResourceRecoveryHint(url, status);
    if (restHint) {
      msg += ` ${restHint}`;
    } else if (status === 401 || status === 403) {
      msg += " Add or fix Authorization in headers — do not use run_shell for authenticated API calls.";
    }
    if (status === 405 && m === "GET") {
      msg += " Use web_post for POST/GraphQL on this endpoint.";
    }
    throw Object.assign(new Error(msg), {
      status,
      ...(status === 405 && m === "GET" ? { suggested_tool: "web_post" } : {}),
    });
  }
  const base = { ok: true as const, status, url, contentType };
  if (parsedJson !== undefined) {
    return {
      ...base,
      data: parsedJson,
      ...(sliced.truncated ? { truncated: true, truncated_at_chars: sliced.truncated_at_chars } : {}),
    };
  }
  return {
    ...base,
    text: sliced.text,
    ...(sliced.truncated ? { truncated: true, truncated_at_chars: sliced.truncated_at_chars } : {}),
  };
}

async function proxyFetch(url, ctx, headers: Record<string, string> = {}) {
  return httpProxyCall({ method: "GET", url, headers }, ctx);
}

export async function webSearchTool(args: ToolArgs = {}, ctx) {
  const { query, location, language, page: pageRaw } = args;
  const q = String(query ?? "").trim();
  if (!q) throw new Error("`query` is required for web_search.");
  const p = Number(pageRaw ?? 0);
  if (!Number.isFinite(p) || p < 0 || p > 10) {
    throw new Error("`page` must be a number between 0 and 10.");
  }
  const provider = await getBrowserAgentProvider(ctx);
  const loc = normalizeSearchLocation(location);
  if (provider && hasProviderApiKey(provider, ctx)) {
    return await browserAgentSearch(provider, { query: q, location: loc, language, page: p }, ctx);
  }
  // Fallback: DuckDuckGo HTML search via proxy (no API key required).
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}${p ? `&s=${p * 20}` : ""}`;
  let text: string;
  try {
    const fetched = await proxyFetch(searchUrl, ctx);
    if (fetched.ok === false) {
      throw new Error(fetched.error);
    }
    text = "text" in fetched ? fetched.text : JSON.stringify(fetched.data ?? "");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${msg} (duckduckgo-fallback)`);
  }
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([^<]+)<\/a>/gi;
  let m;
  const snippets: string[] = [];
  let sm;
  while ((sm = snippetRe.exec(text))) snippets.push(sm[1].replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c))).replace(/&amp;/g, "&").trim());
  let idx = 0;
  while ((m = linkRe.exec(text)) && results.length < 10) {
    results.push({ title: m[2].trim(), url: m[1].trim(), snippet: snippets[idx++] || "" });
  }
  return { ok: true, query: q, provider: "duckduckgo-fallback", results };
}

const WEB_FETCH_READABLE_HTML_CAP = 50_000;

async function webFetchReadableFromProxy(url, ctx, headers: Record<string, string> = {}) {
  const proxy = await proxyFetch(url, ctx, headers);
  if (proxy.ok === false) {
    return {
      ok: false as const,
      url,
      provider: "proxy",
      status: proxy.status,
      content_type: String(proxy.contentType || ""),
      data: proxy.data,
      error: proxy.error,
      ...(proxy.recovery_hint ? { recovery_hint: proxy.recovery_hint } : {}),
      ...(proxy.truncated ? { truncated: proxy.truncated, truncated_at_chars: proxy.truncated_at_chars } : {}),
    };
  }
  const contentType = String(proxy.contentType || "");
  const hasJsonData = "data" in proxy;
  if (hasJsonData) {
    return {
      ok: true as const,
      url,
      provider: "proxy",
      status: proxy.status,
      content_type: contentType,
      data: proxy.data,
      ...(proxy.truncated ? { truncated: proxy.truncated, truncated_at_chars: proxy.truncated_at_chars } : {}),
    };
  }
  const text = "text" in proxy ? String(proxy.text ?? "") : "";
  const proxyTruncated = !!proxy.truncated;
  const proxyTruncCap = proxy.truncated_at_chars;
  const isHtml = contentType.includes("html") || text.trimStart().startsWith("<");
  let readable;
  let truncated = !!proxyTruncated;
  let truncated_at_chars = proxyTruncated ? proxyTruncCap : undefined;
  if (isHtml) {
    const stripped = text
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    const overReadable = stripped.length > WEB_FETCH_READABLE_HTML_CAP;
    readable = overReadable ? stripped.slice(0, WEB_FETCH_READABLE_HTML_CAP) : stripped;
    if (overReadable) {
      truncated = true;
      truncated_at_chars = WEB_FETCH_READABLE_HTML_CAP;
    }
  } else {
    readable = text;
  }
  return {
    ok: true,
    url,
    provider: "proxy-fallback",
    content_type: contentType,
    text: readable,
    ...(truncated ? { truncated, truncated_at_chars } : {}),
  };
}

const WEB_FETCH_BATCH_MAX = 5;

async function webFetchOne(url: string, ctx, headers: Record<string, string> = {}) {
  const u = new URL(url);
  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error(`web_fetch only supports http(s) URLs, got: ${u.protocol}`);
  }
  if (Object.keys(headers).length > 0) {
    return webFetchReadableFromProxy(url, ctx, headers);
  }
  const provider = await getBrowserAgentProvider(ctx);
  if (provider && hasProviderApiKey(provider, ctx)) {
    try {
      const text = await browserAgentFetch(provider, url, ctx);
      return { ok: true, url, provider: provider.id, text };
    } catch (err) {
      await logDebugEvent("web_fetch_provider_fallback_proxy", {
        providerId: provider.id,
        url: String(url).slice(0, 800),
        error: String(err?.message || err),
      });
    }
  }
  return webFetchReadableFromProxy(url, ctx);
}

export async function webFetchTool(args: ToolArgs = {}, ctx) {
  const method = args.method != null ? String(args.method).trim().toUpperCase() : "GET";
  if (method !== "GET") {
    throw new Error(
      'web_fetch is GET-only. Use web_post for POST/GraphQL. Example: {"url":"https://api.example.com/graphql","headers":{"Authorization":"Bearer <token>"},"body":"{\\"query\\":\\"...\\"}"}'
    );
  }
  if (args.body != null && String(args.body).trim()) {
    throw new Error(
      'web_fetch does not accept a body. Use web_post for POST/GraphQL with {"url":"…","headers":{…},"body":"…"}.'
    );
  }

  const headers = normalizeHttpHeaders(args.headers);

  const rawUrls = Array.isArray(args.urls) ? args.urls : [];
  const single = typeof args.url === "string" ? args.url.trim() : "";
  const targets = [
    ...(single ? [single] : []),
    ...rawUrls.map((u) => String(u || "").trim()).filter(Boolean),
  ];
  if (!targets.length) throw new Error("`url` or `urls` is required for web_fetch.");
  if (targets.length > WEB_FETCH_BATCH_MAX) {
    throw new Error(`web_fetch accepts at most ${WEB_FETCH_BATCH_MAX} URLs per call.`);
  }

  if (targets.length === 1) return webFetchOne(targets[0], ctx, headers);

  const documents = await Promise.all(
    targets.map(async (url) => {
      try {
        return await webFetchOne(url, ctx, headers);
      } catch (err) {
        return { ok: false, url, error: String(err?.message || err) };
      }
    })
  );
  return { ok: true, count: documents.length, documents };
}

export async function webPostTool(args: ToolArgs = {}, ctx) {
  const url = typeof args.url === "string" ? args.url.trim() : "";
  if (!url) throw new Error("`url` is required for web_post.");
  const u = new URL(url);
  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error(`web_post only supports http(s) URLs, got: ${u.protocol}`);
  }
  if (args.body === undefined || args.body === null) {
    throw new Error("`body` is required for web_post.");
  }
  const body =
    typeof args.body === "string" ? args.body : JSON.stringify(args.body);
  const headers = normalizeHttpHeaders(args.headers);
  const contentType =
    typeof args.content_type === "string" ? args.content_type.trim() : "";
  if (contentType) headers["Content-Type"] = contentType;
  else if (!headers["Content-Type"] && !headers["content-type"]) {
    const trimmed = body.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      headers["Content-Type"] = "application/json";
    }
  }
  return httpProxyCall({ method: "POST", url, headers, body }, ctx);
}

export async function memorySaveTool(args: ToolArgs = {}, ctx) {
  const key = typeof args?.key === "string" ? args.key.trim() : "";
  if (!key) {
    throw new Error(
      '`key` is required for memory_save. Call again with arguments {"key":"<snake_case_id>","value":<anything>}.'
    );
  }
  if (!Object.prototype.hasOwnProperty.call(args, "value")) {
    throw new Error(
      '`value` is required for memory_save. Call again with arguments {"key":"' +
        key +
        '","value":<anything>}.'
    );
  }
  const memory = memoryServices(ctx);
  const scope = typeof args?.scope === "string" ? args.scope.trim() : undefined;
  const saved = await memory.setFact(key, args.value, scope ? { scope } : undefined);
  await logDebugEvent("memory_save", {
    key: saved.key,
    scope: saved.scope || null,
    valueType: typeof args.value,
  });
  return { ok: true, fact: saved };
}

export async function memoryForgetTool(args: ToolArgs = {}, ctx) {
  const key = typeof args?.key === "string" ? args.key.trim() : "";
  if (!key) {
    throw new Error("`key` is required for memory_forget. It deletes one exact saved memory fact.");
  }
  const memory = memoryServices(ctx);
  if (typeof memory.deleteFact !== "function") {
    throw new Error("memory_forget is unavailable because the memory service does not support deleteFact.");
  }
  const result = await memory.deleteFact(key);
  await logDebugEvent("memory_forget", {
    key,
    deleted: Boolean(result?.deleted),
  });
  return { ok: true, ...result };
}

export async function memoryRecallTool(args: ToolArgs = {}, ctx) {
  const key = typeof args?.key === "string" ? args.key.trim() : "";
  if (!key) {
    throw new Error(
      '`key` is required for memory_recall. Use memory_search if you only have a topic substring.'
    );
  }
  const limit = Math.max(0, Number(args?.limit ?? 20));
  const memory = memoryServices(ctx);
  const fact = await memory.getFact(key);
  const rows = fact ? [fact].slice(0, limit || 1) : [];
  await logDebugEvent("memory_recall", {
    key,
    limit,
    hits: rows.length,
  });
  return rows;
}

export async function memorySearchTool(args: ToolArgs = {}, ctx) {
  const query = typeof args?.query === "string" ? args.query.trim() : "";
  if (!query) {
    throw new Error("`query` is required for memory_search.");
  }
  const limit = Math.min(1000, Math.max(1, Number(args?.limit ?? 30) || 30));
  const memory = memoryServices(ctx);
  const rows = await memory.searchFacts(query, limit);
  await logDebugEvent("memory_search", {
    query,
    limit,
    hits: rows.length,
  });
  return rows.map(({ _match_score, _match_source, ...fact }) => ({
    ...fact,
    ...(typeof _match_score === "number"
      ? { match_score: _match_score, match_source: _match_source || "unknown" }
      : {}),
  }));
}

const SESSION_SEARCH_CONTEXT = 200;
const SESSION_SEARCH_RECENCY_QUERY_RE =
  /\b(last|previous|recent|lately|before)\b[\s\S]{0,80}\b(work|task|project|topic|conversation|chat)\b|\bwhat did we (last|previously)\b|\bwhat we worked on\b/i;
const SESSION_SEARCH_RECENCY_ONLY_RE =
  /^(?:recent|latest|last|prior|previous)(?:\s+(?:session|sessions|work|chat|conversation|thread|messages?))?s?$/i;

function isRecencyOnlySessionSearchQuery(query) {
  const q = String(query || "").trim();
  if (!q) return true;
  return SESSION_SEARCH_RECENCY_ONLY_RE.test(q) || SESSION_SEARCH_RECENCY_QUERY_RE.test(q);
}

function sessionSearchTokenize(q) {
  return String(q || "")
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 1)
    .slice(0, 32);
}

function firstTokenOffset(haystackLc, tokens) {
  let best = -1;
  for (const t of tokens) {
    const idx = haystackLc.indexOf(t);
    if (idx >= 0 && (best < 0 || idx < best)) best = idx;
  }
  return best;
}

/** Full-text search persisted conversation JSON files (memory/conversations). */
export async function sessionSearchTool(args: ToolArgs = {}, _ctx) {
  const query = typeof args?.query === "string" ? args.query.trim() : "";
  const recencyOnly = isRecencyOnlySessionSearchQuery(query);
  if (!recencyOnly && !query) {
    throw new Error("`query` is required for session_search.");
  }
  const tokens = recencyOnly ? [] : sessionSearchTokenize(query);
  const recencyQuery = recencyOnly || SESSION_SEARCH_RECENCY_QUERY_RE.test(query);
  if (!recencyOnly && !tokens.length) {
    throw new Error("`query` must include at least one word with 2+ characters.");
  }

  const maxFiles = Math.min(200, Math.max(10, Number(args?.max_files ?? 80) || 80));
  const absDir = memoryPath(MEMORY_CONVERSATIONS_DIR);
  const absRunsDir = memoryPath(MEMORY_RUNS_DIR);
  const sessionMemoryPath = workspaceStatePath(".webagent/session-memory.jsonl");
  type SessionSearchHit = {
    score: number;
    id: string;
    snippet: string;
    relPath: string;
    mtime: number;
  };
  const scored: SessionSearchHit[] = [];
  const recentCandidates: SessionSearchHit[] = [];

  let dirents: Dirent[] = [];
  try {
    dirents = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    /* fall through to run/session-memory fallbacks */
  }

  const jsonFiles = dirents.filter((e) => e.isFile() && e.name.endsWith(".json"));
  const withMtime = await Promise.all(
    jsonFiles.map(async (e) => {
      const abs = nodePath.join(absDir, e.name);
      const st = await fs.stat(abs).catch(() => null);
      return { abs, name: e.name, mtime: st?.mtimeMs || 0 };
    })
  );
  withMtime.sort((a, b) => b.mtime - a.mtime);
  const toScan = withMtime.slice(0, maxFiles);

  for (const { abs, name, mtime } of toScan) {
    let raw;
    try {
      raw = await fs.readFile(abs, "utf8");
    } catch {
      continue;
    }
    let id = name.replace(/\.json$/i, "");
    const text = raw.replace(/\s+/g, " ").trim();
    const low = text.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (low.includes(t)) score += 1;
    }
    if (recencyOnly) {
      recentCandidates.push({
        score: 0,
        id,
        snippet: text.slice(0, SESSION_SEARCH_CONTEXT * 2),
        relPath: `memory/conversations/${name}`,
        mtime,
      });
      continue;
    }
    if (score === 0) {
      if (recencyQuery) {
        const recencySnippet = text.slice(0, SESSION_SEARCH_CONTEXT * 2);
        recentCandidates.push({
          score: 0,
          id,
          snippet: recencySnippet,
          relPath: `memory/conversations/${name}`,
          mtime,
        });
      }
      continue;
    }

    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.id) id = String(parsed.id);
    } catch {
      /* keep basename */
    }

    const off = firstTokenOffset(low, tokens);
    let snippet = text.slice(0, SESSION_SEARCH_CONTEXT * 2);
    if (off >= 0) {
      const start = Math.max(0, off - SESSION_SEARCH_CONTEXT);
      const end = Math.min(text.length, off + SESSION_SEARCH_CONTEXT);
      snippet = text.slice(start, end);
      if (start > 0) snippet = "…" + snippet;
      if (end < text.length) snippet = snippet + "…";
    }

    scored.push({
      score,
      id,
      snippet,
      relPath: `memory/conversations/${name}`,
      mtime,
    });
    if (recencyQuery) {
      recentCandidates.push({
        score: 0,
        id,
        snippet,
        relPath: `memory/conversations/${name}`,
        mtime,
      });
    }
  }

  // Fallback 1: run history snapshots (saved each turn).
  let runDirents: Dirent[] = [];
  try {
    runDirents = await fs.readdir(absRunsDir, { withFileTypes: true });
  } catch {
    /* absent */
  }
  const runFiles = runDirents.filter((e) => e.isFile() && e.name.endsWith(".json"));
  const runWithMtime = await Promise.all(
    runFiles.map(async (e) => {
      const abs = nodePath.join(absRunsDir, e.name);
      const st = await fs.stat(abs).catch(() => null);
      return { abs, name: e.name, mtime: st?.mtimeMs || 0 };
    })
  );
  runWithMtime.sort((a, b) => b.mtime - a.mtime);
  const runToScan = runWithMtime.slice(0, maxFiles);

  for (const { abs, name, mtime } of runToScan) {
    let raw = "";
    try {
      raw = await fs.readFile(abs, "utf8");
    } catch {
      continue;
    }
    let id = name.replace(/\.json$/i, "");
    let searchable = "";
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        if (parsed.id) id = String(parsed.id);
        const toolNames = Array.isArray(parsed.tool_calls)
          ? parsed.tool_calls
              .map((item) =>
                item && typeof item === "object" && item.name ? String(item.name) : ""
              )
              .filter(Boolean)
              .join(" ")
          : "";
        const errors = Array.isArray(parsed.errors)
          ? parsed.errors.map((v) => String(v || "")).join(" ")
          : "";
        searchable = [
          String(parsed.goal || ""),
          String(parsed.input || ""),
          String(parsed.final_visible_assistant_text || ""),
          toolNames,
          errors,
        ]
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
      }
    } catch {
      searchable = raw.replace(/\s+/g, " ").trim();
    }
    if (!searchable) continue;
    const low = searchable.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (low.includes(t)) score += 1;
    }
    if (recencyOnly) {
      recentCandidates.push({
        score: 0,
        id,
        snippet: searchable.slice(0, SESSION_SEARCH_CONTEXT * 2),
        relPath: `memory/runs/${name}`,
        mtime,
      });
      continue;
    }
    if (score === 0) {
      if (recencyQuery) {
        const offAny = firstTokenOffset(low, tokens);
        let recencySnippet = searchable.slice(0, SESSION_SEARCH_CONTEXT * 2);
        if (offAny >= 0) {
          const start = Math.max(0, offAny - SESSION_SEARCH_CONTEXT);
          const end = Math.min(searchable.length, offAny + SESSION_SEARCH_CONTEXT);
          recencySnippet = searchable.slice(start, end);
          if (start > 0) recencySnippet = "…" + recencySnippet;
          if (end < searchable.length) recencySnippet = recencySnippet + "…";
        }
        recentCandidates.push({
          score: 0,
          id,
          snippet: recencySnippet,
          relPath: `memory/runs/${name}`,
          mtime,
        });
      }
      continue;
    }
    const off = firstTokenOffset(low, tokens);
    let snippet = searchable.slice(0, SESSION_SEARCH_CONTEXT * 2);
    if (off >= 0) {
      const start = Math.max(0, off - SESSION_SEARCH_CONTEXT);
      const end = Math.min(searchable.length, off + SESSION_SEARCH_CONTEXT);
      snippet = searchable.slice(start, end);
      if (start > 0) snippet = "…" + snippet;
      if (end < searchable.length) snippet = snippet + "…";
    }
    scored.push({
      score,
      id,
      snippet,
      relPath: `memory/runs/${name}`,
      mtime,
    });
    if (recencyQuery) {
      recentCandidates.push({
        score: 0,
        id,
        snippet,
        relPath: `memory/runs/${name}`,
        mtime,
      });
    }
  }

  // Fallback 2: rolling session-memory notes.
  try {
    const [raw, stat] = await Promise.all([
      fs.readFile(sessionMemoryPath, "utf8"),
      fs.stat(sessionMemoryPath).catch(() => null),
    ]);
    const lines = raw.split("\n").filter((line) => line.trim()).slice(-200);
    for (const line of lines) {
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      const searchable = [
        String(row?.kind || ""),
        String(row?.text || ""),
        String(row?.ref || ""),
        String(row?.artifact_path || ""),
      ]
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (!searchable) continue;
      const low = searchable.toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (low.includes(t)) score += 1;
      }
      const rowTs = Date.parse(String(row?.ts || ""));
      if (recencyOnly) {
        recentCandidates.push({
          score: 0,
          id: String(row?.ts || "session-memory"),
          snippet: searchable.slice(0, SESSION_SEARCH_CONTEXT * 2),
          relPath: ".webagent/session-memory.jsonl",
          mtime: Number.isFinite(rowTs) ? rowTs : stat?.mtimeMs || 0,
        });
        continue;
      }
      if (score === 0) {
        if (recencyQuery) {
          const offAny = firstTokenOffset(low, tokens);
          let recencySnippet = searchable.slice(0, SESSION_SEARCH_CONTEXT * 2);
          if (offAny >= 0) {
            const start = Math.max(0, offAny - SESSION_SEARCH_CONTEXT);
            const end = Math.min(searchable.length, offAny + SESSION_SEARCH_CONTEXT);
            recencySnippet = searchable.slice(start, end);
            if (start > 0) recencySnippet = "…" + recencySnippet;
            if (end < searchable.length) recencySnippet = recencySnippet + "…";
          }
          recentCandidates.push({
            score: 0,
            id: String(row?.ts || "session-memory"),
            snippet: recencySnippet,
            relPath: ".webagent/session-memory.jsonl",
            mtime: Number.isFinite(rowTs) ? rowTs : stat?.mtimeMs || 0,
          });
        }
        continue;
      }
      const off = firstTokenOffset(low, tokens);
      let snippet = searchable.slice(0, SESSION_SEARCH_CONTEXT * 2);
      if (off >= 0) {
        const start = Math.max(0, off - SESSION_SEARCH_CONTEXT);
        const end = Math.min(searchable.length, off + SESSION_SEARCH_CONTEXT);
        snippet = searchable.slice(start, end);
        if (start > 0) snippet = "…" + snippet;
        if (end < searchable.length) snippet = snippet + "…";
      }
      scored.push({
        score,
        id: String(row?.ts || "session-memory"),
        snippet,
        relPath: ".webagent/session-memory.jsonl",
        mtime: Number.isFinite(rowTs) ? rowTs : stat?.mtimeMs || 0,
      });
      if (recencyQuery) {
        recentCandidates.push({
          score: 0,
          id: String(row?.ts || "session-memory"),
          snippet,
          relPath: ".webagent/session-memory.jsonl",
          mtime: Number.isFinite(rowTs) ? rowTs : stat?.mtimeMs || 0,
        });
      }
    }
  } catch {
    /* absent */
  }

  scored.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  let top = scored.slice(0, 3);
  if (top.length === 0 && recencyQuery && recentCandidates.length > 0) {
    const uniqueByPath = new Map<string, SessionSearchHit>();
    for (const item of recentCandidates) {
      const existing = uniqueByPath.get(item.relPath);
      if (!existing || existing.mtime < item.mtime) uniqueByPath.set(item.relPath, item);
    }
    top = [...uniqueByPath.values()]
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 3);
  }

  await logDebugEvent("session_search", {
    query,
    tokenCount: tokens.length,
    filesScanned: toScan.length,
    hits: top.length,
  });

  const matches = top.map((m) => {
    const source = m.relPath.startsWith("memory/conversations/")
      ? "conversation"
      : m.relPath.startsWith("memory/runs/")
        ? "run"
        : "session_memory";
    return {
      conversation_id: m.id,
      source,
      score: m.score,
      path: m.relPath,
      context: m.snippet,
    };
  });
  const sourceGroups = ["conversation", "run", "session_memory"]
    .map((source) => ({
      source,
      count: matches.filter((m) => m.source === source).length,
      matches: matches.filter((m) => m.source === source),
    }))
    .filter((group) => group.count > 0);

  return {
    ok: true,
    query,
    matches,
    source_groups: sourceGroups,
    ...(top.length === 0
      ? {
          note: "No matches found in conversation archives, run history, or session memory.",
        }
      : {}),
  };
}

function normalizeTodoStatus(status) {
  const allowed = new Set(["pending", "in_progress", "completed", "cancelled"]);
  const next = String(status || "").trim();
  return allowed.has(next) ? next : "pending";
}

function normalizeTodoItem(item, index) {
  const src = item && typeof item === "object" && !Array.isArray(item) ? item : {};
  const content = String(src.content || "").trim() || `Todo ${index + 1}`;
  const id = String(src.id || `todo-${Date.now()}-${index + 1}`).trim() || `todo-${Date.now()}-${index + 1}`;
  return { id, content, status: normalizeTodoStatus(src.status) };
}

export async function sessionMemoryRememberTool(args: ToolArgs = {}, _ctx) {
  const sessionMemoryPath = workspaceStatePath(".webagent/session-memory.jsonl");
  let kind = String(args?.kind ?? "note").trim();
  if (!["decision", "note", "artifact"].includes(kind)) kind = "note";
  const text = String(args?.text ?? "").trim();
  if (!text) throw new Error("`text` is required for session_memory_append.");
  const ref = typeof args?.ref === "string" ? args.ref.trim().slice(0, 500) : "";
  const artifactPath =
    typeof args?.artifact_path === "string" ? args.artifact_path.trim().slice(0, 500) : "";
  const row = {
    ts: new Date().toISOString(),
    kind,
    text: text.slice(0, 8000),
    ...(ref ? { ref } : {}),
    ...(artifactPath ? { artifact_path: artifactPath } : {}),
  };
  await fs.mkdir(nodePath.dirname(sessionMemoryPath), { recursive: true });
  let existing = "";
  try { existing = await fs.readFile(sessionMemoryPath, "utf8"); } catch { /* new file */ }
  const lines = existing.split("\n").filter((l) => l.trim());
  lines.push(JSON.stringify(row));
  await fs.writeFile(sessionMemoryPath, lines.slice(-50).join("\n") + "\n", "utf8");
  await logDebugEvent("session_memory_append", {
    kind,
    textChars: row.text.length,
    hasRef: !!ref,
  });
  return { ok: true, ts: row.ts };
}

export async function sessionMemoryRecallTool(args: ToolArgs = {}, _ctx) {
  const sessionMemoryPath = workspaceStatePath(".webagent/session-memory.jsonl");
  const limit = Math.min(200, Math.max(1, Number(args?.limit ?? 30) || 30));
  let raw = "";
  try {
    raw = await fs.readFile(sessionMemoryPath, "utf8");
  } catch {
    return { ok: true, entries: [] };
  }
  const lines = raw.split("\n").filter((line) => line.trim());
  const slice = lines.slice(-limit);
  const entries = slice.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { parse_error: true, line: line.slice(0, 400) };
    }
  });
  await logDebugEvent("session_memory_list", { limit, count: entries.length });
  return { ok: true, entries };
}

export async function skillBulkSaveTool(args: ToolArgs = {}, ctx) {
  const memory = memoryServices(ctx);
  const normalized = expandSkillBulkSaveArgs(args);
  const items = Array.isArray(normalized?.items) ? normalized.items : null;
  if (!items || items.length === 0) {
    throw new Error(
      "`items` is required for skill_bulk_save (non-empty array). You can pass top-level `url` or `urls` for HTTPS SKILL.md installs, or `items`: [{ url } | { name, content }, ...]."
    );
  }
  const result = await memory.bulkSaveSkills(items);
  await logDebugEvent("skill_bulk_save", {
    count: items.length,
    saved: result.summary?.saved,
    failed: result.summary?.failed,
    blocked: result.summary?.blocked,
  });
  return result;
}

export async function skillListTool(args: ToolArgs = {}, ctx) {
  const memory = memoryServices(ctx);
  const skills = await memory.listSkills({
    query: typeof args?.query === "string" ? args.query.trim() : "",
    category: typeof args?.category === "string" ? args.category.trim() : "",
  });
  await logDebugEvent("skill_list", { count: skills.length });
  return { ok: true, skills };
}

export async function skillViewTool(args: ToolArgs = {}, ctx) {
  const memory = memoryServices(ctx);
  const nameRaw =
    typeof args?.name === "string"
      ? args.name.trim()
      : typeof args?.slug === "string"
        ? args.slug.trim()
        : "";
  if (!nameRaw) {
    throw new Error(
      '`name` is required for skill_view. Use {"name":"<skill-slug>"} — not `slug`.'
    );
  }
  const result = await memory.viewSkill({
    name: nameRaw,
    file_path: typeof args?.file_path === "string" ? args.file_path.trim() : undefined,
  });
  const { recordSkillView } = await import("../skill-provenance.js");
  if (result.slug) await recordSkillView(String(result.slug));
  await logDebugEvent("skill_view", { name: nameRaw, filePath: result.file_path });
  return result;
}

export async function skillManageTool(args: ToolArgs = {}, ctx) {
  const memory = memoryServices(ctx);
  const action = typeof args?.action === "string" ? args.action.trim() : "";
  if (!action) throw new Error("`action` is required for skill_manage.");
  const result = await memory.manageSkill({ ...args, action });
  await logDebugEvent("skill_manage", {
    action,
    name: typeof args?.name === "string" ? args.name.trim() : null,
    ok: result?.ok ?? null,
    blocked: result?.blocked ?? false,
  });
  return result;
}

export async function todoWriteTool(payload: ToolArgs | unknown[] = {}, _ctx) {
  const todosPath = workspaceStatePath(".webagent/todos.json");
  let rawTodos: unknown[] = [];
  if (Array.isArray(payload)) rawTodos = payload;
  else if (Array.isArray((payload as ToolArgs).todos)) rawTodos = (payload as ToolArgs).todos as unknown[];
  else if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const p = payload as ToolArgs;
    const looksLikeSingleTodo = ["id", "content", "status"].some((key) =>
      Object.prototype.hasOwnProperty.call(p, key)
    );
    if (looksLikeSingleTodo) rawTodos = [p];
  }
  const todos = rawTodos.map((todo, index) => normalizeTodoItem(todo, index));
  await fs.mkdir(getWorkspaceRoot(), { recursive: true });
  await fs.writeFile(todosPath, JSON.stringify(todos, null, 2), "utf8");
  return { ok: true, count: todos.length };
}

function extractYouTubeVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") {
      const id = u.pathname.slice(1).split(/[?&#]/)[0];
      return id || null;
    }
    if (u.hostname.includes("youtube.com")) return u.searchParams.get("v") || null;
  } catch {}
  return null;
}

function decodeHtmlEntities(text) {
  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

async function fetchYouTubeCaptionTracks(videoId, ctx) {
  // InnerTube ANDROID POST — the only reliable source of working timedtext URLs.
  // YouTube's API is CORS-blocked in browser JS, so proxyRequest routes it through
  // the local Vite dev server (WEBAGENT_LOCAL_PROXY_URL) which fetches server-side.
  // In Nodebox, the fetch() from the agent goes through the browser's network stack
  // to localhost:PORT/api/proxy, which then hits YouTube without CORS restrictions.
  const { status, body } = readProxyResponse(await proxyRequest(
    {
      method: "POST",
      url: "https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
        videoId,
      }),
    },
    ctx
  ));
  if (status < 200 || status >= 300) throw new Error(`YouTube player API returned ${status}.`);
  let playerData;
  try {
    playerData = JSON.parse(body);
  } catch {
    throw new Error("YouTube player response could not be parsed.");
  }
  const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks) || !tracks.length) {
    const s = playerData?.playabilityStatus?.status;
    const r = playerData?.playabilityStatus?.reason;
    throw new Error(s && s !== "OK" ? `Video unavailable: ${r || s}` : "No captions available for this video.");
  }
  return tracks;
}

function parseCaptionXml(xml) {
  // Extract text from timedtext XML: <s>word</s> inside <p> elements
  const segments: string[] = [];
  const pMatches = [...xml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)];
  for (const pm of pMatches) {
    const inner = pm[1];
    const sMatches = [...inner.matchAll(/<s[^>]*>([^<]*)<\/s>/g)];
    if (sMatches.length) {
      segments.push(sMatches.map((m) => m[1]).join(""));
    } else {
      // Plain text inside <p> with no <s> children
      const text = inner.replace(/<[^>]+>/g, "").trim();
      if (text) segments.push(text);
    }
  }
  return segments
    .map((s) => decodeHtmlEntities(s).replace(/\n/g, " ").trim())
    .filter(Boolean);
}

export async function youtubeTranscribeTool(args: ToolArgs = {}, ctx) {
  const url = typeof args?.url === "string" ? args.url.trim() : "";
  if (!url) throw new Error("`url` is required for youtube_transcribe.");
  const language = typeof args?.language === "string" ? args.language.trim() : "en";


  const videoId = extractYouTubeVideoId(url);
  if (!videoId) throw new Error(`Cannot extract video ID from URL: ${url}`);

  const tracks = await fetchYouTubeCaptionTracks(videoId, ctx);

  const track =
    tracks.find((t) => t.languageCode === language) ||
    tracks.find((t) => String(t.languageCode || "").startsWith(language.split("-")[0])) ||
    tracks[0];
  if (!track?.baseUrl) throw new Error("No usable caption track found for this video.");

  const { status: capStatus, body: capBody } = readProxyResponse(
    await proxyRequest({ url: track.baseUrl }, ctx)
  );
  if (capStatus < 200 || capStatus >= 300) throw new Error(`Caption fetch returned ${capStatus}.`);
  const captionXml = String(capBody ?? "");
  if (!captionXml.trim()) {
    throw new Error(`Caption URL returned empty response. lang=${track.languageCode}`);
  }

  const segments = parseCaptionXml(captionXml);
  if (!segments.length) throw new Error("Transcript XML parsed but no text segments found.");

  const transcript = segments.join(" ").replace(/\s+/g, " ").trim();
  await logDebugEvent("youtube_transcribe", { videoId, language: track.languageCode, segmentCount: segments.length });
  return {
    ok: true,
    videoId,
    url,
    language: track.languageCode,
    segmentCount: segments.length,
    transcript,
  };
}
