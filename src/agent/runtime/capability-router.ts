/** Compact always-on task → skill → tool routing for the agent system prompt. */

import { listSkills } from "./memory/skills.js";

export type CapabilityRoute = {
  need: string;
  skill?: string;
  tools: string[];
  avoid?: string;
  /** Show even when listed tools are not in the active schema (e.g. dynamic mcp_*). */
  alwaysShow?: boolean;
};

const STATIC_CAPABILITY_ROUTES: CapabilityRoute[] = [
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
    need: "JS-heavy page as text",
    tools: ["web_fetch"],
    avoid: "assuming Playwright is built-in",
  },
  {
    need: "Web search",
    tools: ["web_search"],
  },
  {
    need: "Extract/list ZIP",
    tools: ["extract_archive", "archive_list"],
    avoid: "shell unzip",
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
  {
    need: "DOM click/type automation",
    skill: "imported-skill-compat",
    tools: ["mcp_*"],
    alwaysShow: true,
    avoid: "web_fetch for clicks; use tool_search then tool_activate for mcp_*",
  },
];

const STATIC_SKILL_SLUGS = new Set(
  STATIC_CAPABILITY_ROUTES.map((route) => route.skill).filter(Boolean) as string[]
);

function needFromSkill(record: {
  slug: string;
  name: string;
  description: string;
  triggers: string[];
}): string {
  const trigger = record.triggers.find(Boolean);
  if (trigger) return trigger;
  const desc = String(record.description || "").split(/(?<=[.!?])\s+/)[0]?.trim();
  if (desc && desc.length <= 80) return desc;
  return record.name || record.slug;
}

export function buildCapabilityRoutesFromSkills(
  records: Array<{
    slug: string;
    name: string;
    description: string;
    triggers: string[];
    primaryTools: string[];
  }>
): CapabilityRoute[] {
  const routes: CapabilityRoute[] = [];
  for (const record of records) {
    if (!record.primaryTools?.length) continue;
    if (STATIC_SKILL_SLUGS.has(record.slug)) continue;
    routes.push({
      need: needFromSkill(record),
      skill: record.slug,
      tools: [...record.primaryTools],
      ...(record.slug === "composio-oauth" ? { alwaysShow: true } : {}),
      ...(record.slug === "imported-skill-compat" ? { alwaysShow: true } : {}),
    });
  }
  routes.sort((a, b) => String(a.skill).localeCompare(String(b.skill)));
  return routes;
}

export async function resolveCapabilityRoutes(): Promise<CapabilityRoute[]> {
  const records = await listSkills();
  const fromSkills = buildCapabilityRoutesFromSkills(records);
  return [...STATIC_CAPABILITY_ROUTES, ...fromSkills];
}

export const CAPABILITY_ENV_FOOTER =
  "Environment: Nodebox browser — no POSIX shell, Pyodide Python, proxy-backed HTTP. " +
  "Bytes move runtime→proxy→upstream; model sees metadata only (never base64 in tool args). " +
  "CMS /files → web_upload; JSON/GraphQL → web_post; binary download → web_fetch save_to. " +
  "Load procedures via `skill` action=view; tool picker hub: **`browser-runtime-map`**.";

const ROUTER_CHAR_BUDGET = 1800;

function routeHasAvailableTools(route: CapabilityRoute, available: Set<string>): boolean {
  if (route.alwaysShow) return true;
  if (!route.tools.length) return true;
  return route.tools.some((tool) => tool === "mcp_*" || available.has(tool));
}

function formatRouteLine(route: CapabilityRoute, available: Set<string>): string {
  const tools = route.tools.filter((tool) => tool === "mcp_*" || !available.size || available.has(tool));
  const toolText = tools.length ? tools.join(", ") : route.tools.join(", ");
  const skillText = route.skill ? `; skill view **\`${route.skill}\`**` : "";
  const avoidText = route.avoid ? `; avoid ${route.avoid}` : "";
  return `- ${route.need}: ${toolText}${skillText}${avoidText}`;
}

export async function buildCapabilityRouterBlock(toolNames: string[] = []): Promise<string> {
  const available = new Set(
    (toolNames || []).map((name) => String(name || "").trim()).filter(Boolean)
  );
  const routes = await resolveCapabilityRoutes();
  const lines: string[] = [
    "# Capability router",
    "Match the need below before tool fan-out; call `skill` action=view on the listed hub for full procedure.",
  ];
  let budget = ROUTER_CHAR_BUDGET - lines.join("\n").length - CAPABILITY_ENV_FOOTER.length - 4;

  for (const route of routes) {
    if (available.size && !routeHasAvailableTools(route, available)) continue;
    const line = formatRouteLine(route, available);
    if (line.length > budget) break;
    lines.push(line);
    budget -= line.length + 1;
  }

  lines.push(CAPABILITY_ENV_FOOTER);
  return `\n\n${lines.join("\n")}`;
}

export { STATIC_CAPABILITY_ROUTES };
export const CAPABILITY_ROUTES = STATIC_CAPABILITY_ROUTES;
