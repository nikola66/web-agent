/** Browser-only fetch that routes cross-origin MCP HTTP through same-origin /api/proxy. */

function isBrowserPageContext(): boolean {
  try {
    return typeof globalThis !== "undefined" && typeof document !== "undefined";
  } catch {
    return false;
  }
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export function createMcpCorsProxyFetch(): typeof fetch | undefined {
  if (!isBrowserPageContext()) return undefined;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = req.url;
    if (!/^https?:\/\//i.test(url)) {
      return fetch(input, init);
    }

    const method = req.method || "GET";
    const headers = headersToRecord(req.headers);
    let body: string | null = null;
    if (method !== "GET" && method !== "HEAD") {
      try {
        body = await req.clone().text();
      } catch {
        body = null;
      }
    }

    const proxyRes = await fetch("/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, url, headers, body }),
    });
    const data = (await proxyRes.json()) as {
      error?: string;
      status?: number;
      statusText?: string;
      body?: string;
      contentType?: string;
      responseHeaders?: Record<string, string>;
    };
    if (data?.error) {
      throw new Error(String(data.error));
    }

    const respHeaders = new Headers();
    if (data.responseHeaders && typeof data.responseHeaders === "object") {
      for (const [key, value] of Object.entries(data.responseHeaders)) {
        if (value != null) respHeaders.set(key, String(value));
      }
    }
    const contentType = String(data.contentType || "");
    if (contentType && !respHeaders.has("content-type")) {
      respHeaders.set("content-type", contentType);
    }

    return new Response(String(data.body ?? ""), {
      status: Number(data.status ?? proxyRes.status) || 502,
      statusText: String(data.statusText ?? ""),
      headers: respHeaders,
    });
  };
}
