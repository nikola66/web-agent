/**
 * Remote SKILL.md fetch for skill_manage install_url / import_url.
 * Nodebox cannot use global fetch — route through the adapter IPC proxy (same as web_fetch).
 */

import { ipcProxyRequest } from "../ipc.js";
import { errorMessage } from "../utils.js";

const SKILL_IMPORT_BODY_CAP = 200_000;
const FETCH_HEADERS = { "User-Agent": "web-agent-skills" };

function useIpcProxy(): boolean {
  return String(process.env.WEBAGENT_RUNTIME || "").trim() === "nodebox";
}

function readProxyPayload(value: unknown): { status: number; body: string; contentType: string } {
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const status = Number(rec.status);
    const body = typeof rec.body === "string" ? rec.body : "";
    const contentType = typeof rec.contentType === "string" ? rec.contentType : "";
    return { status: Number.isFinite(status) ? status : 0, body, contentType };
  }
  return { status: 0, body: "", contentType: "" };
}

async function fetchViaProxy(url: string): Promise<{ status: number; body: string; contentType: string }> {
  const payload = readProxyPayload(
    await ipcProxyRequest({ method: "GET", url, headers: FETCH_HEADERS })
  );
  const body =
    payload.body.length > SKILL_IMPORT_BODY_CAP
      ? payload.body.slice(0, SKILL_IMPORT_BODY_CAP)
      : payload.body;
  return { ...payload, body };
}

async function fetchViaDirect(url: string): Promise<{ status: number; body: string; contentType: string }> {
  const res = await fetch(url, { headers: FETCH_HEADERS });
  const body = await res.text();
  const sliced = body.length > SKILL_IMPORT_BODY_CAP ? body.slice(0, SKILL_IMPORT_BODY_CAP) : body;
  const status = Number(res.status) || (res.ok === false ? 0 : 200);
  const contentType =
    res.headers && typeof res.headers.get === "function"
      ? res.headers.get("content-type") || ""
      : "";
  return { status, body: sliced, contentType };
}

/** Normalize registry / GitHub URLs toward a fetchable SKILL.md location. */
export function normalizeSkillImportUrl(url: string): string {
  const raw = String(url || "").trim();
  const blob = raw.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i);
  if (blob) {
    return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}/${blob[4]}`;
  }
  const tree = raw.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/i);
  if (tree) {
    const path = tree[4].replace(/\/$/, "");
    if (/\.md$/i.test(path)) {
      return `https://raw.githubusercontent.com/${tree[1]}/${tree[2]}/${tree[3]}/${path}`;
    }
    return `https://raw.githubusercontent.com/${tree[1]}/${tree[2]}/${tree[3]}/${path}/SKILL.md`;
  }
  return raw;
}

function githubTreeToRawSkillMd(treeUrl: string): string | null {
  const normalized = normalizeSkillImportUrl(treeUrl);
  if (normalized !== treeUrl && normalized.startsWith("https://raw.githubusercontent.com/")) {
    return normalized;
  }
  return null;
}

export function looksLikeSkillMarkdown(text: string): boolean {
  const t = String(text || "").trim();
  return t.startsWith("---") && /^##\s+/m.test(t);
}

function looksLikeHtml(text: string, contentType = ""): boolean {
  const head = text.trimStart().slice(0, 512).toLowerCase();
  if (contentType.includes("html")) return true;
  return head.startsWith("<!doctype") || head.startsWith("<html") || /<head[\s>]/i.test(head);
}

function isMarketplaceHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h.includes("skillsmp.com") ||
    h.includes("officialskills.sh") ||
    h.endsWith("skills.sh") ||
    h.endsWith("cursor.directory")
  );
}

