import fs from "node:fs/promises";
import { TOOLS_CAPABILITY_INDEX_REL, workspaceStatePath } from "./constants.js";
import { TOOL_GROUPS } from "./tools/tool-policy-config.js";

export type ToolCatalogEntry = {
  emoji?: string;
  description?: string;
};

export type BuildToolCapabilityIndexOpts = {
  catalog: Record<string, ToolCatalogEntry | undefined>;
  policyToolNames: string[];
  activeToolNames: string[];
};

const TOOL_BRIEF_MAX_CHARS = Math.max(
  40,
  Number(process.env.WEBAGENT_TOOL_BRIEF_MAX_CHARS) || 80
);
export function toolIndexCharBudget(): number {
  return Math.max(1500, Number(process.env.WEBAGENT_TOOL_INDEX_CHAR_BUDGET) || 5000);
}

export const TOOL_INDEX_CHAR_BUDGET = toolIndexCharBudget();
const MCP_TOOLS_LIST_CAP = 8;

let cachedBlock: string | null = null;
let cachedKey: string | null = null;

export function invalidateToolCapabilityIndexCache(): void {
  cachedBlock = null;
  cachedKey = null;
}

export function briefToolDescription(description: string, maxChars = TOOL_BRIEF_MAX_CHARS): string {
  const raw = String(description || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "see tool schema";
  const first = raw.split(/(?<=[.!?])\s+/)[0]?.trim() || raw;
  const text = first.length <= maxChars ? first : first.slice(0, maxChars - 1).trimEnd() + "…";
  return text;
}

function mcpServerFromMeta(name: string, meta: ToolCatalogEntry | undefined): string {
  const fromDesc = /\[MCP:([^\]]+)\]/i.exec(String(meta?.description || ""));
  if (fromDesc?.[1]) return fromDesc[1].trim();
  const stripped = String(name || "").replace(/^mcp_/, "");
  if (!stripped) return "mcp";
  const parts = stripped.split("_").filter(Boolean);
  if (parts.length <= 1) return parts[0] || "mcp";
  return parts.slice(0, -1).join("_") || "mcp";
}

function formatToolLine(
  name: string,
  meta: ToolCatalogEntry | undefined,
  active: Set<string>
): string {
  const tag = active.has(name) ? "active" : "deferred";
  const brief = briefToolDescription(String(meta?.description || ""));
  return `- [${tag}] ${name} — ${brief}`;
}

function groupPolicyTools(
  catalog: Record<string, ToolCatalogEntry | undefined>,
  policySet: Set<string>
): { grouped: Map<string, string[]>; mcpByServer: Map<string, string[]> } {
  const nameToGroup = new Map<string, string>();
  for (const [group, names] of Object.entries(TOOL_GROUPS)) {
    for (const name of names) nameToGroup.set(name, group);
  }

  const grouped = new Map<string, string[]>();
  const mcpByServer = new Map<string, string[]>();

  for (const name of [...policySet].sort()) {
    if (!catalog[name]) continue;
    if (name.startsWith("mcp_")) {
      const server = mcpServerFromMeta(name, catalog[name]);
      const list = mcpByServer.get(server) || [];
      list.push(name);
      mcpByServer.set(server, list);
      continue;
    }
    const group = nameToGroup.get(name) || "other";
    const list = grouped.get(group) || [];
    list.push(name);
    grouped.set(group, list);
  }

  return { grouped, mcpByServer };
}

function countToolLines(lines: string[]): number {
  return lines.filter((l) => l.startsWith("- [active]") || l.startsWith("- [deferred]")).length;
}

function appendMcpSection(
  lines: string[],
  mcpByServer: Map<string, string[]>,
  catalog: Record<string, ToolCatalogEntry | undefined>,
  active: Set<string>,
  budget: { remaining: number }
): void {
  const servers = [...mcpByServer.keys()].sort();
  if (!servers.length) return;

  for (const server of servers) {
    const tools = mcpByServer.get(server) || [];
    if (!tools.length) continue;

    const header = `## MCP (${server})`;
    if (header.length + 1 > budget.remaining) {
      lines.push(`- … +${tools.length} MCP tool(s) on ${server} (see ## MCP in index)`);
      return;
    }
    lines.push(header);
    budget.remaining -= header.length + 1;

    if (tools.length > MCP_TOOLS_LIST_CAP) {
      const summary = `- [active] ${tools.length} mcp_* tools (e.g. ${tools.slice(0, 3).join(", ")}, …) — call by exact name`;
      if (summary.length + 1 <= budget.remaining) {
        lines.push(summary);
        budget.remaining -= summary.length + 1;
      }
      continue;
    }

    for (const name of tools) {
      const line = formatToolLine(name, catalog[name], active);
      if (line.length + 1 > budget.remaining) {
        lines.push(`- … +${tools.length} MCP tool(s) on ${server}`);
        return;
      }
      lines.push(line);
      budget.remaining -= line.length + 1;
    }
  }
}

