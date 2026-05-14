export const SLASH_COMMANDS = [
  { name: "/help", description: "Show built-in commands and available tools." },
  { name: "/clear", description: "Clear history and restart onboarding for this profile." },
  { name: "/compact", description: "Summarize older context and keep the current thread going." },
  {
    name: "/plan [goal]",
    description:
      "Planning mode: research the workspace, write a detailed plan under .webagent/plans, present it, then stop—execute on a follow-up message.",
  },
  { name: "/checkpoint [name]", description: "Save a named snapshot of current history for rollback." },
  { name: "/rollback [name]", description: "List checkpoints or restore a named checkpoint." },
  { name: "/skills [search]", description: "List installed skills, or search skills by query." },
  { name: "/<skill> [task]", description: "Invoke an installed skill for a task." },
  { name: "/stop", description: "Interrupt the current run." },
  { name: "/exit", description: "Exit the active terminal agent session." },
];

export function buildCommandSpec() {
  return SLASH_COMMANDS.map((command) => `- ${command.name}: ${command.description}`).join("\n");
}

export function buildTelegramBotCommands() {
  return SLASH_COMMANDS.filter((command) => /^\/[A-Za-z0-9_]+(?:\s|$)/.test(command.name || "")).map((command) => {
    const nameWithoutSlash = String(command.name || "").replace(/^\//, "");
    const commandName = nameWithoutSlash.split(/\s/)[0];
    return {
      command: commandName,
      description: String(command.description || "").slice(0, 256),
    };
  });
}
