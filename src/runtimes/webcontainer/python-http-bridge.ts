export const CORS_PROXY_PATH = "/api/proxy";

export type ProxyHttpRequestInput = {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | null;
};

export type ProxyHttpResponse = {
  status: number;
  statusText: string;
  contentType: string;
  headers: Record<string, string>;
  bodyText: string;
  bodyBytes: Uint8Array;
  error?: string;
};

export type SyncHttpTransport = (payload: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | null;
}) => { status: number; responseText: string };

let syncTransport: SyncHttpTransport | null = null;

export function setSyncHttpTransport(transport: SyncHttpTransport | null): void {
  syncTransport = transport;
}

function defaultSyncTransport(payload: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | null;
}): { status: number; responseText: string } {
  const xhr = new XMLHttpRequest();
  xhr.open("POST", CORS_PROXY_PATH, false);
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.send(
    JSON.stringify({
      method: payload.method,
      url: payload.url,
      headers: payload.headers ?? {},
      body: payload.body ?? null,
    })
  );
  return { status: xhr.status, responseText: xhr.responseText || "" };
}

function normalizeHeaders(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function bodyToBytes(body: string): Uint8Array {
  return new TextEncoder().encode(body);
}

export function proxyHttpRequest(input: ProxyHttpRequestInput): ProxyHttpResponse {
  const method = String(input.method || "GET").toUpperCase();
  const url = String(input.url || "").trim();
  if (!url) {
    return {
      status: 0,
      statusText: "",
      contentType: "",
      headers: {},
      bodyText: "",
      bodyBytes: new Uint8Array(),
      error: "proxyHttpRequest: url is required",
    };
  }

  const transport = syncTransport ?? defaultSyncTransport;
  let rawStatus = 0;
  let rawText = "";
  try {
    const res = transport({
      method,
      url,
      headers: input.headers,
      body: input.body ?? null,
    });
    rawStatus = Number(res.status) || 0;
    rawText = String(res.responseText ?? "");
  } catch (error) {
    return {
      status: 0,
      statusText: "",
      contentType: "",
      headers: {},
      bodyText: "",
      bodyBytes: new Uint8Array(),
      error: String((error as Error)?.message ?? error),
    };
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
  } catch {
    return {
      status: rawStatus,
      statusText: "",
      contentType: "text/plain",
      headers: {},
      bodyText: rawText,
      bodyBytes: bodyToBytes(rawText),
      error: rawStatus >= 400 ? `proxy returned HTTP ${rawStatus}` : undefined,
    };
  }

  if (typeof parsed.error === "string" && parsed.error.trim()) {
    return {
      status: Number(parsed.status) || rawStatus || 0,
      statusText: String(parsed.statusText ?? ""),
      contentType: String(parsed.contentType ?? ""),
      headers: normalizeHeaders(parsed.headers),
      bodyText: typeof parsed.body === "string" ? parsed.body : "",
      bodyBytes: bodyToBytes(typeof parsed.body === "string" ? parsed.body : ""),
      error: parsed.error,
    };
  }

  const bodyText = typeof parsed.body === "string" ? parsed.body : "";
  return {
    status: Number(parsed.status) || rawStatus || 0,
    statusText: String(parsed.statusText ?? ""),
    contentType: String(parsed.contentType ?? ""),
    headers: normalizeHeaders(parsed.headers),
    bodyText,
    bodyBytes: bodyToBytes(bodyText),
  };
}
