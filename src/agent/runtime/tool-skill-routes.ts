export type ToolSkillRoute = {
  tool: string;
  skill: string;
  aliasOf?: string;
  visibilityNote?: string;
};

export const TOOL_SKILL_ROUTES: ToolSkillRoute[] = [
  { tool: "apply_patch", skill: "browser-runtime-map" },
  { tool: "archive_list", skill: "browser-runtime-map" },
  { tool: "artifact_present", skill: "artifact-delivery" },
  { tool: "audio_analyze", skill: "multimodal-ingest" },
  { tool: "browse_workspace", skill: "browser-runtime-map" },
  { tool: "composio_action", skill: "composio-oauth" },
  { tool: "composio_connect", skill: "composio-oauth" },
  { tool: "composio_status", skill: "composio-oauth" },
  { tool: "cron_list", skill: "heartbeat-cron" },
  { tool: "cron_register", skill: "heartbeat-cron" },
  { tool: "delete_file", skill: "browser-runtime-map" },
  { tool: "docx_extract", skill: "multimodal-ingest" },
  { tool: "edit_file", skill: "browser-runtime-map" },
  { tool: "email", skill: "artifact-delivery" },
  { tool: "extract_archive", skill: "browser-runtime-map" },
  { tool: "file_diff", skill: "browser-runtime-map" },
  {
    tool: "find_files",
    skill: "browser-runtime-map",
    aliasOf: "browse_workspace",
    visibilityNote: "Compatibility alias; prefer browse_workspace action=find.",
  },
  { tool: "grep", skill: "browser-runtime-map" },
  { tool: "image_info", skill: "multimodal-ingest" },
  {
    tool: "list_dir",
    skill: "browser-runtime-map",
    aliasOf: "browse_workspace",
    visibilityNote: "Compatibility alias; prefer browse_workspace action=list.",
  },
  { tool: "make_dir", skill: "project-scaffold" },
  { tool: "memory_forget", skill: "memory-layers" },
  { tool: "memory_recall", skill: "memory-layers" },
  { tool: "memory_save", skill: "memory-layers" },
  { tool: "memory_search", skill: "memory-layers" },
  { tool: "move_file", skill: "browser-runtime-map" },
  { tool: "multi_edit", skill: "browser-runtime-map" },
  { tool: "pdf_extract", skill: "multimodal-ingest" },
  { tool: "read_file", skill: "browser-runtime-map" },
  { tool: "run_python", skill: "pyodide-runtime" },
  { tool: "run_shell", skill: "browser-runtime-map" },
  { tool: "session_memory_append", skill: "memory-layers" },
  { tool: "session_memory_list", skill: "memory-layers" },
  { tool: "session_search", skill: "memory-layers" },
  { tool: "skill", skill: "web-agent-skill" },
  { tool: "system_info", skill: "browser-runtime-map" },
  { tool: "todo_write", skill: "task-execution" },
  { tool: "tool_activate", skill: "browser-runtime-map" },
  { tool: "tool_search", skill: "browser-runtime-map" },
  {
    tool: "tree",
    skill: "browser-runtime-map",
    aliasOf: "browse_workspace",
    visibilityNote: "Compatibility alias; prefer browse_workspace action=tree.",
  },
  { tool: "vision_analyze", skill: "multimodal-ingest" },
  { tool: "web_fetch", skill: "browser-runtime-map" },
  { tool: "web_post", skill: "browser-runtime-map" },
  { tool: "web_search", skill: "browser-runtime-map" },
  { tool: "web_upload", skill: "browser-runtime-map" },
  { tool: "wiki_search", skill: "memory-layers" },
  { tool: "wiki_setup", skill: "memory-layers" },
  { tool: "wiki_sync", skill: "memory-layers" },
  { tool: "write_file", skill: "browser-runtime-map" },
  { tool: "youtube_transcribe", skill: "multimodal-ingest" },
];

export const CANONICAL_TOOL_SKILL_BY_TOOL = Object.fromEntries(
  TOOL_SKILL_ROUTES.map((route) => [route.tool, route])
) as Record<string, ToolSkillRoute>;

export function canonicalSkillForTool(tool: string): ToolSkillRoute | null {
  return CANONICAL_TOOL_SKILL_BY_TOOL[String(tool || "").trim()] || null;
}