export function buildToolCapabilityIndexBlock(opts: BuildToolCapabilityIndexOpts): string {
  const catalog = opts.catalog || {};
  const policySet = new Set(
    (opts.policyToolNames || []).map((n) => String(n || "").trim()).filter(Boolean)
  );
  for (const name of Object.keys(catalog)) {
    if (name.startsWith("mcp_")) policySet.add(name);
  }
  const active = new Set(
    (opts.activeToolNames || []).map((n) => String(n || "").trim()).filter(Boolean)
  );

  const mcpCount = Object.keys(catalog).filter((n) => n.startsWith("mcp_") && catalog[n]).length;
  const lines: string[] = [
    "# Tool capability index",
    "All tools below exist in this agent. **Active** = callable now. **Deferred** = policy-group, MCP, or hidden-alias tools — use `tool_search` then `tool_activate` before calling.",
    mcpCount
      ? `**MCP:** ${mcpCount} registered tool(s) under ## MCP below (\`mcp_*\` integrations — deferred until activated or unlocked after config reload). \`list_dir\`/\`find_files\`/\`tree\` are built-in browse aliases — not MCP.`
      : "**MCP:** none registered yet — add servers in `.webagent/mcp-servers.json` (and secrets in `.webagent/mcp-secrets.json`); `write_file` on those paths triggers reload when the browser tab is open.",
  ];
  const budget = { remaining: toolIndexCharBudget() - lines.join("\n").length - 2 };

  const { grouped, mcpByServer } = groupPolicyTools(catalog, policySet);
  const groupOrder = [...Object.keys(TOOL_GROUPS), "other"];

  for (const group of groupOrder) {
    const tools = group === "other" ? grouped.get("other") : grouped.get(group);
    if (!tools?.length) continue;

    const header = group === "other" ? "## Other" : `## ${group.replace(/_/g, " ")}`;
    if (header.length + 1 > budget.remaining) break;
    lines.push(header);
    budget.remaining -= header.length + 1;

    for (const name of tools) {
      const line = formatToolLine(name, catalog[name], active);
      if (line.length + 1 > budget.remaining) {
        lines.push(`- … +${tools.length} more in ${group} (tool_search)`);
        break;
      }
      lines.push(line);
      budget.remaining -= line.length + 1;
    }
  }

  appendMcpSection(lines, mcpByServer, catalog, active, budget);

  const listed = countToolLines(lines);
  const total = [...policySet].filter((n) => catalog[n]).length;
  if (total > listed) {
    const note = `- … ${total - listed} more tool(s) omitted (budget); use tool_search.`;
    if (note.length + 1 <= budget.remaining) lines.push(note);
  }

  return `\n\n${lines.join("\n")}`;
}

export function toolCapabilityIndexFingerprint(
  catalog: Record<string, ToolCatalogEntry | undefined>,
  policyToolNames: string[],
  activeToolNames: string[]
): string {
  const keys = Object.keys(catalog)
    .sort()
    .map((name) => {
      const d = String(catalog[name]?.description || "");
      return `${name}:${d.length}:${d.slice(0, 48)}`;
    })
    .join("|");
  return `${keys}::${[...policyToolNames].sort().join(",")}::${[...activeToolNames].sort().join(",")}`;
}

export async function persistToolsCapabilityIndex(markdownBlock: string): Promise<void> {
  const path = workspaceStatePath(TOOLS_CAPABILITY_INDEX_REL);
  const body = String(markdownBlock || "")
    .replace(/^\n+/, "")
    .trimEnd();
  if (!body) return;
  await fs.mkdir(path.replace(/\/[^/]+$/, ""), { recursive: true });
  await fs.writeFile(path, `${body}\n`, "utf8");
}

export async function resolveToolCapabilityIndexBlock(
  opts: BuildToolCapabilityIndexOpts
): Promise<string> {
  const key = toolCapabilityIndexFingerprint(
    opts.catalog,
    opts.policyToolNames,
    opts.activeToolNames
  );
  if (cachedBlock !== null && cachedKey === key) return cachedBlock;
  const block = buildToolCapabilityIndexBlock(opts);
  cachedBlock = block;
  cachedKey = key;
  await persistToolsCapabilityIndex(block).catch(() => {});
  return block;
}
