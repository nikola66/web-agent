/** If `input` is a find-skills slash command, return the synthetic prompt; otherwise null. */
export function rewriteFindSkillsSlashUserMessage(input: string): string | null {
  const trimmed = String(input ?? "").trim();
  if (trimmed === "/find_skills" || trimmed.startsWith("/find_skills ")) {
    const query = trimmed === "/find_skills" ? "" : trimmed.slice("/find_skills ".length).trim();
    return buildFindSkillsModeUserPrompt(query, "slash");
  }
  return null;
}

const FIND_SKILLS_NEGATIVE_RE = /\bskillfully\b|\bskill issue\b/i;

const FIND_SKILLS_INTENT_RE = new RegExp(
  [
    "\\b(?:find|search|discover|recommend|suggest|lookup|look up)\\b[^.!?]{0,80}\\b(?:agent\\s+)?skills?\\b",
    "\\b(?:best|top|good)\\b[^.!?]{0,60}\\b(?:agent\\s+)?skills?\\b",
    "\\b(?:install|add)\\b[^.!?]{0,40}\\bskills?\\b[^.!?]{0,40}\\b(?:for|to)\\b",
    "\\bagent\\s+skills?\\b[^.!?]{0,80}\\b(?:for|about|audit|seo|research)\\b",
  ].join("|"),
  "i"
);

/** Natural-language skill discovery (no slash). */
export function rewriteFindSkillsIntentUserMessage(input: string): string | null {
  const trimmed = String(input ?? "").trim();
  if (!trimmed || trimmed.startsWith("/")) return null;
  if (FIND_SKILLS_NEGATIVE_RE.test(trimmed)) return null;
  if (!FIND_SKILLS_INTENT_RE.test(trimmed)) return null;
  return buildFindSkillsModeUserPrompt(trimmed, "intent");
}

/** Slash or natural-language find-skills routing. */
export function resolveFindSkillsUserMessage(input: string): string | null {
  return rewriteFindSkillsSlashUserMessage(input) ?? rewriteFindSkillsIntentUserMessage(input);
}

/** Synthetic user message for find-skills turns (UI shows raw user text). */
export function buildFindSkillsModeUserPrompt(query: string, source: "slash" | "intent" = "slash") {
  const queryText =
    String(query || "").trim() ||
    "Infer the skill-discovery query from the recent conversation and the latest user message.";
  const intro =
    source === "slash"
      ? "The user invoked **find-skills mode** via `/find_skills`. Follow it strictly for this turn only."
      : "The user asked to discover agent skills in natural language. Treat this as **find-skills mode** for this turn only.";
  return [
    intro,
    "",
    `**Search query:** ${queryText}`,
    "",
    "First call `skill_view` with `{\"name\":\"find-skills\"}` to load the full procedure, then execute it.",
    "",
    "**Deliverable:** exactly **5** online agent skills ranked by installs, stars, or votes (deduped across registries).",
    "",
    "**Registries to search:** skills.sh, SkillsMP, Cursor Marketplace, cursor.directory, GitHub SKILL.md repos.",
    "",
    "**Minimum:** ≥4 `web_search` + ≥3 `web_fetch` before the final answer. Present a pipe table with popularity metrics and install links.",
    "",
    "Do **not** install without explicit user confirmation — offer `/skills install <url>` after the table.",
  ].join("\n");
}
