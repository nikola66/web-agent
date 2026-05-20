/** Local Whisper STT via IPC; optional LLM follow-up when `question` is customized. */

import { LLM_REQUEST_TIMEOUT_MS } from "../constants.js";
import { extractNonStreamAssistantText } from "../context-compression.js";
import { fetchWithTimeout } from "../llm/streaming.js";
import { reasoningDisableExtras, resolveLlm } from "../llm/provider-config.js";
import { ipcSttRequest } from "../ipc.js";
import fs from "node:fs/promises";
import {
  normalizeWorkspaceRelativePath,
  resolveWorkspacePath,
  toWorkspaceRelative,
} from "../workspace-paths.js";

export const DEFAULT_VOICE_QUESTION =
  "Listen to this audio and respond to what the speaker says, as if they sent you this voice message in chat.";

function sanitizeHeaders(headers: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const name = String(k || "").trim();
    if (!name) continue;
    out[name] = String(v ?? "").replace(/[^\x00-\xFF]/g, "");
  }
  return out;
}

const SUPPORTED_AUDIO_EXTS: Record<string, { mime: string; format: string }> = {
  ogg: { mime: "audio/ogg", format: "ogg" },
  oga: { mime: "audio/ogg", format: "ogg" },
  opus: { mime: "audio/ogg", format: "ogg" },
  mp3: { mime: "audio/mpeg", format: "mp3" },
  wav: { mime: "audio/wav", format: "wav" },
  m4a: { mime: "audio/mp4", format: "m4a" },
  mp4: { mime: "audio/mp4", format: "mp4" },
  webm: { mime: "audio/webm", format: "webm" },
  flac: { mime: "audio/flac", format: "flac" },
  aac: { mime: "audio/aac", format: "aac" },
};

function audioFormatFromExt(path: string): { mime: string; format: string } | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return SUPPORTED_AUDIO_EXTS[ext] ?? null;
}

function audioFormatFromMime(mime: string): { mime: string; format: string } | null {
  const lower = String(mime || "").toLowerCase();
  for (const value of Object.values(SUPPORTED_AUDIO_EXTS)) {
    if (lower.startsWith(value.mime)) return value;
  }
  if (lower.startsWith("audio/")) {
    const guess = lower.slice("audio/".length).split(";")[0].trim();
    if (guess) return { mime: lower.split(";")[0], format: guess };
  }
  return null;
}

export function isDefaultVoiceQuestion(question: string): boolean {
  return question.trim() === DEFAULT_VOICE_QUESTION;
}

async function loadWorkspaceAudioPath(
  raw: string,
  ctx?: { cwd?: string }
): Promise<{ base64: string; format: string; mime: string }> {
  const normalized = normalizeWorkspaceRelativePath(raw).replace(/\\/g, "/");
  const abs = resolveWorkspacePath(ctx, raw);
  const rel = toWorkspaceRelative(abs).replace(/\\/g, "/");
  const allowed =
    rel.startsWith("uploads/") || rel.startsWith(".webagent/voice-inbox/");
  if (!allowed) {
    throw new Error(
      "workspace_relative_audio_path must point under uploads/ or .webagent/voice-inbox/."
    );
  }
  const format = audioFormatFromExt(rel);
  if (!format) {
    throw new Error(
      `Unsupported audio extension for ${rel}. Allowed: ${Object.keys(SUPPORTED_AUDIO_EXTS).join(", ")}.`
    );
  }
  let buf: Buffer;
  try {
    buf = await fs.readFile(abs);
  } catch {
    throw new Error(`workspace_relative_audio_path not found: ${normalized}`);
  }
  return { base64: buf.toString("base64"), ...format };
}

