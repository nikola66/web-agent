import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import nodePath from "node:path";
import crypto from "node:crypto";
import { withWebAgentUserAgent } from "../http-upstream.js";
import { ipcProxyRequest, readProxyResponse } from "../ipc.js";
import { resolveWorkspacePath, normalizeWorkspaceRelativePath } from "../workspace-paths.js";
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
import { htmlApiBodyRecoveryNote, looksLikeHtmlDocument } from "../tool-result-preview.js";
import { loadMcpSecrets, resolveMcpBearerToken } from "../mcp-secrets.js";
import { loadMcpServersConfig } from "../mcp-config.js";
import { parseTinyFishFetchPayload, spaShellPageRecoveryHint } from "./tinyfish-fetch.js";
import { expandSkillBulkSaveArgs } from "./skill-bulk-args.js";
import {
  extractYouTubeVideoId,
  fetchYouTubeCaptionTracks,
  parseCaptionXml,
} from "./youtube-caption-fetch.js";
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

type HttpProxySuccessBinary = {
  ok: true;
  status: number;
  url: string;
  contentType: string;
  bytes: number;
  body_encoding: "base64";
  base64: string;
  sha256_prefix: string;
};

export type HttpProxyResult =
  | HttpProxySuccessJson
  | HttpProxySuccessText
  | HttpProxySuccessBinary
  | HttpProxyFailure;

type BrowserCatalogProvider = {
  id: string;
  isDefault?: boolean;
  name?: string;
  auth?: { settingKey?: string; envVar?: string; headerName?: string };
  search?: { endpoint?: string; timeoutMs?: number };
  fetch?: { endpoint?: string; timeoutMs?: number };
};


export function formatProxyTransportError(message: string, url?: string): string {
  const base = String(message || "unknown error").trim() || "unknown error";
  if (!/failed to fetch/i.test(base)) return base;
  const host = (() => {
    try {
      return new URL(String(url || "")).hostname;
    } catch {
      return "";
    }
  })();
  const mcpHint = host
    ? ` If REST is blocked, use configured mcp_* tools (see .webagent/mcp-servers.json) for ${host}.`
    : " If REST is blocked, use configured mcp_* tools from .webagent/mcp-servers.json.";
  return `${base} (browser sandbox could not reach upstream — requests are routed via /api/proxy).${mcpHint}`;
}

/** Max upload size for web_upload / web_post multipart file parts (default 10 MB). */
export const WEB_UPLOAD_MAX_BYTES = Math.max(
  1024,
  Number(process.env.WEBAGENT_UPLOAD_MAX_BYTES) || 10 * 1024 * 1024
);

/** Inline base64 cap for web_fetch response_encoding without save_to. */
export const WEB_FETCH_BINARY_INLINE_CAP = 32_000;

export type MultipartFieldSpec = {
  name: string;
  text?: string;
  filename?: string;
  content_type?: string;
  file_path?: string;
  source_url?: string;
};

type ResolvedMultipartPart = {
  name: string;
  text?: string;
  bytes?: Buffer;
  filename?: string;
  content_type?: string;
};

