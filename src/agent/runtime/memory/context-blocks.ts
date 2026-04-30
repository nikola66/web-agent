/**
 * Memory context block generation.
 */

import { logDebugEvent } from "../logging/debug-log.js";
import { errorMessage } from "../utils.js";
import { getReflections, MEMORY_REFLECTION_LIMIT } from "./reflection.js";
import { getAllFacts } from "./facts.js";
import { getToolStats } from "./tool-stats.js";
import { getPromotableLearnings } from "./learnings.js";
import { listSkills } from "./skills.js";

export const MEMORY_CONTEXT_CHAR_BUDGET = 4_000;

function relativeAge(isoDate) {
  if (!isoDate) return null;
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays < 1) return null;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

export async function buildMemoryContextBlock() {
  let reflections = [];
  let facts = [];
  let stats = [];
  let learnings = [];
  try {
    reflections = await getReflections(MEMORY_REFLECTION_LIMIT);
    facts = await getAllFacts();
    stats = await getToolStats();
    learnings = await getPromotableLearnings(8);
  } catch (error) {
    await logDebugEvent("memory_context_failed", {
      error: errorMessage(error),
    });
    return "";
  }

  const lines = [];
  if (facts.length) {
    lines.push("Facts:");
    for (const fact of facts.slice(0, 24)) {
      const age = relativeAge(fact.updated_at);
      const ageTag = age ? ` (${age})` : "";
      const staleTag = fact.updated_at && Date.now() - new Date(fact.updated_at).getTime() > 90 * 86_400_000 ? " ⚠️stale" : "";
      lines.push(`- ${fact.key}: ${JSON.stringify(fact.value)}${ageTag}${staleTag}`);
    }
  }
  if (reflections.length) {
    lines.push("Recent reflections:");
    for (const reflection of reflections) {
      const worked = String(reflection.what_worked || "").trim();
      const failed = String(reflection.what_failed || "").trim();
      const improvement = String(reflection.improvement || "").trim();
      lines.push(`- worked=${worked || "n/a"} failed=${failed || "n/a"} improve=${improvement || "n/a"}`);
    }
  }
  if (stats.length) {
    lines.push("Tool stats:");
    for (const stat of stats.slice(0, 16)) {
      lines.push(
        `- ${stat.tool_name}: ${stat.success_count} success, ${stat.failure_count} failure`
      );
    }
  }
  if (learnings.length) {
    lines.push("High-signal learnings:");
    for (const learning of learnings) {
      if (learning.evidence_count < 2 && learning.confidence < 0.75) continue;
      lines.push(
        `- [${learning.category}] ${learning.statement} (confidence=${learning.confidence.toFixed(
          2
        )}, evidence=${learning.evidence_count})`
      );
    }
  }
  if (!lines.length) return "";
  const block = `\n\nRuntime memory (compact, profile-local):\n${lines.join("\n")}`;
  return block.length > MEMORY_CONTEXT_CHAR_BUDGET
    ? `${block.slice(0, MEMORY_CONTEXT_CHAR_BUDGET)}\n[Memory truncated]`
    : block;
}
