import { createChannelInboundHandler } from "../../../channels/dispatcher.js";
import {
  loadTelegramAllowedUserId,
  pollTelegramUpdates,
  registerTelegramCommands,
  saveTelegramAllowedUserId,
  sendTelegramDocument,
  sendTelegramMessage,
  startTelegramTyping,
} from "../../../channels/telegram.js";

export function start(deps: {
  signal: AbortSignal;
  agentTurn: (...args: unknown[]) => Promise<unknown>;
  cfg: Record<string, unknown>;
  abortTurn?: (reason?: string) => boolean;
  writeStderrStyled?: (line: string) => void;
}) {
  const { signal, agentTurn, cfg, abortTurn, writeStderrStyled } = deps;
  const token = String(process.env.WEBAGENT_TELEGRAM_BOT_TOKEN || "").trim();
  const noop = () => {};
  if (!token) return { stop: noop };

  void registerTelegramCommands(token).catch((err) =>
    writeStderrStyled?.(
      `channel: failed to register Telegram commands: ${err instanceof Error ? err.message : String(err)}`
    )
  );

  const inbound = createChannelInboundHandler({
    agentTurn,
    cfg,
    abortTurn,
    sendReply: (chatId, text) => sendTelegramMessage(token, chatId, text),
    sendDocument: (chatId, doc) => sendTelegramDocument(token, chatId, doc),
    startTyping: (chatId) => startTelegramTyping(token, chatId, { signal }),
  });

  const gatedInbound = async (msg: Record<string, unknown>) => {
    const userId = String(msg?.userId ?? "").trim();
    const chatId = String(msg?.chatId ?? "").trim();
    let allowed = await loadTelegramAllowedUserId();
    if (!allowed) {
      if (!userId) {
        writeStderrStyled?.("channel: skipping Telegram inbound (missing user id)");
        return;
      }
      await saveTelegramAllowedUserId(userId);
      allowed = userId;
      const line = `Telegram user id is set to "${userId}".\n`;
      writeStderrStyled?.(line);
      await sendTelegramMessage(token, chatId, line).catch(() => {});
    } else if (userId !== allowed) {
      await sendTelegramMessage(token, chatId, "Unauthorized.").catch(() => {});
      return;
    }
    return inbound(msg);
  };

  const handle = pollTelegramUpdates({
    token,
    signal,
    onInbound: gatedInbound,
    onError: (err) =>
      writeStderrStyled?.(
        `channel: ${err instanceof Error ? err.message : String(err)}`
      ),
  });

  return { stop: handle.stop };
}
