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
  "skill_save",
  "skill_manage",
  "skill_list",
  "skill_view",
  "skill_recall",
]);

let itersSinceSkill = 0;
let turnsSinceMemory = 0;

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

  let shouldReviewMemory = false;
  let shouldReviewSkills = false;

  if (completed && hasMemoryTools && turnsSinceMemory >= DEFAULT_MEMORY_REVIEW_INTERVAL) {
    shouldReviewMemory = true;
    turnsSinceMemory = 0;
  }
  if (
    completed &&
    complex &&
    hasSkillTools &&
    !input.skillMutatingCalled &&
    itersSinceSkill >= DEFAULT_SKILL_REVIEW_INTERVAL
  ) {
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
  "Focus on durable user preferences, persona details, and expectations about how you should behave. " +
  "If something stands out, save it with memory tools or session_memory_append. " +
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
  "**Memory**: save durable user preferences and persona facts.\n\n" +
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

export function summarizeBackgroundReviewActions(
  toolResults: Array<{ tool?: string; status?: string; error?: string; result?: unknown }>
): string[] {
  const lines: string[] = [];
  for (const item of toolResults) {
    if (item.status !== "ok" || item.error) continue;
    const tool = String(item.tool || "");
    const result = item.result && typeof item.result === "object" ? (item.result as Record<string, unknown>) : {};
    if (tool === "skill_save" || (tool === "skill_manage" && result.action === "create")) {
      const name = String(result.name || result.slug || "skill");
      lines.push(`Skill '${name}' created`);
    } else if (tool === "skill_manage" && ["patch", "edit", "write_file"].includes(String(result.action || ""))) {
      lines.push(`Skill '${String(result.name || result.slug || "skill")}' updated`);
    } else if (tool === "memory_save") {
      lines.push("Memory updated");
    } else if (tool === "session_memory_append") {
      lines.push("Session memory updated");
    }
  }
  return lines;
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

  const actions = summarizeBackgroundReviewActions(capturedResults);
  if (!actions.length) {
    await logDebugEvent("background_review_completed", { kind, runId, actions: [] });
    return null;
  }

  const summary = `Self-improvement review: ${actions.join(" · ")}`;
  process.stdout.write(dim(`💾 ${summary}\n\n`));
  emitSelfImprovementSummary({
    summary,
    kind,
    source: writeOrigin,
  });
  await logDebugEvent("background_review_completed", { kind, runId, actions, summary });
  if (typeof onSummary === "function") {
    await onSummary(summary);
  }
  return summary;
}
