export declare function createChannelInboundHandler(deps: {
  agentTurn: (...args: unknown[]) => Promise<unknown>;
  cfg: Record<string, unknown>;
  abortTurn?: (reason?: string) => boolean;
  sendReply: (chatId: string, text: string) => Promise<void>;
  sendPreview?: (chatId: string, text: string) => Promise<number | null>;
  editPreview?: (chatId: string, messageId: number, text: string) => Promise<void>;
  deletePreview?: (chatId: string, messageId: number) => Promise<void>;
  sendDocument?: (chatId: string, doc: unknown) => Promise<void>;
  startTyping?: (chatId: string) => { stop?: () => void };
}): (msg: Record<string, unknown>) => Promise<void>;
