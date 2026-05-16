import { WIKI_DEFAULT_ROOT } from "./tools/wiki-tools.js";

/** Synthetic prompt for `/wiki-setup` → forces `wiki_setup` tool use. */
export function buildWikiSetupUserPrompt(rest: string) {
  const root_path = String(rest || "").trim() || WIKI_DEFAULT_ROOT;
  return [
    "The user invoked **`/wiki-setup`**. For this turn, call the **`wiki_setup`** tool **exactly once** first.",
    `Use these JSON arguments: ${JSON.stringify({
      root_path,
      mode: "para_plus_wiki",
      overwrite: false,
    })}`,
    "Then reply with a brief summary of created vs skipped paths.",
  ].join("\n");
}

/** Synthetic prompt for `/wiki-sync` → forces `wiki_sync` tool use. */
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
    "The user invoked **`/wiki-sync`**. Call **`wiki_sync`** **exactly once** first.",
    `Use these JSON arguments: ${JSON.stringify({
      root_path,
      scope,
      max_items: 40,
    })}`,
    "Then summarize counts and touched files briefly.",
  ].join("\n");
}

/** Synthetic prompt for `/wiki-search` → forces `wiki_search` tool use. */
export function buildWikiSearchUserPrompt(rest: string) {
  const query = String(rest || "").trim();
  if (!query) {
    return [
      "The user invoked **`/wiki-search`** without a query.",
      "Ask them for keywords to search the wiki vault, or suggest running `/wiki-setup` if no vault exists.",
    ].join("\n");
  }
  return [
    "The user invoked **`/wiki-search`**. Call **`wiki_search`** **exactly once** first.",
    `Use these JSON arguments: ${JSON.stringify({
      query,
      root_path: WIKI_DEFAULT_ROOT,
      limit: 10,
    })}`,
    "Then summarize the strongest matches with workspace-relative paths.",
  ].join("\n");
}
