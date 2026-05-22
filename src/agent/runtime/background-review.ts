/**
 * Post-turn background memory/skill review (Hermes-style self-improvement loop).
 */

import { dim } from "./terminal-format.js";
import { logDebugEvent } from "./logging/debug-log.js";
import { emitSelfImprovementSummary } from "./identity/onboarding.js";
import { runWithSkillWriteOrigin } from "./skill-provenance.js";
import { errorMessage } from "./utils.js";

export const DEFAULT_SKILL_REVIEW_INTERVAL = Math.max(
  1,
  Number(process.env.WEBAGENT_SKILL_REVIEW_INTERVAL) || 8
);
export const DEFAULT_MEMORY_REVIEW_INTERVAL = Math.max(
  1,
  Number(process.env.WEBAGENT_MEMORY_REVIEW_INTERVAL) || 8
);
export const BACKGROUND_REVIEW_MAX_ROUNDS = Math.max(
  1,
  Number(process.env.WEBAGENT_BACKGROUND_REVIEW_MAX_ROUNDS) || 12
);

const MEMORY_TOOLS = new Set([
  "memory_save",
  "memory_search",
  "memory_recall",
  "session_memory_append",
  "session_memory_list",
]);
const SKILL_TOOLS = new Set([
  "skill_manage",
  "skill_list",
  "skill_view",
  "skill_bulk_save",
]);

let itersSinceSkill = 0;
let turnsSinceMemory = 0;

export function getSelfImproveCounters(): { itersSinceSkill: number; turnsSinceMemory: number } {
  return { itersSinceSkill, turnsSinceMemory };
}

export function resetSelfImproveCounters(): void {
  itersSinceSkill = 0;
  turnsSinceMemory = 0;
}

export function noteUserTurnStarted(): void {
  turnsSinceMemory += 1;
}

export function noteToolIteration(): void {
  itersSinceSkill += 1;
}

export function noteForegroundSkillWrite(): void {
  itersSinceSkill = 0;
}

export function noteForegroundMemoryWrite(): void {
  turnsSinceMemory = 0;
}

export type BackgroundReviewKind = "memory" | "skill" | "combined";

export type BackgroundReviewTriggerInput = {
  status: string;
  aborted?: boolean;
  executedToolsInTurn?: boolean;
  skillMutatingCalled?: boolean;
  usedTodoWrite?: boolean;
  usedPlanningGate?: boolean;
  estimatedStepsOverSix?: boolean;
  toolRoundCount?: number;
  toolCallCount?: number;
  finalVisibleText?: string;
  availableToolNames?: string[];
};

export type BackgroundReviewTriggerResult = {
  shouldReviewMemory: boolean;
  shouldReviewSkills: boolean;
  kind: BackgroundReviewKind | null;
};

export function evaluateBackgroundReviewTrigger(
  input: BackgroundReviewTriggerInput
): BackgroundReviewTriggerResult {
  const tools = new Set(input.availableToolNames || []);
  const hasMemoryTools = [...MEMORY_TOOLS].some((name) => tools.has(name));
  const hasSkillTools = [...SKILL_TOOLS].some((name) => tools.has(name));
  const completed =
    input.status === "completed" &&
    !input.aborted &&
    !!String(input.finalVisibleText || "").trim();

  let shouldReviewMemory = false;
  let shouldReviewSkills = false;

  if (completed && hasMemoryTools && turnsSinceMemory >= DEFAULT_MEMORY_REVIEW_INTERVAL) {
    shouldReviewMemory = true;
    turnsSinceMemory = 0;
  }
  const skillReviewDue =
    completed &&
    hasSkillTools &&
    !input.skillMutatingCalled &&
    itersSinceSkill >= DEFAULT_SKILL_REVIEW_INTERVAL;
  if (skillReviewDue) {
    shouldReviewSkills = true;
    itersSinceSkill = 0;
  }

  let kind: BackgroundReviewKind | null = null;
  if (shouldReviewMemory && shouldReviewSkills) kind = "combined";
  else if (shouldReviewMemory) kind = "memory";
  else if (shouldReviewSkills) kind = "skill";

  return { shouldReviewMemory, shouldReviewSkills, kind };
}

