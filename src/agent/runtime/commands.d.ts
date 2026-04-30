export const SLASH_COMMANDS: Array<{ name: string; description: string }>;
export function buildCommandSpec(): string;
export function buildTelegramBotCommands(): Array<{ command: string; description: string }>;
