export declare function loadTelegramAllowedUserId(): Promise<string | null>;
export declare function saveTelegramAllowedUserId(userId: string): Promise<void>;
export declare function registerTelegramCommands(token: string): Promise<void>;
export declare function sendTelegramMessage(token: string, chatId: string, text: string): Promise<void>;
export declare function sendTelegramDocument(token: string, chatId: string, doc: unknown): Promise<void>;
export declare function startTelegramTyping(
  token: string,
  chatId: string,
  options?: { signal?: AbortSignal; intervalMs?: number }
): { stop: () => void };
export declare function pollTelegramUpdates(options: {
  token: string;
  signal: AbortSignal;
  onInbound: (msg: Record<string, unknown>) => Promise<void>;
  onError?: (err: unknown) => void;
}): { stop: () => void };
