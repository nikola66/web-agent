import fs from "node:fs/promises";
import nodePath from "node:path";
import { WS } from "../constants.js";
import { sanitizeForLogs } from "../privacy.js";

const DEBUG_LOG_ENABLED = typeof process !== "undefined" && String(process.env?.WEBAGENT_DEBUG_LOG || "").trim() === "1";
const DEBUG_LOG_DIR = typeof process !== "undefined" ? String(process.env?.WEBAGENT_DEBUG_LOG_DIR || `${WS}/debug-logs`).trim() : `${WS}/debug-logs`;
const DEBUG_SESSION_ID =
  typeof process !== "undefined" && (String(process.env?.WEBAGENT_DEBUG_SESSION_ID || "").trim() ||
  `${new Date().toISOString().replace(/[:.]/g, "-")}-pid${process.pid}`) ||
  `${new Date().toISOString().replace(/[:.]/g, "-")}-browser`;
const DEBUG_LOG_PATH = typeof process !== "undefined" ? nodePath.join(DEBUG_LOG_DIR, `${DEBUG_SESSION_ID}.jsonl`) : "";

let initPromise = null;
let writeQueue = Promise.resolve();

async function ensureReady() {
  if (!DEBUG_LOG_ENABLED) return;
  if (!initPromise) {
    initPromise = (async () => {
      await fs.mkdir(DEBUG_LOG_DIR, { recursive: true });
      const header = {
        ts: new Date().toISOString(),
        event: "debug_log_session_started",
        pid: process.pid,
        cwd: WS,
        sessionId: DEBUG_SESSION_ID,
      };
      await fs.appendFile(DEBUG_LOG_PATH, `${JSON.stringify(header)}\n`, "utf8");
    })();
  }
  await initPromise;
}

export function isDebugLogEnabled() {
  return DEBUG_LOG_ENABLED;
}

export function getDebugLogPath() {
  return DEBUG_LOG_PATH;
}

export async function logDebugEvent(event, payload = {}) {
  if (!DEBUG_LOG_ENABLED) return;
  await ensureReady();
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    payload: sanitizeForLogs(payload),
  });
  writeQueue = writeQueue
    .then(() => fs.appendFile(DEBUG_LOG_PATH, `${line}\n`, "utf8"))
    .catch(() => {
      /* best effort logging */
    });
  await writeQueue;
}
