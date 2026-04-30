/**
 * Turn reflection persistence.
 */

import {
  MEMORY_REFLECTIONS_DIR,
} from "../constants.js";
import {
  ensureMemoryDirs,
  safeId,
  safeWriteJson,
  readJsonFilesNewestFirst,
} from "./sql.js";

export const MEMORY_REFLECTION_LIMIT = 5;

export async function saveReflection(reflection) {
  await ensureMemoryDirs();
  const createdAt = new Date().toISOString();
  const id = String(reflection?.id || safeId("reflection"));
  const payload = { id, created_at: createdAt, ...reflection };
  await safeWriteJson(`${MEMORY_REFLECTIONS_DIR}/${id}.json`, payload);
  return payload;
}

export async function getReflections(limit = MEMORY_REFLECTION_LIMIT) {
  return readJsonFilesNewestFirst(MEMORY_REFLECTIONS_DIR, limit, "reflection");
}
