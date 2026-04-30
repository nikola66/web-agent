/**
 * Background job management in database.
 */

import {
  MEMORY_JOBS_DIR,
} from "../constants.js";
import {
  getDb,
  persistDb,
  appendJsonLine,
  memoryPath,
} from "./sql.js";

export async function upsertJob(job) {
  const jobId = String(job?.job_id || "").trim();
  if (!jobId) throw new Error("job_id is required");
  const now = new Date().toISOString();
  const startedAt = String(job?.started_at || now);
  const db = await getDb();
  db.run(
    `INSERT INTO jobs(
      job_id, run_id, tool_name, status, command, cwd, started_at, completed_at, last_log_offset, notify_policy, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET
      run_id = COALESCE(excluded.run_id, jobs.run_id),
      tool_name = COALESCE(excluded.tool_name, jobs.tool_name),
      status = excluded.status,
      command = COALESCE(excluded.command, jobs.command),
      cwd = COALESCE(excluded.cwd, jobs.cwd),
      started_at = COALESCE(excluded.started_at, jobs.started_at),
      completed_at = COALESCE(excluded.completed_at, jobs.completed_at),
      last_log_offset = excluded.last_log_offset,
      notify_policy = COALESCE(excluded.notify_policy, jobs.notify_policy),
      updated_at = excluded.updated_at`,
    [
      jobId,
      job?.run_id || null,
      job?.tool_name || null,
      String(job?.status || "running"),
      job?.command || null,
      job?.cwd || null,
      startedAt,
      job?.completed_at || null,
      Number(job?.last_log_offset || 0),
      job?.notify_policy || null,
      now,
    ]
  );
  await persistDb(db);
  return {
    job_id: jobId,
    status: String(job?.status || "running"),
    started_at: startedAt,
  };
}

export async function getJob(jobId) {
  const id = String(jobId || "").trim();
  if (!id) return null;
  const db = await getDb();
  const result = db.exec(
    `SELECT job_id, run_id, tool_name, status, command, cwd, started_at, completed_at, last_log_offset, notify_policy, updated_at
     FROM jobs WHERE job_id = ? LIMIT 1`,
    [id]
  );
  const row = result?.[0]?.values?.[0];
  if (!row) return null;
  const [job_id, run_id, tool_name, status, command, cwd, started_at, completed_at, last_log_offset, notify_policy, updated_at] = row;
  return {
    job_id,
    run_id,
    tool_name,
    status,
    command,
    cwd,
    started_at,
    completed_at,
    last_log_offset: Number(last_log_offset || 0),
    notify_policy,
    updated_at,
  };
}

export async function appendJobLog(jobId, entry) {
  const id = String(jobId || "").trim();
  if (!id) throw new Error("job_id is required");
  const timestamp = new Date().toISOString();
  const bytes = await appendJsonLine(`${MEMORY_JOBS_DIR}/${id}.jsonl`, {
    ts: timestamp,
    ...entry,
  });
  const current = await getJob(id);
  const nextOffset = Number(current?.last_log_offset || 0) + bytes;
  await upsertJob({
    job_id: id,
    status: current?.status || "running",
    started_at: current?.started_at || timestamp,
    last_log_offset: nextOffset,
    run_id: current?.run_id || null,
    tool_name: current?.tool_name || null,
    command: current?.command || null,
    cwd: current?.cwd || null,
    notify_policy: current?.notify_policy || null,
    completed_at: current?.completed_at || null,
  });
  return { job_id: id, bytes, last_log_offset: nextOffset };
}

export async function enqueueJobEvent({ jobId, eventType, payload }) {
  const id = String(jobId || "").trim();
  if (!id) throw new Error("job_id is required");
  const type = String(eventType || "update").trim() || "update";
  const createdAt = new Date().toISOString();
  const db = await getDb();
  db.run(
    `INSERT INTO job_events(job_id, event_type, payload, created_at, dispatched)
     VALUES (?, ?, ?, ?, 0)`,
    [id, type, JSON.stringify(payload || {}), createdAt]
  );
  await persistDb(db);
  return { job_id: id, event_type: type, created_at: createdAt };
}

export async function drainPendingJobEvents(limit = 20) {
  const capped = Math.max(1, Math.min(200, Number(limit || 20)));
  const db = await getDb();
  const result = db.exec(
    `SELECT id, job_id, event_type, payload, created_at
     FROM job_events
     WHERE dispatched = 0
     ORDER BY id ASC
     LIMIT ?`,
    [capped]
  );
  return (result?.[0]?.values || []).map(([id, job_id, event_type, payload, created_at]) => {
    let parsed = {};
    try {
      parsed = JSON.parse(String(payload || "{}"));
    } catch {
      parsed = { raw: String(payload || "") };
    }
    return {
      id: Number(id),
      job_id,
      event_type,
      payload: parsed,
      created_at,
    };
  });
}

export async function acknowledgeJobEvents(eventIds) {
  const ids = Array.isArray(eventIds) ? eventIds.map((id) => Number(id)).filter(Number.isFinite) : [];
  if (!ids.length) return 0;
  const db = await getDb();
  for (const id of ids) {
    db.run(`UPDATE job_events SET dispatched = 1 WHERE id = ?`, [id]);
  }
  await persistDb(db, true);
  return ids.length;
}

export function buildJobEventsPrompt(events) {
  if (!Array.isArray(events) || events.length === 0) return "";
  const lines = ["Background job updates:"];
  for (const event of events) {
    const payload = event?.payload || {};
    const jobId = String(event?.job_id || "unknown");
    const type = String(event?.event_type || "update");
    if (type === "completed") {
      lines.push(`- ${jobId}: completed (exit_code=${payload.exit_code ?? "n/a"}).`);
      continue;
    }
    if (type === "failed") {
      lines.push(`- ${jobId}: failed (${String(payload.error || "unknown error").slice(0, 160)}).`);
      continue;
    }
    if (type === "watch_match") {
      lines.push(
        `- ${jobId}: watch match "${String(payload.pattern || "pattern")}" -> ${String(
          payload.preview || ""
        ).slice(0, 160)}`
      );
      continue;
    }
    lines.push(`- ${jobId}: ${type} ${JSON.stringify(payload).slice(0, 180)}`);
  }
  lines.push("Use these updates to continue work and keep responses concise.");
  return lines.join("\n");
}
