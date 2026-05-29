import type { ToolVisibility } from "./definition.js";
import { DEFERRED_TOOL_GROUPS, isDeferredGroupToolName } from "./tool-groups.js";

export type ToolVisibilityMeta = {
  visibility?: ToolVisibility;
  llmVisible?: boolean;
  toolGroup?: string;
};

export function resolveToolVisibility(
  name: string,
  meta?: ToolVisibilityMeta | null
): ToolVisibility {
  if (meta?.visibility) return meta.visibility;
  if (meta?.llmVisible === false) return "hidden";
  if (String(name || "").startsWith("mcp_")) return "deferred";
  if (isDeferredGroupToolName(String(name || ""))) return "deferred";
  if (meta?.toolGroup && DEFERRED_TOOL_GROUPS.has(meta.toolGroup)) return "deferred";
  return "active";
}

export function isDeferredOrHiddenVisibility(visibility: ToolVisibility): boolean {
  return visibility === "deferred" || visibility === "hidden";
}

export function catalogEntryIsDeferred(
  name: string,
  meta?: ToolVisibilityMeta | null
): boolean {
  return isDeferredOrHiddenVisibility(resolveToolVisibility(name, meta));
}
