import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nodePath from "node:path";

import {
  buildMissingPathHint,
  looksLikeFilePath,
  resolveGrepSearchTarget,
} from "../src/agent/runtime/tools/filesystem/path-hints.ts";
import { grepTool } from "../src/agent/runtime/tools/filesystem/search.ts";

test("looksLikeFilePath detects file basenames", () => {
  assert.equal(looksLikeFilePath(".webagent/package.json"), true);
  assert.equal(looksLikeFilePath("src/agent/runtime/background-review.ts"), true);
  assert.equal(looksLikeFilePath("projects"), false);
  assert.equal(looksLikeFilePath("."), false);
});

test("buildMissingPathHint explains missing parent and workspace layout", async () => {
  const hint = await buildMissingPathHint(
    {},
    `tmp/_missing_path_hint_${Date.now()}/src/agent/runtime/background-review.ts`
  );
  assert.match(hint, /Path not found:/);
  assert.match(hint, /workspace-relative|workspace root/i);
  assert.match(hint, /browse_workspace|workspace-map/);
});

test("resolveGrepSearchTarget accepts existing file paths", async () => {
  const slug = `_grep_root_file_${Date.now()}`;
  const fileRel = nodePath.join("tmp", slug, "notes.txt").replace(/\\/g, "/");
  const abs = nodePath.join(process.cwd(), fileRel);
  try {
    await fs.mkdir(nodePath.dirname(abs), { recursive: true });
    await fs.writeFile(abs, "skill_manage probe\n", "utf8");
    const target = await resolveGrepSearchTarget({}, fileRel);
    assert.equal(target.isFile, true);
    const out = await grepTool({ pattern: "skill_manage", root: fileRel }, {});
    assert.equal(out.searchMode, "file");
    assert.ok(out.hits.length >= 1);
  } finally {
    await fs.rm(nodePath.dirname(abs), { recursive: true, force: true });
  }
});

test("resolveGrepSearchTarget rejects missing paths with layout hint", async () => {
  const missing = `tmp/_grep_missing_${Date.now()}/nope/background-review.ts`;
  await assert.rejects(
    () => resolveGrepSearchTarget({}, missing),
    /Path not found:/
  );
});
