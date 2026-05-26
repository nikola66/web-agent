export const SLASH_COMMANDS = [
  { name: "/help", description: "Show built-in commands and available tools." },
  { name: "/clear", description: "Clear conversation history and start a fresh thread; keeps agent and user identity." },
  { name: "/compact", description: "Summarize older context and keep the current thread going." },
  {
    name: "/plan [goal]",
    description:
      "Planning mode: research the workspace, write a detailed plan under plans/, present it, then stop—execute on a follow-up message.",
  },
  {
    name: "/clarify [topic]",
    description:
      "Clarify mode: emit one <<<CLARIFY>>> option block—no tools; host shows choice buttons.",
  },
  {
    name: "/find_skills [query]",
    description:
      "Find-skills mode: search skills.sh, SkillsMP, and Cursor Marketplace only; return the top 5 by installs, stars, or votes.",
  },
  {
    name: "/mcp [list|use|add|remove|test]",
    description: "Manage MCP servers; /mcp use <url> quick-adds Streamable HTTP (e.g. Directus /mcp).",
  },
  { name: "/reload-mcp", description: "Reload MCP servers from .webagent/mcp-servers.json and refresh tools." },
  { name: "/checkpoint [name]", description: "Save a named snapshot of current history for rollback (handled by the embedded agent runtime)." },
  { name: "/rollback [name]", description: "List checkpoints or restore a named checkpoint (handled by the embedded agent runtime)." },
  { name: "/skills [search]", description: "List installed skills, or search skills by query." },
  {
    name: "/wiki_setup [path]",
    description:
      "Initialize PARA + Obsidian wiki vault (Projects/Areas/Resources/KnowledgeVault/Archives). Optional workspace-relative root (default .webagent/knowledge-vault).",
  },
  {
    name: "/wiki_sync [scope] [path]",
    description:
      "Sync runtime facts/session/learnings into the wiki (scope: facts | session | all). Optional root path after scope.",
  },
  {
    name: "/wiki_search <query>",
    description: "Search markdown in the wiki vault when memory tools are not enough.",
  },
  { name: "/<skill> [task]", description: "Invoke an installed skill for a task." },
  {
    name: "/voice [on|off]",
    description:
      "Voice mode: speak agent replies aloud (browser OS voices, fully local). Mic uses local Whisper STT. No arg shows status.",
  },
  { name: "/stop", description: "Interrupt the current run." },
  { name: "/exit", description: "Exit the active terminal agent session." },
];

const TELEGRAM_COMMAND_RE = /^[a-z0-9_]{1,32}$/;

type TelegramSkillCommand = { slug: string; command: string; description: string };

function builtinTelegramCommands() {
  return SLASH_COMMANDS.filter((command) => /^\/[a-z0-9_]+(?:\s|$)/i.test(command.name || ""))
    .map((command) => {
      const nameWithoutSlash = String(command.name || "").replace(/^\//, "");
      const commandName = nameWithoutSlash.split(/\s/)[0].toLowerCase();
      return {
        command: commandName,
        description: String(command.description || "").slice(0, 256),
      };
    })
    .filter(({ command }) => TELEGRAM_COMMAND_RE.test(command));
}

/** Built-in + bundled skill commands for Telegram Bot API (underscore tokens only). */
export function buildTelegramBotCommands(
  skills: Array<{ slug: string; name?: string; description?: string }> = []
) {
  const seen = new Set<string>();
  const out: Array<{ command: string; description: string }> = [];

  for (const entry of builtinTelegramCommands()) {
    if (seen.has(entry.command)) continue;
    seen.add(entry.command);
    out.push(entry);
  }

  const skillRows: TelegramSkillCommand[] = [];
  for (const skill of skills) {
    const slug = String(skill.slug || "").trim();
    if (!slug) continue;
    const command = slug.replace(/-/g, "_");
    if (!TELEGRAM_COMMAND_RE.test(command) || seen.has(command)) continue;
    skillRows.push({
      slug,
      command,
      description: String(skill.description || skill.name || slug).slice(0, 256),
    });
  }
  skillRows.sort((a, b) => a.command.localeCompare(b.command));
  for (const row of skillRows) {
    seen.add(row.command);
    out.push({ command: row.command, description: row.description });
  }
  return out;
}
