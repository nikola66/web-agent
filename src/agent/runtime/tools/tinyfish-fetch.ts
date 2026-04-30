/**
 * TinyFish Fetch API response parsing (HTTP 200 + per-URL results[] / errors[]).
 * @see https://docs.tinyfish.ai/fetch-api
 */

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