export function buildMultipartBody(parts: ResolvedMultipartPart[]): {
  body: string;
  bodyEncoding: "base64";
  contentType: string;
  boundary: string;
} {
  if (!parts.length) throw new Error("multipart requires at least one field.");
  const boundary = `----WebAgent${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const name = String(part.name || "").trim();
    if (!name) throw new Error("Each multipart field requires `name`.");
    if (part.bytes) {
      const filename = String(part.filename || "file").replace(/[\r\n"]/g, "_");
      const ct = String(part.content_type || "application/octet-stream");
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${ct}\r\n\r\n`
        )
      );
      chunks.push(part.bytes);
      chunks.push(Buffer.from("\r\n"));
    } else {
      chunks.push(
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${String(part.text ?? "")}\r\n`)
      );
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const bodyBuf = Buffer.concat(chunks);
  return {
    body: bodyBuf.toString("base64"),
    bodyEncoding: "base64",
    contentType: `multipart/form-data; boundary=${boundary}`,
    boundary,
  };
}

function assertUploadSize(bytes: Buffer, label: string): void {
  if (bytes.length > WEB_UPLOAD_MAX_BYTES) {
    throw new Error(
      `${label} is ${bytes.length} bytes (max ${WEB_UPLOAD_MAX_BYTES}). Use a smaller file or raise WEBAGENT_UPLOAD_MAX_BYTES.`
    );
  }
}

async function fetchBinaryViaProxy(
  url: string,
  ctx: unknown,
  headers: Record<string, string> = {},
  timeoutMs?: number
): Promise<{ bytes: Buffer; contentType: string; status: number }> {
  const ipcTimeout = pickRemoteTimeoutMs(ctx, timeoutMs, 120_000);
  const raw = await proxyRequest(
    { method: "GET", url, headers, binaryResponse: true },
    ctx,
    ipcTimeout
  );
  const { status, body, contentType, bodyEncoding } = readProxyResponse(raw);
  if (status < 200 || status >= 300) {
    throw new Error(`Binary fetch failed (${status}) for ${url.slice(0, 240)}`);
  }
  const bytes =
    bodyEncoding === "base64" && body
      ? Buffer.from(body, "base64")
      : Buffer.from(body, "utf8");
  assertUploadSize(bytes, `Download from ${url.slice(0, 120)}`);
  return { bytes, contentType: contentType || "application/octet-stream", status };
}

async function readWorkspaceBinary(relPath: string, ctx: unknown, label: string): Promise<Buffer> {
  const normalized = normalizeWorkspaceRelativePath(relPath).replace(/\\/g, "/");
  const abs = resolveWorkspacePath(ctx, normalized);
  const bytes = await fs.readFile(abs);
  assertUploadSize(bytes, label || normalized);
  return bytes;
}

export async function resolveMultipartFieldSpecs(
  specs: MultipartFieldSpec[],
  ctx: unknown
): Promise<ResolvedMultipartPart[]> {
  if (!Array.isArray(specs) || !specs.length) {
    throw new Error("`multipart` must be a non-empty array of field objects.");
  }
  const out: ResolvedMultipartPart[] = [];
  for (const spec of specs) {
    const name = String(spec?.name || "").trim();
    if (!name) throw new Error("Each multipart field requires `name`.");
    const filePath = typeof spec.file_path === "string" ? spec.file_path.trim() : "";
    const sourceUrl = typeof spec.source_url === "string" ? spec.source_url.trim() : "";
    const textVal = spec.text != null ? String(spec.text) : "";
    const hasFile = !!(filePath || sourceUrl);
    const hasText = textVal.length > 0;
    if (hasFile && hasText) {
      throw new Error(`Multipart field "${name}": use either text or file_path/source_url, not both.`);
    }
    if (!hasFile && !hasText) {
      throw new Error(`Multipart field "${name}": provide text, file_path, or source_url.`);
    }
    if (filePath && sourceUrl) {
      throw new Error(`Multipart field "${name}": provide only one of file_path or source_url.`);
    }
    if (hasFile) {
      const bytes = filePath
        ? await readWorkspaceBinary(filePath, ctx, `File ${filePath}`)
        : (await fetchBinaryViaProxy(sourceUrl, ctx)).bytes;
      out.push({
        name,
        bytes,
        filename:
          typeof spec.filename === "string" && spec.filename.trim()
            ? spec.filename.trim()
            : filePath
              ? nodePath.basename(filePath)
              : "file",
        content_type:
          typeof spec.content_type === "string" && spec.content_type.trim()
            ? spec.content_type.trim()
            : undefined,
      });
    } else {
      out.push({ name, text: textVal });
    }
  }
  return out;
}

function sha256Prefix(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 12);
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

export async function proxyRequest(request, _ctx, timeoutMs?) {
  const { method = "GET", url, headers = {}, body = null, bodyEncoding, binaryResponse } = request;
  const ipcTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : undefined;
  return ipcProxyRequest({ method, url, headers, body, bodyEncoding, binaryResponse }, ipcTimeout);
}

export const WEB_POST_METHODS = ["POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"] as const;
const WEB_POST_BODY_OPTIONAL = new Set(["DELETE", "HEAD", "OPTIONS"]);

export function mergeUrlQueryParams(url: string, params: Record<string, unknown> | undefined): string {
  if (!params || typeof params !== "object" || Array.isArray(params)) return url;
  const u = new URL(url);
  for (const [key, val] of Object.entries(params)) {
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item != null) u.searchParams.append(key, String(item));
      }
    } else {
      u.searchParams.set(key, String(val));
    }
  }
  return u.toString();
}

export function normalizeWebPostMethod(raw: unknown, defaultMethod = "POST"): string {
  const m = String(raw ?? defaultMethod).trim().toUpperCase();
  return (WEB_POST_METHODS as readonly string[]).includes(m) ? m : defaultMethod;
}

export function resolveWebPostBody(
  args: ToolArgs,
  method: string
): { body: string | null; bodyEncoding?: "base64"; contentTypeHint?: string } {
  const m = method.toUpperCase();
  if (Array.isArray(args.multipart) && args.multipart.length) {
    throw new Error(
      "`multipart` is resolved asynchronously — use webPostTool (not resolveWebPostBody) for multipart payloads."
    );
  }
  if (args.form && typeof args.form === "object" && !Array.isArray(args.form)) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(args.form as Record<string, unknown>)) {
      if (v !== undefined && v !== null) params.append(k, String(v));
    }
    return { body: params.toString(), contentTypeHint: "application/x-www-form-urlencoded" };
  }
  let raw = args.body;
  if (raw === undefined || raw === null) {
    raw = args.data ?? args.payload ?? args.json;
  }
  if (raw === undefined || raw === null) {
    if (WEB_POST_BODY_OPTIONAL.has(m)) return { body: null };
    throw new Error(
      "`body` is required for web_post (POST/PATCH/PUT). Pass a JSON string, object via `json`, or use `form` for urlencoded fields."
    );
  }
  const body = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (args.body_encoding === "base64") return { body, bodyEncoding: "base64" };
  return { body };
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
  // Require a real GraphQL signal. Bare "was not provided" / "of required type"
  // also appear in plain REST validation errors, so they are not sufficient on
  // their own — otherwise a REST 422 gets GraphQL relation advice.
  const isGraphql = /graphql|Cannot query field|_input\b/i.test(text);
  if (!isGraphql) return undefined;
  // Relation input-shape error: trying to link an existing related record but
  // the create-input demands all its non-null fields. This is the loop that
  // stalled a blog publish across ~8 introspection calls.
  const cmsMutationNaming =
    /create_[A-Za-z0-9_]+_item|update_[A-Za-z0-9_]+_item|delete_[A-Za-z0-9_]+_item|_aggregated\b|Unknown type|create_.*_input/i.test(
      text
    );
  if (/_input\b|of required type|was not provided|non[- ]?null/i.test(text)) {
    let hint =
      "GraphQL mutation input-shape error. To LINK an existing related record (author, category, etc.), pass the relation as a nested object with only its id — e.g. `author: { id: \"1\" }` — not a bare id, and not the full create object with all fields. " +
      "If a `create_*_input` still demands every non-null field, the relation field actually accepts the lighter input that only needs `id`. " +
      "Put large or HTML field values in GraphQL `variables` (web_post `json: { query, variables }`) rather than inlining them in the query string, to avoid JSON-escaping corruption. " +
      "See `skill` (action=view) on the relevant imported skill and **`http-api`** for the exact shape.";
    if (cmsMutationNaming) {
      hint +=
        " CMS GraphQL mutations use `create_{ExactCollection}_item` / `update_{ExactCollection}_item` — collection name and casing must match the schema (e.g. `Blog_Posts`, not `posts`). Re-fetch `GET /fields/{Collection}` with `response_format: \"api\"` before retrying.";
    }
    return hint;
  }
  let hint =
    "GraphQL root fields must match that API's schema — do not assume generic names. " +
    "Call `skill` (action=view) on the relevant imported skill (and **`http-api`**) for discovery endpoints and query shape, " +
    "then fix field names from the error.";
  if (cmsMutationNaming) {
    hint +=
      " For CMS-style schemas: query roots and mutations follow the exact collection name (`Blog_Posts`, `Blog_Posts_aggregated`, `create_Blog_Posts_item`). See **`http-api`** (CMS GraphQL section).";
  }
  return hint;
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
    "Use `skill` (action=view) on the relevant imported skill for discovery (list/metadata/health) before guessing resource names. " +
    "See `skill` (action=view) **`http-api`**."
  );
}

