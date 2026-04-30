// Re-export tool catalog built from registry metadata
// Use browser-compatible stub that only includes metadata, not Node.js implementations
import { BUILTIN_TOOLS } from "@embed-runtime/tools/registry-browser.js";

export interface ToolCatalogEntry {
  emoji: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  requiresConfirmation?: boolean;
}

type BuiltinToolsMap = Record<
  string,
  {
    emoji: string;
    description: string;
    inputSchema: Record<string, unknown>;
    requiresConfirmation?: boolean;
  }
>;

export const TOOL_CATALOG: Record<string, ToolCatalogEntry> = Object.fromEntries(
  Object.entries(BUILTIN_TOOLS as unknown as BuiltinToolsMap).map(([name, entry]) => [
    name,
    {
      emoji: entry.emoji,
      description: entry.description,
      inputSchema: entry.inputSchema,
      requiresConfirmation: entry.requiresConfirmation,
    },
  ])
);

export const TOOL_CATALOG_JSON = JSON.stringify(TOOL_CATALOG, null, 2);
