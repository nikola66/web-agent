import fs from "node:fs/promises";
import { workspaceStatePath } from "../constants.js";
import { logDebugEvent } from "../logging/debug-log.js";
import { ensureParentDir } from "../workspace-paths.js";
import { buildTelegramBotCommands } from "../commands.js";

async function readStateFile() {
  const channelStatePath = workspaceStatePath(".channel-state.json");
  try {
    const raw = await fs.readFile(channelStatePath, "utf8");
    const j = JSON.parse(raw);
    return j && typeof j === "object" && !Array.isArray(j) ? j : {};
  } catch {
    return {};
  }
}

async function writeStateFile(next) {
  const channelStatePath = workspaceStatePath(".channel-state.json");
  await ensureParentDir(channelStatePath);
  await fs.writeFile(channelStatePath, JSON.stringify(next, null, 2), "utf8");
}

async function loadNextPollOffset() {
  const s = await readStateFile();
  const n = Number(s?.telegram?.nextPollOffset ?? NaN);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

async function saveNextPollOffset(offset) {
  const s = await readStateFile();
  const prev = typeof s.telegram === "object" && s.telegram !== null ? s.telegram : {};
  s.telegram = { ...prev, nextPollOffset: offset };
  await writeStateFile(s);
}

async function fetchTelegramResult(urlString, opts = {}) {
  const res = await fetch(urlString, opts);
  /** @type {Record<string, unknown>} */
  const body = typeof res?.json === "function" ? await res.json().catch(() => ({})) : {};
  if (body?.ok !== true) {
    const description = typeof body?.description === "string" ? body.description : "";
    throw new Error(description || `${res.status} ${res.statusText || "Telegram HTTP error"}`.trim());
  }
  return body.result;
}

function createTelegramJsonOptions(body, timeoutMs = 120_000) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined,
    body: JSON.stringify(body),
  };
}

async function sendTelegramPayload(urlString, payload, timeoutMs = 120_000) {
  return fetchTelegramResult(urlString, createTelegramJsonOptions(payload, timeoutMs));
}

/**
 * Register Telegram slash commands for this bot.
 *
 * @param {string} token
 */
export async function registerTelegramCommands(token) {
  const commands = buildTelegramBotCommands();
  const url = new URL(`https://api.telegram.org/bot${encodeURIComponent(token)}/setMyCommands`);
  await sendTelegramPayload(url.toString(), { commands }, 30_000);
}

function escapeTelegramHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatInlineMarkdownForTelegram(text) {
  let out = escapeTelegramHtml(text);
  const codeTokens = [];
  out = out.replace(/`([^`\n]+)`/g, (_m, code) => {
    const token = `@@TGCODE${codeTokens.length}@@`;
    codeTokens.push(`<code>${code}</code>`);
    return token;
  });
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  out = out.replace(/(^|[^\w])__([^_\n]+)__([^\w]|$)/g, "$1<b>$2</b>$3");
  out = out.replace(/(^|[^\*])\*([^*\n]+)\*/g, "$1<i>$2</i>");
  out = out.replace(/(^|[^\w])_([^_\n]+)_([^\w]|$)/g, "$1<i>$2</i>$3");
  for (let i = 0; i < codeTokens.length; i++) {
    out = out.split(`@@TGCODE${i}@@`).join(codeTokens[i]);
  }
  return out;
}

function renderMarkdownForTelegram(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inFence = false;
  const fenceLines = [];
  for (const line of lines) {
    const fence = line.match(/^\s*```(.*)$/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceLines.length = 0;
      } else {
        const code = escapeTelegramHtml(fenceLines.join("\n"));
        out.push(`<pre><code>${code}</code></pre>`);
        inFence = false;
      }
      continue;
    }
    if (inFence) {
      fenceLines.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      out.push(`<b>${formatInlineMarkdownForTelegram(heading[2].trim())}</b>`);
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push("────────────────────────");
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      out.push(`▎${formatInlineMarkdownForTelegram(quote[1])}`);
      continue;
    }
    const ulist = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (ulist) {
      out.push(`${ulist[1]}• ${formatInlineMarkdownForTelegram(ulist[2])}`);
      continue;
    }
    const olist = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (olist) {
      out.push(`${olist[1]}${olist[2]}. ${formatInlineMarkdownForTelegram(olist[3])}`);
      continue;
    }
    out.push(formatInlineMarkdownForTelegram(line));
  }
  if (inFence && fenceLines.length) {
    const code = escapeTelegramHtml(fenceLines.join("\n"));
    out.push(`<pre><code>${code}</code></pre>`);
  }
  return out.join("\n");
}

