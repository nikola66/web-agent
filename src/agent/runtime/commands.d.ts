export const SLASH_COMMANDS: Array<{ name: string; description: string }>;
export function buildTelegramBotCommands(
  skills?: Array<{ slug: string; name?: string; description?: string }>
): Array<{ command: string; description: string }>;
