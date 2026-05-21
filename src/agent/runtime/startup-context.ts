/**
 * Prior-session context for startup greetings and per-turn memory injection.
 */

import fs from "node:fs/promises";
import { MEMORY_CONVERSATIONS_DIR, MEMORY_RUNS_DIR, workspaceStatePath } from "./constants.js";
import {
  getAllFacts,
  getPromotableLearnings,
  getReflections,
  readJsonFilesNewestFirst,
} from "./memory/index.js";
import { ensureMemoryDirs, safeId, safeWriteJson } from "./memory/sql.js";
import { loadHistory } from "./state/persistence.js";

const GREETING_CONTEXT_MAX_CHARS = 1100;
const GREETING_TRANSCRIPT_LIMIT = 8;
const GREETING_SESSION_NOTES_LIMIT = 5;
const GREETING_FACTS_LIMIT = 4;
const PRIOR_SESSION_CONTEXT_MAX_CHARS = 900;

function clipGreetingText(text: unknown, max: number) {
  const t = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function greetingMessageText(message: { role?: string; content?: unknown }) {
  return typeof message?.content === "string" ? message.content : "";
}

export function isStartupGreetingNoise(content: unknown) {
  const text = String(content ?? "").trim();
  if (!text) return true;
  if (text === "(session opened)") return true;
  if (text.includes("Session startup — you speak first")) return true;
  return false;
}

export function extractGreetingTranscriptMessages(
  historyMessages: unknown[],
  limit = GREETING_TRANSCRIPT_LIMIT
) {
  if (!Array.isArray(historyMessages)) return [];
  const transcript: Array<{ role: string; content: string }> = [];
  for (const message of historyMessages) {
    const row = message as { role?: string; content?: unknown };
    if (row?.role !== "user" && row?.role !== "assistant") continue;
    const content = greetingMessageText(row);
    if (isStartupGreetingNoise(content)) continue;
    transcript.push({ role: row.role!, content });
  }
  return transcript.slice(-limit);
}

async function loadRecentSessionMemoryNotes(limit = GREETING_SESSION_NOTES_LIMIT) {
  try {
    const raw = await fs.readFile(workspaceStatePath(".webagent/session-memory.jsonl"), "utf8");
    const notes: string[] = [];
    for (const line of raw.split("\n").filter((entry) => entry.trim()).slice(-limit)) {
      try {
        const text = String(JSON.parse(line)?.text ?? "").trim();
        if (text) notes.push(text);
      } catch {
        /* skip malformed line */
      }
    }
    return notes;
  } catch {
    return [];
  }
}

async function loadLatestRunSnippet() {
  try {
    const runs = await readJsonFilesNewestFirst(MEMORY_RUNS_DIR, 1, "run");
    const run = runs[0] as Record<string, unknown> | undefined;
    if (!run || typeof run !== "object") return "";
    const goal = clipGreetingText(run.goal || run.input || "", 180);
    const reply = clipGreetingText(run.final_visible_assistant_text || "", 220);
    const parts: string[] = [];
    if (goal) parts.push(`Last task: ${goal}`);
    if (reply) parts.push(`Last reply: ${reply}`);
    return parts.join("\n");
  } catch {
    return "";
  }
}

async function appendLightMemoryFallback(lines: string[]) {
  if (lines.length >= 3) return;
  try {
    const facts = await getAllFacts(GREETING_FACTS_LIMIT);
    if (facts.length) {
      const factStr = facts
        .map((f) => {
          const v = typeof f.value === "object" ? JSON.stringify(f.value) : String(f.value ?? "");
          return `${f.key}: ${clipGreetingText(v, 100)}`;
        })
        .join(" · ");
      lines.push(`Facts: ${factStr}`);
    }
  } catch {
    /* ignore */
  }
  if (lines.length >= 2) return;
  try {
    for (const row of (await getPromotableLearnings(3)).slice(0, 2)) {
      const st = String(row.statement || "").trim();
      if (st) lines.push(`Learning: ${clipGreetingText(st, 200)}`);
    }
  } catch {
    /* ignore */
  }
  if (lines.length >= 2) return;
  try {
    for (const reflection of (await getReflections(1)).slice(0, 1)) {
      const merged = [reflection.what_worked, reflection.what_failed, reflection.improvement]
        .map((part) => String(part || "").trim())
        .filter(Boolean)
        .join(" — ");
      if (merged) lines.push(`Reflection: ${clipGreetingText(merged, 220)}`);
    }
  } catch {
    /* ignore */
  }
}

export function mergeStartupGreetingContextLines(lines: string[], maxChars = GREETING_CONTEXT_MAX_CHARS) {
  let merged = lines.join("\n").trim();
  if (merged.length > maxChars) merged = `${merged.slice(0, maxChars - 1)}…`;
  return merged;
}

async function collectPriorSessionLines() {
  const [savedHistory, sessionNotes, runSnippet] = await Promise.all([
    loadHistory(),
    loadRecentSessionMemoryNotes(),
    loadLatestRunSnippet(),
  ]);

  const lines: string[] = [];
  for (const message of extractGreetingTranscriptMessages(savedHistory)) {
    const clipped = clipGreetingText(message.content, 280);
    lines.push(`${message.role === "user" ? "User" : "Agent"}: ${clipped}`);
  }
  for (const note of sessionNotes) {
    lines.push(`Session note: ${clipGreetingText(note, 200)}`);
  }
  if (runSnippet && lines.length < 4) lines.push(runSnippet);
  await appendLightMemoryFallback(lines);
  return lines;
}

export async function buildStartupGreetingContext() {
  return mergeStartupGreetingContextLines(await collectPriorSessionLines());
}

export async function buildPriorSessionContextBlock() {
  const merged = mergeStartupGreetingContextLines(
    await collectPriorSessionLines(),
    PRIOR_SESSION_CONTEXT_MAX_CHARS
  );
  if (!merged) return "";
  return (
    "\n\nPrior session (recent transcript, notes, last run — use for continuity; " +
    "call session_search or session_memory_list if you need more detail):\n" +
    merged
  );
}

/** Archive live history before /clear so session_search can find the prior thread. */
export async function archiveCurrentHistoryForSessionSearch(historyMessages: unknown[]) {
  const transcript = extractGreetingTranscriptMessages(historyMessages, 40);
  if (!transcript.length) return null;
  await ensureMemoryDirs();
  const id = safeId("conv");
  await safeWriteJson(`${MEMORY_CONVERSATIONS_DIR}/${id}.json`, {
    id,
    archived_at: new Date().toISOString(),
    messages: transcript,
  });
  return id;
}
