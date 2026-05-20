/**
 * Canonical list of registered workspace migrations. Order does not matter
 * here — the runner sorts by `id` before executing. Add new migrations as a
 * sibling file and append the import below; do not re-order existing entries.
 */

import migration001 from "./001-relocate-state-files.js";
import type { Migration } from "./types.js";

export const registeredMigrations: Migration[] = [migration001];
