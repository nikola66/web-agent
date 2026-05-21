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

/** When a marketplace page was fetched, resolve a raw SKILL.md URL from embedded GitHub links. */
export function resolveSkillImportUrlFromPage(sourceUrl: string, body: string): string | null {
  const host = (() => {
    try {
      return new URL(sourceUrl).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  const isMarketplace =
    host.includes("skillsmp.com") ||
    host.includes("skills.sh") ||
    host.endsWith("cursor.directory");
  if (!isMarketplace && !looksLikeHtml(body)) return null;

  const treeMatch = body.match(
    /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/tree\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?/
  );
  if (treeMatch) {
    const raw = githubTreeToRawSkillMd(treeMatch[0].replace(/[)"'\\]+$/, ""));
    if (raw) return raw;
  }

  const rawMatch = body.match(
    /https:\/\/raw\.githubusercontent\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)*\.md/i
  );
  if (rawMatch) return rawMatch[0].replace(/[)"'\\]+$/, "");

  return null;
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

  let { body, contentType } = await load(target);
  if (!looksLikeSkillMarkdown(body)) {
    const alt = resolveSkillImportUrlFromPage(target, body);
    if (alt && alt !== target) {
      const second = await load(alt);
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