export const MEMORY_REVIEW_PROMPT =
  "Review the conversation above and consider saving to memory if appropriate.\n\n" +
  "Focus on:\n" +
  "1. Has the user revealed things about themselves — their persona, desires, " +
  "preferences, or personal details worth remembering?\n" +
  "2. Has the user expressed expectations about how you should behave, their work " +
  "style, or ways they want you to operate?\n\n" +
  "Layer choice:\n" +
  "- Durable facts (preferences, stable environment) → `memory_save`\n" +
  "- Investigation trail, temporary decisions, artifact pointers → `session_memory_append`\n" +
  "- Do NOT save task progress, PR/issue numbers, or stale-in-a-week artifacts to `memory_save`; " +
  "use `session_search` to recall those from archives.\n" +
  "- Repeatable workflows → skills (`skill_manage` create/patch), not memory facts.\n\n" +
  "If something stands out, save it with the appropriate tool. " +
  "If nothing is worth saving, reply 'Nothing to save.' and stop.";

export const SKILL_REVIEW_PROMPT =
  "Tools available in this pass (use these exact names only): `skill_list`, " +
  "`skill_view`, `skill_manage` (with `action`: create | patch | edit | write_file). " +
  "There is no `skill_save`, `skill_create`, or standalone `write_file` tool.\n\n" +
  "Review the conversation above and update the skill library. Be " +
  "ACTIVE — most sessions produce at least one skill update, even if " +
  "small. A pass that does nothing is a missed learning opportunity, " +
  "not a neutral outcome.\n\n" +
  "Target shape of the library: CLASS-LEVEL skills, each with a rich " +
  "SKILL.md and a `references/` directory for session-specific detail. " +
  "Not a long flat list of narrow one-session-one-skill entries. This " +
  "shapes HOW you update, not WHETHER you update.\n\n" +
  "Signals to look for (any one of these warrants action):\n" +
  "  • User corrected your style, tone, format, legibility, or " +
  "verbosity. Frustration signals like 'stop doing X', 'this is too " +
  "verbose', 'don't format like this', 'why are you explaining', " +
  "'just give me the answer', 'you always do Y and I hate it', or an " +
  "explicit 'remember this' are FIRST-CLASS skill signals, not just " +
  "memory signals. Update the relevant skill(s) to embed the " +
  "preference so the next session starts already knowing.\n" +
  "  • User corrected your workflow, approach, or sequence of steps. " +
  "Encode the correction as a pitfall or explicit step in the skill " +
  "that governs that class of task.\n" +
  "  • Non-trivial technique, fix, workaround, debugging path, or " +
  "tool-usage pattern emerged that a future session would benefit " +
  "from. Capture it.\n" +
  "  • A skill that got loaded or consulted this session turned out " +
  "to be wrong, missing a step, or outdated. Patch it NOW.\n\n" +
  "Preference order — prefer the earliest action that fits, but do " +
  "pick one when a signal above fired:\n" +
  "  1. UPDATE A CURRENTLY-LOADED SKILL. Look back through the " +
  "conversation for skills the user loaded via /skill-name or you " +
  "read via skill_view. If any of them covers the territory of the " +
  "new learning, PATCH that one first. It is the skill that was in " +
  "play, so it's the right one to extend.\n" +
  "  2. UPDATE AN EXISTING UMBRELLA (via skill_list + skill_view). " +
  "If no loaded skill fits but an existing class-level skill does, " +
  "patch it. Add a subsection, a pitfall, or broaden a trigger.\n" +
  "  3. ADD A SUPPORT FILE under an existing umbrella. Skills can be " +
  "packaged with three kinds of support files — use the right " +
  "directory per kind:\n" +
  "     • `references/<topic>.md` — session-specific detail (error " +
  "transcripts, reproduction recipes, provider quirks) AND " +
  "condensed knowledge banks: quoted research, API docs, external " +
  "authoritative excerpts, or domain notes you found while working " +
  "on the problem. Write it concise and for the value of the task, " +
  "not as a full mirror of upstream docs.\n" +
  "     • `templates/<name>.<ext>` — starter files meant to be " +
  "copied and modified (boilerplate configs, scaffolding, a " +
  "known-good example the agent can reproduce with modifications).\n" +
  "     • `scripts/<name>.<ext>` — statically re-runnable actions " +
  "the skill can invoke directly (verification scripts, fixture " +
  "generators, deterministic probes, anything the agent should run " +
  "rather than hand-type each time).\n" +
  "     Add support files via skill_manage action=write_file with " +
  "file_path starting 'references/', 'templates/', or 'scripts/'. " +
  "The umbrella's SKILL.md should gain a one-line pointer to any " +
  "new support file so future agents know it exists.\n" +
  "  4. CREATE A NEW CLASS-LEVEL UMBRELLA SKILL when no existing " +
  "skill covers the class. The name MUST be at the class level. " +
  "The name MUST NOT be a specific PR number, error string, feature " +
  "codename, library-alone name, or 'fix-X / debug-Y / audit-Z-today' " +
  "session artifact. If the proposed name only makes sense for " +
  "today's task, it's wrong — fall back to (1), (2), or (3).\n\n" +
  "User-preference embedding (important): when the user expressed a " +
  "style/format/workflow preference, the update belongs in the " +
  "SKILL.md body, not just in memory. Memory captures 'who the user " +
  "is and what the current situation and state of your operations " +
  "are'; skills capture 'how to do this class of task for this " +
  "user'. When they complain about how you handled a task, the " +
  "skill that governs that task needs to carry the lesson.\n\n" +
  "If you notice two existing skills that overlap, note it in your " +
  "reply — the background curator handles consolidation at scale.\n\n" +
  "Protected skills (DO NOT edit these):\n" +
  "  • Bundled skills (shipped with Web Agent, e.g. 'web-agent-skill', category bundled).\n" +
  "  • URL-imported skills (installed via skill_manage / skill_bulk_save import).\n" +
  "  • Pinned skills (marked in .webagent/skills/.usage.json).\n" +
  "If the only skills that need updating are protected, say\n" +
  "'Nothing to save.' and stop.\n\n" +
  "Do NOT capture (these become persistent self-imposed constraints " +
  "that bite you later when the environment changes):\n" +
  "  • Environment-dependent failures: missing binaries, fresh-install " +
  "errors, post-migration path mismatches, 'command not found', " +
  "unconfigured credentials, uninstalled packages. The user can fix " +
  "these — they are not durable rules.\n" +
  "  • Negative claims about tools or features ('browser tools do not " +
  "work', 'X tool is broken', 'cannot use Y from run_shell'). These " +
  "harden into refusals the agent cites against itself for months " +
  "after the actual problem was fixed.\n" +
  "  • Session-specific transient errors that resolved before the " +
  "conversation ended. If retrying worked, the lesson is the retry " +
  "pattern, not the original failure.\n" +
  "  • One-off task narratives. A user asking 'summarize today's " +
  "market' or 'analyze this PR' is not a class of work that warrants " +
  "a skill.\n\n" +
  "If a tool failed because of setup state, capture the FIX (install " +
  "command, config step, env var to set) under an existing setup or " +
  "troubleshooting skill — never 'this tool does not work' as a " +
  "standalone constraint.\n\n" +
  "'Nothing to save.' is a real option but should NOT be the " +
  "default. If the session ran smoothly with no corrections and " +
  "produced no new technique, just say 'Nothing to save.' and stop. " +
  "Otherwise, act.";

