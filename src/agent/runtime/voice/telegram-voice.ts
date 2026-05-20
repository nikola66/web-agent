/**
 * Telegram voice-message plumbing.
 *
 * Responsibilities:
 *   - Per-chat voice flag, persisted in `.webagent/channel-state.json` under
 *     `telegram.voiceChats: string[]`.
 *   - Download voice files Telegram references by `file_id` (Telegram serves
 *     them as OGG/Opus from `api.telegram.org/file/bot<TOKEN>/<file_path>`).
 *   - Send outbound voice notes via `sendVoice` / `sendAudio`. Inbound STT uses
 *     browser Whisper via `audio_analyze`; outbound TTS uses Kokoro in Nodebox.
 */

import fs from "node:fs/promises";
import nodePath from "node:path";
import { workspaceStatePath } from "../constants.js";
import { ensureParentDir } from "../workspace-paths.js";
import { logDebugEvent } from "../logging/debug-log.js";

const CHANNEL_STATE_REL = ".webagent/channel-state.json";
const VOICE_INBOX_REL = ".webagent/voice-inbox";

interface ChannelStateShape {
  telegram?: {
    voiceChats?: string[];
    nextPollOffset?: number;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

async function readChannelState(): Promise<ChannelStateShape> {
  try {
    const raw = await fs.readFile(workspaceStatePath(CHANNEL_STATE_REL), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function writeChannelState(next: ChannelStateShape): Promise<void> {
  const path = workspaceStatePath(CHANNEL_STATE_REL);
  await ensureParentDir(path);
  await fs.writeFile(path, JSON.stringify(next, null, 2), "utf8");
}

export async function isVoiceChatEnabled(chatId: string | number): Promise<boolean> {
  const state = await readChannelState();
  const list = state.telegram?.voiceChats;
  if (!Array.isArray(list)) return false;
  return list.includes(String(chatId));
}

export async function setVoiceChatEnabled(
  chatId: string | number,
  enabled: boolean
): Promise<{ enabled: boolean; chatIds: string[] }> {
  const state = await readChannelState();
  const telegram = (state.telegram && typeof state.telegram === "object" ? state.telegram : {}) as Required<NonNullable<ChannelStateShape["telegram"]>>;
  const current = Array.isArray(telegram.voiceChats) ? telegram.voiceChats.map(String) : [];
  const set = new Set(current);
  const key = String(chatId);
  if (enabled) set.add(key);
  else set.delete(key);
  const nextChatIds = [...set];
  state.telegram = { ...telegram, voiceChats: nextChatIds };
  await writeChannelState(state);
  await logDebugEvent("telegram_voice_chat_toggle", { chatId: key, enabled, total: nextChatIds.length });
  return { enabled, chatIds: nextChatIds };
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
  const res = await fetch(apiUrl.toString());
  if (!res.ok) {
    await logDebugEvent("telegram_getFile_failed", { fileId, status: res.status });
    return null;
  }
  const payload = (await res.json()) as { ok?: boolean; result?: { file_path?: string } };
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

/**
 * Download a Telegram voice file (OGG/Opus) into the workspace voice inbox.
 * Returns the absolute saved path and the source URL so callers can hand
 * the buffer to a transcription pipeline without touching Telegram APIs.
 */
export async function downloadTelegramVoice(
  token: string,
  fileId: string
): Promise<{ savedPath: string; sourceUrl: string; byteLength: number } | null> {
  const resolved = await resolveTelegramFileUrl(token, fileId);
  if (!resolved) return null;

  const res = await fetch(resolved.url);
  if (!res.ok) {
    await logDebugEvent("telegram_voice_download_failed", { fileId, status: res.status });
    return null;
  }
  const buffer = Buffer.from(await res.arrayBuffer());

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
  return { savedPath: savedAbs, sourceUrl: resolved.url, byteLength: buffer.byteLength };
}

/**
 * Send an audio file via Telegram's `sendAudio` endpoint. Used by the
 * outbound TTS pipeline to deliver MP3 replies — `sendVoice` requires
 * OGG/Opus which no pure-JS encoder we trust ships today, but Telegram
 * plays `sendAudio` MP3 inline with full controls and a waveform-ish UI.
 */
export async function sendTelegramAudio(
  token: string,
  chatId: string | number,
  audio: Buffer,
  options: {
    filename?: string;
    mimeType?: string;
    caption?: string;
    durationSec?: number;
    title?: string;
    performer?: string;
  } = {}
): Promise<void> {
  if (!audio || audio.byteLength === 0) return;
  const boundary = `----TGBoundary${Date.now().toString(36)}`;
  const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/sendAudio`;
  const parts: Buffer[] = [];
  const push = (s: string) => parts.push(Buffer.from(s, "utf8"));

  push(`--${boundary}\r\n`);
  push(`Content-Disposition: form-data; name="chat_id"\r\n\r\n${String(chatId)}\r\n`);

  const textFields: Record<string, string | undefined> = {
    caption: options.caption,
    title: options.title,
    performer: options.performer,
    duration: options.durationSec != null ? String(Math.round(options.durationSec)) : undefined,
    disable_notification: "true",
  };
  for (const [name, value] of Object.entries(textFields)) {
    if (value == null || value === "") continue;
    push(`--${boundary}\r\n`);
    push(`Content-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  }

  const filename = (options.filename || "reply.mp3").replace(/[^A-Za-z0-9_.-]/g, "_");
  const mimeType = options.mimeType || "audio/mpeg";
  push(`--${boundary}\r\n`);
  push(
    `Content-Disposition: form-data; name="audio"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  parts.push(audio);
  push(`\r\n--${boundary}--\r\n`);

  const body = Buffer.concat(parts);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    await logDebugEvent("telegram_sendAudio_failed", {
      chatId: String(chatId),
      status: res.status,
      body: text.slice(0, 200),
    });
    throw new Error(`sendAudio failed: ${res.status} ${text.slice(0, 200)}`);
  }
}
