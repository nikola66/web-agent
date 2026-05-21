import {
  buildArchiveIndex,
  parseSessionMemoryJsonl,
  querySqliteMemory,
  type MemoryFact,
  type MemoryJob,
  type MemoryJobEvent,
  type MemoryLearning,
  type MemoryToolStat,
  type SessionMemoryEntry,
} from "./agent-memory-parsers";
import {
  listWorkspaceFiles,
  readWorkspaceFileBuffer,
  readWorkspaceFileText,
  WORKSPACE_SESSION_MEMORY_REL,
  type WorkspaceFileEntry,
} from "./workspace";

export type {
  MemoryArchiveIndex,
  MemoryFact,
  MemoryJob,
  MemoryJobEvent,
  MemoryLearning,
  MemoryToolStat,
  SessionMemoryEntry,
} from "./agent-memory-parsers";

const MEMORY_DB_PATH = "memory/memory.sqlite";
const REFLECTIONS_PREFIX = "memory/reflections/";
const SNAPSHOTS_PREFIX = "memory/snapshots/";
const CONVERSATIONS_PREFIX = "memory/conversations/";
const RUNS_PREFIX = "memory/runs/";
const JOBS_ARCHIVE_PREFIX = "memory/jobs/";
const CRONJOBS_PATH = ".webagent/cronjobs.json";
const CURATOR_STATE_PATH = ".webagent/skills/.curator_state";
const CURATOR_REPORTS_PREFIX = ".webagent/skills/.curator/reports/";
const SKILL_USAGE_PATH = ".webagent/skills/.usage.json";

export type MemoryReflection = {
  path: string;
  id?: string;
  created_at?: string;
  what_worked?: string;
  what_failed?: string;
  improvement?: string;
  raw: Record<string, unknown>;
};

export type CronJobStep = {
  tool: string;
  arguments?: Record<string, unknown>;
};

export type CronJobEntry = {
  id: string;
  enabled: boolean;
  everyMinutes: number;
  delivery: string;
  tool?: string;
  arguments?: Record<string, unknown>;
  steps?: CronJobStep[];
  notifyChannel?: string;
  retryCount?: number;
  retryDelayMinutes?: number;
  lastRunAt?: number;
  retryAttempts?: number;
  nextRetryAt?: number;
  deliveryEmailTo?: string;
  deliveryEmailSubject?: string;
  raw: Record<string, unknown>;
};

export type AgentMemorySnapshot = {
  loadedAt: string;
  warnings: string[];
  sqliteBytes: number | null;
  facts: MemoryFact[];
  learnings: MemoryLearning[];
  toolStats: MemoryToolStat[];
  jobs: MemoryJob[];
  jobEvents: MemoryJobEvent[];
  cronJobs: CronJobEntry[];
  sessionEntries: SessionMemoryEntry[];
  reflections: MemoryReflection[];
  curator: CuratorSnapshot | null;
  skillProvenance: SkillProvenanceSnapshot | null;
  archives: {
    conversations: ReturnType<typeof buildArchiveIndex>;
    runs: ReturnType<typeof buildArchiveIndex>;
    jobs: ReturnType<typeof buildArchiveIndex>;
    snapshots: ReturnType<typeof buildArchiveIndex>;
  };
};

export type CuratorSnapshot = {
  paused: boolean;
  lastRunAt: string | null;
  lastRunSummary: string | null;
  lastReportPath: string | null;
  runCount: number;
  latestReport: Record<string, unknown> | null;
};

export type SkillUsageSnapshot = {
  slug: string;
  createdBy?: string;
  state?: string;
  useCount?: number;
  viewCount?: number;
  patchCount?: number;
  pinned?: boolean;
  lastUsedAt?: string | null;
  lastViewedAt?: string | null;
  lastPatchedAt?: string | null;
};

export type SkillProvenanceSnapshot = {
  total: number;
  agentCreated: number;
  byState: { active: number; stale: number; archived: number };
  skills: SkillUsageSnapshot[];
};

type SqlDatabase = {
  exec(sql: string, params?: unknown[]): Array<{
    columns: string[];
    values: unknown[][];
  }>;
  close(): void;
};

