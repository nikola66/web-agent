/**
 * Curator — periodic consolidation and lifecycle maintenance for agent-created skills.
 */

import fs from "node:fs/promises";
import nodePath from "node:path";
import { SKILLS_DIR, workspaceStatePath } from "./constants.js";
import { dim } from "./terminal-format.js";
import { logDebugEvent } from "./logging/debug-log.js";
import { emitSelfImprovementSummary } from "./identity/onboarding.js";
import { listSkills } from "./memory/skills.js";
import {
  applyAutomaticSkillTransitions,
  archiveSkillDirectory,
  isAgentCreatedSkill,
  isPinnedSkill,
  listAgentCreatedSkillSlugs,
  listSkillUsage,
} from "./skill-provenance.js";
import { runBackgroundReview, type BackgroundReviewKind } from "./background-review.js";
import { errorMessage } from "./utils.js";

const CURATOR_STATE_PATH = workspaceStatePath(".webagent/skills/.curator_state");
const CURATOR_REPORTS_DIR = workspaceStatePath(".webagent/skills/.curator/reports");

export const DEFAULT_CURATOR_INTERVAL_MS = Math.max(
  60 * 60 * 1000,
  Number(process.env.WEBAGENT_CURATOR_INTERVAL_MS) || 7 * 24 * 60 * 60 * 1000
);
export const DEFAULT_CURATOR_STALE_AFTER_DAYS = Math.max(
  1,
  Number(process.env.WEBAGENT_CURATOR_STALE_AFTER_DAYS) || 30
);
export const DEFAULT_CURATOR_ARCHIVE_AFTER_DAYS = Math.max(
  1,
  Number(process.env.WEBAGENT_CURATOR_ARCHIVE_AFTER_DAYS) || 90
);

type CuratorState = {
  last_run_at: string | null;
  last_run_summary: string | null;
  last_report_path: string | null;
  paused: boolean;
  run_count: number;
};

function defaultState(): CuratorState {
  return {
    last_run_at: null,
    last_run_summary: null,
    last_report_path: null,
    paused: false,
    run_count: 0,
  };
}

