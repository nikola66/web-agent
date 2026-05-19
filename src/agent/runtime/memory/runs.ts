/**
 * Run history persistence.
 */

import {
  MEMORY_RUNS_DIR,
} from "../constants.js";
import {
  ensureMemoryDirs,
  safeId,
  safeWriteJson,
} from "./sql.js";

export async function saveRun(run) {
  await ensureMemoryDirs();
  const id = String(run?.id || safeId("run"));
  const payload = { id, ...run };
  await safeWriteJson(`${MEMORY_RUNS_DIR}/${id}.json`, payload);
  return payload;
}
