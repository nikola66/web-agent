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
  "responses' ✓ — 'Always respond concisely' ✗). Procedures belong in skills, not memory. " +
  "Use `memory_forget` by exact key when a saved fact is stale, wrong, or the user asks you to forget it.";

export const SESSION_SEARCH_GUIDANCE =
  "When the user references something from a past conversation, you suspect cross-session context " +
  "exists, or you need to reconstruct where work left off, use `session_search` before asking " +
  "them to repeat themselves. Use keyword `query` for targeted recall; use `recent`, `latest`, " +
  "or `last session` for recency-only browse. Prior-session transcript may already appear in the " +
  "prompt — search when you need older or keyword-specific detail.";

export const WORKSPACE_BROWSE_GUIDANCE =
  "Workspace paths in `list_dir`, `read_file`, `find_files`, `grep`, and `tree` are **relative to " +
  "the workspace root** (`.` = top level). Never use `/` or host paths like `/home/...`. " +
  "**First browse step:** run `list_dir({\"path\":\".\"})` or `tree({\"path\":\".\"})` before assuming " +
  "files exist — profile workspaces are often agent-centric (AGENT.md, USER.md, projects/, work/) not " +
  "full app repos unless the user added them. Do not guess paths from training (e.g. src/agent/..., " +
  ".webagent/package.json); `package.json` when present is usually at `.` not under `.webagent/`. " +
  "`grep` **`root`** is a directory to recurse (default `.`) or a single file path to search. " +
  "`grep` / `find_files` use **`pattern`**; **`query`** is only for `session_search`. " +
  "Use `list_dir` for one directory; `find_files` to locate a file by name.";

export const TOOL_JSON_ARGS_GUIDANCE =
  "Tool arguments must be plain JSON with the schema keys each tool declares — do not swap names " +
  "(grep/find_files: `pattern`; session_search: `query`; read_file/list_dir/tree: `path` or `root`; " +
  "skill_view/skill_manage: `name` — not `slug`). " +
  "Examples: {\"pattern\":\"TODO\"}, {\"query\":\"last outreach\"}, {\"path\":\".\"}. " +
  "Do not escape property names and do not wrap values in extra quote layers.";

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

export const SCRIPT_PORTING_GUIDANCE =
  "Nodebox runs JavaScript only — no `python`, `pip`, or POSIX shell. When a skill references Python scripts or HTTP clients: map `requests.get` → `web_fetch` (+ `headers`), `requests.post`/GraphQL → `web_post`; use `run_shell` only for local `node` scripts (not axios/fetch one-liners). Call `skill_view` **`http-api`** for REST/GraphQL shapes, **`script-porting`** for Python ports, or `python_to_node` before shell/API steps.";

export const HTTP_API_GUIDANCE =
  "REST GET → `web_fetch` with `url` + optional `headers` (Bearer). POST / GraphQL → `web_post` with `url`, `body`, `headers`. " +
  "Do not invent GraphQL root fields — read the API schema or `skill_view` **`http-api`**. " +
  "On `ok: false` or GraphQL `errors`, read the error message and fix the call once; never loop axios/shell retries for HTTP.";

export const MEMORY_SPILL_RECOVERY_GUIDANCE =
  "**Internal memory paths (do not scavenge):** `memory/snapshots/` = oversized tool-result spill only; " +
  "`memory/runs/` = agent turn logs (tool names/errors), not API payloads. Never `list_dir`, `find_files`, or `grep` under those trees to recover HTTP data. " +
  "When compact tool output shows `result_ref`, `read_file` that exact path once (content is auto-unwrapped). If missing/stale/nested, rerun `web_fetch`/`web_post`/`grep` on real project paths — not `run_shell head` on memory files. " +
  "For prior chat context use `session_search`, not raw run JSON.";

export function buildMemoryLayerGuidanceBlock(toolNames: string[] = []): string {
  const tools = new Set(
    (toolNames || []).map((name) => String(name || "").trim()).filter(Boolean)
  );
  const parts: string[] = [];
  if (tools.has("memory_save") || tools.has("memory_recall") || tools.has("memory_search") || tools.has("memory_forget")) {
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
    tools.has("read_file") ||
    tools.has("find_files") ||
    tools.has("grep") ||
    tools.has("tree")
  ) {
    parts.push(WORKSPACE_BROWSE_GUIDANCE);
  }
  if (tools.has("skill_manage") || tools.has("skill_bulk_save")) {
    parts.push(SKILLS_GUIDANCE);
  }
  if (tools.has("run_shell")) {
    parts.push(SCRIPT_PORTING_GUIDANCE);
  }
  if (tools.has("web_fetch") && tools.has("web_post")) {
    parts.push(HTTP_API_GUIDANCE);
  }
  if (tools.has("read_file") || tools.has("grep") || tools.has("find_files") || tools.has("list_dir")) {
    parts.push(MEMORY_SPILL_RECOVERY_GUIDANCE);
  }
  if (!parts.length) return "";
  return `\n\n# Memory layers\n${parts.join("\n\n")}`;
}
