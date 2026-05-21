/** If `input` is a find-skills slash command, return the synthetic prompt; otherwise null. */
export function rewriteFindSkillsSlashUserMessage(input: string): string | null {
  const trimmed = String(input ?? "").trim();
  if (trimmed === "/find_skills" || trimmed.startsWith("/find_skills ")) {
    const query = trimmed === "/find_skills" ? "" : trimmed.slice("/find_skills ".length).trim();
    return buildFindSkillsModeUserPrompt(query);
  }
  return null;
}

/** Synthetic user message for `/find_skills` turns (UI shows raw `/find_skills …`). */
export function buildFindSkillsModeUserPrompt(query: string) {
  const queryText =
    String(query || "").trim() ||
    "Infer the skill-discovery query from the recent conversation and the latest user message.";
  return [
    "The user invoked **find-skills mode** via `/find_skills`. Follow it strictly for this turn only.",
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
