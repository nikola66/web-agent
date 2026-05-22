import test from "node:test";
import assert from "node:assert/strict";

import {
  isMemoryRunArchivePath,
  isMemorySnapshotSpillPath,
  memoryInternalBrowseBlockedMessage,
  memoryRunArchiveBlockedMessage,
  shellMemorySpillBypassBlockedMessage,
  shouldSkipMemoryInternalFileSearch,
} from "../dist/agent-runtime/memory/internal-paths.js";
import { unwrapMemorySnapshotReadContent } from "../dist/agent-runtime/memory/index.js";

test("isMemoryRunArchivePath matches run logs only", () => {
  assert.equal(isMemoryRunArchivePath("memory/runs/run_123_abc.json"), true);
  assert.equal(isMemoryRunArchivePath("memory/runs/"), true);
  assert.equal(isMemoryRunArchivePath("memory/snapshots/run_x_r1_0.json"), false);
});

test("shouldSkipMemoryInternalFileSearch excludes snapshots and runs", () => {
  assert.equal(shouldSkipMemoryInternalFileSearch("memory/snapshots/run_x.json"), true);
  assert.equal(shouldSkipMemoryInternalFileSearch("memory/runs/run_x.json"), true);
  assert.equal(shouldSkipMemoryInternalFileSearch("projects/foo.json"), false);
});

test("memoryInternalBrowseBlockedMessage blocks snapshots listing", () => {
  const msg = memoryInternalBrowseBlockedMessage("list_dir", "memory/snapshots");
  assert.match(msg ?? "", /will not help recover API data/i);
});

test("memoryRunArchiveBlockedMessage tells agent to rerun HTTP tools", () => {
  assert.match(
    memoryRunArchiveBlockedMessage("memory/runs/run_x.json"),
    /web_fetch|web_post/i
  );
});

test("shellMemorySpillBypassBlockedMessage blocks head on memory paths", () => {
  const msg = shellMemorySpillBypassBlockedMessage(
    "head -c 5000 memory/runs/run_1779456609356_q8tmpq.json"
  );
  assert.match(msg ?? "", /cannot read.*memory\/runs/i);
});

test("unwrapMemorySnapshotReadContent unwraps nested read_file snapshot payloads", () => {
  const innerFetch = { ok: true, text: "directus collections payload" };
  const innerSnapshot = JSON.stringify({
    payload: { tool: "web_fetch", result: innerFetch },
  });
  const outer = JSON.stringify({
    payload: {
      tool: "read_file",
      result: {
        ok: true,
        path: "memory/snapshots/run_inner_r1_0.json",
        content: innerSnapshot,
      },
    },
  });
  const out = unwrapMemorySnapshotReadContent("memory/snapshots/run_outer_r7_0.json", outer);
  assert.equal(out?.from_snapshot, true);
  assert.match(out?.content ?? "", /directus collections payload/);
});