function httpApiRecoveryHint(url: string, status: number, data: unknown): string | undefined {
  return graphqlSchemaRecoveryHint(data, status) ?? guessedResourceRecoveryHint(url, status);
}

/** True when callers expect JSON/API data (not a marketing HTML page read). */
export function urlExpectsApiJson(url: string, method: string): boolean {
  const m = String(method || "GET").toUpperCase();
  if (m !== "GET") return true;
  return looksLikeApiFetchUrl(url);
}

function apiHtmlFailureResult(
  status: number,
  url: string,
  contentType: string,
  text: string,
  truncated?: { truncated?: true; truncated_at_chars?: number }
): HttpProxyFailure {
  const recovery_hint = spaShellPageRecoveryHint(text, url);
  return {
    ok: false,
    status,
    url,
    contentType,
    data: null,
    error: htmlApiBodyRecoveryNote(text, url),
    ...(recovery_hint ? { recovery_hint } : {}),
    ...truncated,
  };
}

function bearerFromAuthArgs(auth: Record<string, unknown> | null): string {
  if (!auth) return "";
  return String(auth.directus_token ?? auth.bearer_token ?? auth.token ?? "").trim();
}

async function bearerFromMcpSecretsForUrl(url: string): Promise<string> {
  const secrets = await loadMcpSecrets();
  const token = resolveMcpBearerToken(secrets);
  if (!token) return "";
  try {
    const host = new URL(url).hostname.toLowerCase();
    const config = await loadMcpServersConfig();
    for (const srv of Object.values(config)) {
      const srvUrl = String(srv?.url ?? "").trim();
      if (!srvUrl) continue;
      try {
        if (new URL(srvUrl).hostname.toLowerCase() === host) return token;
      } catch {
        /* ignore bad MCP server url */
      }
    }
  } catch {
    return "";
  }
  return "";
}

