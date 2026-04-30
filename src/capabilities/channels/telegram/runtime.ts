import { createChannelInboundHandler } from "../../../channels/dispatcher.js";
import {
  pollTelegramUpdates,
  registerTelegramCommands,
  sendTelegramDocument,
  sendTelegramMessage,
  startTelegramTyping,
} from "../../../channels/telegram.js";

export function start(deps) {
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

  const handle = pollTelegramUpdates({
    token,
    signal,
    onInbound: inbound,
    onError: (err) =>
      writeStderrStyled?.(
        `channel: ${err instanceof Error ? err.message : String(err)}`
      ),
  });

  return { stop: handle.stop };
}
