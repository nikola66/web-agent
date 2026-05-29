export const TOOL_GROUPS: Record<string, readonly string[]> = {
  core: [
    "read_file",
    "grep",
    "browse_workspace",
    "write_file",
    "edit_file",
    "multi_edit",
    "apply_patch",
    "run_python",
    "run_shell",
    "web_fetch",
    "web_post",
    "web_upload",
    "web_search",
    "skill",
    "todo_write",
    "system_info",
    "tool_search",
    "tool_activate",
  ],
  filesystem_mutate: ["make_dir", "delete_file", "move_file", "file_diff"],
  memory: ["memory_save", "memory_recall", "memory_search", "memory_forget"],
  session: ["session_memory_append", "session_memory_list", "session_search"],
  skills: ["capability_list"],
  wiki: ["wiki_setup", "wiki_sync", "wiki_search"],
  composio: ["composio_connect", "composio_status", "composio_action"],
  cron: ["cron_register", "cron_list"],
  multimodal: ["vision_analyze", "audio_analyze", "youtube_transcribe", "image_info"],
  documents: ["pdf_extract", "docx_extract"],
  archives: ["extract_archive", "archive_list"],
  delivery: ["artifact_present", "email"],
};

export const DEFERRED_TOOL_GROUPS = new Set([
  "wiki",
  "cron",
  "multimodal",
  "documents",
  "archives",
  "delivery",
  "composio",
]);

const DEFERRED_GROUP_TOOL_NAMES = new Set<string>(
  [...DEFERRED_TOOL_GROUPS].flatMap((group) => [...(TOOL_GROUPS[group] || [])])
);

export function isDeferredGroupToolName(name: string): boolean {
  return DEFERRED_GROUP_TOOL_NAMES.has(String(name || ""));
}
