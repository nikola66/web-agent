import { PLANS_DIR_REL } from "./constants.js";

function slugFromGoal(goal: string) {
  const s = String(goal || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s.replace(/-+/g, "-");
}

function formatStamp(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Synthetic user message for `/plan` turns (shown to the model only; UI shows raw `/plan …`). */
export function buildPlanModeUserPrompt(goal: string, now = new Date()) {
  const trimmedGoal = String(goal || "").trim();
  const goalText =
    trimmedGoal ||
    "Infer the planning goal from the recent conversation and the workspace context.";
  const slug = slugFromGoal(trimmedGoal) || "plan";
  const relPath = `${PLANS_DIR_REL}/${formatStamp(now)}-${slug}.md`;

  return [
    "The user invoked **planning mode** via `/plan`. Follow it strictly for this turn only.",
    "",
    `**Goal:** ${goalText}`,
    "",
    "**Constraints:**",
    "- First **research** the workspace using read-only tools (e.g. list_dir, grep, read_file, tree, find_files) before finalizing the plan.",
    "- **Do not** implement the work: no write_file, edit_file, apply_patch, or mutating run_shell except to create the single plan markdown at the path below (write_file creates parent dirs).",
    "- Do **not** call make_dir for this plan path. `plans/` is canonical and write_file can create missing parents when needed.",
    "",
    "**Deliverables (in order):**",
    `1. write_file — save the full plan markdown to workspace-relative path: \`${relPath}\``,
    "2. artifact_present — same markdown: pass a short title, filename ending in .md, and the full markdown body so the host can show View/Download.",
    "",
    "**Plan document sections** (use ## headings): Goal; Assumptions; Approach; Step-by-step plan; Files likely to change; Tests/validation; Risks, tradeoffs, open questions.",
    "",
    "**Closing:** In your final assistant message (after tools), tell the user the saved path, and that they should reply on the **next turn** with e.g. \"Execute the plan\" or describe edits first—do not execute the plan in this turn.",
  ].join("\n");
}
