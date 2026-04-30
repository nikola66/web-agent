/**
 * Conversation history persistence.
 */

import {
  MEMORY_CONVERSATIONS_DIR,
} from "../constants.js";
import {
  ensureMemoryDirs,
  safeId,
  safeWriteJson,
  readJsonFilesNewestFirst,
  memoryPath,
} from "./sql.js";

export const MEMORY_RECENT_CONVERSATION_LIMIT = 3;

export async function saveConversation(conversation) {
  await ensureMemoryDirs();
  const createdAt = new Date().toISOString();
  const id = String(conversation?.id || safeId("convo"));
  const payload = { id, created_at: createdAt, ...conversation };
  await safeWriteJson(`${MEMORY_CONVERSATIONS_DIR}/${id}.json`, payload);
  return payload;
}

export async function loadRecentConversations(limit = MEMORY_RECENT_CONVERSATION_LIMIT) {
  return readJsonFilesNewestFirst(MEMORY_CONVERSATIONS_DIR, limit, "conversation");
}
