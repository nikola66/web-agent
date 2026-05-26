import { defineTool } from "../definition.js";
import { searchDeferredTools } from "../tool-search-tools.js";

export default defineTool({
  name: "tool_search",
  run: async (args, ctx) => {
    const query = String(args?.query ?? args?.q ?? "").trim();
    const limit = Number(args?.limit) || 12;
    const active = new Set(
      Array.isArray((ctx as { services?: { activeToolNamesState?: { list?: string[] } } })?.services?.activeToolNamesState?.list)
        ? (ctx as { services: { activeToolNamesState: { list: string[] } } }).services.activeToolNamesState.list
        : []
    );
    const matches = await searchDeferredTools(query, active, limit);
    return { ok: true, query, matches, count: matches.length };
  },
  emoji: "🔍",
  toolGroup: "core",
  description:
    "Search deferred tools (MCP `mcp_*` integrations and hidden aliases) not in the active schema. " +
    "For MCP capabilities use query `mcp` (not empty — empty omits browse aliases but may miss MCP). " +
    "Read ## MCP in the Tool capability index first. Use before `tool_activate`.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Substring to match tool name or description." },
      limit: { type: "number", description: "Max matches (default 12)." },
    },
    additionalProperties: false,
  },
});
