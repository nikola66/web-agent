/**
 * Workspace migration contract.
 *
 * A migration is a one-shot patch applied at most once per workspace.
 * Applied ids are recorded in `.webagent/migrations.json` and consulted
 * on every bootstrap before any business logic touches state files.
 *
 * Migrations must be idempotent: if rerun on an already-migrated
 * workspace they should detect the absence of legacy state and
 * report `skipped` without error.
 */

export interface MigrationContext {
  /** Absolute workspace root for this profile (process cwd at bootstrap time). */
  workspaceRoot: string;
}

export interface MigrationResult {
  ok: boolean;
  /** Files/paths the migration actively moved or rewrote. */
  moved?: string[];
  /** Legacy paths that were absent or already migrated. */
  skipped?: string[];
  /** Short human-readable summary for the debug log. */
  note?: string;
  /** Set when `ok === false`. Migration is *not* recorded as applied. */
  error?: string;
}

export interface Migration {
  /** Unique, sortable id. Convention: `NNN-kebab-summary`. */
  id: string;
  /** One-line description shown in the debug log when the migration runs. */
  description: string;
  /** Execute the migration. Must not throw — wrap failures in `{ok: false, error}`. */
  run(ctx: MigrationContext): Promise<MigrationResult>;
}

export interface AppliedMigrationRecord {
  id: string;
  appliedAt: string;
  note?: string;
}

export interface MigrationsStateFile {
  applied: AppliedMigrationRecord[];
}
