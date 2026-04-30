import test from "node:test";
import assert from "node:assert/strict";
import initSqlJs from "sql.js";

import {
  buildArchiveIndex,
  parseFactValue,
  parseSessionMemoryJsonl,
  querySqliteMemory,
} from "../src/core/agent-memory-parsers.ts";
import type { WorkspaceFileEntry } from "../src/core/workspace.ts";

test("parseFactValue parses JSON and falls back to raw strings", () => {
  assert.deepEqual(parseFactValue('{"mode":"dark"}'), { mode: "dark" });
  assert.equal(parseFactValue("plain-text"), "plain-text");
});

test("parseSessionMemoryJsonl tolerates malformed lines and returns newest first", () => {
  const content = [
    '{"ts":"2026-05-12T10:00:00.000Z","kind":"note","text":"older"}',
    "not-json",
    '{"ts":"2026-05-12T11:00:00.000Z","kind":"decision","text":"newer"}',
  ].join("\n");

  const entries = parseSessionMemoryJsonl(content);
  assert.equal(entries.length, 3);
  assert.equal(entries[0]?.text, "newer");
  assert.equal(entries[1]?.parse_error, true);
  assert.equal(entries[2]?.text, "older");
});

test("buildArchiveIndex summarizes archive files", () => {
  const files: WorkspaceFileEntry[] = [
    { path: "memory/conversations/a.json", size: 120 },
    { path: "memory/conversations/b.json", size: 80 },
    { path: "memory/runs/run_1.json", size: 40 },
    { path: "memory/snapshots/spill.txt", size: 10 },
  ];

  const conversations = buildArchiveIndex(files, "memory/conversations/");
  assert.equal(conversations.count, 2);
  assert.equal(conversations.totalBytes, 200);
  assert.deepEqual(conversations.latestPaths, ["b.json", "a.json"]);
});

test("querySqliteMemory maps sqlite rows into snapshot sections", async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE facts(
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE learnings(
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
    CREATE TABLE tool_stats(
      tool_name TEXT PRIMARY KEY,
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_used TEXT
    );
    CREATE TABLE jobs(
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
    CREATE TABLE job_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      dispatched INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.run(
    `INSERT INTO facts(key, value, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    ["user_timezone", '"UTC+4"', "2026-05-12T08:00:00.000Z", "2026-05-12T09:00:00.000Z"]
  );
  db.run(
    `INSERT INTO learnings(category, statement, confidence, evidence_count, contradicted, source_run_id, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, NULL, ?, ?)`,
    [
      "tool_strategy",
      "Read before write",
      0.8,
      2,
      "run_1",
      "2026-05-12T08:00:00.000Z",
      "2026-05-12T09:00:00.000Z",
    ]
  );
  db.run(
    `INSERT INTO tool_stats(tool_name, success_count, failure_count, last_used)
     VALUES (?, ?, ?, ?)`,
    ["read_file", 3, 1, "2026-05-12T09:30:00.000Z"]
  );
  db.run(
    `INSERT INTO jobs(job_id, run_id, tool_name, status, command, cwd, started_at, completed_at, last_log_offset, notify_policy, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)`,
    [
      "job_1",
      "run_1",
      "shell",
      "completed",
      "npm test",
      "/workspace",
      "2026-05-12T08:00:00.000Z",
      "2026-05-12T08:05:00.000Z",
      "2026-05-12T08:05:00.000Z",
    ]
  );
  db.run(
    `INSERT INTO job_events(job_id, event_type, payload, created_at, dispatched)
     VALUES (?, ?, ?, ?, 0)`,
    ["job_1", "stdout", '{"text":"ok"}', "2026-05-12T08:01:00.000Z"]
  );

  const snapshot = querySqliteMemory(db);
  assert.equal(snapshot.facts.length, 1);
  assert.equal(snapshot.facts[0]?.key, "user_timezone");
  assert.equal(snapshot.facts[0]?.value, "UTC+4");
  assert.equal(snapshot.learnings[0]?.statement, "Read before write");
  assert.equal(snapshot.toolStats[0]?.tool_name, "read_file");
  assert.equal(snapshot.jobs[0]?.job_id, "job_1");
  assert.equal(snapshot.jobEvents[0]?.event_type, "stdout");

  db.close();
});