export const COMBINED_REVIEW_PROMPT =
  "Tools available in this pass (exact names only): memory_save, session_memory_append, " +
  "memory_search, memory_recall, session_memory_list, skill_list, skill_view, skill_manage " +
  "(action: create | patch | edit | write_file). No skill_save/skill_create/standalone write_file.\n\n" +
  "Review the conversation above and update two things:\n\n" +
  "**Memory**: who the user is. Did the user reveal persona, " +
  "desires, preferences, personal details, or expectations about " +
  "how you should behave? Save facts about the user and durable " +
  "preferences with `memory_save`. Use `session_memory_append` only for " +
  "rolling session notes — not durable facts.\n\n" +
  "**Skills**: how to do this class of task. Be ACTIVE — most " +
  "sessions produce at least one skill update. A pass that does " +
  "nothing is a missed learning opportunity, not a neutral outcome.\n\n" +
  "Target shape of the skill library: CLASS-LEVEL skills with a rich " +
  "SKILL.md and a `references/` directory for session-specific detail. " +
  "Not a long flat list of narrow one-session-one-skill entries.\n\n" +
  "Signals that warrant a skill update (any one is enough):\n" +
  "  • User corrected your style, tone, format, legibility, " +
  "verbosity, or approach. Frustration is a FIRST-CLASS skill " +
  "signal, not just a memory signal. 'stop doing X', 'don't format " +
  "like this', 'I hate when you Y' — embed the lesson in the skill " +
  "that governs that task so the next session starts fixed.\n" +
  "  • Non-trivial technique, fix, workaround, or debugging path " +
  "emerged.\n" +
  "  • A skill that was loaded or consulted turned out wrong, " +
  "missing, or outdated — patch it now.\n\n" +
  "Preference order for skills — pick the earliest that fits:\n" +
  "  1. UPDATE A CURRENTLY-LOADED SKILL. Check what skills were " +
  "loaded via /skill-name or skill_view in the conversation. If one " +
  "of them covers the learning, PATCH it first. It was in play; " +
  "it's the right place.\n" +
  "  2. UPDATE AN EXISTING UMBRELLA (skill_list + skill_view to " +
  "find the right one). Patch it.\n" +
  "  3. ADD A SUPPORT FILE under an existing umbrella via " +
  "skill_manage action=write_file. Three kinds: " +
  "`references/<topic>.md` for session-specific detail OR condensed " +
  "knowledge banks (quoted research, API docs excerpts, domain " +
  "notes) written concise and task-focused; `templates/<name>.<ext>` " +
  "for starter files meant to be copied and modified; " +
  "`scripts/<name>.<ext>` for statically re-runnable actions " +
  "(verification, fixture generators, probes). Add a one-line " +
  "pointer in SKILL.md so future agents find them.\n" +
  "  4. CREATE A NEW CLASS-LEVEL UMBRELLA when nothing exists. " +
  "Name at the class level — NOT a PR number, error string, " +
  "codename, library-alone name, or 'fix-X / debug-Y' session " +
  "artifact. If the name only fits today's task, fall back to (1), " +
  "(2), or (3).\n\n" +
  "User-preference embedding: when the user complains about how " +
  "you handled a task, update the skill that governs that task — " +
  "memory alone isn't enough. Memory says 'who the user is and " +
  "what the current situation and state of your operations are'; " +
  "skills say 'how to do this class of task for this user'. Both " +
  "should carry user-preference lessons when relevant.\n\n" +
  "If you notice overlapping existing skills, mention it — the " +
  "background curator handles consolidation.\n\n" +
  "Protected skills (DO NOT edit these):\n" +
  "  • Bundled skills (shipped with Web Agent, e.g. 'web-agent-skill', category bundled).\n" +
  "  • URL-imported skills (installed via skill_manage / skill_bulk_save import).\n" +
  "  • Pinned skills (marked in .webagent/skills/.usage.json).\n" +
  "If the only skills that need updating are protected, say\n" +
  "'Nothing to save.' and stop.\n\n" +
  "Do NOT capture as skills (these become persistent self-imposed " +
  "constraints that bite you later when the environment changes):\n" +
  "  • Environment-dependent failures: missing binaries, fresh-install " +
  "errors, post-migration path mismatches, 'command not found', " +
  "unconfigured credentials, uninstalled packages. The user can fix " +
  "these — they are not durable rules.\n" +
  "  • Negative claims about tools or features ('browser tools do not " +
  "work', 'X tool is broken', 'cannot use Y from run_shell'). These " +
  "harden into refusals the agent cites against itself for months " +
  "after the actual problem was fixed.\n" +
  "  • Session-specific transient errors that resolved before the " +
  "conversation ended. If retrying worked, the lesson is the retry " +
  "pattern, not the original failure.\n" +
  "  • One-off task narratives. A user asking 'summarize today's " +
  "market' or 'analyze this PR' is not a class of work that warrants " +
  "a skill.\n\n" +
  "If a tool failed because of setup state, capture the FIX (install " +
  "command, config step, env var to set) under an existing setup or " +
  "troubleshooting skill — never 'this tool does not work' as a " +
  "standalone constraint.\n\n" +
  "Act on whichever of the two dimensions has real signal. If " +
  "genuinely nothing stands out on either, say 'Nothing to save.' " +
  "and stop — but don't reach for that conclusion as a default.";

