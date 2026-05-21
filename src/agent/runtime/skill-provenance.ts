/**
 * Skill write-origin context + usage/provenance sidecar (Hermes-style).
 */

import fs from "node:fs/promises";
import nodePath from "node:path";
import { workspaceStatePath } from "./constants.js";

export type SkillWriteOrigin = "foreground" | "background_review" | "curator";

const USAGE_REL = ".webagent/skills/.usage.json";
const ARCHIVE_REL = ".webagent/skills/.archive";

function usageFilePath(): string {
  return workspaceStatePath(USAGE_REL);
}

function archiveDirPath(): string {
  return workspaceStatePath(ARCHIVE_REL);
}

async function ensureSkillsDir(): Promise<void> {
  await fs.mkdir(workspaceStatePath(".webagent/skills"), { recursive: true });
}

export type SkillUsageRecord = {
  created_by?: "agent" | "user";
  created_at?: string;
  use_count?: number;
  view_count?: number;
  patch_count?: number;
  last_used_at?: string | null;
  last_viewed_at?: string | null;
  last_patched_at?: string | null;
  state?: "active" | "stale" | "archived";
  pinned?: boolean;
  archived_at?: string | null;
  absorbed_into?: string | null;
};

type UsageStore = Record<string, SkillUsageRecord>;

let writeOrigin: SkillWriteOrigin | null = null;

export function getSkillWriteOrigin(): SkillWriteOrigin | null {
  return writeOrigin;
}

export async function runWithSkillWriteOrigin<T>(
  origin: SkillWriteOrigin,
  fn: () => Promise<T> | T
): Promise<T> {
  const prev = writeOrigin;
  writeOrigin = origin;
  try {
    return await fn();
  } finally {
    writeOrigin = prev;
  }
}

async function loadUsageStore(): Promise<UsageStore> {
  try {
    const raw = await fs.readFile(usageFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function saveUsageStore(store: UsageStore): Promise<void> {
  await ensureSkillsDir();
  await fs.writeFile(usageFilePath(), JSON.stringify(store, null, 2), "utf8");
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseIso(value: unknown): number | null {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function latestActivityMs(record: SkillUsageRecord): number | null {
  const stamps = [record.last_used_at, record.last_viewed_at, record.last_patched_at]
    .map(parseIso)
    .filter((v): v is number => v != null);
  if (!stamps.length) return parseIso(record.created_at);
  return Math.max(...stamps);
}

async function updateUsage(
  slug: string,
  patch: (record: SkillUsageRecord) => SkillUsageRecord
): Promise<SkillUsageRecord> {
  const key = String(slug || "").trim();
  if (!key) throw new Error("skill usage: slug required.");
  const store = await loadUsageStore();
  const next = patch({ ...(store[key] || {}) });
  store[key] = next;
  await saveUsageStore(store);
  return next;
}

export async function markAgentCreated(slug: string): Promise<void> {
  await updateUsage(slug, (record) => ({
    ...record,
    created_by: "agent",
    created_at: record.created_at || nowIso(),
    state: record.state || "active",
  }));
}

export async function recordSkillView(slug: string): Promise<void> {
  await updateUsage(slug, (record) => ({
    ...record,
    view_count: Number(record.view_count || 0) + 1,
    last_viewed_at: nowIso(),
    state: record.state === "archived" ? record.state : "active",
  }));
}

export async function recordSkillPatch(slug: string): Promise<void> {
  await updateUsage(slug, (record) => ({
    ...record,
    patch_count: Number(record.patch_count || 0) + 1,
    last_patched_at: nowIso(),
    state: record.state === "archived" ? record.state : "active",
  }));
}

export async function recordSkillUse(slug: string): Promise<void> {
  await updateUsage(slug, (record) => ({
    ...record,
    use_count: Number(record.use_count || 0) + 1,
    last_used_at: nowIso(),
    state: record.state === "archived" ? record.state : "active",
  }));
}

export async function getSkillUsage(slug: string): Promise<SkillUsageRecord | null> {
  const store = await loadUsageStore();
  return store[String(slug || "").trim()] || null;
}

export async function listSkillUsage(): Promise<UsageStore> {
  return loadUsageStore();
}

export async function isAgentCreatedSkill(slug: string): Promise<boolean> {
  const usage = await getSkillUsage(slug);
  return usage?.created_by === "agent";
}

export async function isPinnedSkill(slug: string): Promise<boolean> {
  const usage = await getSkillUsage(slug);
  return !!usage?.pinned;
}

export async function setSkillPinned(slug: string, pinned: boolean): Promise<void> {
  await updateUsage(slug, (record) => ({ ...record, pinned: !!pinned }));
}

export async function setSkillState(
  slug: string,
  state: "active" | "stale" | "archived",
  extra: Partial<SkillUsageRecord> = {}
): Promise<void> {
  await updateUsage(slug, (record) => ({ ...record, state, ...extra }));
}

export async function listAgentCreatedSkillSlugs(): Promise<string[]> {
  const store = await loadUsageStore();
  return Object.entries(store)
    .filter(([, record]) => record?.created_by === "agent" && record?.state !== "archived")
    .map(([slug]) => slug);
}

export async function applyAutomaticSkillTransitions({
  staleAfterDays = 30,
  archiveAfterDays = 90,
}: {
  staleAfterDays?: number;
  archiveAfterDays?: number;
} = {}): Promise<{ stale: string[]; archived: string[] }> {
  const store = await loadUsageStore();
  const stale: string[] = [];
  const archived: string[] = [];
  const now = Date.now();
  const staleMs = staleAfterDays * 24 * 60 * 60 * 1000;
  const archiveMs = archiveAfterDays * 24 * 60 * 60 * 1000;

  for (const [slug, record] of Object.entries(store)) {
    if (record?.pinned || record?.created_by !== "agent") continue;
    if (record?.state === "archived") continue;
    const activity = latestActivityMs(record);
    if (activity == null) continue;
    const idle = now - activity;
    if (idle >= archiveMs) {
      record.state = "archived";
      record.archived_at = nowIso();
      archived.push(slug);
    } else if (idle >= staleMs && record.state !== "stale") {
      record.state = "stale";
      stale.push(slug);
    }
  }

  if (stale.length || archived.length) {
    await saveUsageStore(store);
  }
  return { stale, archived };
}

export async function archiveSkillDirectory(
  skillDir: string,
  slug: string,
  absorbedInto?: string | null
): Promise<{ ok: true; action: "archive"; slug: string; absorbed_into: string | null }> {
  await fs.mkdir(archiveDirPath(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = nodePath.join(archiveDirPath(), `${slug}-${stamp}`);
  await fs.rename(skillDir, dest);
  await setSkillState(slug, "archived", {
    archived_at: new Date().toISOString(),
    absorbed_into: absorbedInto || null,
  });
  return { ok: true, action: "archive", slug, absorbed_into: absorbedInto || null };
}
