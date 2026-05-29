import * as memoryModule from "../../memory/index.js";
import { logDebugEvent } from "../../logging/debug-log.js";
import { defineTool, strictObjectSchema } from "../definition.js";
import { expandSkillBulkSaveArgs } from "../skill-bulk-args.js";

type ToolCtx = { services?: { memory?: typeof memoryModule } };

function memoryServices(ctx: unknown) {
  return (ctx as ToolCtx)?.services?.memory ?? memoryModule;
}

const SKILL_VIEW_EXAMPLES = [
  { action: "view", name: "http-api" },
  { action: "view", name: "memory-layers" },
  { action: "view", name: "browser-runtime-map" },
];

const SKILL_BULK_EXAMPLES = [
  {
    action: "bulk",
    items: [
      {
        name: "demo_skill",
        content: "---\nname: demo\n---\nBody",
        description: "Example",
        files: [{ path: "references/notes.md", content: "# Notes\n" }],
      },
    ],
  },
  { action: "bulk", url: "https://example.com/raw/SKILL.md" },
];

export default defineTool({
  name: "skill",
  run: async (args: Record<string, unknown>, ctx) => {
    const memory = memoryServices(ctx);
    const action = String(args?.action ?? "").trim().toLowerCase();
    if (!action) throw new Error("`action` is required for skill (list | view | manage | bulk).");

    if (action === "list") {
      const skills = await memory.listSkills({
        query: typeof args?.query === "string" ? args.query.trim() : "",
        category: typeof args?.category === "string" ? args.category.trim() : "",
      });
      await logDebugEvent("skill", { subaction: "list", count: skills.length });
      return { ok: true, skills };
    }

    if (action === "view") {
      const nameRaw =
        typeof args?.name === "string"
          ? args.name.trim()
          : typeof args?.slug === "string"
            ? args.slug.trim()
            : "";
      if (!nameRaw) {
        throw new Error('`name` is required for skill view. Use {"action":"view","name":"<skill-slug>"}.');
      }
      const result = await memory.viewSkill({
        name: nameRaw,
        file_path: typeof args?.file_path === "string" ? args.file_path.trim() : undefined,
      });
      const { recordSkillView } = await import("../../skill-provenance.js");
      if (result.slug) await recordSkillView(String(result.slug));
      await logDebugEvent("skill", { subaction: "view", name: nameRaw, filePath: result.file_path });
      return result;
    }

    if (action === "bulk") {
      const normalized = expandSkillBulkSaveArgs(args);
      const items = Array.isArray(normalized?.items) ? normalized.items : null;
      if (!items || items.length === 0) {
        throw new Error(
          "`items` is required for skill bulk (non-empty array). Pass top-level `url`/`urls` or `items`: [{ url } | { name, content }, ...]."
        );
      }
      const result = await memory.bulkSaveSkills(items);
      await logDebugEvent("skill", {
        subaction: "bulk",
        count: items.length,
        saved: result.summary?.saved,
        failed: result.summary?.failed,
        blocked: result.summary?.blocked,
      });
      void import("../../turn.js").then((m) => m.invalidateToolNamesCache?.());
      return result;
    }

    if (action === "manage") {
      const manageAction =
        typeof args?.manage_action === "string"
          ? args.manage_action.trim()
          : typeof args?.operation === "string"
            ? args.operation.trim()
            : "";
      if (!manageAction) throw new Error("`manage_action` is required when action=manage.");
      const result = await memory.manageSkill({ ...args, action: manageAction });
      await logDebugEvent("skill", {
        subaction: "manage",
        manage_action: manageAction,
        name: typeof args?.name === "string" ? args.name.trim() : null,
        ok: result?.ok ?? null,
        blocked: result?.blocked ?? false,
      });
      if (result?.ok) void import("../../turn.js").then((m) => m.invalidateToolNamesCache?.());
      return result;
    }

    throw new Error(`skill: unsupported action "${action}". Use list | view | manage | bulk.`);
  },
  emoji: "🧩",
  toolGroup: "core",
  description:
    "Skills library: list, view, manage, or bulk-import SKILL.md procedures. " +
    "Actions: `list` (discover skills), `view` (load full SKILL.md — required arg `name`), " +
    "`manage` (create/patch/edit/delete/import via `manage_action`), `bulk` (batch URL or inline saves). " +
    "Manage applies immediately except delete; bulk requires approval.",
  inputSchema: strictObjectSchema(
    {
      action: {
        type: "string",
        enum: ["list", "view", "manage", "bulk"],
        description: "list | view | manage | bulk",
      },
      name: { type: "string", description: "Skill slug for view/manage." },
      file_path: { type: "string", description: "Optional support file path for view/manage write_file." },
      query: { type: "string", description: "Filter for list." },
      category: { type: "string", description: "Category filter for list or bulk URL imports." },
      manage_action: {
        type: "string",
        enum: [
          "create",
          "patch",
          "edit",
          "delete",
          "install_url",
          "import_url",
          "import_dir",
          "install_dir",
          "write_file",
          "remove_file",
        ],
        description: "Required when action=manage.",
      },
      operation: { type: "string", description: "Alias for manage_action." },
      content: { type: "string" },
      old_string: { type: "string" },
      new_string: { type: "string" },
      description: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      version: { type: "string" },
      absorbed_into: { type: "string" },
      url: { type: "string" },
      urls: { type: "array", items: { type: "string" } },
      path: { type: "string" },
      items: { type: "array", items: { type: "object", additionalProperties: true } },
    },
    ["action"],
    [
      { action: "list" },
      ...SKILL_VIEW_EXAMPLES,
      { action: "manage", manage_action: "create", name: "deploy-checklist", content: "# Deploy\n" },
      { action: "manage", manage_action: "install_url", url: "https://example.com/SKILL.md" },
      ...SKILL_BULK_EXAMPLES,
    ]
  ),
  requiresConfirmation: false,
});