function reviewPromptForKind(kind: BackgroundReviewKind): string {
  if (kind === "memory") return MEMORY_REVIEW_PROMPT;
  if (kind === "skill") return SKILL_REVIEW_PROMPT;
  return COMBINED_REVIEW_PROMPT;
}

function allowedToolsForKind(kind: BackgroundReviewKind): string[] {
  if (kind === "memory") return [...MEMORY_TOOLS];
  if (kind === "skill") return [...SKILL_TOOLS];
  return [...new Set([...MEMORY_TOOLS, ...SKILL_TOOLS])];
}

export type BackgroundReviewActionSummary = {
  lines: string[];
  skillsCreated: number;
  skillsPatched: number;
  memoryUpdates: number;
  sessionMemoryUpdates: number;
};

export function summarizeBackgroundReviewActions(
  toolResults: Array<{ tool?: string; status?: string; error?: string; result?: unknown }>
): string[] {
  return summarizeBackgroundReviewActionsDetailed(toolResults).lines;
}

export function summarizeBackgroundReviewActionsDetailed(
  toolResults: Array<{ tool?: string; status?: string; error?: string; result?: unknown }>
): BackgroundReviewActionSummary {
  const lines: string[] = [];
  let skillsCreated = 0;
  let skillsPatched = 0;
  let memoryUpdates = 0;
  let sessionMemoryUpdates = 0;
  for (const item of toolResults) {
    if (item.status !== "ok" || item.error) continue;
    const tool = String(item.tool || "");
    const result = item.result && typeof item.result === "object" ? (item.result as Record<string, unknown>) : {};
    if (tool === "skill_manage" && result.action === "create") {
      const name = String(result.name || result.slug || "skill");
      lines.push(`Skill '${name}' created`);
      skillsCreated += 1;
    } else if (tool === "skill_manage" && ["patch", "edit", "write_file"].includes(String(result.action || ""))) {
      lines.push(`Skill '${String(result.name || result.slug || "skill")}' updated`);
      skillsPatched += 1;
    } else if (tool === "memory_save") {
      lines.push("Memory updated");
      memoryUpdates += 1;
    } else if (tool === "session_memory_append") {
      lines.push("Session memory updated");
      sessionMemoryUpdates += 1;
    }
  }
  return { lines, skillsCreated, skillsPatched, memoryUpdates, sessionMemoryUpdates };
}

