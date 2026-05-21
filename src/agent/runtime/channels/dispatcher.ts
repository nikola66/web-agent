import fs from "node:fs/promises";
import { CHANNEL_HISTORY_DIR } from "../constants.js";
import {
  compactHistory,
  formatCompactionNotice,
  maybeCompactHistory,
} from "../context-compression.js";
import { logDebugEvent } from "../logging/debug-log.js";
import { sanitizeMessagesMissingSnapshotRefs } from "../memory/index.js";
import { loadSystemPrompt } from "../state/persistence.js";
import { formatTranscriptEventForChannel } from "../transcript.js";
import { ensureParentDir } from "../workspace-paths.js";
import { errorMessage } from "../utils.js";
import { SLASH_COMMANDS } from "../commands.js";
import {
  formatHelpForSurface,
  outboundSurfaceForChannel,
  runSkillsSlashCommand,
} from "../channel-outbound.js";
import { buildToolRowsFromCatalog } from "../slash-command-views.js";
import { loadToolCatalog } from "../tools/registry.js";
import { buildPlanModeUserPrompt } from "../planning-slash.js";
import { buildClarifyModeUserPrompt } from "../clarify-slash.js";
import { rewriteFindSkillsSlashUserMessage } from "../find-skills-slash.js";
import { rewriteWikiSlashUserMessage } from "../wiki-slash.js";
import { downloadTelegramVoice } from "../voice/telegram-voice.js";
import { audioAnalyzeTool } from "../tools/audio-tools.js";

function safeSegment(value) {
  return String(value || "").replace(/[^\w\-]/g, "_") || "_";
}

function chatHistoryPath(channel, chatId) {
  return `${CHANNEL_HISTORY_DIR}/${safeSegment(channel)}/${safeSegment(chatId)}.json`;
}