/** Merge args.headers, auth aliases, and MCP secrets (host-matched) into Authorization. */
export async function resolveHttpAuthHeaders(
  args: ToolArgs,
  url: string
): Promise<Record<string, string>> {
  const headers = normalizeHttpHeaders(args.headers);
  const existing = String(headers.Authorization ?? headers.authorization ?? "").trim();
  if (existing) return headers;

  const auth =
    args.auth && typeof args.auth === "object" && !Array.isArray(args.auth)
      ? (args.auth as Record<string, unknown>)
      : null;
  let token = bearerFromAuthArgs(auth);
  if (!token) token = await bearerFromMcpSecretsForUrl(url);
  if (!token) return headers;

  headers.Authorization = /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
  return headers;
}

export async function httpProxyCall(
  {
    method = "GET",
    url,
    headers = {},
    body = null,
    bodyEncoding,
    binaryResponse,
  }: {
    method?: string;
    url: string;
    headers?: Record<string, string>;
    body?: string | null;
    bodyEncoding?: "base64";
    binaryResponse?: boolean;
  },
  ctx,
  options?: { timeoutMs?: number }
): Promise<HttpProxyResult> {
  const normHeaders = withWebAgentUserAgent(normalizeHttpHeaders(headers));
  const m = String(method || "GET").toUpperCase();
  const ipcTimeout = pickRemoteTimeoutMs(ctx, options?.timeoutMs, 120_000);
  await logDebugEvent("http_proxy_call", {
    method: m,
    url: String(url).slice(0, 800),
    headers: redactHttpHeadersForLog(normHeaders),
    binaryResponse: !!binaryResponse,
  });
  const {
    status,
    body: respBody,
    contentType,
    bodyEncoding: respBodyEncoding,
    proxyError,
  } = readProxyResponse(
    await proxyRequest(
      { method: m, url, headers: normHeaders, body, bodyEncoding, binaryResponse },
      ctx,
      ipcTimeout
    )
  );
  if (proxyError) {
    throw new Error(formatProxyTransportError(proxyError, url));
  }
  const ok = status >= 200 && status < 300;

  if (binaryResponse) {
    const bytes =
      respBodyEncoding === "base64" && respBody
        ? Buffer.from(respBody, "base64")
        : Buffer.from(respBody, "utf8");
    const base = { ok: ok as true, status, url, contentType, bytes: bytes.length, body_encoding: "base64" as const };
    if (!ok) {
      const detail = bytes.toString("utf8", 0, Math.min(bytes.length, 240));
      throw Object.assign(new Error(`HTTP request failed (${status}): ${detail || "unknown error"}`), { status });
    }
    return {
      ...base,
      base64: respBodyEncoding === "base64" ? respBody : bytes.toString("base64"),
      sha256_prefix: sha256Prefix(bytes),
    };
  }

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
      if (trimmed.startsWith("<") || looksLikeHtmlDocument(sliced.text)) {
        const trunc = sliced.truncated
          ? { truncated: true as const, truncated_at_chars: sliced.truncated_at_chars }
          : {};
        if (urlExpectsApiJson(url, m)) {
          return apiHtmlFailureResult(status, url, contentType, sliced.text, trunc);
        }
        const recovery_hint = spaShellPageRecoveryHint(sliced.text, url);
        return {
          ok: true as const,
          status,
          url,
          contentType,
          text: sliced.text,
          ...(recovery_hint ? { recovery_hint } : {}),
          ...trunc,
        };
      }
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
  if (looksLikeHtmlDocument(sliced.text) && urlExpectsApiJson(url, m)) {
    const trunc = sliced.truncated
      ? { truncated: true as const, truncated_at_chars: sliced.truncated_at_chars }
      : {};
    return apiHtmlFailureResult(status, url, contentType, sliced.text, trunc);
  }
  const recovery_hint =
    looksLikeHtmlDocument(sliced.text) ? spaShellPageRecoveryHint(sliced.text, url) : undefined;
  return {
    ...base,
    text: sliced.text,
    ...(recovery_hint ? { recovery_hint } : {}),
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

export type WebFetchResponseFormat = "markdown" | "api";

/** `response_format` on web_fetch: `api` = direct proxy JSON/text; `markdown` = TinyFish page reader when eligible. */
export function resolveWebFetchResponseFormat(args: {
  response_format?: unknown;
  format?: unknown;
} = {}): WebFetchResponseFormat {
  const raw = String(args.response_format ?? args.format ?? "")
    .trim()
    .toLowerCase();
  if (raw === "api" || raw === "json" || raw === "rest" || raw === "raw") return "api";
  if (raw === "markdown" || raw === "page" || raw === "html") return "markdown";
  return "markdown";
}

/** True when the URL path/host looks like a REST/GraphQL API surface (not a marketing HTML page). */
export function looksLikeApiFetchUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (host.startsWith("api.") || host.includes(".api.") || host.endsWith(".api")) return true;
    if (/\.(json|xml|ya?ml|graphql)$/i.test(path)) return true;
    if (/\/graphql\b/i.test(path)) return true;
    if (/\/(api|rest)\b/i.test(path) || /\/v\d+\b/i.test(path)) return true;
    if (/\/(items|collections|assets|files|fields|schema|users|roles|permissions|webhooks)\b/i.test(path)) {
      return true;
    }
    if (/\/server\/(info|health|ping|specs)\b/i.test(path)) return true;
    if (/\/wp-json\b/i.test(path)) return true;
    if (/\/oauth2?\b/i.test(path)) return true;
    const fmt = u.searchParams.get("format")?.toLowerCase();
    if (fmt && /^(json|xml|graphql)$/.test(fmt)) return true;
    return false;
  } catch {
    return false;
  }
}

