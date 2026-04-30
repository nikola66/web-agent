export const TRANSIT_ONLY_PROXY_MODE = "transit_only_proxy";
export const DEFAULT_LAUNCH_MODE = "standard";

const SENSITIVE_VALUE_KEYS = new Set([
  "apikey",
  "apikeys",
  "apisecret",
  "apitoken",
  "apikeyheader",
  "apikeyvalue",
  "authorization",
  "body",
  "content",
  "emailbody",
  "fetchedcontent",
  "html",
  "input",
  "inputs",
  "messagebody",
  "messages",
  "output",
  "outputs",
  "password",
  "prompt",
  "prompts",
  "requestbody",
  "responsebody",
  "secret",
  "setcookie",
  "text",
  "token",
  "tokens",
  "transcript",
  "visibletext",
  "renderedansi",
  "argumentspreview",
]);

const URL_VALUE_KEYS = new Set([
  "alternateurl",
  "endpoint",
  "requesturl",
  "responseurl",
  "uri",
  "url",
  "urls",
]);

const HEADER_CONTAINER_KEYS = new Set([
  "headers",
  "requestheaders",
  "responseheaders",
]);

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "x-api-key",
]);

function normalizeKey(value: string): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveHeaderName(name: string): boolean {
  const lowered = String(name || "").trim().toLowerCase();
  if (!lowered) return false;
  if (SENSITIVE_HEADER_NAMES.has(lowered)) return true;
  return (
    lowered.includes("token") ||
    lowered.includes("secret") ||
    lowered.includes("api-key") ||
    lowered.includes("apikey")
  );
}

export function normalizeLaunchMode(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase() === TRANSIT_ONLY_PROXY_MODE
    ? TRANSIT_ONLY_PROXY_MODE
    : DEFAULT_LAUNCH_MODE;
}

export function isTransitOnlyProxyMode(value: string | null | undefined): boolean {
  return normalizeLaunchMode(value) === TRANSIT_ONLY_PROXY_MODE;
}

export function sanitizeUrlForLogs(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const raw = value.trim();
  if (!raw) return raw;
  try {
    const parsed = new URL(raw, "http://local.invalid");
    if (parsed.username) parsed.username = "[redacted]";
    if (parsed.password) parsed.password = "[redacted]";
    const queryCount = [...parsed.searchParams.keys()].length;
    parsed.search = queryCount > 0 ? `?redacted_query_params=${queryCount}` : "";
    if (parsed.origin === "http://local.invalid") {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return `${parsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return raw.length > 256 ? `${raw.slice(0, 256)}…[truncated:${raw.length}]` : raw;
  }
}

export function sanitizeHeadersForLogs(headers: unknown): Record<string, unknown> {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return {};
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = isSensitiveHeaderName(name) ? "[redacted]" : sanitizeForLogs(value, 1);
  }
  return out;
}

export function sanitizeForLogs(value: unknown, depth = 0, parentKey = ""): unknown {
  if (depth > 5) return "[max_depth]";

  const normalizedParentKey = normalizeKey(parentKey);
  if (HEADER_CONTAINER_KEYS.has(normalizedParentKey)) return sanitizeHeadersForLogs(value);
  if (URL_VALUE_KEYS.has(normalizedParentKey)) {
    if (Array.isArray(value)) return value.map((entry) => sanitizeUrlForLogs(entry));
    return sanitizeUrlForLogs(value);
  }
  if (SENSITIVE_VALUE_KEYS.has(normalizedParentKey)) return `[redacted:${parentKey || "value"}]`;

  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.length <= 4_000) return value;
    return `${value.slice(0, 4_000)}…[truncated:${value.length}]`;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeForLogs(item, depth + 1, parentKey));
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeForLogs(value.message, depth + 1, "message"),
      stack: sanitizeForLogs(value.stack, depth + 1, "stack"),
    };
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = sanitizeForLogs(entry, depth + 1, key);
    }
    return out;
  }
  return String(value);
}

export function buildProxyDebugLogEntry(meta: {
  requestId: string;
  routeId: string;
  statusCode?: number | null;
  durationMs?: number | null;
}) {
  return {
    requestId: String(meta.requestId || "").trim(),
    routeId: String(meta.routeId || "").trim(),
    ...(meta.statusCode != null ? { statusCode: Number(meta.statusCode) } : {}),
    ...(meta.durationMs != null ? { durationMs: Math.max(0, Math.round(Number(meta.durationMs) || 0)) } : {}),
  };
}
