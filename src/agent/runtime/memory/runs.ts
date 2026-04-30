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
  readJsonFile,
  memoryPath,
} from "./sql.js";

export async function saveRun(run) {
  await ensureMemoryDirs();
  const id = String(run?.id || safeId("run"));
  const payload = { id, ...run };
  await safeWriteJson(`${MEMORY_RUNS_DIR}/${id}.json`, payload);
  return payload;
}

export async function getRun(id) {
  if (!id) return null;
  const abs = memoryPath(`${MEMORY_RUNS_DIR}/${String(id)}.json`);
  return readJsonFile(abs, "run");
}
