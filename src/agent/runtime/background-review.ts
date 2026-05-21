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
  Number(process.env.WEBAGENT_SKILL_REVIEW_INTERVAL) || 10
);
export const DEFAULT_MEMORY_REVIEW_INTERVAL = Math.max(
  1,
  Number(process.env.WEBAGENT_MEMORY_REVIEW_INTERVAL) || 10
);
export const BACKGROUND_REVIEW_MAX_ROUNDS = Math.max(
  1,
  Number(process.env.WEBAGENT_BACKGROUND_REVIEW_MAX_ROUNDS) || 16
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
  const complex =
    !!input.executedToolsInTurn &&
    (input.usedTodoWrite || input.usedPlanningGate || input.estimatedStepsOverSix);
  const toolRoundCount = Math.max(0, Number(input.toolRoundCount || 0));
  const toolCallCount = Math.max(0, Number(input.toolCallCount || 0));
  const toolHeavy = toolCallCount >= 5 || toolRoundCount >= 3;
  const missedSkillOpportunity =
    completed &&
    hasSkillTools &&
    !input.skillMutatingCalled &&
    !!input.executedToolsInTurn &&
    (complex || toolHeavy);

  let shouldReviewMemory = false;
  let shouldReviewSkills = false;

  if (completed && hasMemoryTools && turnsSinceMemory >= DEFAULT_MEMORY_REVIEW_INTERVAL) {
    shouldReviewMemory = true;
    turnsSinceMemory = 0;
  }
  const acceleratedSkillThreshold = Math.max(3, DEFAULT_SKILL_REVIEW_INTERVAL - 4);
  const skillReviewDue =
    completed &&
    hasSkillTools &&
    !input.skillMutatingCalled &&
    missedSkillOpportunity &&
    (itersSinceSkill >= DEFAULT_SKILL_REVIEW_INTERVAL ||
      toolCallCount >= 8 ||
      (toolHeavy && itersSinceSkill >= acceleratedSkillThreshold));
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

const MEMORY_REVIEW_PROMPT =
  "Review the conversation above and consider saving to memory if appropriate.\n\n" +
  "Focus on durable user preferences, persona details, and expectations about how you should behave.\n\n" +
  "Layer choice:\n" +
  "- Durable facts (preferences, stable environment) → `memory_save`\n" +
  "- Investigation trail, temporary decisions, artifact pointers → `session_memory_append`\n" +
  "- Do NOT save task progress, PR/issue numbers, or stale-in-a-week artifacts to `memory_save`; " +
  "use `session_search` to recall those from archives.\n" +
  "- Repeatable workflows → skills (`skill_manage` create/patch), not memory facts.\n\n" +
  "If something stands out, save it with the appropriate tool. " +
  "If nothing is worth saving, reply 'Nothing to save.' and stop.";

const SKILL_REVIEW_PROMPT =
  "Review the conversation above and update the skill library. Be ACTIVE — most complex sessions " +
  "produce at least one skill update.\n\n" +
  "Prefer patch existing skills before creating new class-level umbrella skills. " +
  "Do not edit bundled skills (category bundled). " +
  "Capture repeatable workflows, recoveries, and user corrections as procedural skills.\n\n" +
  "If nothing is reusable, reply 'Nothing to save.' and stop.";

const COMBINED_REVIEW_PROMPT =
  "Review the conversation above and update memory and skills.\n\n" +
  "**Memory**: save durable user preferences and persona facts with `memory_save`. " +
  "Use `session_memory_append` only for rolling session notes — not durable facts.\n\n" +
  "**Skills**: patch or create class-level procedural skills; prefer updates over new files; " +
  "do not edit bundled skills.\n\n" +
  "If nothing is worth saving, reply 'Nothing to save.' and stop.";

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
      skipSkillNudge: true,
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
