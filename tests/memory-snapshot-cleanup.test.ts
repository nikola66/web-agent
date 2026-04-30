import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";

import {
  cleanupSnapshotsNotReferenced,
  collectReferencedSnapshotBasenames,
  sanitizeMessagesMissingSnapshotRefs,
} from "../dist/agent-runtime/memory/index.js";

test("collectReferencedSnapshotBasenames finds memory/snapshots paths in tool result JSON", () => {
  const history = [
    {
      role: "user",
      content:
        'Tool results (compact JSON):\n[{"summary":"x","result_ref":"memory/snapshots/run_abc_r1_0.json"}]',
    },
  ];
  const keep = collectReferencedSnapshotBasenames(history);
  assert.equal(keep.has("run_abc_r1_0.json"), true);
});

test("collectReferencedSnapshotBasenames ignores unrelated paths", () => {
  const keep = collectReferencedSnapshotBasenames([
    { role: "user", content: "Read data/other/file.json" },
  ]);
  assert.equal(keep.size, 0);
});

test("cleanupSnapshotsNotReferenced deletes only unreferenced files", async () => {
  const prev = process.env.WEBAGENT_SNAPSHOT_ORPHAN_MIN_AGE_MS;
  process.env.WEBAGENT_SNAPSHOT_ORPHAN_MIN_AGE_MS = "0";
  try {
    const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "webagent-snap-"));
    const snapDir = nodePath.join(root, "snapshots");
    await fs.mkdir(snapDir, { recursive: true });
    await fs.writeFile(nodePath.join(snapDir, "keep_me.json"), '{"x":1}', "utf8");
    await fs.writeFile(nodePath.join(snapDir, "orphan.json"), '{"y":2}', "utf8");

    const history = [
      {
        role: "user",
        content: 'prior tool memory/snapshots/keep_me.json and nothing else',
      },
    ];
    await cleanupSnapshotsNotReferenced(history, snapDir);

    const names = (await fs.readdir(snapDir)).sort();
    assert.deepEqual(names, ["keep_me.json"]);
    await fs.rm(root, { recursive: true, force: true });
  } finally {
    if (prev === undefined) delete process.env.WEBAGENT_SNAPSHOT_ORPHAN_MIN_AGE_MS;
    else process.env.WEBAGENT_SNAPSHOT_ORPHAN_MIN_AGE_MS = prev;
  }
});

test("cleanupSnapshotsNotReferenced with empty history removes all snapshot JSON", async () => {
  const prev = process.env.WEBAGENT_SNAPSHOT_ORPHAN_MIN_AGE_MS;
  process.env.WEBAGENT_SNAPSHOT_ORPHAN_MIN_AGE_MS = "0";
  try {
    const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "webagent-snap2-"));
    const snapDir = nodePath.join(root, "snapshots");
    await fs.mkdir(snapDir, { recursive: true });
    await fs.writeFile(nodePath.join(snapDir, "a.json"), "{}", "utf8");

    await cleanupSnapshotsNotReferenced([], snapDir);

    const names = await fs.readdir(snapDir);
    assert.equal(names.length, 0);
    await fs.rm(root, { recursive: true, force: true });
  } finally {
    if (prev === undefined) delete process.env.WEBAGENT_SNAPSHOT_ORPHAN_MIN_AGE_MS;
    else process.env.WEBAGENT_SNAPSHOT_ORPHAN_MIN_AGE_MS = prev;
  }
});

test("cleanupSnapshotsNotReferenced keeps young orphans by default", async () => {
  const prev = process.env.WEBAGENT_SNAPSHOT_ORPHAN_MIN_AGE_MS;
  delete process.env.WEBAGENT_SNAPSHOT_ORPHAN_MIN_AGE_MS;
  try {
    const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "webagent-snap-age-"));
    const snapDir = nodePath.join(root, "snapshots");
    await fs.mkdir(snapDir, { recursive: true });
    const youngPath = nodePath.join(snapDir, "fresh_orphan.json");
    const stalePath = nodePath.join(snapDir, "stale_orphan.json");
    await fs.writeFile(youngPath, '{"x":1}', "utf8");
    await fs.writeFile(stalePath, '{"x":2}', "utf8");
    const oldSec = Math.floor(Date.now() / 1000) - 100_000;
    await fs.utimes(stalePath, oldSec, oldSec);

    await cleanupSnapshotsNotReferenced([], snapDir);

    const names = (await fs.readdir(snapDir)).sort();
    assert.deepEqual(names, ["fresh_orphan.json"]);
    await fs.rm(root, { recursive: true, force: true });
  } finally {
    if (prev === undefined) delete process.env.WEBAGENT_SNAPSHOT_ORPHAN_MIN_AGE_MS;
    else process.env.WEBAGENT_SNAPSHOT_ORPHAN_MIN_AGE_MS = prev;
  }
});

test("sanitize_messages strips result_ref when snapshot file is missing", async () => {
  const snapDir = await fs.mkdtemp(nodePath.join(os.tmpdir(), "webagent-sanitize-"));
  await fs.writeFile(nodePath.join(snapDir, "exists.json"), "{}", "utf8");

  const history = [
    {
      role: "user",
      content:
        "Tool results (compact JSON):\n" +
        JSON.stringify(
          [
            {
              tool: "web_fetch",
              status: "ok",
              summary: "big",
              result_ref: "memory/snapshots/exists.json",
            },
            {
              tool: "web_fetch",
              status: "ok",
              summary: "gone",
              result_ref: "memory/snapshots/missing.json",
            },
          ],
          null,
          2
        ),
    },
  ];

  const out = await sanitizeMessagesMissingSnapshotRefs(history, { snapshotsAbsDirOverride: snapDir });
  assert.equal(out.length, 1);
  const parsed = JSON.parse(out[0].content.replace(/^Tool results \(compact JSON\):\n/, ""));
  assert.equal(parsed[0].result_ref, "memory/snapshots/exists.json");
  assert.equal(parsed[1].result_ref, undefined);
  assert.ok(String(parsed[1].summary).includes("stale result_ref removed"));

  await fs.rm(snapDir, { recursive: true, force: true });
});
