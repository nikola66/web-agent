/**
 * Telegram inbound voice-note plumbing.
 *
 * Downloads voice files Telegram references by `file_id` (OGG/Opus from
 * `api.telegram.org/file/bot<TOKEN>/<file_path>`). HTTP routes through
 * shared `telegram-files` (proxied via adapter `/api/proxy` in Nodebox).
 * Transcription runs in the browser (Whisper IPC).
 */

import fs from "node:fs/promises";
import nodePath from "node:path";
import { workspaceStatePath } from "../constants.js";
import { logDebugEvent } from "../logging/debug-log.js";
import { externalFetch, resolveTelegramFileUrl } from "../channels/telegram-files.js";

export { resolveTelegramFileUrl };

const VOICE_INBOX_REL = ".webagent/voice-inbox";

/**
 * Download a Telegram voice file (OGG/Opus) into the workspace voice inbox.
 */
export async function downloadTelegramVoice(
  token: string,
  fileId: string
): Promise<{ savedPath: string; relPath: string; sourceUrl: string; byteLength: number } | null> {
  const resolved = await resolveTelegramFileUrl(token, fileId);
  if (!resolved) return null;

  const res = await externalFetch(resolved.url, { binaryResponse: true });
  if (!res.ok) {
    await logDebugEvent("telegram_voice_download_failed", { fileId, status: res.status });
    return null;
  }
  const buffer = Buffer.isBuffer(res.body) ? res.body : Buffer.from(String(res.body));

  const ext = nodePath.extname(resolved.filePath) || ".oga";
  const safeId = String(fileId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || `voice-${Date.now()}`;
  const savedRel = `${VOICE_INBOX_REL}/${Date.now()}-${safeId}${ext}`;
  const savedAbs = workspaceStatePath(savedRel);
  await fs.mkdir(nodePath.dirname(savedAbs), { recursive: true });
  await fs.writeFile(savedAbs, buffer);
  await logDebugEvent("telegram_voice_downloaded", {
    fileId,
    bytes: buffer.byteLength,
    savedRel,
  });
  return { savedPath: savedAbs, relPath: savedRel, sourceUrl: resolved.url, byteLength: buffer.byteLength };
}