export function shouldWebFetchUseDirectProxy(
  url: string,
  headers: Record<string, string> = {},
  responseFormat: WebFetchResponseFormat = "markdown"
): boolean {
  if (responseFormat === "api") return true;
  if (Object.keys(headers).length > 0) return true;
  return looksLikeApiFetchUrl(url);
}

/**
 * Throw an HTTP failure as an Error that still carries the structured
 * `recovery_hint`, parsed error `data`, and `status` that httpProxyCall built.
 * The runTools catch propagates these onto the tool result, so a thrown HTTP
 * error keeps its GraphQL/relation recovery hint and full error body instead of
 * collapsing to a bare message string.
 */
function throwHttpProxyFailure(result: HttpProxyFailure): never {
  throw Object.assign(new Error(result.error || "HTTP request failed"), {
    status: result.status,
    ...(result.recovery_hint ? { recovery_hint: result.recovery_hint } : {}),
    ...(result.data !== undefined ? { data: result.data } : {}),
  });
}

async function webFetchReadableFromProxy(url, ctx, headers: Record<string, string> = {}) {
  const proxy = await proxyFetch(url, ctx, headers);
  if (proxy.ok === false) {
    throwHttpProxyFailure(proxy as HttpProxyFailure);
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
  const recovery_hint = spaShellPageRecoveryHint(readable, url);
  return {
    ok: true,
    url,
    provider: "proxy-fallback",
    content_type: contentType,
    text: readable,
    ...(recovery_hint ? { recovery_hint } : {}),
    ...(truncated ? { truncated, truncated_at_chars } : {}),
  };
}

const WEB_FETCH_BATCH_MAX = 5;

async function webFetchOne(
  url: string,
  ctx,
  headers: Record<string, string> = {},
  fetchOpts: { saveTo?: string; responseEncoding?: string; responseFormat?: WebFetchResponseFormat } = {}
) {
  const u = new URL(url);
  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error(`web_fetch only supports http(s) URLs, got: ${u.protocol}`);
  }

  const saveTo = typeof fetchOpts.saveTo === "string" ? fetchOpts.saveTo.trim() : "";
  const responseEncoding = String(fetchOpts.responseEncoding || "").trim().toLowerCase();
  const wantBinary = saveTo.length > 0 || responseEncoding === "base64";

  if (wantBinary) {
    const binary = await httpProxyCall(
      { method: "GET", url, headers, binaryResponse: true },
      ctx
    );
    if (!binary.ok) throw new Error("binary" in binary ? "fetch failed" : String((binary as HttpProxyFailure).error));
    const bin = binary as HttpProxySuccessBinary;
    const bytes = Buffer.from(bin.base64, "base64");
    if (saveTo) {
      const rel = normalizeWorkspaceRelativePath(saveTo).replace(/\\/g, "/");
      const abs = resolveWorkspacePath(ctx, rel);
      await fs.mkdir(nodePath.dirname(abs), { recursive: true });
      await fs.writeFile(abs, bytes);
      return {
        ok: true as const,
        url,
        provider: "proxy-binary",
        status: bin.status,
        content_type: bin.contentType,
        bytes: bytes.length,
        path: rel,
        sha256_prefix: bin.sha256_prefix,
      };
    }
    if (bin.base64.length <= WEB_FETCH_BINARY_INLINE_CAP) {
      return {
        ok: true as const,
        url,
        provider: "proxy-binary",
        status: bin.status,
        content_type: bin.contentType,
        bytes: bytes.length,
        body_encoding: "base64" as const,
        base64: bin.base64,
        sha256_prefix: bin.sha256_prefix,
      };
    }
    const spillRel = `memory/tmp/fetch_${Date.now().toString(36)}_${sha256Prefix(bytes)}.bin`;
    const spillAbs = resolveWorkspacePath(ctx, spillRel);
    await fs.mkdir(nodePath.dirname(spillAbs), { recursive: true });
    await fs.writeFile(spillAbs, bytes);
    return {
      ok: true as const,
      url,
      provider: "proxy-binary",
      status: bin.status,
      content_type: bin.contentType,
      bytes: bytes.length,
      path: spillRel,
      sha256_prefix: bin.sha256_prefix,
      spilled: true,
      note: "Binary too large to inline — use path with web_upload (file_path) or web_post.multipart.",
    };
  }

  const responseFormat = fetchOpts.responseFormat ?? "markdown";
  if (shouldWebFetchUseDirectProxy(url, headers, responseFormat)) {
    return webFetchReadableFromProxy(url, ctx, headers);
  }
  const provider = await getBrowserAgentProvider(ctx);
  if (provider && hasProviderApiKey(provider, ctx)) {
    try {
      const text = await browserAgentFetch(provider, url, ctx);
      const recovery_hint = spaShellPageRecoveryHint(text, url);
      return {
        ok: true,
        url,
        provider: provider.id,
        text,
        ...(recovery_hint ? { recovery_hint } : {}),
      };
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

  const queryParams =
    args.params && typeof args.params === "object" && !Array.isArray(args.params)
      ? (args.params as Record<string, unknown>)
      : undefined;
  const saveTo = typeof args.save_to === "string" ? args.save_to.trim() : "";
  const responseEncoding = typeof args.response_encoding === "string" ? args.response_encoding.trim() : "";
  const responseFormat = resolveWebFetchResponseFormat(args);
  const fetchOpts = { saveTo, responseEncoding, responseFormat };

  const rawUrls = Array.isArray(args.urls) ? args.urls : [];
  const single = typeof args.url === "string" ? args.url.trim() : "";
  const targets = [
    ...(single ? [single] : []),
    ...rawUrls.map((u) => String(u || "").trim()).filter(Boolean),
  ].map((url) => (queryParams ? mergeUrlQueryParams(url, queryParams) : url));
  if (!targets.length) throw new Error("`url` or `urls` is required for web_fetch.");
  if (targets.length > WEB_FETCH_BATCH_MAX) {
    throw new Error(`web_fetch accepts at most ${WEB_FETCH_BATCH_MAX} URLs per call.`);
  }
  if ((saveTo || responseEncoding) && targets.length > 1) {
    throw new Error("save_to and response_encoding apply to a single url only (not batch urls).");
  }

  // Resolve auth per-target: a Bearer/MCP token is host-matched to its own url,
  // never reused across a mixed-host batch (which would leak it to other hosts).
  if (targets.length === 1) {
    const headers = await resolveHttpAuthHeaders(args, targets[0]);
    return webFetchOne(targets[0], ctx, headers, fetchOpts);
  }

  const documents = await Promise.all(
    targets.map(async (url) => {
      try {
        const headers = await resolveHttpAuthHeaders(args, url);
        return await webFetchOne(url, ctx, headers, fetchOpts);
      } catch (err) {
        return { ok: false, url, error: String(err?.message || err) };
      }
    })
  );
  return { ok: true, count: documents.length, documents };
}

export async function webPostTool(args: ToolArgs = {}, ctx) {
  let url = typeof args.url === "string" ? args.url.trim() : "";
  if (!url) throw new Error("`url` is required for web_post.");
  if (args.params && typeof args.params === "object" && !Array.isArray(args.params)) {
    url = mergeUrlQueryParams(url, args.params as Record<string, unknown>);
  }
  const u = new URL(url);
  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error(`web_post only supports http(s) URLs, got: ${u.protocol}`);
  }
  const method = normalizeWebPostMethod(args.method);
  const headers = await resolveHttpAuthHeaders(args, url);
  const timeoutMs = Number(args.timeout_ms);
  const proxyCtx =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? { ...ctx, timeoutMs } : ctx;
  const timeoutOpt = Number.isFinite(timeoutMs) && timeoutMs > 0 ? { timeoutMs } : undefined;

  let body: string | null;
  let bodyEncoding: "base64" | undefined;
  let contentTypeHint = "";

  if (Array.isArray(args.multipart) && args.multipart.length) {
    if (args.body != null || args.json != null || args.form != null || args.data != null) {
      throw new Error("Use either `multipart` or body/json/form — not both.");
    }
    const parts = await resolveMultipartFieldSpecs(args.multipart as MultipartFieldSpec[], ctx);
    const built = buildMultipartBody(parts);
    body = built.body;
    bodyEncoding = built.bodyEncoding;
    contentTypeHint = built.contentType;
  } else {
    const resolved = resolveWebPostBody(args, method);
    body = resolved.body;
    bodyEncoding = resolved.bodyEncoding;
    contentTypeHint = resolved.contentTypeHint || "";
  }

  const contentType =
    typeof args.content_type === "string" ? args.content_type.trim() : contentTypeHint || "";
  if (contentType) headers["Content-Type"] = contentType;
  else if (!headers["Content-Type"] && !headers["content-type"] && body) {
    const trimmed = body.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      headers["Content-Type"] = "application/json";
    }
  }
  const result = await httpProxyCall({ method, url, headers, body, bodyEncoding }, proxyCtx, timeoutOpt);
  if (!result.ok) throwHttpProxyFailure(result as HttpProxyFailure);
  return result;
}

