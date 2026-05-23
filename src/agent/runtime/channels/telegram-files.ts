/**
 * Shared Telegram file-transfer plumbing.
 *
 * `externalFetch` proxies HTTPS through adapter `/api/proxy` when running in
 * Nodebox (browser-only Node, no direct sockets). `resolveTelegramFileUrl`
 * turns a Bot API `file_id` into a download URL via `getFile`.
 *
 * Both voice notes and generic attachments build on these.
 */

import fs from "node:fs/promises";
import nodePath from "node:path";
import { workspaceStatePath } from "../constants.js";
import { logDebugEvent } from "../logging/debug-log.js";
import { ipcProxyRequest } from "../ipc.js";

function isNodeboxRuntime(): boolean {
  return String(process.env.WEBAGENT_RUNTIME ?? "").trim() === "nodebox";
}

export type ExternalFetchResult = {
  ok: boolean;
  status: number;
  body: string | Buffer;
  contentType: string;
};

/** Nodebox cannot reach external HTTPS directly; route through adapter /api/proxy. */
export async function externalFetch(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: Buffer;
    binaryResponse?: boolean;
  } = {}
): Promise<ExternalFetchResult> {
  const method = init.method ?? "GET";
  if (!isNodeboxRuntime()) {
    const res = await fetch(url, {
      method,
      headers: init.headers,
      ...(init.body ? { body: init.body } : {}),
    });
    const contentType = res.headers.get("content-type") ?? "";
    if (init.binaryResponse) {
      return {
        ok: res.ok,
        status: res.status,
        body: Buffer.from(await res.arrayBuffer()),
        contentType,
      };
    }
    return { ok: res.ok, status: res.status, body: await res.text(), contentType };
  }

  const proxyReq: Record<string, unknown> = {
    method,
    url,
    headers: init.headers ?? {},
    binaryResponse: init.binaryResponse ?? false,
  };
  if (init.body) {
    proxyReq.body = init.body.toString("base64");
    proxyReq.bodyEncoding = "base64";
  }

  const payload = (await ipcProxyRequest(proxyReq)) as {
    error?: string;
    status?: number;
    body?: string;
    contentType?: string;
    bodyEncoding?: string;
  };
  if (payload?.error) throw new Error(String(payload.error));
  const status = Number(payload?.status ?? 0);
  const contentType = String(payload?.contentType ?? "");
  if (!Number.isFinite(status) || status <= 0) {
    throw new Error(`Proxy fetch failed (${status}) for ${url.slice(0, 120)}`);
  }
  const ok = status >= 200 && status < 300;
  if (init.binaryResponse || payload?.bodyEncoding === "base64") {
    return {
      ok,
      status,
      body: Buffer.from(String(payload.body ?? ""), "base64"),
      contentType,
    };
  }
  return { ok, status, body: String(payload.body ?? ""), contentType };
}

/**
 * Resolve a Telegram `file_id` to a downloadable URL.
 * Returns `null` if the file cannot be located (size limit, expired, etc.).
 */
export async function resolveTelegramFileUrl(
  token: string,
  fileId: string
): Promise<{ url: string; filePath: string } | null> {
  const apiUrl = new URL(`https://api.telegram.org/bot${encodeURIComponent(token)}/getFile`);
  apiUrl.searchParams.set("file_id", fileId);
  const res = await externalFetch(apiUrl.toString());
  if (!res.ok) {
    await logDebugEvent("telegram_getFile_failed", { fileId, status: res.status });
    return null;
  }
  const payload = JSON.parse(String(res.body)) as { ok?: boolean; result?: { file_path?: string } };
  const filePath = payload?.result?.file_path;
  if (!payload?.ok || !filePath) {
    await logDebugEvent("telegram_getFile_no_path", { fileId });
    return null;
  }
  return {
    filePath,
    url: `https://api.telegram.org/file/bot${encodeURIComponent(token)}/${filePath}`,
  };
}

const ATTACHMENT_INBOX_REL = ".webagent/telegram-inbox";

function safeFileNameSegment(value: string, fallback: string): string {
  const cleaned = String(value || "")
    .replace(/[\\/]/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

export type DownloadedAttachment = {
  savedPath: string;
  relPath: string;
  sourceUrl: string;
  byteLength: number;
  fileName: string;
};

/**
 * Download an arbitrary Telegram attachment (photo/document/video/audio) into
 * the workspace inbox. Returns absolute + workspace-relative paths plus the
 * resolved file name. `fileName` from the caller is preferred; falls back to
 * the basename of the Bot API `file_path`.
 *
 * The 20MB Bot API limit applies — Telegram's `getFile` returns an error for
 * larger files and we return `null`.
 */
export async function downloadTelegramAttachment(
  token: string,
  fileId: string,
  fileName?: string | null
): Promise<DownloadedAttachment | null> {
  const resolved = await resolveTelegramFileUrl(token, fileId);
  if (!resolved) return null;

  const res = await externalFetch(resolved.url, { binaryResponse: true });
  if (!res.ok) {
    await logDebugEvent("telegram_attachment_download_failed", { fileId, status: res.status });
    return null;
  }
  const buffer = Buffer.isBuffer(res.body) ? res.body : Buffer.from(String(res.body));

  const apiBasename = nodePath.basename(resolved.filePath) || `file-${Date.now()}`;
  const desiredName = fileName && String(fileName).trim() ? String(fileName) : apiBasename;
  const safeName = safeFileNameSegment(desiredName, apiBasename);
  // Short collision-avoidance prefix only (the previous safeId+timestamp made
  // paths ~90 chars and broke Telegram outbound rendering).
  const shortId = String(fileId).replace(/[^A-Za-z0-9]/g, "").slice(-6) || String(Date.now()).slice(-6);
  const savedRel = `${ATTACHMENT_INBOX_REL}/${shortId}-${safeName}`;
  const savedAbs = workspaceStatePath(savedRel);
  await fs.mkdir(nodePath.dirname(savedAbs), { recursive: true });
  await fs.writeFile(savedAbs, buffer);
  await logDebugEvent("telegram_attachment_downloaded", {
    fileId,
    bytes: buffer.byteLength,
    savedRel,
  });
  return {
    savedPath: savedAbs,
    relPath: savedRel,
    sourceUrl: resolved.url,
    byteLength: buffer.byteLength,
    fileName: safeName,
  };
}
