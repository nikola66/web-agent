/**
 * Orchestrates the one-shot workspace migrations on each bootstrap.
 *
 * Contract:
 *   - registered migrations are sorted by id and run in order;
 *   - each migration runs at most once per workspace (recorded in
 *     `.webagent/migrations.json`);
 *   - a failing migration is logged but does **not** abort bootstrap —
 *     the runtime continues so the user can still open the app and fix
 *     the underlying issue manually.
 */

import { getWorkspaceRoot } from "../constants.js";
import { logDebugEvent } from "../logging/debug-log.js";
import { loadAppliedMigrations, recordAppliedMigration } from "./state.js";
import { registeredMigrations } from "./registry.js";
import type { Migration, MigrationContext } from "./types.js";

export interface AppliedMigrationSummaryEntry {
  id: string;
  description: string;
  note?: string;
  moved: string[];
}

export interface RunMigrationsSummary {
  applied: AppliedMigrationSummaryEntry[];
  skipped: string[];
  failed: { id: string; error: string }[];
}

export async function runPendingMigrations(): Promise<RunMigrationsSummary> {
  const ctx: MigrationContext = { workspaceRoot: getWorkspaceRoot() };
  const applied = await loadAppliedMigrations();
  const appliedIds = new Set(applied.map((entry) => entry.id));

  const sorted: Migration[] = [...registeredMigrations].sort((a, b) =>
    a.id.localeCompare(b.id)
  );

  const summary: RunMigrationsSummary = { applied: [], skipped: [], failed: [] };

  for (const migration of sorted) {
    if (appliedIds.has(migration.id)) {
      summary.skipped.push(migration.id);
      continue;
    }

    try {
      const result = await migration.run(ctx);
      if (!result.ok) {
        summary.failed.push({ id: migration.id, error: result.error || "unknown error" });
        await logDebugEvent("migration_failed", {
          id: migration.id,
          description: migration.description,
          error: result.error || "unknown error",
        });
        continue;
      }

      await recordAppliedMigration({
        id: migration.id,
        appliedAt: new Date().toISOString(),
        note: result.note,
      });
      summary.applied.push({
        id: migration.id,
        description: migration.description,
        note: result.note,
        moved: result.moved ?? [],
      });
      await logDebugEvent("migration_applied", {
        id: migration.id,
        description: migration.description,
        moved: result.moved ?? [],
        skipped: result.skipped ?? [],
        note: result.note,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      summary.failed.push({ id: migration.id, error });
      await logDebugEvent("migration_failed", {
        id: migration.id,
        description: migration.description,
        error,
      });
    }
  }

  return summary;
}
