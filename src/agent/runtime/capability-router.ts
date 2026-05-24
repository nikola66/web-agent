/** Compact always-on task → skill → tool routing for the agent system prompt. */

export type CapabilityRoute = {
  need: string;
  skill?: string;
  tools: string[];
  avoid?: string;
};

export const CAPABILITY_ROUTES: CapabilityRoute[] = [
  {
    need: "Read/edit files",
    skill: "browser-runtime-map",
    tools: ["read_file", "write_file", "edit_file", "multi_edit", "apply_patch"],
    avoid: "run_shell cat/sed",
  },
  {
    need: "Browse workspace (list/tree/find)",
    skill: "browser-runtime-map",
    tools: ["browse_workspace"],
    avoid: "grep for filenames",
  },
  {
    need: "Search file contents",
    tools: ["grep"],
    avoid: "browse_workspace find for contents",
  },
  {
    need: "REST/GraphQL HTTP",
    skill: "http-api",
    tools: ["web_fetch", "web_post"],
    avoid: "run_shell curl/axios",
  },
  {
    need: "Python scripts",
    skill: "browser-runtime-map",
    tools: ["run_python"],
    avoid: "run_shell python3 except alias",
  },
  {
    need: "Shell (last resort)",
    skill: "browser-runtime-map",
    tools: ["run_shell"],
    avoid: "POSIX pipes, git, npx, curl",
  },
  {
    need: "OAuth SaaS apps",
    skill: "composio-oauth",
    tools: ["composio_connect", "composio_status", "composio_action"],
    avoid: "raw web_post without OAuth setup",
  },
  {
    need: "DOM click/type automation",
    skill: "imported-skill-compat",
    tools: ["tool_search", "tool_activate"],
    avoid: "web_fetch for clicks; use MCP browser via tool_search",
  },
  {
    need: "JS-heavy page as text",
    tools: ["web_fetch"],
    avoid: "assuming Playwright is built-in",
  },
  {
    need: "Web search",
    tools: ["web_search"],
  },
  {
    need: "Create ZIP",
    skill: "browser-runtime-map",
    tools: ["run_python"],
    avoid: "create_archive (missing); shell zip",
  },
  {
    need: "Extract/list ZIP",
    tools: ["extract_archive", "archive_list"],
    avoid: "shell unzip",
  },
  {
    need: "Durable facts",
    skill: "memory-layers",
    tools: ["memory_save", "memory_recall", "memory_search", "memory_forget"],
    avoid: "saving procedures as memory facts",
  },
  {
    need: "Session notes / prior chats",
    skill: "memory-layers",
    tools: ["session_memory_append", "session_memory_list", "session_search"],
  },
  {
    need: "Skills / procedures",
    skill: "memory-layers",
    tools: ["skill_list", "skill_view", "skill_manage", "skill_bulk_save"],
  },
  {
    need: "Wiki vault",
    skill: "memory-layers",
    tools: ["wiki_setup", "wiki_sync", "wiki_search"],
  },
  {
    need: "Scheduled jobs",
    skill: "heartbeat-cron",
    tools: ["cron_register", "cron_list"],
    avoid: "manual cron run",
  },
  {
    need: "Deliverables",
    skill: "artifact-delivery",
    tools: ["artifact_present", "email"],
  },
  {
    need: "Images / audio / video",
    skill: "multimodal-ingest",
    tools: ["vision_analyze", "audio_analyze", "youtube_transcribe", "image_info"],
  },
  {
    need: "PDF/DOCX plain text",
    tools: ["pdf_extract", "docx_extract"],
    avoid: "run_python first for simple text",
  },
  {
    need: "System clock / env",
    tools: ["system_info"],
    avoid: "run_shell date",
  },
];

export const CAPABILITY_ENV_FOOTER =
  "Environment: Nodebox browser — no POSIX shell, Pyodide Python, proxy-backed HTTP. " +
  "In Python scripts use webagent.http for HTTP; agent one-offs use web_fetch/web_post. " +
  "Full matrix: skill_view **`browser-runtime-map`**. " +
  "Installed capability folders: `capability_list` (extensions only, not built-in routing).";

const ROUTER_CHAR_BUDGET = 1800;

function routeHasAvailableTools(route: CapabilityRoute, available: Set<string>): boolean {
  if (!route.tools.length) return true;
  return route.tools.some((tool) => available.has(tool));
}

function formatRouteLine(route: CapabilityRoute, available: Set<string>): string {
  const tools = route.tools.filter((tool) => !available.size || available.has(tool));
  const toolText = tools.length ? tools.join(", ") : route.tools.join(", ");
  const skillText = route.skill ? `; skill_view **\`${route.skill}\`**` : "";
  const avoidText = route.avoid ? `; avoid ${route.avoid}` : "";
  return `- ${route.need}: ${toolText}${skillText}${avoidText}`;
}

export function buildCapabilityRouterBlock(toolNames: string[] = []): string {
  const available = new Set(
    (toolNames || []).map((name) => String(name || "").trim()).filter(Boolean)
  );
  const lines: string[] = [
    "# Capability router",
    "Skills and built-in tools are one surface. Match the need below before tool fan-out; call skill_view on the listed hub for full procedure.",
  ];
  let budget = ROUTER_CHAR_BUDGET - lines.join("\n").length - CAPABILITY_ENV_FOOTER.length - 4;

  for (const route of CAPABILITY_ROUTES) {
    if (available.size && !routeHasAvailableTools(route, available)) continue;
    const line = formatRouteLine(route, available);
    if (line.length > budget) break;
    lines.push(line);
    budget -= line.length + 1;
  }

  lines.push(CAPABILITY_ENV_FOOTER);
  return `\n\n${lines.join("\n")}`;
}
