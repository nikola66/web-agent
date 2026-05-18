/**
 * Shared database and file I/O utilities for memory subsystem.
 */

import fs from "node:fs/promises";
import nodePath from "node:path";
import {
  MEMORY_CONVERSATIONS_DIR,
  MEMORY_DB_PATH,
  MEMORY_JOBS_DIR,
  MEMORY_REFLECTIONS_DIR,
  MEMORY_ROOT,
  MEMORY_RUNS_DIR,
  MEMORY_SNAPSHOTS_DIR,
  getMemoryRoot,
  getWorkspaceRoot,
} from "../constants.js";
import { logDebugEvent } from "../logging/debug-log.js";
import { ensureParentDir, isWithinWorkspaceAbs, toWorkspaceDisplayPath } from "../workspace-paths.js";
import { errorMessage } from "../utils.js";

interface SqlDatabase {
  run(sql: string): void;
  exec(sql: string): unknown[];
  close(): void;
  export(): Uint8Array;
}

interface SqlModule {
  Database: new (data?: Uint8Array) => SqlDatabase;
}

type InitSqlJs = ((config: { locateFile: (file: string) => string }) => Promise<SqlModule>) | null;

let dbPromise: Promise<SqlDatabase> | null = null;
let _initSqlJs: InitSqlJs = null;

const NULL_DB: SqlDatabase = { run: () => {}, exec: () => [], close: () => {}, export: () => new Uint8Array() };

