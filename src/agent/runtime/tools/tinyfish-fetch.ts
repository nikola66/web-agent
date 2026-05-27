/**
 * TinyFish Fetch API response parsing (HTTP 200 + per-URL results[] / errors[]).
 * @see https://docs.tinyfish.ai/fetch-api
 */

const SPA_JS_SHELL_RE =
  /doesn'?t work without javascript|please enable\b.*javascript|requires javascript enabled|javascript is required/i;

/** HTTP 200 + "enable JavaScript" HTML (Directus admin, SPAs) — not outage; APIs may still work. */
export function spaShellPageRecoveryHint(text: unknown, url?: string): string | undefined {
  const t = String(text || "").trim();
  if (!t || t.length > 12_000 || !SPA_JS_SHELL_RE.test(t)) return undefined;

  let hostNote =
    "HTTP 200 returned a JS-only app shell (TinyFish markdown cannot execute JS) — the host is usually reachable, not down. ";
  try {
    const u = new URL(String(url || ""));
    if (/directus/i.test(t) || /\/admin\b/i.test(u.pathname)) {
      hostNote =
        "Directus (and similar CMS admin UIs) return this HTML at HTTP 200 when fetched as a page — the service is usually up. ";
    }
    if (/\/items\/|\/collections\/|\/graphql|\/mcp\b|\/server\/|\/auth\//i.test(u.pathname)) {
      return (
        `${hostNote}This URL looks like an API path but returned HTML — add Authorization (Bearer) on web_fetch/web_post, or configure Directus MCP in .webagent/mcp-servers.json. Do not treat HTTP 200 here as unreachable or retry without auth.`
      );
    }
  } catch {
    /* ignore bad url */
  }
  return (
    `${hostNote}Use documented REST/API paths with Authorization headers (web_fetch/web_post), not the admin or marketing page URL.`
  );
}

export function normalizeTinyFishUrlKey(u) {
  try {
    const x = new URL(String(u || ""));
    x.hash = "";
    let s = x.href;
    if (s.endsWith("/") && x.pathname !== "/" && x.pathname.length > 1) {
      s = s.slice(0, -1);
    }
    return s;
  } catch {
    return String(u || "").trim();
  }
}

function tinyFishRowMatchesUrl(rowUrl, requestedUrl) {
  if (!rowUrl || !requestedUrl) return false;
  return normalizeTinyFishUrlKey(rowUrl) === normalizeTinyFishUrlKey(requestedUrl);
}

export function extractTextFromTinyFishResultRow(row, format) {
  if (!row) return null;
  if (format !== "markdown") {
    const raw = row.rawHtml ?? row.html ?? row.json ?? row.text ?? "";
    if (typeof raw === "string" && raw.trim()) return raw;
    if (raw && typeof raw === "object") return JSON.stringify(raw);
    return null;
  }
  if (typeof row.text === "string" && row.text.trim()) return row.text;
  return null;
}

/**
 * @param {unknown} payload
 * @param {string} requestedUrl
 * @param {string} format
 * @param {string} providerName
 * @returns {{ ok: true, text: string } | { ok: false, error: string, errorCode?: string }}
 */
export function parseTinyFishFetchPayload(payload, requestedUrl, format, providerName) {
  const name = providerName || "TinyFish";
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];

  let row = results.find(
    (r) =>
      tinyFishRowMatchesUrl(r?.url, requestedUrl) || tinyFishRowMatchesUrl(r?.final_url, requestedUrl)
  );
  if (!row && results.length === 1) row = results[0];

  const text = extractTextFromTinyFishResultRow(row, format);
  if (text) return { ok: true, text };

  const err =
    errors.find((e) => tinyFishRowMatchesUrl(e?.url, requestedUrl)) ||
    (errors.length === 1 ? errors[0] : null);
  const code = err?.error != null ? String(err.error) : "";
  if (code) {
    const u = err?.url ? String(err.url) : requestedUrl;
    return {
      ok: false,
      error: `${name} Fetch failed for ${u}: ${code} (HTTP 200 with per-URL error; see https://docs.tinyfish.ai/fetch-api)`,
      errorCode: code,
    };
  }

  return {
    ok: false,
    error: `${name} Fetch returned no extractable content for ${requestedUrl}.`,
  };
}
