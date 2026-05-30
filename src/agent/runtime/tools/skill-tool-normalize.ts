import { expandSkillBulkSaveArgs } from "./skill-bulk-args.js";

const LEGACY_SKILL_TOOL_NAMES = new Set([
  "skill_list",
  "skill_view",
  "skill_manage",
  "skill_bulk_save",
  "skill_bulk_import",
  "bulk_import",
  "bulk_import_skills",
]);

const BULK_SKILL_TOOL_NAMES = new Set(["skill_bulk_save", "skill_bulk_import", "bulk_import", "bulk_import_skills"]);

export function isLegacySkillToolName(name: string): boolean {
  return LEGACY_SKILL_TOOL_NAMES.has(String(name || "").trim());
}

export function resolveLegacySkillToolName(name: string, knownTools: Set<string>): string {
  const trimmed = String(name || "").trim();
  if (knownTools.has(trimmed)) return trimmed;
  if (knownTools.has("skill") && isLegacySkillToolName(trimmed)) return "skill";
  return trimmed;
}

export function normalizeSkillToolCall(
  name: string,
  args: Record<string, unknown>,
  rawName = name
): { name: string; args: Record<string, unknown> } {
  const tool = String(name || "").trim();
  const a = args && typeof args === "object" && !Array.isArray(args) ? { ...args } : {};
  const raw = String(rawName || tool).trim().toLowerCase();

  if (tool === "skill" && !String(a.action || "").trim()) {
    if (raw === "skill_list") return { name: "skill", args: { ...a, action: "list" } };
    if (raw === "skill_view") return { name: "skill", args: { ...a, action: "view" } };
    if (BULK_SKILL_TOOL_NAMES.has(raw)) {
      return { name: "skill", args: { action: "bulk", ...expandSkillBulkSaveArgs(a) } };
    }
    if (raw === "skill_save" || raw === "skill_create") {
      return { name: "skill", args: { ...a, action: "manage", manage_action: "create" } };
    }
    if (raw === "skill_patch") return { name: "skill", args: { ...a, action: "manage", manage_action: "patch" } };
    if (raw === "skill_edit") return { name: "skill", args: { ...a, action: "manage", manage_action: "edit" } };
  }

  if (tool === "skill_list" || (tool === "skill" && String(a.action || "").toLowerCase() === "list")) {
    return { name: "skill", args: { ...a, action: "list" } };
  }
  if (tool === "skill_view" || (tool === "skill" && String(a.action || "").toLowerCase() === "view")) {
    return { name: "skill", args: { ...a, action: "view" } };
  }
  if (
    BULK_SKILL_TOOL_NAMES.has(tool) ||
    BULK_SKILL_TOOL_NAMES.has(raw) ||
    (tool === "skill" && String(a.action || "").toLowerCase() === "bulk")
  ) {
    return { name: "skill", args: { ...expandSkillBulkSaveArgs(a), action: "bulk" } };
  }
  if (tool === "skill_manage") {
    let manageAction = String(a.action ?? "").trim();
    if (!manageAction) {
      const from = String(rawName || "").trim().toLowerCase();
      if (from === "skill_save" || from === "skill_create") manageAction = "create";
      else if (from === "skill_patch") manageAction = "patch";
      else if (from === "skill_edit") manageAction = "edit";
      else if (typeof a.content === "string" && a.content.trim()) manageAction = "create";
      else if (typeof a.old_string === "string") manageAction = "patch";
    }
    if (!a.file_path && typeof a.path === "string") a.file_path = a.path;
    const { action: _drop, ...rest } = a;
    return { name: "skill", args: { ...rest, action: "manage", manage_action: manageAction } };
  }
  if (tool === "skill") {
    const action = String(a.action || "").trim().toLowerCase();
    if (action === "bulk") {
      return { name: "skill", args: { ...expandSkillBulkSaveArgs(a), action: "bulk" } };
    }
    if (action === "manage") {
      const manageAction = String(a.manage_action ?? a.operation ?? "").trim();
      if (manageAction) return { name: "skill", args: { ...a, action: "manage", manage_action: manageAction } };
    }
  }
  return { name: tool, args: a };
}