function splitTelegramSourceMessage(text, limit = 3500) {
  const normalized = String(text ?? "").trim();
  if (!normalized) return [];
  if (normalized.length <= limit) return [normalized];
  const chunks = [];
  const paragraphs = normalized.split(/\n{2,}/);
  let current = "";
  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    if (current) pushCurrent();
    if (para.length <= limit) {
      current = para;
      continue;
    }
    const lines = para.split("\n");
    for (const line of lines) {
      const withLine = current ? `${current}\n${line}` : line;
      if (withLine.length <= limit) {
        current = withLine;
        continue;
      }
      if (current) pushCurrent();
      if (line.length <= limit) {
        current = line;
        continue;
      }
      for (let i = 0; i < line.length; i += limit) {
        chunks.push(line.slice(i, i + limit));
      }
    }
  }
  if (current) pushCurrent();
  return chunks;
}

/**
 * Markdown-like outbound rendered to Telegram HTML.
 * We split source text before rendering so we never cut HTML tags mid-entity.
 *
 * @param {string} token
 * @param {string | number} chatId
 * @param {string} text
 */
export async function sendTelegramMessage(token, chatId, text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return;
  const sourceChunks = splitTelegramSourceMessage(trimmed, 3500);
  const url = new URL(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`);
  const urlString = url.toString();
  const basePayload = {
    chat_id: chatId,
    disable_web_page_preview: true,
  };
  for (const sourceChunk of sourceChunks) {
    const chunk = renderMarkdownForTelegram(sourceChunk);
    try {
      await sendTelegramPayload(urlString, {
        ...basePayload,
        text: chunk,
        parse_mode: "HTML",
      });
    } catch (htmlError) {
      await logDebugEvent("telegram_send_html_failed", {
        chatId: String(chatId),
        error: htmlError instanceof Error ? htmlError.message : String(htmlError),
        sourcePreview: sourceChunk.slice(0, 200),
      }).catch(() => {});
      try {
        await sendTelegramPayload(urlString, {
          ...basePayload,
          text: sourceChunk,
        });
        await logDebugEvent("telegram_send_plain_fallback_ok", {
          chatId: String(chatId),
          sourcePreview: sourceChunk.slice(0, 200),
        }).catch(() => {});
      } catch (plainError) {
        await logDebugEvent("telegram_send_plain_fallback_failed", {
          chatId: String(chatId),
          htmlError: htmlError instanceof Error ? htmlError.message : String(htmlError),
          plainError: plainError instanceof Error ? plainError.message : String(plainError),
          sourcePreview: sourceChunk.slice(0, 200),
        }).catch(() => {});
        throw plainError;
      }
    }
  }
}

/**
 * Send a markdown file as a Telegram document attachment.
 *
 * @param {string} token
 * @param {string | number} chatId
 * @param {{ title: string; filename: string; content: string }} doc
 */
export async function sendTelegramDocument(token, chatId, doc) {
  const title = String(doc?.title || "Document").trim();
  const filename = String(doc?.filename || "artifact.md").trim();
  const content = String(doc?.content || "").trim();
  if (!content) return;

  const boundary = `----TGBoundary${Date.now().toString(36)}`;
  const fileBytes = Buffer.from(content, "utf-8");

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${title}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${filename}"\r\nContent-Type: text/markdown\r\n\r\n`),
    fileBytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const url = new URL(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendDocument`);
  await fetchTelegramResult(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(60_000) : undefined,
    body,
  });
}

/**
 * Start a lightweight Telegram "typing" heartbeat while processing.
 * Telegram typing status auto-expires quickly, so we re-send periodically
 * until the returned stopper is called.
 *
 * @param {string} token
 * @param {string | number} chatId
 * @param {{ signal?: AbortSignal; intervalMs?: number }} [opts]
 * @returns {() => void} stop function
 */
export function startTelegramTyping(token, chatId, opts = {}) {
  const intervalMs = Math.max(1500, Number(opts?.intervalMs) || 4000);
  const signal = opts?.signal;
  let stopped = false;
  let timer = null;

  const emitTyping = async () => {
    if (stopped) return;
    const url = new URL(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendChatAction`);
    try {
      await sendTelegramPayload(url.toString(), { chat_id: chatId, action: "typing" }, 15_000);
    } catch {
      // Best-effort UX signal; never fail the actual turn for this.
    }
  };

  void emitTyping();
  timer = setInterval(() => {
    void emitTyping();
  }, intervalMs);
  timer.unref?.();

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  };

  if (signal) {
    if (signal.aborted) stop();
    else signal.addEventListener?.("abort", stop, { once: true });
  }

  return stop;
}

