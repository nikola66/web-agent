import { WIKI_DEFAULT_ROOT } from "./tools/wiki-tools.js";

/** Synthetic prompt for `/wiki_setup` → forces `wiki_setup` tool use. */
export function buildWikiSetupUserPrompt(rest: string) {
  const root_path = String(rest || "").trim() || WIKI_DEFAULT_ROOT;
  return [
    "The user invoked **`/wiki_setup`**. For this turn, call the **`wiki_setup`** tool **exactly once** first.",
    `Use these JSON arguments: ${JSON.stringify({
      root_path,
      mode: "para_plus_wiki",
      overwrite: false,
    })}`,
    "Then reply with a brief summary of created vs skipped paths.",
  ].join("\n");
}

/** Synthetic prompt for `/wiki_sync` → forces `wiki_sync` tool use. */
export function buildWikiSyncUserPrompt(rest: string) {
  const trimmed = String(rest || "").trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  let scope = "all";
  let root_path = WIKI_DEFAULT_ROOT;
  if (parts.length && ["facts", "session", "all"].includes(parts[0].toLowerCase())) {
    scope = parts[0].toLowerCase();
    root_path = parts.slice(1).join(" ").trim() || WIKI_DEFAULT_ROOT;
  } else if (parts.length) {
    root_path = trimmed;
  }
  return [
    "The user invoked **`/wiki_sync`**. Call **`wiki_sync`** **exactly once** first.",
    `Use these JSON arguments: ${JSON.stringify({
      root_path,
      scope,
      max_items: 40,
    })}`,
    "Then summarize counts and touched files briefly.",
  ].join("\n");
}

/** Synthetic prompt for `/wiki_search` → forces `wiki_search` tool use. */
export function buildWikiSearchUserPrompt(rest: string) {
  const query = String(rest || "").trim();
  if (!query) {
    return [
      "The user invoked **`/wiki_search`** without a query.",
      "Ask them for keywords to search the wiki vault, or suggest running `/wiki_setup` if no vault exists.",
    ].join("\n");
  }
  return [
    "The user invoked **`/wiki_search`**. Call **`wiki_search`** **exactly once** first.",
    `Use these JSON arguments: ${JSON.stringify({
      query,
      root_path: WIKI_DEFAULT_ROOT,
      limit: 10,
    })}`,
    "Then summarize the strongest matches with workspace-relative paths.",
  ].join("\n");
}

/** If `input` is a wiki slash command, return the synthetic tool-forcing user prompt; otherwise null. */
export function rewriteWikiSlashUserMessage(input: string): string | null {
  const trimmed = String(input ?? "").trim();
  if (trimmed === "/wiki_setup" || trimmed.startsWith("/wiki_setup ")) {
    const rest = trimmed === "/wiki_setup" ? "" : trimmed.slice("/wiki_setup ".length);
    return buildWikiSetupUserPrompt(rest);
  }
  if (trimmed === "/wiki_sync" || trimmed.startsWith("/wiki_sync ")) {
    const rest = trimmed === "/wiki_sync" ? "" : trimmed.slice("/wiki_sync ".length);
    return buildWikiSyncUserPrompt(rest);
  }
  if (trimmed === "/wiki_search" || trimmed.startsWith("/wiki_search ")) {
    const rest = trimmed === "/wiki_search" ? "" : trimmed.slice("/wiki_search ".length);
    return buildWikiSearchUserPrompt(rest);
  }
  return null;
}
