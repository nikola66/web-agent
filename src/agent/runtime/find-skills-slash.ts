/** Synthetic user message for `/find-skills` turns (UI shows raw `/find-skills …`). */
export function buildFindSkillsModeUserPrompt(query: string) {
  const queryText =
    String(query || "").trim() ||
    "Infer the skill-discovery query from the recent conversation and the latest user message.";
  return [
    "The user invoked **find-skills mode** via `/find-skills`. Follow it strictly for this turn only.",
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
