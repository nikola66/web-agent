/**
 * Migration 001 — relocate scattered root-level state dotfiles under `.webagent/`.
 *
 * Pre-migration layout (drifted over time):
 *   .history.json
 *   .todos.json
 *   .cronjobs.json
 *   .heartbeat-state.json
 *   .channel-state.json
 *
 * Post-migration layout (canonical):
 *   .webagent/history.json
 *   .webagent/todos.json
 *   .webagent/cronjobs.json
 *   .webagent/heartbeat-state.json
 *   .webagent/channel-state.json
 *
 * The migration is idempotent: it moves a legacy file only when the new
 * target does not already exist. When both are present (the user has
 * already started writing to the new path), the legacy file is removed.
 */

import fs from "node:fs/promises";
import nodePath from "node:path";
import { workspaceStatePath } from "../constants.js";
import type { Migration, MigrationResult } from "./types.js";

const RELOCATIONS: Array<{ legacy: string; next: string }> = [
  { legacy: ".history.json", next: ".webagent/history.json" },
  { legacy: ".todos.json", next: ".webagent/todos.json" },
  { legacy: ".cronjobs.json", next: ".webagent/cronjobs.json" },
  { legacy: ".heartbeat-state.json", next: ".webagent/heartbeat-state.json" },
  { legacy: ".channel-state.json", next: ".webagent/channel-state.json" },
];

async function pathExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

const migration: Migration = {
  id: "001-relocate-state-files",
  description:
    "Move root-level agent state dotfiles (history/todos/cronjobs/heartbeat/channel) under .webagent/.",
  async run(): Promise<MigrationResult> {
    const moved: string[] = [];
    const skipped: string[] = [];

    for (const { legacy, next } of RELOCATIONS) {
      const legacyAbs = workspaceStatePath(legacy);
      const nextAbs = workspaceStatePath(next);

      const legacyExists = await pathExists(legacyAbs);
      if (!legacyExists) {
        skipped.push(legacy);
        continue;
      }

      const nextExists = await pathExists(nextAbs);
      if (nextExists) {
        try {
          await fs.rm(legacyAbs, { force: true });
          skipped.push(`${legacy} (new path already populated; legacy removed)`);
        } catch (err) {
          return {
            ok: false,
            error: `Failed to remove duplicate legacy file ${legacy}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          };
        }
        continue;
      }

      try {
        await fs.mkdir(nodePath.dirname(nextAbs), { recursive: true });
        await fs.rename(legacyAbs, nextAbs);
        moved.push(`${legacy} -> ${next}`);
      } catch (err) {
        return {
          ok: false,
          error: `Failed to relocate ${legacy}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
    }

    return {
      ok: true,
      moved,
      skipped,
      note: moved.length
        ? `Relocated ${moved.length} legacy state file${moved.length === 1 ? "" : "s"}.`
        : "No legacy state files found; workspace already on canonical layout.",
    };
  },
};

export default migration;