export async function webUploadTool(args: ToolArgs = {}, ctx) {
  const uploadUrl = typeof args.upload_url === "string" ? args.upload_url.trim() : "";
  if (!uploadUrl) throw new Error("`upload_url` is required for web_upload.");
  const u = new URL(uploadUrl);
  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error(`web_upload only supports http(s) URLs, got: ${u.protocol}`);
  }
  if (args.body != null || args.content != null || args.base64 != null) {
    throw new Error(
      "web_upload never accepts raw bytes in tool args. Use source_url or file_path — runtime fetches/reads bytes server-side."
    );
  }

  const filePath = typeof args.file_path === "string" ? args.file_path.trim() : "";
  const sourceUrl = typeof args.source_url === "string" ? args.source_url.trim() : "";
  if (!filePath && !sourceUrl) {
    throw new Error("web_upload requires exactly one of `source_url` or `file_path`.");
  }
  if (filePath && sourceUrl) {
    throw new Error("web_upload accepts only one of `source_url` or `file_path`, not both.");
  }

  const fieldName = typeof args.field_name === "string" && args.field_name.trim() ? args.field_name.trim() : "file";
  const filename =
    typeof args.filename === "string" && args.filename.trim()
      ? args.filename.trim()
      : filePath
        ? nodePath.basename(filePath)
        : "upload.bin";
  const contentType =
    typeof args.content_type === "string" && args.content_type.trim()
      ? args.content_type.trim()
      : "application/octet-stream";

  let bytes: Buffer;
  if (filePath) {
    bytes = await readWorkspaceBinary(filePath, ctx, `File ${filePath}`);
  } else {
    const fetched = await fetchBinaryViaProxy(sourceUrl, ctx, normalizeHttpHeaders(args.source_headers));
    bytes = fetched.bytes;
  }

  const built = buildMultipartBody([
    { name: fieldName, bytes, filename, content_type: contentType },
  ]);
  const headers = normalizeHttpHeaders(args.headers);
  headers["Content-Type"] = built.contentType;
  const timeoutMs = Number(args.timeout_ms);
  const proxyCtx =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? { ...ctx, timeoutMs } : ctx;
  const result = await httpProxyCall(
    { method: "POST", url: uploadUrl, headers, body: built.body, bodyEncoding: built.bodyEncoding },
    proxyCtx,
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? { timeoutMs } : undefined
  );
  if (!result.ok) return result;
  const payload =
    "data" in result
      ? result
      : {
          ok: true as const,
          status: result.status,
          url: uploadUrl,
          contentType: result.contentType,
          data: "text" in result ? result.text : null,
        };
  return {
    ...payload,
    bytes_uploaded: bytes.length,
    filename,
    field_name: fieldName,
  };
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

