/** Hermes-style memory/session/skills guidance (ported from hermes-agent prompt_builder.py). */

export const MEMORY_GUIDANCE =
  "You have persistent memory across sessions. Save durable facts with `memory_save`: user " +
  "preferences, environment details, tool quirks, and stable conventions. Memory is injected " +
  "into every turn, so keep it compact and focused on facts that will still matter later. " +
  "Prioritize what reduces future user steering.\n" +
  "Do NOT save task progress, session outcomes, completed-work logs, or temporary TODO state " +
  "to memory — use `session_search` or `session_memory_append` instead. Specifically: do not " +
  "record PR numbers, issue numbers, commit SHAs, 'fixed bug X', 'Phase N done', file counts, " +
  "or any artifact that will be stale in 7 days. If a fact will be stale in a week, it does " +
  "not belong in memory.\n" +
  "If you discovered a repeatable workflow, save it as a skill — not as a memory fact. " +
  "Write memories as declarative facts, not instructions to yourself ('User prefers concise " +
  "responses' ✓ — 'Always respond concisely' ✗). Procedures belong in skills, not memory.";

export const SESSION_SEARCH_GUIDANCE =
  "When the user references something from a past conversation, you suspect cross-session context " +
  "exists, or you need to reconstruct where work left off, use `session_search` before asking " +
  "them to repeat themselves. Use keyword `query` for targeted recall; use `recent`, `latest`, " +
  "or `last session` for recency-only browse. Prior-session transcript may already appear in the " +
  "prompt — search when you need older or keyword-specific detail.";

export const WORKSPACE_BROWSE_GUIDANCE =
  "Workspace paths in `list_dir`, `read_file`, `find_files`, `grep`, and `tree` are **relative to " +
  "the project root**. Use `.` to list the workspace root — never pass `/` or a host absolute path " +
  "(e.g. `/home/...`); those are rejected as escaping the workspace. " +
  "Use `list_dir` for one directory (optional single-level filter); use `find_files` for cross-tree name/glob search.";

export const TOOL_JSON_ARGS_GUIDANCE =
  "Tool arguments must be plain JSON objects with normal keys: {\"query\":\"keywords\"}, " +
  "{\"path\":\".\"}. Do not escape property names (wrong: {\"\\\"query\\\"\":\"...\"}) and do not " +
  "wrap string values in extra quote layers.";

export const SESSION_MEMORY_GUIDANCE =
  "Use `session_memory_append` for rolling investigation notes, temporary decisions, and artifact " +
  "pointers during the current stretch of work. Call `session_memory_list` to read recent session " +
  "notes before guessing. Do NOT store durable user preferences in session memory — use " +
  "`memory_save`. For archived prior sessions, use `session_search`.";

export const SKILLS_GUIDANCE =
  "After completing a complex task (5+ tool calls), fixing a tricky error, or discovering a " +
  "non-trivial workflow, save the approach with `skill_manage` so you can reuse " +
  "it next time. When using a skill and finding it outdated or wrong, patch it immediately — " +
  "don't wait to be asked. Skills capture procedures; memory captures durable facts.";

export function buildMemoryLayerGuidanceBlock(toolNames: string[] = []): string {
  const tools = new Set(
    (toolNames || []).map((name) => String(name || "").trim()).filter(Boolean)
  );
  const parts: string[] = [];
  if (tools.has("memory_save") || tools.has("memory_recall") || tools.has("memory_search")) {
    parts.push(MEMORY_GUIDANCE);
  }
  if (tools.has("session_search")) {
    parts.push(SESSION_SEARCH_GUIDANCE);
  }
  if (tools.has("session_memory_append") || tools.has("session_memory_list")) {
    parts.push(SESSION_MEMORY_GUIDANCE);
  }
  if (
    tools.has("session_search") ||
    tools.has("session_memory_append") ||
    tools.has("session_memory_list")
  ) {
    parts.push(TOOL_JSON_ARGS_GUIDANCE);
  }
  if (
    tools.has("list_dir") ||
    tools.has("find_files") ||
    tools.has("grep") ||
    tools.has("tree")
  ) {
    parts.push(WORKSPACE_BROWSE_GUIDANCE);
  }
  if (tools.has("skill_manage") || tools.has("skill_bulk_save")) {
    parts.push(SKILLS_GUIDANCE);
  }
  if (!parts.length) return "";
  return `\n\n# Memory layers\n${parts.join("\n\n")}`;
}
