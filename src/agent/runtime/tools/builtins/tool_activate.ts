import { defineTool } from "../definition.js";
import { describeDeferredTool } from "../tool-search-tools.js";

export default defineTool({
  name: "tool_activate",
  run: async (args) => {
    const name = String(args?.name ?? args?.tool ?? "").trim();
    if (!name) throw new Error("tool_activate requires `name`.");
    const meta = await describeDeferredTool(name);
    if (!meta) {
      throw new Error(`Tool '${name}' is not a deferred tool or is already active. Use tool_search first.`);
    }
    return {
      ok: true,
      activated: name,
      description: meta.description,
      activates_next_round: true,
    };
  },
  emoji: "🔓",
  toolGroup: "core",
  description:
    "Activate a deferred policy-group or hidden-alias tool for the next agent round in this turn. " +
    "Call `tool_search` first, then `tool_activate` with the exact tool name, then call the tool on the following round. Not for `mcp_*` (already active when configured).",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Exact deferred tool name (e.g. cron_register, list_dir)." },
    },
    required: ["name"],
    additionalProperties: false,
  },
});