function mapInboundUpdate(update) {
  const msg = update.message || update.channel_post;
  if (!msg || typeof msg !== "object") return null;
  if (msg.from?.is_bot) return null;
  const textRaw = typeof msg.text === "string" ? msg.text : typeof msg.caption === "string" ? msg.caption : "";
  if (!textRaw.trim()) return null;
  return {
    channel: "telegram",
    chatId: String(msg.chat?.id ?? ""),
    userId: String(msg.from?.id ?? ""),
    messageId: String(msg.message_id ?? ""),
    text: textRaw,
    timestamp: Number(msg.date || 0) * 1000,
  };
}

/**
 * Long-poll Telegram getUpdates; calls onInbound for each mapped message.
 * Persists telegram.nextPollOffset in CHANNEL_STATE_PATH.
 *
 * @param {{ token: string; signal: AbortSignal; onInbound: (msg: Record<string, unknown>) => Promise<void>; onError?: (e: Error) => void }} opts
 */
export function pollTelegramUpdates({ token, signal, onInbound, onError }) {
  let outerStopped = false;
  const pollTimeoutSec = Math.min(
    55,
    Math.max(1, Number(process.env.WEBAGENT_TELEGRAM_POLL_TIMEOUT_S) || 25)
  );

  const run = async () => {
    let nextPollOffset = await loadNextPollOffset();
    while (!signal.aborted && !outerStopped) {
      try {
        const url = new URL(`https://api.telegram.org/bot${encodeURIComponent(token)}/getUpdates`);
        if (nextPollOffset != null) url.searchParams.set("offset", String(nextPollOffset));
        url.searchParams.set("timeout", String(pollTimeoutSec));
        url.searchParams.set("allowed_updates", JSON.stringify(["message", "channel_post"]));

        const result = await fetchTelegramResult(url.toString(), { signal });
        const updates = Array.isArray(result) ? result : [];
        let maxId = null;
        for (const u of updates) {
          const id = Number(u?.update_id ?? NaN);
          if (!Number.isFinite(id)) continue;
          maxId = maxId === null ? id : Math.max(maxId, id);
          const inbound = mapInboundUpdate(u);
          if (inbound) {
            void Promise.resolve(onInbound(inbound)).catch((err) =>
              onError?.(err instanceof Error ? err : new Error(String(err)))
            );
          }
        }
        if (maxId !== null) {
          nextPollOffset = maxId + 1;
          await saveNextPollOffset(nextPollOffset);
        }
      } catch (e) {
        if (signal.aborted || outerStopped) break;
        if (e?.name === "AbortError") break;
        onError?.(e instanceof Error ? e : new Error(String(e)));
        await new Promise((r) => setTimeout(r, 2500));
      }
    }
  };

  void run().catch((e) =>
    onError?.(e instanceof Error ? e : new Error(String(e)))
  );

  return {
    stop() {
      outerStopped = true;
    },
  };
}
