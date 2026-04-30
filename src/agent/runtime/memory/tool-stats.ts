/**
 * Tool usage statistics in database.
 */

import { logDebugEvent } from "../logging/debug-log.js";
import { getDb, persistDb } from "./sql.js";

async function recordToolStat(toolName, column) {
  const name = String(toolName || "unknown").trim() || "unknown";
  const db = await getDb();
  const now = new Date().toISOString();
  const successBump = column === "success_count" ? 1 : 0;
  const failureBump = column === "failure_count" ? 1 : 0;
  db.run(
    `INSERT INTO tool_stats(tool_name, success_count, failure_count, last_used)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tool_name) DO UPDATE SET
       success_count = success_count + excluded.success_count,
       failure_count = failure_count + excluded.failure_count,
       last_used = excluded.last_used`,
    [name, successBump, failureBump, now]
  );
  await persistDb(db);
  await logDebugEvent("memory_tool_stat_recorded", {
    tool: name,
    success: successBump,
    failure: failureBump,
  });
}

export async function recordToolSuccess(toolName) {
  await recordToolStat(toolName, "success_count");
}

export async function recordToolFailure(toolName) {
  await recordToolStat(toolName, "failure_count");
}

export async function getToolStats() {
  const db = await getDb();
  const result = db.exec(
    `SELECT tool_name, success_count, failure_count, last_used
     FROM tool_stats
     ORDER BY last_used DESC, tool_name ASC`
  );
  return (result[0]?.values || []).map(
    ([toolName, successCount, failureCount, lastUsed]) => ({
      tool_name: toolName,
      success_count: Number(successCount || 0),
      failure_count: Number(failureCount || 0),
      last_used: lastUsed || null,
    })
  );
}
