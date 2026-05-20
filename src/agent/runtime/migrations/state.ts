/**
 * Read/write `.webagent/migrations.json` — the ledger of applied migrations.
 * The file is intentionally tiny and human-readable so a maintainer can
 * inspect (or hand-edit) which patches a workspace has seen.
 */

import fs from "node:fs/promises";
import nodePath from "node:path";
import { workspaceStatePath } from "../constants.js";
import type { AppliedMigrationRecord, MigrationsStateFile } from "./types.js";

const MIGRATIONS_STATE_REL = ".webagent/migrations.json";

export function migrationsStatePath(): string {
  return workspaceStatePath(MIGRATIONS_STATE_REL);
}

export async function loadAppliedMigrations(): Promise<AppliedMigrationRecord[]> {
  try {
    const raw = await fs.readFile(migrationsStatePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<MigrationsStateFile>;
    if (!parsed || !Array.isArray(parsed.applied)) return [];
    return parsed.applied.filter(
      (entry): entry is AppliedMigrationRecord =>
        !!entry && typeof entry.id === "string" && typeof entry.appliedAt === "string"
    );
  } catch {
    return [];
  }
}

export async function recordAppliedMigration(record: AppliedMigrationRecord): Promise<void> {
  const path = migrationsStatePath();
  await fs.mkdir(nodePath.dirname(path), { recursive: true });
  const existing = await loadAppliedMigrations();
  if (existing.some((entry) => entry.id === record.id)) return;
  const next: MigrationsStateFile = { applied: [...existing, record] };
  await fs.writeFile(path, JSON.stringify(next, null, 2) + "\n", "utf8");
}