export type ScheduleBackgroundReviewInput = {
  kind: BackgroundReviewKind;
  messagesSnapshot: unknown[];
  cfg: Record<string, unknown>;
  runId: string;
  writeOrigin?: "background_review" | "curator";
  onSummary?: (summary: string) => void | Promise<void>;
};

export function scheduleBackgroundReview(input: ScheduleBackgroundReviewInput): void {
  void runBackgroundReview(input).catch(async (err) => {
    await logDebugEvent("background_review_failed", {
      kind: input.kind,
      runId: input.runId,
      error: errorMessage(err),
    });
  });
}

export async function runBackgroundReview({
  kind,
  messagesSnapshot,
  cfg,
  runId,
  writeOrigin = "background_review",
  onSummary,
}: ScheduleBackgroundReviewInput): Promise<string | null> {
  const prompt = reviewPromptForKind(kind);
  const allowedToolNames = allowedToolsForKind(kind);
  const reviewMessages = [
    ...messagesSnapshot.filter((m) => {
      const row = m as { role?: string };
      return row.role === "user" || row.role === "assistant";
    }),
    { role: "user", content: prompt },
  ];

  await logDebugEvent("background_review_started", { kind, runId, parentRunId: runId });

  const capturedResults: Array<{ tool?: string; status?: string; error?: string; result?: unknown }> =
    [];

  await runWithSkillWriteOrigin(writeOrigin, async () => {
    const { agentTurn } = await import("./turn.js");
    await agentTurn(reviewMessages, cfg, {
      runId: `${runId}-review`,
      input: prompt,
      autoApprove: true,
      quiet: true,
      backgroundReview: true,
      skipBackgroundReview: true,
      allowedToolNames,
      maxAgentRounds: BACKGROUND_REVIEW_MAX_ROUNDS,
      onToolResults: (results) => {
        capturedResults.push(...results);
      },
    });
  });

  const actionSummary = summarizeBackgroundReviewActionsDetailed(capturedResults);
  if (!actionSummary.lines.length) {
    await logDebugEvent("background_review_completed", { kind, runId, actions: [] });
    return null;
  }

  const summary = `Self-improvement review: ${actionSummary.lines.join(" · ")}`;
  process.stdout.write(dim(`💾 ${summary}\n\n`));
  emitSelfImprovementSummary({
    summary,
    kind,
    source: writeOrigin,
  });
  await logDebugEvent("background_review_completed", {
    kind,
    runId,
    actions: actionSummary.lines,
    skillsCreated: actionSummary.skillsCreated,
    skillsPatched: actionSummary.skillsPatched,
    memoryUpdates: actionSummary.memoryUpdates,
    summary,
  });
  if (typeof onSummary === "function") {
    await onSummary(summary);
  }
  return summary;
}