async function loadAudioFromUrl(
  raw: string,
  signal?: AbortSignal
): Promise<{ base64: string; format: string; mime: string }> {
  const u = raw.trim();
  if (!u) throw new Error("Missing audio payload.");
  if (u.startsWith("data:audio/")) {
    const match = u.match(/^data:(audio\/[^;]+);base64,(.+)$/i);
    if (!match) throw new Error("Audio data URL must be base64-encoded.");
    const mime = match[1];
    const guess = audioFormatFromMime(mime);
    if (!guess) throw new Error(`Unsupported audio MIME ${mime}.`);
    return { base64: match[2], ...guess };
  }
  if (u.startsWith("http://") || u.startsWith("https://")) {
    const res = await fetch(u, { signal });
    if (!res.ok) throw new Error(`Fetching audio URL failed (${res.status}).`);
    const ctype = String(res.headers.get("content-type") || "audio/ogg")
      .split(";")[0]
      .trim();
    const guess = audioFormatFromMime(ctype);
    if (!guess) {
      throw new Error(`Fetched resource is not a supported audio type (content-type: ${ctype}).`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { base64: buf.toString("base64"), ...guess };
  }
  throw new Error(
    "Audio must be a data:audio/... URL, an http(s) URL, or `workspace_relative_audio_path`."
  );
}

type LlmCfg = NonNullable<Awaited<ReturnType<typeof resolveLlm>>>;

async function transcribeViaLocalStt(payloadAudio: {
  base64: string;
  mime: string;
}): Promise<string> {
  const result = (await ipcSttRequest({
    audioBase64: payloadAudio.base64,
    mime: payloadAudio.mime,
  })) as { ok?: boolean; text?: string; error?: string };
  if (result?.error) throw new Error(String(result.error));
  const text = String(result?.text ?? "").trim();
  if (!text) throw new Error("STT returned an empty transcript.");
  return text;
}

async function answerAboutTranscript(
  cfg: LlmCfg,
  question: string,
  transcript: string,
  signal?: AbortSignal
): Promise<string> {
  const headers = sanitizeHeaders({
    "Content-Type": "application/json",
    ...(cfg.extraHeaders as Record<string, string>),
    Authorization: `Bearer ${cfg.apiKey}`,
  });
  const endpoint = `${String(cfg.baseUrl).replace(/\/$/, "")}/chat/completions`;
  const res = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          {
            role: "user",
            content: `${question}\n\nTranscript:\n${transcript}`,
          },
        ],
        max_tokens: 2048,
        ...reasoningDisableExtras(cfg.provider),
      }),
      signal,
    },
    LLM_REQUEST_TIMEOUT_MS,
    "audio_analyze llm question"
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Follow-up chat failed (${res.status}). ${errText.slice(0, 400)}`.trim());
  }
  const payload = await res.json();
  const text = extractNonStreamAssistantText(payload);
  if (!text.trim()) throw new Error("Chat model returned an empty response.");
  return text.trim();
}

export async function audioAnalyzeTool(
  args: Record<string, unknown>,
  ctx?: { signal?: AbortSignal; env?: NodeJS.ProcessEnv; cwd?: string }
) {
  const questionRaw = typeof args.question === "string" ? args.question.trim() : "";
  const question = questionRaw || DEFAULT_VOICE_QUESTION;
  const needsLlmFollowUp = !isDefaultVoiceQuestion(question);

  const dataCandidate =
    (typeof args.audio_data_url === "string" ? args.audio_data_url.trim() : "") ||
    (typeof args.audio_url === "string" ? args.audio_url.trim() : "");
  const fetchSrc = typeof args.fetch_url === "string" ? args.fetch_url.trim() : "";
  const workspaceAudioPath =
    typeof args.workspace_relative_audio_path === "string"
      ? args.workspace_relative_audio_path.trim()
      : "";

  if (workspaceAudioPath && (dataCandidate || fetchSrc)) {
    throw new Error(
      "Provide either `workspace_relative_audio_path` or `audio_data_url`/`audio_url`/`fetch_url`, not both."
    );
  }
  if (!workspaceAudioPath && !dataCandidate && !fetchSrc) {
    throw new Error(
      "Provide `workspace_relative_audio_path`, `audio_data_url`/`audio_url`, or `fetch_url` pointing to an audio file."
    );
  }

  let payloadAudio: { base64: string; format: string; mime: string };
  if (workspaceAudioPath) payloadAudio = await loadWorkspaceAudioPath(workspaceAudioPath, ctx);
  else if (dataCandidate) payloadAudio = await loadAudioFromUrl(dataCandidate, ctx?.signal);
  else payloadAudio = await loadAudioFromUrl(fetchSrc, ctx?.signal);

  const transcript = await transcribeViaLocalStt(payloadAudio);

  let analysis = transcript;
  let chatModel: string | undefined;
  if (needsLlmFollowUp) {
    const cfg = await resolveLlm();
    if (!cfg?.baseUrl || !cfg.model) {
      throw new Error("Custom audio questions require a resolved LLM profile (missing base URL or model).");
    }
    if (!cfg.apiKey) {
      throw new Error("Custom audio questions require an API key for the configured provider.");
    }
    chatModel = cfg.model;
    analysis = await answerAboutTranscript(cfg, question, transcript, ctx?.signal);
  }

  return {
    ok: true,
    ...(chatModel ? { chat_model: chatModel } : {}),
    format: payloadAudio.format,
    transcript,
    analysis,
    note: needsLlmFollowUp
      ? "Transcribed locally via whisper-tiny.en; follow-up answered by the chat model."
      : "Transcribed locally via whisper-tiny.en.",
  };
}