type SessionSearchHit = {
  score: number;
  id: string;
  snippet: string;
  relPath: string;
  mtime: number;
};

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

function sessionSearchTokenScore(low, tokens) {
  let score = 0;
  for (const t of tokens) {
    if (low.includes(t)) score += 1;
  }
  return score;
}

function sessionSearchSnippet(searchable, tokens) {
  const maxLen = SESSION_SEARCH_CONTEXT * 2;
  const off = firstTokenOffset(searchable.toLowerCase(), tokens);
  if (off < 0) return searchable.slice(0, maxLen);
  const start = Math.max(0, off - SESSION_SEARCH_CONTEXT);
  const end = Math.min(searchable.length, off + SESSION_SEARCH_CONTEXT);
  let snippet = searchable.slice(start, end);
  if (start > 0) snippet = "…" + snippet;
  if (end < searchable.length) snippet = snippet + "…";
  return snippet;
}

function appendSessionSearchHits(
  scored,
  recentCandidates,
  searchable,
  tokens,
  recencyOnly,
  recencyQuery,
  id,
  relPath,
  mtime,
  offsetRecencySnippet = true
) {
  const low = searchable.toLowerCase();
  const score = sessionSearchTokenScore(low, tokens);
  const headSnippet = searchable.slice(0, SESSION_SEARCH_CONTEXT * 2);
  if (recencyOnly) {
    recentCandidates.push({ score: 0, id, snippet: headSnippet, relPath, mtime });
    return;
  }
  if (score === 0) {
    if (recencyQuery) {
      let snippet = headSnippet;
      if (offsetRecencySnippet && tokens.length) {
        snippet = sessionSearchSnippet(searchable, tokens);
      }
      recentCandidates.push({ score: 0, id, snippet, relPath, mtime });
    }
    return;
  }
  const snippet = sessionSearchSnippet(searchable, tokens);
  scored.push({ score, id, snippet, relPath, mtime });
  if (recencyQuery) {
    recentCandidates.push({ score: 0, id, snippet, relPath, mtime });
  }
}