async function loadChannelHistory(channel, chatId) {
  const path = chatHistoryPath(channel, chatId);
  try {
    const raw = await fs.readFile(path, "utf8");
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

async function saveChannelHistory(channel, chatId, messages) {
  const path = chatHistoryPath(channel, chatId);
  await ensureParentDir(path);
  await fs.writeFile(path, JSON.stringify(messages, null, 2), "utf8");
}

async function refreshChannelHistoryWithLatestSystemPrompt(currentHistory) {
  const systemPrompt = await loadSystemPrompt();
  if (!currentHistory.length) return [{ role: "system", content: systemPrompt }];
  if (currentHistory[0]?.role !== "system") {
    return [{ role: "system", content: systemPrompt }, ...currentHistory];
  }
  return [{ role: "system", content: systemPrompt }, ...currentHistory.slice(1)];
}

function createRunId() {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isCriticalTranscriptEvent(event) {
  return Boolean(event?.critical) || event?.type === "assistant";
}

async function sendChannelError({ channel, chatId, sendReply, logType, error }) {
  const message = errorMessage(error);
  await logDebugEvent(logType, { channel, chatId, error: message }).catch(() => {});
  await sendReply(chatId, `Error: ${message.slice(0, 3800)}`).catch(() => {});
}

function createTranscriptSender({ channel, chatId, sendReply, transcriptStyle, toolCatalog }) {
  let lastTranscriptText = "";
  let transcriptMessageCount = 0;
  let lastAssistantPreview = "";

  return {
    async send(event) {
      const outbound = formatTranscriptEventForChannel(event, {
        style: transcriptStyle,
        toolCatalog,
      }).trim();
      if (!outbound || outbound === lastTranscriptText) return;
      try {
        await sendReply(chatId, outbound);
      } catch (error) {
        const critical = isCriticalTranscriptEvent(event);
        await logDebugEvent("channel_transcript_send_error", {
          channel,
          chatId,
          eventType: String(event?.type || "unknown"),
          critical,
          error: errorMessage(error),
          preview: outbound.slice(0, 120),
        }).catch(() => {});
        if (critical) throw error;
        return;
      }
      lastTranscriptText = outbound;
      transcriptMessageCount += 1;
      if (event?.type === "assistant") lastAssistantPreview = outbound.slice(0, 120);
    },
    stats() {
      return {
        transcriptMessageCount,
        lastAssistantPreview,
      };
    },
  };
}

/**
 * Builds an inbound handler for one channel backend (wired with sendReply).
 *
 * @param {{
 *   agentTurn: (...args: any[]) => Promise<any>;
 *   cfg: Record<string, unknown>;
 *   sendReply: (chatId: string, text: string) => Promise<void>;
 *   startTyping?: (chatId: string) => (() => void) | void;
 *   abortTurn?: (reason?: string) => boolean;
 * }} deps
 */
export function createChannelInboundHandler(deps) {
  const {
    agentTurn,
    cfg,
    sendReply,
    sendDocument,
    startTyping,
    abortTurn,
    contextCompaction = {},
  } = deps;
  const chatQueues = new Map();

  const enqueueByChat = (chatId, task) => {
    const previous = chatQueues.get(chatId) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    chatQueues.set(chatId, next);
    void next.finally(() => {
      if (chatQueues.get(chatId) === next) chatQueues.delete(chatId);
    });
    return next;
  };

  return function handleChannelInbound(msg) {
    const channel = String(msg?.channel ?? "").trim();
    const chatId = String(msg?.chatId ?? "").trim();
    let text = typeof msg?.text === "string" ? msg.text : "";
    const voice =
      msg?.voice && typeof msg.voice === "object" && typeof msg.voice.fileId === "string"
        ? (msg.voice as { fileId: string; duration?: number; mimeType?: string; fileSize?: number })
        : null;

    if (voice && !text.trim() && channel === "telegram") {
      // Will be replaced inside the queued task once the file is downloaded.
      text = `[Telegram voice note received — file_id ${voice.fileId.slice(0, 12)}…, ~${Math.max(0, Math.round(voice.duration || 0))}s]`;
    }
    const trimmed = text.trim();
    if (!channel || !chatId || !trimmed) return Promise.resolve();

    if (trimmed === "/stop") {
      return Promise.resolve()
        .then(async () => {
          const interrupted = typeof abortTurn === "function" ? !!abortTurn("channel_stop") : false;
          await logDebugEvent("channel_stop_requested", { channel, chatId, interrupted });
          await sendReply(
            chatId,
            interrupted ? "Stopping current run…" : "No active run to interrupt."
          );
        })
        .catch(async (e) => {
          await sendChannelError({
            channel,
            chatId,
            sendReply,
            logType: "channel_stop_error",
            error: e,
          });
        });
    }

    return enqueueByChat(chatId, async () => {
      await logDebugEvent("channel_inbound", {
        channel,
        chatId,
        preview: text.slice(0, 120),
      });
      let history = await refreshChannelHistoryWithLatestSystemPrompt(
        await loadChannelHistory(channel, chatId)
      );
      if (trimmed === "/compact") {
        const result = await compactHistory(history, cfg, {
          ...contextCompaction,
          onWarning: async (warning, error) => {
            await logDebugEvent("channel_context_compaction_failed", {
              channel,
              chatId,
              error: errorMessage(error),
            }).catch(() => {});
            if (typeof contextCompaction.onWarning === "function") {
              await contextCompaction.onWarning(warning, error);
            }
          },
        });
        if (result.changed) {
          history = result.messages;
          await saveChannelHistory(channel, chatId, history);
          await sendReply(chatId, formatCompactionNotice(result));
        } else if (result.reason === "summary_failed") {
          const detail = result.error ? errorMessage(result.error) : "";
          const suffix =
            detail && !detail.startsWith("Context compaction failed")
              ? ` Reason: ${detail.length > 420 ? `${detail.slice(0, 420)}…` : detail}`
              : "";
          await sendReply(chatId, `Context compaction failed; history unchanged.${suffix}`);
        } else {
          await sendReply(chatId, "Not enough history to compact.");
        }
        return;
      }
      const surface = outboundSurfaceForChannel(channel);
      if (trimmed === "/help") {
        const catalog = await loadToolCatalog();
        const toolRows = buildToolRowsFromCatalog(catalog);
        await sendReply(chatId, formatHelpForSurface(surface, SLASH_COMMANDS, toolRows));
        return;
      }
      if (trimmed === "/skills" || trimmed.startsWith("/skills ")) {
        await runSkillsSlashCommand(trimmed, surface, (msg) => sendReply(chatId, msg));
        return;
      }
      if (trimmed === "/voice" || trimmed.startsWith("/voice ")) {
        const arg = trimmed.slice("/voice".length).trim().toLowerCase();
        const status =
          channel === "telegram"
            ? arg === "on" || arg === "off"
              ? "Voice playback (/voice on|off) is only in the web app (Edge TTS). On Telegram, send voice notes — they are transcribed locally and answered in text."
              : "Telegram: inbound voice notes → local Whisper STT → text replies. Spoken agent replies: web app, /voice on or the speaker control."
            : "Voice playback is a web-app feature: /voice on or /voice off, or the speaker control next to Files.";
        await sendReply(chatId, status);
        return;
      }
      let voiceUserPrompt: string | null = null;
      if (voice && channel === "telegram") {
        const token = String(process.env.WEBAGENT_TELEGRAM_BOT_TOKEN || "").trim();
        if (token) {
          try {
            const downloaded = await downloadTelegramVoice(token, voice.fileId);
            const relPath = downloaded?.relPath ?? "";
            if (downloaded && relPath) {
              const durationLabel = Math.max(0, Math.round(voice.duration || 0));
              let transcript = "";
              try {
                const analyzed = (await audioAnalyzeTool({
                  workspace_relative_audio_path: relPath,
                })) as { transcript?: string };
                transcript = String(analyzed?.transcript ?? "").trim();
              } catch (err) {
                await logDebugEvent("telegram_voice_transcribe_failed", {
                  chatId,
                  relPath,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
              if (transcript) {
                voiceUserPrompt =
                  `The user sent a Telegram voice note (~${durationLabel}s). Transcript:\n${transcript}\n\nReply naturally to what they said.`;
              } else {
                voiceUserPrompt =
                  "The user sent a Telegram voice note but local transcription failed. Apologize briefly and ask them to try again or send text.";
              }
              await logDebugEvent("telegram_voice_received", {
                chatId,
                durationSec: durationLabel,
                bytes: downloaded.byteLength,
                savedPath: relPath,
                transcriptChars: transcript.length,
              });
            } else {
              voiceUserPrompt =
                "The user sent a Telegram voice note but the file could not be downloaded (Telegram getFile failed — see debug log). Ask them to try again or send text.";
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            await logDebugEvent("telegram_voice_handle_failed", {
              chatId,
              error: errMsg,
            });
            voiceUserPrompt =
              "The user sent a Telegram voice note but the runtime hit an error while downloading it. Ask them to send text or try again.";
          }
        } else {
          voiceUserPrompt =
            "A Telegram voice note arrived but WEBAGENT_TELEGRAM_BOT_TOKEN is not set in the runtime env — cannot fetch the audio. Reply in text and ask the user to retry once the token is configured.";
        }
      }

      const wikiRewrite = rewriteWikiSlashUserMessage(trimmed);
      const findSkillsRewrite = rewriteFindSkillsSlashUserMessage(trimmed);
      let userContent =
        voiceUserPrompt ??
        wikiRewrite ??
        findSkillsRewrite ??
        (trimmed === "/plan" || trimmed.startsWith("/plan ")
          ? buildPlanModeUserPrompt(
              trimmed === "/plan" ? "" : trimmed.slice("/plan ".length).trim()
            )
          : trimmed === "/clarify" || trimmed.startsWith("/clarify ")
            ? buildClarifyModeUserPrompt(
                trimmed === "/clarify" ? "" : trimmed.slice("/clarify ".length).trim()
              )
            : trimmed);
      history.push({ role: "user", content: userContent });
      const compaction = await maybeCompactHistory(history, cfg, {
        ...contextCompaction,
        onWarning: async (warning, error) => {
          await logDebugEvent("channel_context_compaction_failed", {
            channel,
            chatId,
            error: errorMessage(error),
          }).catch(() => {});
          if (typeof contextCompaction.onWarning === "function") {
            await contextCompaction.onWarning(warning, error);
          }
        },
      });
      if (compaction.changed) {
        history = compaction.messages;
        await saveChannelHistory(channel, chatId, history);
        await sendReply(chatId, formatCompactionNotice(compaction));
      }
      history = await sanitizeMessagesMissingSnapshotRefs(history);
      const runId = createRunId();
      const stopTyping = typeof startTyping === "function" ? startTyping(chatId) : null;
      const transcriptStyle = channel === "telegram" ? "telegram" : "terminal";
      const toolCatalog =
        transcriptStyle === "telegram" ? await loadToolCatalog() : undefined;
      const transcriptSender = createTranscriptSender({
        channel,
        chatId,
        sendReply,
        transcriptStyle,
        toolCatalog,
      });

      const RESEARCH_PROGRESS_MS = 90_000;
      let progressTimer: ReturnType<typeof setInterval> | null = null;
      if (channel === "telegram") {
        const turnStartedAt = Date.now();
        progressTimer = setInterval(() => {
          const elapsedMin = Math.floor((Date.now() - turnStartedAt) / 60_000);
          void sendReply(
            chatId,
            `⏳ Still working… (${elapsedMin} min elapsed)`
          ).catch(() => {});
        }, RESEARCH_PROGRESS_MS);
      }

      try {
        const tail = await agentTurn(history, cfg, {
          runId,
          input: trimmed,
          ask: null,
          autoApprove: true,
          services: typeof sendDocument === "function"
            ? { sendDocument: (doc) => sendDocument(chatId, doc) }
            : {},
          onTranscript: (event) => transcriptSender.send(event),
        });

        const tailMessages = Array.isArray(tail) ? tail : [];

        for (const m of tailMessages) history.push(m);
        history = await sanitizeMessagesMissingSnapshotRefs(history);
        await saveChannelHistory(channel, chatId, history);

        await logDebugEvent("channel_outbound_ok", {
          channel,
          chatId,
          ...transcriptSender.stats(),
        });
      } catch (e) {
        await sendChannelError({
          channel,
          chatId,
          sendReply,
          logType: "channel_turn_error",
          error: e,
        });
      } finally {
        if (progressTimer) clearInterval(progressTimer);
        try {
          if (typeof stopTyping === "function") stopTyping();
        } catch {
          /* */
        }
      }
    });
  };
}
