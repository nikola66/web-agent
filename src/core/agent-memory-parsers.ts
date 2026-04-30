export type MemoryFact = {
  key: string;
  value: unknown;
  created_at: string | null;
  updated_at: string | null;
};

export type MemoryLearning = {
  category: string;
  statement: string;
  confidence: number;
  evidence_count: number;
  source_run_id: string | null;
  updated_at: string | null;
};

export type MemoryToolStat = {
  tool_name: string;
  success_count: number;
  failure_count: number;
  last_used: string | null;
};

export type MemoryJob = {
  job_id: string;
  run_id: string | null;
  tool_name: string | null;
  status: string;
  command: string | null;
  cwd: string | null;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
};

export type MemoryJobEvent = {
  id: number;
  job_id: string;
  event_type: string;
  payload: unknown;
  created_at: string;
};

export type SessionMemoryEntry = {
  ts?: string;
  kind?: string;
  text?: string;
  ref?: string;
  artifact_path?: string;
  parse_error?: boolean;
  line?: string;
};

export type MemoryArchiveIndex = {
  count: number;
  totalBytes: number;
  latestPaths: string[];
};

type ArchiveFileEntry = {
  path: string;
  size: number;
};

type SqlDatabase = {
  exec(sql: string, params?: unknown[]): Array<{
    columns: string[];
    values: unknown[][];
  }>;
};

export function parseFactValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function parseSessionMemoryJsonl(content: string): SessionMemoryEntry[] {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const entries = lines.map((line) => {
    try {
      return JSON.parse(line) as SessionMemoryEntry;
    } catch {
      return { parse_error: true, line: line.slice(0, 400) };
    }
  });
  return entries.reverse();
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

export function buildArchiveIndex(
  files: ArchiveFileEntry[],
  prefix: string
): MemoryArchiveIndex {
  const matches = files.filter((file) => file.path.startsWith(prefix));
  const sorted = [...matches].sort((a, b) => b.path.localeCompare(a.path));
  return {
    count: matches.length,
    totalBytes: matches.reduce((sum, file) => sum + file.size, 0),
    latestPaths: sorted.slice(0, 5).map((file) => basename(file.path)),
  };
}

function mapFactRows(rows: unknown[][]): MemoryFact[] {
  return rows.map(([key, value, createdAt, updatedAt]) => ({
    key: String(key ?? ""),
    value: parseFactValue(String(value ?? "")),
    created_at: createdAt ? String(createdAt) : null,
    updated_at: updatedAt ? String(updatedAt) : null,
  }));
}

export function querySqliteMemory(db: SqlDatabase): {
  facts: MemoryFact[];
  learnings: MemoryLearning[];
  toolStats: MemoryToolStat[];
  jobs: MemoryJob[];
  jobEvents: MemoryJobEvent[];
} {
  const factsResult = db.exec(
    "SELECT key, value, created_at, updated_at FROM facts ORDER BY updated_at DESC, key ASC"
  );
  const learningsResult = db.exec(
    `SELECT category, statement, confidence, evidence_count, source_run_id, updated_at
     FROM learnings
     WHERE contradicted = 0
     ORDER BY evidence_count DESC, confidence DESC, updated_at DESC`
  );
  const toolStatsResult = db.exec(
    `SELECT tool_name, success_count, failure_count, last_used
     FROM tool_stats
     ORDER BY last_used DESC, tool_name ASC`
  );
  const jobsResult = db.exec(
    `SELECT job_id, run_id, tool_name, status, command, cwd, started_at, completed_at, updated_at
     FROM jobs
     ORDER BY updated_at DESC, started_at DESC`
  );
  const jobEventsResult = db.exec(
    `SELECT id, job_id, event_type, payload, created_at
     FROM job_events
     ORDER BY id DESC
     LIMIT 100`
  );

  const facts = mapFactRows(factsResult[0]?.values ?? []);
  const learnings = (learningsResult[0]?.values ?? []).map(
    ([category, statement, confidence, evidenceCount, sourceRunId, updatedAt]) => ({
      category: String(category ?? ""),
      statement: String(statement ?? ""),
      confidence: Number(confidence ?? 0),
      evidence_count: Number(evidenceCount ?? 0),
      source_run_id: sourceRunId ? String(sourceRunId) : null,
      updated_at: updatedAt ? String(updatedAt) : null,
    })
  );
  const toolStats = (toolStatsResult[0]?.values ?? []).map(
    ([toolName, successCount, failureCount, lastUsed]) => ({
      tool_name: String(toolName ?? ""),
      success_count: Number(successCount ?? 0),
      failure_count: Number(failureCount ?? 0),
      last_used: lastUsed ? String(lastUsed) : null,
    })
  );
  const jobs = (jobsResult[0]?.values ?? []).map(
    ([jobId, runId, toolName, status, command, cwd, startedAt, completedAt, updatedAt]) => ({
      job_id: String(jobId ?? ""),
      run_id: runId ? String(runId) : null,
      tool_name: toolName ? String(toolName) : null,
      status: String(status ?? ""),
      command: command ? String(command) : null,
      cwd: cwd ? String(cwd) : null,
      started_at: String(startedAt ?? ""),
      completed_at: completedAt ? String(completedAt) : null,
      updated_at: String(updatedAt ?? ""),
    })
  );
  const jobEvents = (jobEventsResult[0]?.values ?? []).map(
    ([id, jobId, eventType, payload, createdAt]) => ({
      id: Number(id ?? 0),
      job_id: String(jobId ?? ""),
      event_type: String(eventType ?? ""),
      payload: parseFactValue(String(payload ?? "")),
      created_at: String(createdAt ?? ""),
    })
  );

  return { facts, learnings, toolStats, jobs, jobEvents };
}