export function safeId(prefix: string): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${stamp}_${random}`;
}

export function memoryPath(input: string): string {
  const liveMemoryRoot = nodePath.resolve(getMemoryRoot());
  const frozenMr = nodePath.resolve(MEMORY_ROOT);
  const wsRoot = nodePath.resolve(getWorkspaceRoot());
  const raw = String(input ?? "").trim();

  let abs: string;
  if (nodePath.isAbsolute(raw)) {
    abs = nodePath.resolve(raw);
    if (abs === frozenMr || abs.startsWith(frozenMr + nodePath.sep)) {
      const suffix = nodePath.relative(frozenMr, abs);
      abs = nodePath.resolve(liveMemoryRoot, suffix);
    }
  } else if (raw === "memory" || raw.startsWith(`memory${nodePath.sep}`) || raw.startsWith("memory/")) {
    abs = nodePath.resolve(wsRoot, raw.replace(/\\/g, "/"));
  } else {
    abs = nodePath.resolve(liveMemoryRoot, raw);
  }

  if (!isWithinWorkspaceAbs(abs)) {
    throw new Error(`Path escapes workspace: ${abs}`);
  }
  return abs;
}

export async function ensureMemoryDirs(): Promise<void> {
  await fs.mkdir(memoryPath(MEMORY_ROOT), { recursive: true });
  await fs.mkdir(memoryPath(MEMORY_CONVERSATIONS_DIR), { recursive: true });
  await fs.mkdir(memoryPath(MEMORY_RUNS_DIR), { recursive: true });
  await fs.mkdir(memoryPath(MEMORY_REFLECTIONS_DIR), { recursive: true });
  await fs.mkdir(memoryPath(MEMORY_SNAPSHOTS_DIR), { recursive: true });
  await fs.mkdir(memoryPath(MEMORY_JOBS_DIR), { recursive: true });
}

export async function safeWriteJson(path: string, value: unknown): Promise<void> {
  const abs = memoryPath(path);
  await ensureParentDir(abs);
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmp, abs);
}

export async function safeWriteBytes(path: string, value: Uint8Array | Buffer): Promise<void> {
  const abs = memoryPath(path);
  await ensureParentDir(abs);
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, value);
  await fs.rename(tmp, abs);
}

export async function appendJsonLine(path: string, value: unknown): Promise<number> {
  const abs = memoryPath(path);
  await ensureParentDir(abs);
  const line = `${JSON.stringify(value)}\n`;
  await fs.appendFile(abs, line, "utf8");
  return Buffer.byteLength(line, "utf8");
}

export async function readJsonFile(abs: string, kind: string): Promise<unknown> {
  try {
    const raw = await fs.readFile(abs, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    await logDebugEvent("memory_corrupt_file_skipped", {
      kind,
      path: toWorkspaceDisplayPath(abs),
      error: errorMessage(error),
    });
    return null;
  }
}

interface FileEntry {
  abs: string;
  mtimeMs: number;
  name: string;
}

export async function readJsonFilesNewestFirst(
  dir: string,
  limit: number | undefined,
  kind: string
): Promise<unknown[]> {
  const absDir = memoryPath(dir);
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: FileEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const abs = nodePath.join(absDir, entry.name);
    try {
      const stat = await fs.stat(abs);
      files.push({ abs, mtimeMs: stat.mtimeMs, name: entry.name });
    } catch {
      /* skip */
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  const out: unknown[] = [];
  for (const file of files.slice(0, Math.max(0, Number(limit || 0)))) {
    const parsed = await readJsonFile(file.abs, kind);
    if (parsed) out.push(parsed);
  }
  return out;
}

export async function getDb(): Promise<SqlDatabase> {
  if (!_initSqlJs) {
    try {
      const mod = await import("../vendor/sql-wasm.cjs");
      _initSqlJs = (mod.default ?? mod) as InitSqlJs;
    } catch {
      _initSqlJs = null;
    }
  }

  if (!_initSqlJs) return NULL_DB;

  if (!dbPromise) {
    const fn: InitSqlJs = _initSqlJs;
    dbPromise = (async () => {
      await ensureMemoryDirs();
      const SQL = await fn({
        locateFile: (file: string) => new URL(`../vendor/${file}`, import.meta.url).pathname,
      });
      const dbPath = memoryPath(MEMORY_DB_PATH);
      let db: SqlDatabase;
      try {
        const bytes = await fs.readFile(dbPath);
        db = new SQL.Database(bytes);
      } catch {
        db = new SQL.Database();
      }

      db.run(`
        CREATE TABLE IF NOT EXISTS facts(
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          created_at TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tool_stats(
          tool_name TEXT PRIMARY KEY,
          success_count INTEGER NOT NULL DEFAULT 0,
          failure_count INTEGER NOT NULL DEFAULT 0,
          last_used TEXT
        );
        CREATE TABLE IF NOT EXISTS jobs(
          job_id TEXT PRIMARY KEY,
          run_id TEXT,
          tool_name TEXT,
          status TEXT NOT NULL,
          command TEXT,
          cwd TEXT,
          started_at TEXT NOT NULL,
          completed_at TEXT,
          last_log_offset INTEGER NOT NULL DEFAULT 0,
          notify_policy TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS job_events(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          dispatched INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS learnings(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT NOT NULL,
          statement TEXT NOT NULL,
          confidence REAL NOT NULL,
          evidence_count INTEGER NOT NULL DEFAULT 1,
          contradicted INTEGER NOT NULL DEFAULT 0,
          source_run_id TEXT,
          metadata TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(category, statement)
        );
      `);

      try { db.run("ALTER TABLE facts ADD COLUMN created_at TEXT"); } catch { /* already exists */ }

      await persistDb(db, true);
      return db;
    })();
  }

  return dbPromise;
}

let _persistDbTimer: NodeJS.Timeout | null = null;

export async function persistDb(db: SqlDatabase | null, force = false): Promise<void> {
  if (!db || db === NULL_DB || typeof db.export !== "function") return;

  if (force) {
    if (_persistDbTimer) { clearTimeout(_persistDbTimer); _persistDbTimer = null; }
    await safeWriteBytes(MEMORY_DB_PATH, db.export());
    return;
  }

  if (_persistDbTimer) return;

  _persistDbTimer = setTimeout(() => {
    _persistDbTimer = null;
    safeWriteBytes(MEMORY_DB_PATH, db.export()).catch(() => {});
  }, 3000);
}