type InitSqlJs = (config?: { locateFile?: (file: string) => string }) => Promise<{
  Database: new (data?: Uint8Array) => SqlDatabase;
}>;

let sqlModulePromise: Promise<{ Database: new (data?: Uint8Array) => SqlDatabase } | null> | null =
  null;

async function getSqlModule(): Promise<{ Database: new (data?: Uint8Array) => SqlDatabase } | null> {
  if (!sqlModulePromise) {
    sqlModulePromise = (async () => {
      const mod = await import("sql.js/dist/sql-wasm.js");
      const initSqlJs = (mod.default ?? mod) as InitSqlJs;
      let wasmUrl: string | undefined;
      try {
        const wasmMod = (await import("sql.js/dist/sql-wasm.wasm?url")) as { default: string };
        wasmUrl = wasmMod.default;
      } catch {
        wasmUrl = new URL("../../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url).pathname;
      }
      return initSqlJs({
        locateFile: (file) => (file.endsWith(".wasm") ? wasmUrl ?? file : file),
      });
    })().catch(() => null);
  }
  return sqlModulePromise;
}

async function loadSqliteSections(
  profileId: string,
  warnings: string[]
): Promise<{
  sqliteBytes: number | null;
  facts: MemoryFact[];
  learnings: MemoryLearning[];
  toolStats: MemoryToolStat[];
  jobs: MemoryJob[];
  jobEvents: MemoryJobEvent[];
}> {
  const empty = {
    sqliteBytes: null as number | null,
    facts: [] as MemoryFact[],
    learnings: [] as MemoryLearning[],
    toolStats: [] as MemoryToolStat[],
    jobs: [] as MemoryJob[],
    jobEvents: [] as MemoryJobEvent[],
  };

  let bytes: ArrayBuffer;
  try {
    bytes = await readWorkspaceFileBuffer(profileId, MEMORY_DB_PATH, { preferLive: true });
  } catch {
    return empty;
  }

  if (!bytes.byteLength) return empty;

  const initSqlJs = await getSqlModule();
  if (!initSqlJs) {
    warnings.push("SQLite viewer unavailable in this environment.");
    return { ...empty, sqliteBytes: bytes.byteLength };
  }

  let db: SqlDatabase | null = null;
  try {
    db = new initSqlJs.Database(new Uint8Array(bytes));
    const sections = querySqliteMemory(db);
    return { sqliteBytes: bytes.byteLength, ...sections };
  } catch (error) {
    warnings.push(
      `Could not read ${MEMORY_DB_PATH}: ${error instanceof Error ? error.message : String(error)}`
    );
    return { ...empty, sqliteBytes: bytes.byteLength };
  } finally {
    db?.close();
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function parseCronJobEntry(value: unknown): CronJobEntry | null {
  const job = asRecord(value);
  if (!job) return null;
  const id = typeof job.id === "string" ? job.id.trim() : "";
  if (!id) return null;

  const everyRaw = Number(job.everyMinutes);
  const everyMinutes = Number.isFinite(everyRaw) && everyRaw > 0 ? everyRaw : 0;
  const delivery =
    typeof job.delivery === "string" && job.delivery.trim() ? job.delivery.trim() : "terminal";

  const rawSteps = Array.isArray(job.steps) ? job.steps : null;
  const steps = rawSteps
    ? rawSteps
        .map((step): CronJobStep | null => {
          const record = asRecord(step);
          if (!record) return null;
          const tool =
            typeof record.tool === "string"
              ? record.tool.trim()
              : typeof record.action === "string"
                ? record.action.trim()
                : "";
          if (!tool) return null;
          const args = asRecord(record.arguments);
          return args ? { tool, arguments: args } : { tool };
        })
        .filter((step): step is CronJobStep => step !== null)
    : undefined;

  const tool = typeof job.tool === "string" ? job.tool.trim() : undefined;
  const args = asRecord(job.arguments);
  const notifyChannel =
    typeof job.notifyChannel === "string" && job.notifyChannel.trim()
      ? job.notifyChannel.trim()
      : undefined;
  const deliveryEmailTo =
    typeof job.deliveryEmailTo === "string" && job.deliveryEmailTo.trim()
      ? job.deliveryEmailTo.trim()
      : undefined;
  const deliveryEmailSubject =
    typeof job.deliveryEmailSubject === "string" && job.deliveryEmailSubject.trim()
      ? job.deliveryEmailSubject.trim()
      : undefined;

  const numberOrUndefined = (input: unknown): number | undefined => {
    const num = Number(input);
    return Number.isFinite(num) ? num : undefined;
  };

  return {
    id,
    enabled: job.enabled !== false,
    everyMinutes,
    delivery,
    tool: tool || undefined,
    arguments: args,
    steps: steps && steps.length > 0 ? steps : undefined,
    notifyChannel,
    retryCount: numberOrUndefined(job.retryCount),
    retryDelayMinutes: numberOrUndefined(job.retryDelayMinutes),
    lastRunAt: numberOrUndefined(job.lastRunAt),
    retryAttempts: numberOrUndefined(job.retryAttempts),
    nextRetryAt: numberOrUndefined(job.nextRetryAt),
    deliveryEmailTo,
    deliveryEmailSubject,
    raw: job,
  };
}

async function loadCronJobsFile(
  profileId: string,
  warnings: string[]
): Promise<CronJobEntry[]> {
  let raw: string;
  try {
    raw = await readWorkspaceFileText(profileId, CRONJOBS_PATH, { preferLive: true });
  } catch {
    return [];
  }
  const trimmed = raw.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    warnings.push(
      `Could not parse ${CRONJOBS_PATH}: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
  const root = asRecord(parsed);
  const list = root && Array.isArray(root.jobs) ? root.jobs : Array.isArray(parsed) ? parsed : [];
  return list
    .map((entry) => parseCronJobEntry(entry))
    .filter((entry): entry is CronJobEntry => entry !== null);
}

async function loadReflections(
  profileId: string,
  files: WorkspaceFileEntry[],
  warnings: string[],
  limit = 20
): Promise<MemoryReflection[]> {
  const paths = files
    .filter((file) => file.path.startsWith(REFLECTIONS_PREFIX) && file.path.endsWith(".json"))
    .sort((a, b) => b.path.localeCompare(a.path))
    .slice(0, limit)
    .map((file) => file.path);

  const reflections: MemoryReflection[] = [];
  for (const path of paths) {
    try {
      const content = await readWorkspaceFileText(profileId, path, { preferLive: true });
      const parsed = JSON.parse(content) as Record<string, unknown>;
      reflections.push({
        path,
        id: typeof parsed.id === "string" ? parsed.id : undefined,
        created_at: typeof parsed.created_at === "string" ? parsed.created_at : undefined,
        what_worked: typeof parsed.what_worked === "string" ? parsed.what_worked : undefined,
        what_failed: typeof parsed.what_failed === "string" ? parsed.what_failed : undefined,
        improvement: typeof parsed.improvement === "string" ? parsed.improvement : undefined,
        raw: parsed,
      });
    } catch (error) {
      warnings.push(
        `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return reflections;
}

async function loadCuratorSnapshot(
  profileId: string,
  files: WorkspaceFileEntry[],
  warnings: string[]
): Promise<CuratorSnapshot | null> {
  let stateRaw = "";
  try {
    stateRaw = await readWorkspaceFileText(profileId, CURATOR_STATE_PATH, { preferLive: true });
  } catch {
    return null;
  }
  let state: Record<string, unknown> = {};
  try {
    state = JSON.parse(stateRaw) as Record<string, unknown>;
  } catch (error) {
    warnings.push(
      `Could not parse ${CURATOR_STATE_PATH}: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }

  const reportPaths = files
    .filter((file) => file.path.startsWith(CURATOR_REPORTS_PREFIX) && file.path.endsWith(".json"))
    .sort((a, b) => b.path.localeCompare(a.path));
  let latestReport: Record<string, unknown> | null = null;
  if (reportPaths.length > 0) {
    try {
      const content = await readWorkspaceFileText(profileId, reportPaths[0].path, {
        preferLive: true,
      });
      latestReport = JSON.parse(content) as Record<string, unknown>;
    } catch (error) {
      warnings.push(
        `Could not read curator report: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return {
    paused: state.paused === true,
    lastRunAt: typeof state.last_run_at === "string" ? state.last_run_at : null,
    lastRunSummary: typeof state.last_run_summary === "string" ? state.last_run_summary : null,
    lastReportPath: typeof state.last_report_path === "string" ? state.last_report_path : null,
    runCount: Number(state.run_count || 0),
    latestReport,
  };
}

async function loadSkillProvenanceSnapshot(
  profileId: string,
  warnings: string[]
): Promise<SkillProvenanceSnapshot | null> {
  let raw = "";
  try {
    raw = await readWorkspaceFileText(profileId, SKILL_USAGE_PATH, { preferLive: true });
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    warnings.push(
      `Could not parse ${SKILL_USAGE_PATH}: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const byState = { active: 0, stale: 0, archived: 0 };
  const skills: SkillUsageSnapshot[] = [];
  let agentCreated = 0;
  for (const [slug, value] of Object.entries(parsed as Record<string, unknown>)) {
    const record = asRecord(value);
    if (!record) continue;
    const state =
      record.state === "stale" || record.state === "archived" ? record.state : "active";
    byState[state] += 1;
    if (record.created_by === "agent") agentCreated += 1;
    skills.push({
      slug,
      createdBy: typeof record.created_by === "string" ? record.created_by : undefined,
      state,
      useCount: Number(record.use_count || 0),
      viewCount: Number(record.view_count || 0),
      patchCount: Number(record.patch_count || 0),
      pinned: record.pinned === true,
      lastUsedAt: typeof record.last_used_at === "string" ? record.last_used_at : null,
      lastViewedAt: typeof record.last_viewed_at === "string" ? record.last_viewed_at : null,
      lastPatchedAt: typeof record.last_patched_at === "string" ? record.last_patched_at : null,
    });
  }

  skills.sort((a, b) => {
    if (a.createdBy === "agent" && b.createdBy !== "agent") return -1;
    if (b.createdBy === "agent" && a.createdBy !== "agent") return 1;
    return a.slug.localeCompare(b.slug);
  });

  if (!skills.length) return null;

  return {
    total: skills.length,
    agentCreated,
    byState,
    skills,
  };
}

export async function loadAgentMemorySnapshot(
  profileId: string
): Promise<AgentMemorySnapshot> {
  const warnings: string[] = [];
  const files = await listWorkspaceFiles(profileId, { preferLive: true });
  const sqlite = await loadSqliteSections(profileId, warnings);

  let sessionEntries: SessionMemoryEntry[] = [];
  try {
    const sessionRaw = await readWorkspaceFileText(profileId, WORKSPACE_SESSION_MEMORY_REL, {
      preferLive: true,
    });
    sessionEntries = parseSessionMemoryJsonl(sessionRaw);
  } catch {
    sessionEntries = [];
  }

  const reflections = await loadReflections(profileId, files, warnings);
  const cronJobs = await loadCronJobsFile(profileId, warnings);
  const curator = await loadCuratorSnapshot(profileId, files, warnings);
  const skillProvenance = await loadSkillProvenanceSnapshot(profileId, warnings);

  return {
    loadedAt: new Date().toISOString(),
    warnings,
    sqliteBytes: sqlite.sqliteBytes,
    facts: sqlite.facts,
    learnings: sqlite.learnings,
    toolStats: sqlite.toolStats,
    jobs: sqlite.jobs,
    jobEvents: sqlite.jobEvents,
    cronJobs,
    sessionEntries,
    reflections,
    curator,
    skillProvenance,
    archives: {
      conversations: buildArchiveIndex(files, CONVERSATIONS_PREFIX),
      runs: buildArchiveIndex(files, RUNS_PREFIX),
      jobs: buildArchiveIndex(files, JOBS_ARCHIVE_PREFIX),
      snapshots: buildArchiveIndex(files, SNAPSHOTS_PREFIX),
    },
  };
}
