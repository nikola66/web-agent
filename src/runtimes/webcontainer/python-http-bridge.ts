export const CORS_PROXY_PATH = "/api/proxy";

export type ProxyHttpRequestInput = {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | null;
  bodyEncoding?: "base64";
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

export type MultipartPartInput = {
  name: string;
  text?: string;
  filename?: string;
  contentType?: string;
  contentBase64?: string;
};

export type SyncHttpTransport = (payload: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | null;
  bodyEncoding?: "base64";
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
  bodyEncoding?: "base64";
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
      bodyEncoding: payload.bodyEncoding,
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

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function buildMultipartBodyBase64(parts: MultipartPartInput[]): {
  body: string;
  contentType: string;
} {
  if (!parts.length) throw new Error("uploadMultipart: at least one part required");
  const boundary = `----WebAgentPy${Date.now().toString(36)}`;
  const chunks: Uint8Array[] = [];
  const enc = new TextEncoder();
  const pushText = (s: string) => chunks.push(enc.encode(s));
  for (const part of parts) {
    const name = String(part.name || "").trim();
    if (!name) throw new Error("uploadMultipart: each part needs name");
    if (part.contentBase64) {
      const filename = String(part.filename || "file").replace(/[\r\n"]/g, "_");
      const ct = String(part.contentType || "application/octet-stream");
      pushText(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${ct}\r\n\r\n`
      );
      chunks.push(base64ToBytes(part.contentBase64));
      pushText("\r\n");
    } else {
      pushText(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${String(part.text ?? "")}\r\n`);
    }
  }
  pushText(`--${boundary}--\r\n`);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  let binary = "";
  for (let i = 0; i < merged.length; i += 1) binary += String.fromCharCode(merged[i]!);
  return {
    body: btoa(binary),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
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
      bodyEncoding: input.bodyEncoding,
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

export function proxyHttpUploadMultipart(
  url: string,
  headers: Record<string, string>,
  parts: MultipartPartInput[],
  method = "POST"
): ProxyHttpResponse {
  const built = buildMultipartBodyBase64(parts);
  const hdrs = { ...headers, "Content-Type": built.contentType };
  return proxyHttpRequest({
    method,
    url,
    headers: hdrs,
    body: built.body,
    bodyEncoding: "base64",
  });
}
