import { clearAll } from "./persistence";
import { get, set } from "idb-keyval";

const MIGRATION_KEY = "migration:v2-cleared-legacy-snapshots";

/** One-time: remove OPFS trees from the old OpenClaw/Hermes layout */
export async function runLegacySnapshotMigration(): Promise<void> {
  const done = await get<boolean>(MIGRATION_KEY);
  if (done) return;
  await clearAll("snapshots");
  await set(MIGRATION_KEY, true);
}