async function listRecentJsonFiles(absDir, maxFiles) {
  let dirents = [];
  try {
    dirents = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return [];
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
  return withMtime.slice(0, maxFiles);
}

function runSearchableFromRunJson(raw) {
  let id = "";
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
  return { id, searchable };
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
  const scored = [];
  const recentCandidates = [];

  const toScan = await listRecentJsonFiles(absDir, maxFiles);
  for (const { abs, name, mtime } of toScan) {
    let raw;
    try {
      raw = await fs.readFile(abs, "utf8");
    } catch {
      continue;
    }
    let id = name.replace(/\.json$/i, "");
    const text = raw.replace(/\s+/g, " ").trim();
    const score = sessionSearchTokenScore(text.toLowerCase(), tokens);
    if (!recencyOnly && score > 0) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.id) id = String(parsed.id);
      } catch {
        /* keep basename */
      }
    }
    appendSessionSearchHits(
      scored,
      recentCandidates,
      text,
      tokens,
      recencyOnly,
      recencyQuery,
      id,
      `memory/conversations/${name}`,
      mtime,
      false
    );
  }

  const runToScan = await listRecentJsonFiles(absRunsDir, maxFiles);
  for (const { abs, name, mtime } of runToScan) {
    let raw = "";
    try {
      raw = await fs.readFile(abs, "utf8");
    } catch {
      continue;
    }
    let id = name.replace(/\.json$/i, "");
    const parsed = runSearchableFromRunJson(raw);
    if (parsed.id) id = parsed.id;
    if (!parsed.searchable) continue;
    appendSessionSearchHits(
      scored,
      recentCandidates,
      parsed.searchable,
      tokens,
      recencyOnly,
      recencyQuery,
      id,
      `memory/runs/${name}`,
      mtime
    );
  }

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
      const rowTs = Date.parse(String(row?.ts || ""));
      appendSessionSearchHits(
        scored,
        recentCandidates,
        searchable,
        tokens,
        recencyOnly,
        recencyQuery,
        String(row?.ts || "session-memory"),
        ".webagent/session-memory.jsonl",
        Number.isFinite(rowTs) ? rowTs : stat?.mtimeMs || 0
      );
    }
  } catch {
    /* absent */
  }

  scored.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  let top = scored.slice(0, 3);
  if (top.length === 0 && recencyQuery && recentCandidates.length > 0) {
    const uniqueByPath = new Map();
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
  // Accept the common label aliases models reach for (text/title/task/label),
  // not just `content` — otherwise every todo silently becomes "Todo N".
  const content =
    String(src.content ?? src.text ?? src.title ?? src.task ?? src.label ?? src.name ?? "").trim() ||
    `Todo ${index + 1}`;
  const fallbackId = `todo-${Date.now()}-${index + 1}`;
  const id = String(src.id ?? fallbackId).trim() || fallbackId;
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
      "`items` is required for skill bulk (action=bulk) (non-empty array). You can pass top-level `url` or `urls` for HTTPS SKILL.md installs, or `items`: [{ url } | { name, content }, ...]."
    );
  }
  const result = await memory.bulkSaveSkills(items);
  await logDebugEvent("skill_bulk_save", {
    count: items.length,
    saved: result.summary?.saved,
    failed: result.summary?.failed,
    blocked: result.summary?.blocked,
  });
  void import("../turn.js").then((m) => m.invalidateToolNamesCache?.());
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
      '`name` is required for skill view (action=view). Use {"name":"<skill-slug>"} — not `slug`.'
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
  if (!action) throw new Error("`manage_action` is required when action=manage.");
  const result = await memory.manageSkill({ ...args, action });
  await logDebugEvent("skill_manage", {
    action,
    name: typeof args?.name === "string" ? args.name.trim() : null,
    ok: result?.ok ?? null,
    blocked: result?.blocked ?? false,
  });
  if (result?.ok) void import("../turn.js").then((m) => m.invalidateToolNamesCache?.());
  return result;
}

export async function todoWriteTool(payload: ToolArgs | unknown[] = {}, _ctx) {
  const todosPath = workspaceStatePath(".webagent/todos.json");
  let rawTodos: unknown[] = [];
  if (Array.isArray(payload)) rawTodos = payload;
  else if (payload && typeof payload === "object") {
    const p = payload as ToolArgs;
    // Accept any of the array keys models commonly use, not just `todos`.
    // (An explicit empty array clears the checklist — a valid reset.)
    const arrayKey = ["todos", "items", "tasks", "list", "steps", "checklist"].find((key) =>
      Array.isArray(p[key])
    );
    if (arrayKey) {
      rawTodos = p[arrayKey] as unknown[];
    } else {
      const looksLikeSingleTodo = ["id", "content", "text", "title", "task", "status"].some((key) =>
        Object.prototype.hasOwnProperty.call(p, key)
      );
      if (looksLikeSingleTodo) rawTodos = [p];
    }
  }
  const todos = rawTodos.map((todo, index) => normalizeTodoItem(todo, index));
  // mkdir the `.webagent` parent, not just the workspace root — otherwise the
  // write ENOENTs on a fresh workspace where `.webagent/` does not exist yet.
  await fs.mkdir(nodePath.dirname(todosPath), { recursive: true });
  await fs.writeFile(todosPath, JSON.stringify(todos, null, 2), "utf8");
  return { ok: true, count: todos.length };
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
