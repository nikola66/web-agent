/**
 * Memory context block generation.
 */

import { logDebugEvent } from "../logging/debug-log.js";
import { errorMessage } from "../utils.js";
import { getReflections, MEMORY_REFLECTION_LIMIT } from "./reflection.js";
import { getAllFacts, searchFactsForContext } from "./facts.js";
import { getToolStats } from "./tool-stats.js";
import { getPromotableLearnings } from "./learnings.js";

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

function mergeFactsByKey(recentFacts, relevantFacts, max = 24) {
  const merged = new Map();
  for (const fact of relevantFacts) merged.set(fact.key, fact);
  for (const fact of recentFacts) {
    if (!merged.has(fact.key)) merged.set(fact.key, fact);
  }
  return [...merged.values()].slice(0, max);
}

export async function buildMemoryContextBlock(options: { goal?: string } = {}) {
  const goal = String(options.goal || "").trim();
  let reflections = [];
  let recentFacts = [];
  let relevantFacts = [];
  let stats = [];
  let learnings = [];
  try {
    reflections = await getReflections(MEMORY_REFLECTION_LIMIT);
    recentFacts = await getAllFacts(12);
    if (goal) relevantFacts = await searchFactsForContext(goal, 12);
    stats = await getToolStats();
    learnings = await getPromotableLearnings(8);
  } catch (error) {
    await logDebugEvent("memory_context_failed", {
      error: errorMessage(error),
    });
    return "";
  }

  const facts = mergeFactsByKey(recentFacts, relevantFacts, 24);
  const lines = [];
  if (facts.length) {
    lines.push("Facts:");
    for (const fact of facts) {
      const age = relativeAge(fact.updated_at);
      const ageTag = age ? ` (${age})` : "";
      const staleTag =
        fact.updated_at && Date.now() - new Date(fact.updated_at).getTime() > 90 * 86_400_000
          ? " ⚠️stale"
          : "";
      lines.push(`- ${fact.key}: ${JSON.stringify(fact.value)}${ageTag}${staleTag}`);
    }
  }
  if (reflections.length) {
    lines.push("Recent reflections:");
    for (const reflection of reflections) {
      const worked = String(reflection.what_worked || "").trim();
      const failed = String(reflection.what_failed || "").trim();
      const improvement = String(reflection.improvement || "").trim();
      lines.push(
        `- worked=${worked || "n/a"} failed=${failed || "n/a"} improve=${improvement || "n/a"}`
      );
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

  let block = `\n\nRuntime memory (compact, profile-local):\n${lines.join("\n")}`;
  if (block.length <= MEMORY_CONTEXT_CHAR_BUDGET) return block;

  while (block.length > MEMORY_CONTEXT_CHAR_BUDGET && lines.length > 2) {
    const factsHeaderIdx = lines.indexOf("Facts:");
    let removed = false;
    if (factsHeaderIdx >= 0) {
      for (let i = factsHeaderIdx + 1; i < lines.length; i += 1) {
        if (!lines[i].startsWith("- ")) break;
        lines.splice(i, 1);
        removed = true;
        break;
      }
    }
    if (!removed) lines.pop();
    block = `\n\nRuntime memory (compact, profile-local):\n${lines.join("\n")}`;
  }

  return block.length > MEMORY_CONTEXT_CHAR_BUDGET
    ? `${block.slice(0, MEMORY_CONTEXT_CHAR_BUDGET)}\n[Memory truncated]`
    : block;
}
