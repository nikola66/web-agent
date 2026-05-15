import fs from "node:fs/promises";
import nodePath from "node:path";
import { ipcProxyRequest } from "../ipc.js";
import {
  BROWSER_AGENT_CATALOG_PATH,
  MEMORY_CONVERSATIONS_DIR,
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
  hasCronJobArgumentPayload,
  normalizeCronJobArguments,
  sanitizeCronToolToken,
} from "../state/persistence.js";

/** Loose tool / IPC JSON object shape (tool handlers read known keys with runtime checks). */
type ToolArgs = Record<string, unknown>;

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
  return loadCronJobs();
}

function hasProviderApiKey(provider, ctx) {
  const envVar = provider?.auth?.envVar;
  if (!envVar) return false;
  return !!String(ctxEnv(ctx)[envVar] || "").trim();
}

async function proxyFetch(url, ctx) {
  const { status, body, contentType } = readProxyResponse(await proxyRequest({ method: "GET", url }, ctx));
  if (status < 200 || status >= 300) {
    const detail = String(body || "").slice(0, 240);
    throw new Error(
      `Fetch failed (${status}): ${detail || "unknown error"}. Retry web_search with a simpler query, one location code (ae or sa, not "ae, sa"), or check network/API settings.`
    );
  }
  return { ok: true, url, status, contentType, text: body.slice(0, 100_000) };
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
    ({ text } = await proxyFetch(searchUrl, ctx));
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

async function webFetchReadableFromProxy(url, ctx) {
  const { text, contentType } = await proxyFetch(url, ctx);
  const isHtml = contentType.includes("html") || text.trimStart().startsWith("<");
  const readable = isHtml
    ? text
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim()
        .slice(0, 50_000)
    : text;
  return { ok: true, url, provider: "proxy-fallback", text: readable };
}

const WEB_FETCH_BATCH_MAX = 5;

async function webFetchOne(url: string, ctx) {
  const u = new URL(url);
  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error(`web_fetch only supports http(s) URLs, got: ${u.protocol}`);
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
  const headers = (args.headers && typeof args.headers === "object" && !Array.isArray(args.headers)
    ? args.headers
    : {}) as Record<string, unknown>;
  void headers;

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

  if (targets.length === 1) return webFetchOne(targets[0], ctx);

  const documents = await Promise.all(
    targets.map(async (url) => {
      try {
        return await webFetchOne(url, ctx);
      } catch (err) {
        return { ok: false, url, error: String(err?.message || err) };
      }
    })
  );
  return { ok: true, count: documents.length, documents };
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
  const saved = await memory.setFact(key, args.value);
  await logDebugEvent("memory_save", {
    key: saved.key,
    valueType: typeof args.value,
  });
  return { ok: true, fact: saved };
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
  return rows;
}

const SESSION_SEARCH_CONTEXT = 200;

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
  if (!query) {
    throw new Error("`query` is required for session_search.");
  }
  const tokens = sessionSearchTokenize(query);
  if (!tokens.length) {
    throw new Error("`query` must include at least one word with 2+ characters.");
  }

  const maxFiles = Math.min(200, Math.max(10, Number(args?.max_files ?? 80) || 80));
  const absDir = memoryPath(MEMORY_CONVERSATIONS_DIR);
  type SessionSearchHit = {
    score: number;
    id: string;
    snippet: string;
    relPath: string;
    mtime: number;
  };
  const scored: SessionSearchHit[] = [];

  let dirents;
  try {
    dirents = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return {
      ok: true,
      query,
      matches: [],
      note: "No conversation archive found yet (memory/conversations is empty or unavailable).",
    };
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
    const text = raw.replace(/\s+/g, " ").trim();
    const low = text.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (low.includes(t)) score += 1;
    }
    if (score === 0) continue;

    let id = name.replace(/\.json$/i, "");
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
  }

  scored.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  const top = scored.slice(0, 3);

  await logDebugEvent("session_search", {
    query,
    tokenCount: tokens.length,
    filesScanned: toScan.length,
    hits: top.length,
  });

  return {
    ok: true,
    query,
    matches: top.map((m) => ({
      conversation_id: m.id,
      score: m.score,
      path: m.relPath,
      context: m.snippet,
    })),
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

export async function skillSaveTool(args: ToolArgs = {}, ctx) {
  const memory = memoryServices(ctx);
  const name = typeof args?.name === "string" ? args.name.trim() : "";
  if (!name) throw new Error("`name` is required for skill_save.");
  const content = typeof args?.content === "string" ? args.content.trim() : "";
  if (!content) throw new Error("`content` is required for skill_save.");
  const result = await memory.manageSkill({
    action: "create",
    name,
    description: typeof args?.description === "string" ? args.description.trim() : name,
    version: typeof args?.version === "string" ? args.version.trim() : undefined,
    category: typeof args?.category === "string" ? args.category.trim() : undefined,
    tags: Array.isArray(args?.tags) ? args.tags.map(String) : [],
    content,
  });
  await logDebugEvent("skill_save", { name, slug: result.slug });
  return result;
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
  const name = typeof args?.name === "string" ? args.name.trim() : "";
  if (!name) throw new Error("`name` is required for skill_view.");
  const result = await memory.viewSkill({
    name,
    file_path: typeof args?.file_path === "string" ? args.file_path.trim() : undefined,
  });
  await logDebugEvent("skill_view", { name, filePath: result.file_path });
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

export async function skillRecallTool(args: ToolArgs = {}, ctx) {
  const memory = memoryServices(ctx);
  const name = typeof args?.name === "string" ? args.name.trim() : "";
  if (!name) throw new Error("`name` is required for skill_recall.");
  const content = await memory.loadSkill(name);
  await logDebugEvent("skill_recall", { name });
  return { ok: true, content };
}

export async function skillDeleteTool(args: ToolArgs = {}, ctx) {
  const memory = memoryServices(ctx);
  const name = typeof args?.name === "string" ? args.name.trim() : "";
  if (!name) throw new Error("`name` is required for skill_delete.");
  const result = await memory.manageSkill({ action: "delete", name });
  await logDebugEvent("skill_delete", { name });
  return result;
}

export async function todoWriteTool(payload: ToolArgs | unknown[] = {}, _ctx) {
  const todosPath = workspaceStatePath(".todos.json");
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