function trimLinkSuffix(link: string): string {
  return link.replace(/[)"'\\]+$/, "");
}

/** Alternate raw paths when a direct SKILL.md URL 404s (common repo layouts). */
export function candidateRawSkillUrls(url: string): string[] {
  const raw = String(url || "").trim();
  const m = raw.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i);
  if (!m) return [];
  const [, owner, repo, ref, rest] = m;
  let skillPath = rest.replace(/\/SKILL\.md$/i, "");
  if (!skillPath || skillPath === rest) return [];

  const bases = [
    skillPath,
    `skills/${skillPath}`,
    `.agents/skills/${skillPath}`,
    `.claude/skills/${skillPath}`,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const base of bases) {
    const candidate = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${base}/SKILL.md`;
    if (!seen.has(candidate)) {
      seen.add(candidate);
      out.push(candidate);
    }
  }
  return out;
}

function extractGithubSkillUrlsFromPage(body: string): string[] {
  const text = String(body || "");
  const out: string[] = [];
  const seen = new Set<string>();

  const treeRe =
    /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/tree\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?/g;
  let treeMatch: RegExpExecArray | null;
  while ((treeMatch = treeRe.exec(text))) {
    const raw = githubTreeToRawSkillMd(trimLinkSuffix(treeMatch[0]));
    if (raw && !seen.has(raw)) {
      seen.add(raw);
      out.push(raw);
    }
  }

  const rawRe =
    /https:\/\/raw\.githubusercontent\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)*\.md/gi;
  let rawMatch: RegExpExecArray | null;
  while ((rawMatch = rawRe.exec(text))) {
    const link = trimLinkSuffix(rawMatch[0]);
    if (!seen.has(link)) {
      seen.add(link);
      out.push(link);
    }
  }

  return out;
}

/** When a marketplace page was fetched, resolve a raw SKILL.md URL from embedded GitHub links. */
export function resolveSkillImportUrlFromPage(sourceUrl: string, body: string): string | null {
  const host = (() => {
    try {
      return new URL(sourceUrl).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (!isMarketplaceHost(host) && !looksLikeHtml(body)) return null;

  const candidates = extractGithubSkillUrlsFromPage(body);
  if (candidates.length) return candidates[0];

  return null;
}

export function resolveAllSkillImportUrlsFromPage(sourceUrl: string, body: string): string[] {
  const host = (() => {
    try {
      return new URL(sourceUrl).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (!isMarketplaceHost(host) && !looksLikeHtml(body)) return [];
  return extractGithubSkillUrlsFromPage(body);
}

function isFetch404Error(err: unknown): boolean {
  return /fetch failed \(404\)/i.test(errorMessage(err));
}

export async function fetchSkillImportText(url: string): Promise<string> {
  const target = normalizeSkillImportUrl(url);
  if (!/^https:\/\//i.test(target)) {
    throw new Error("skill import: only valid https URLs are supported.");
  }

  const load = async (fetchUrl: string) => {
    if (useIpcProxy()) {
      const proxied = await fetchViaProxy(fetchUrl);
      if (proxied.status < 200 || proxied.status >= 300) {
        throw new Error(
          `skill import: fetch failed (${proxied.status}) for ${fetchUrl}. ` +
            "Use a direct raw GitHub SKILL.md URL or a skills.sh install link ending in SKILL.md."
        );
      }
      return proxied;
    }
    try {
      const direct = await fetchViaDirect(fetchUrl);
      if (direct.status < 200 || direct.status >= 300) {
        throw new Error(`skill import: fetch failed (${direct.status}) for ${fetchUrl}`);
      }
      return direct;
    } catch (err) {
      const msg = errorMessage(err);
      if (!/failed to fetch|network|econn|enotfound|timeout/i.test(msg)) throw err;
      const proxied = await fetchViaProxy(fetchUrl);
      if (proxied.status < 200 || proxied.status >= 300) {
        throw new Error(
          `skill import: fetch failed (${proxied.status || "network"}) for ${fetchUrl}: ${msg}`
        );
      }
      return proxied;
    }
  };

  const loadWithCandidates = async (fetchUrl: string) => {
    try {
      return await load(fetchUrl);
    } catch (err) {
      if (!isFetch404Error(err)) throw err;
      for (const alt of candidateRawSkillUrls(fetchUrl)) {
        if (alt === fetchUrl) continue;
        try {
          return await load(alt);
        } catch (altErr) {
          if (!isFetch404Error(altErr)) throw altErr;
        }
      }
      throw err;
    }
  };

  let { body, contentType } = await loadWithCandidates(target);
  if (!looksLikeSkillMarkdown(body)) {
    const alt = resolveSkillImportUrlFromPage(target, body);
    if (alt && alt !== target) {
      const second = await loadWithCandidates(alt);
      body = second.body;
      contentType = second.contentType;
    }
  }

  if (!looksLikeSkillMarkdown(body)) {
    if (looksLikeHtml(body, contentType)) {
      throw new Error(
        "skill import: URL returned HTML, not SKILL.md. Paste a direct raw GitHub URL " +
          "(raw.githubusercontent.com/.../SKILL.md) or use /skills install with a skills.sh SKILL.md link."
      );
    }
  }

  return body;
}