export async function loadCuratorState(): Promise<CuratorState> {
  try {
    const raw = await fs.readFile(CURATOR_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch {
    return defaultState();
  }
}

async function saveCuratorState(state: CuratorState): Promise<void> {
  await fs.mkdir(SKILLS_DIR, { recursive: true });
  await fs.writeFile(CURATOR_STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

export async function setCuratorPaused(paused: boolean): Promise<void> {
  const state = await loadCuratorState();
  state.paused = !!paused;
  await saveCuratorState(state);
}

function msSince(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Date.now() - ms : Number.POSITIVE_INFINITY;
}

async function buildCuratorCandidateSummary(): Promise<string[]> {
  const slugs = await listAgentCreatedSkillSlugs();
  const usage = await listSkillUsage();
  const skills = await listSkills();
  const lines: string[] = [];
  for (const slug of slugs) {
    const record = usage[slug] || {};
    const skill = skills.find((item) => item.slug === slug);
    if (!skill) continue;
    lines.push(
      `- ${skill.name} (slug: ${slug}, state: ${record.state || "active"}, category: ${skill.category}): ${skill.description}`
    );
  }
  return lines;
}

const CURATOR_REVIEW_PROMPT =
  "You are the skill curator. Review agent-created skills and consolidate overlapping entries.\n\n" +
  "Rules:\n" +
  "- Only patch/create/archive agent-created local skills (never bundled skills).\n" +
  "- Prefer merging narrow skills into class-level umbrella skills via patch/create.\n" +
  "- Archive redundant siblings with skill_manage delete only when absorbed_into is recorded in your reply.\n" +
  "- Never hard-delete pinned skills.\n\n" +
  "Candidate skills:\n";

export type MaybeRunCuratorInput = {
  cfg: Record<string, unknown>;
  idleForMs?: number;
  force?: boolean;
  onSummary?: (summary: string) => void | Promise<void>;
};

export async function maybeRunCurator({
  cfg,
  idleForMs = Number.POSITIVE_INFINITY,
  force = false,
  onSummary,
}: MaybeRunCuratorInput): Promise<{ ran: boolean; summary?: string }> {
  const state = await loadCuratorState();
  if (state.paused && !force) return { ran: false };

  if (!state.last_run_at && !force) {
    state.last_run_at = new Date().toISOString();
    await saveCuratorState(state);
    return { ran: false };
  }

  if (!force && msSince(state.last_run_at) < DEFAULT_CURATOR_INTERVAL_MS) {
    return { ran: false };
  }
  if (!force && idleForMs < 2 * 60 * 60 * 1000) {
    return { ran: false };
  }

  const agentCreated = await listAgentCreatedSkillSlugs();
  if (!agentCreated.length && !force) {
    state.last_run_at = new Date().toISOString();
    await saveCuratorState(state);
    return { ran: false };
  }

  const transitions = await applyAutomaticSkillTransitions({
    staleAfterDays: DEFAULT_CURATOR_STALE_AFTER_DAYS,
    archiveAfterDays: DEFAULT_CURATOR_ARCHIVE_AFTER_DAYS,
  });

  await logDebugEvent("curator_started", {
    agentCreated: agentCreated.length,
    stale: transitions.stale,
    archived: transitions.archived,
  });

  const candidates = await buildCuratorCandidateSummary();
  const prompt = `${CURATOR_REVIEW_PROMPT}${candidates.join("\n") || "- (none)"}`;
  const reviewMessages = [{ role: "user", content: prompt }];

  let summary = "";
  try {
    await runBackgroundReview({
      kind: "skill" as BackgroundReviewKind,
      messagesSnapshot: reviewMessages,
      cfg,
      runId: `curator-${Date.now()}`,
      writeOrigin: "curator",
      onSummary: async (line) => {
        summary = line;
        if (typeof onSummary === "function") await onSummary(line);
      },
    });
  } catch (err) {
    await logDebugEvent("curator_failed", { error: errorMessage(err) });
    return { ran: false };
  }

  const report = {
    at: new Date().toISOString(),
    transitions,
    summary: summary || "Curator pass completed.",
    candidates: candidates.length,
  };
  await fs.mkdir(CURATOR_REPORTS_DIR, { recursive: true });
  const reportPath = nodePath.join(CURATOR_REPORTS_DIR, `${Date.now()}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  state.last_run_at = report.at;
  state.last_run_summary = report.summary;
  state.last_report_path = reportPath;
  state.run_count = Number(state.run_count || 0) + 1;
  await saveCuratorState(state);

  process.stdout.write(dim(`🧹 Curator: ${report.summary}\n\n`));
  if (!summary) {
    emitSelfImprovementSummary({
      summary: `Curator: ${report.summary}`,
      kind: "skill",
      source: "curator",
    });
  }
  await logDebugEvent("curator_completed", { reportPath, summary: report.summary });
  return { ran: true, summary: report.summary };
}

export async function archiveAgentSkillBySlug(slug: string, absorbedInto?: string): Promise<void> {
  if (await isPinnedSkill(slug)) {
    throw new Error(`skill curator: '${slug}' is pinned.`);
  }
  if (!(await isAgentCreatedSkill(slug))) {
    throw new Error(`skill curator: '${slug}' is not agent-created.`);
  }
  const skills = await listSkills();
  const skill = skills.find((item) => item.slug === slug);
  if (!skill || skill.source === "bundled") {
    throw new Error(`skill curator: '${slug}' not found or protected.`);
  }
  const dir = nodePath.join(SKILLS_DIR, skill.category, slug);
  await archiveSkillDirectory(dir, slug, absorbedInto || null);
}

export async function curatorDeleteSkill(name: string, absorbedInto?: string) {
  const slug = String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  await archiveAgentSkillBySlug(slug, absorbedInto);
  return { ok: true, action: "archive", name, slug, absorbed_into: absorbedInto || null };
}
