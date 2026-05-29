/** Hermes-style memory/session/skills guidance (ported from hermes-agent prompt_builder.py). */

export const MEMORY_GUIDANCE =
  "You have persistent memory across sessions, stored only in this browser (IndexedDB) — " +
  "nothing is sent to a server. Save durable facts with `memory_save`: user preferences, " +
  "URLs, API tokens, environment details, tool quirks, and stable conventions. When the user " +
  "asks you to remember credentials or secrets, save them as key=value facts — do not refuse. " +
  "Memory is injected into every turn, so keep it compact and focused on facts that will still " +
  "matter later. Prioritize what reduces future user steering.\n" +
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
  "Workspace paths in `browse_workspace`, `read_file`, and `grep` are **relative to " +
  "the workspace root** (`.` = top level). Never use `/` or host paths like `/home/...`. " +
  "**First browse step:** run `browse_workspace({\"action\":\"list\",\"path\":\".\"})` or " +
  "`browse_workspace({\"action\":\"tree\",\"path\":\".\"})` before assuming files exist. " +
  "`browse_workspace` **`action`**: `list` (one directory), `tree` (layout), `find` (cross-tree by name). " +
  "`grep` **`root`** is a directory to recurse (default `.`) or a single file path to search. " +
  "`grep` / browse `find` use **`pattern`**; **`query`** is only for `session_search`.";

export const TOOL_JSON_ARGS_GUIDANCE =
  "Tool arguments must be plain JSON with the schema keys each tool declares — do not swap names " +
  "(grep/browse find: `pattern`; session_search: `query`; read_file/browse_workspace: `path` or `root`; " +
  "skill (action=view/manage): `name` — not `slug`). " +
  "Examples: {\"pattern\":\"TODO\"}, {\"query\":\"last outreach\"}, {\"path\":\".\"}. " +
  "Do not escape property names and do not wrap values in extra quote layers.";

export const SESSION_MEMORY_GUIDANCE =
  "Use `session_memory_append` for rolling investigation notes, temporary decisions, and artifact " +
  "pointers during the current stretch of work. Call `session_memory_list` to read recent session " +
  "notes before guessing. Do NOT store durable user preferences in session memory — use " +
  "`memory_save`. For archived prior sessions, use `session_search`.";

export const SKILLS_GUIDANCE =
  "After completing a complex task (5+ tool calls), fixing a tricky error, or discovering a " +
  "non-trivial workflow, save the approach with `skill` (action=manage) so you can reuse " +
  "it next time. When using a skill and finding it outdated or wrong, patch it immediately — " +
  "don't wait to be asked. Skills capture procedures; memory captures durable facts.";

export const SCRIPT_PORTING_GUIDANCE =
  "Nodebox has no POSIX shell or system pip. For Python skills, use `run_python` for stdlib/Pyodide-compatible scripts and `python3 ...` only as a run_shell alias. Map REST/CMS HTTP to `web_fetch`/`web_post`; inside reusable Python use `webagent.http` (proxy-backed) or Pyodide-safe parsing only. Do not use axios/fetch shell one-liners or native pip/subprocess assumptions.";

export const HTTP_API_GUIDANCE =
  "Bytes move runtime→proxy→upstream; you see metadata (`bytes`, `path`, `file_id`) — never base64 in tool args or chat. " +
  "REST GET → `web_fetch`; binary download → `web_fetch` + `save_to`. JSON/GraphQL/PATCH → `web_post`. " +
  "CMS `/files` or single file upload → `web_upload` with `source_url` or `file_path`. Mixed form + file(s) → `web_post.multipart`. " +
  "Python script uploads → `webagent.http.upload_file` in `run_python`. Read `skill` (action=view) **`http-api`** before first API call. " +
  "OAuth-connected SaaS (Gmail, LinkedIn, Slack, …) → `skill` (action=view) **`composio-oauth`**, then `composio_status` — not raw `web_post`. " +
  "On `ok: false` or GraphQL `errors`, fix once — do not loop shell/axios or read_file snapshot recovery for uploads.";

export const COMPOSIO_SAAS_GUIDANCE =
  "For the user's connected OAuth apps (Gmail, LinkedIn, Slack, HubSpot, …): call `skill` (action=view) **`composio-oauth`**, then `composio_status` before answering about access. " +
  "If `connected_accounts` includes the app, use `composio_action` — do not tell the user to connect OAuth or claim 'no access' without checking status. " +
  "Offer `composio_connect` only when status shows the app is missing from `connected_accounts`. " +
  "When `configured: false`, setup is Settings → Composio → `composio_api_key` — do not web_search or web_fetch repo/GitHub docs for setup.";

export const MEMORY_SPILL_RECOVERY_GUIDANCE =
  "**Internal memory paths (do not scavenge):** `memory/snapshots/` = oversized tool-result spill only; " +
  "`memory/runs/` = agent turn logs (tool names/errors), not API payloads. Never `list_dir`, `find_files`, or `grep` under those trees to recover HTTP data. " +
  "When compact tool output shows `list_digest`, use it — do not read_file the spill. When only `result_ref` is present, read_file that path once (auto-unwrapped). If the body is HTML or invalid JSON, rerun `web_fetch`/`web_post` with Authorization — never JSON.parse spill files. " +
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
    tools.has("browse_workspace") ||
    tools.has("list_dir") ||
    tools.has("read_file") ||
    tools.has("find_files") ||
    tools.has("grep") ||
    tools.has("tree")
  ) {
    parts.push(WORKSPACE_BROWSE_GUIDANCE);
  }
  if (tools.has("skill")) {
    parts.push(SKILLS_GUIDANCE);
  }
  if (tools.has("web_fetch") || tools.has("web_post") || tools.has("web_upload")) {
    parts.push(HTTP_API_GUIDANCE);
  }
  if (tools.has("composio_status") || tools.has("composio_action") || tools.has("composio_connect")) {
    parts.push(COMPOSIO_SAAS_GUIDANCE);
  }
  if (tools.has("read_file") || tools.has("grep") || tools.has("browse_workspace") || tools.has("find_files") || tools.has("list_dir")) {
    parts.push(MEMORY_SPILL_RECOVERY_GUIDANCE);
  }
  if (!parts.length) return "";
  return `\n\n# Memory layers\n${parts.join("\n\n")}`;
}
