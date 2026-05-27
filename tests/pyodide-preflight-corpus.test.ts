import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nodePath from "node:path";

import { preflightPython } from "../src/agent/runtime/tools/python-preflight.js";

const FIXTURE_DIR = nodePath.join(process.cwd(), "tests/pyodide/fixtures/preflight");

type PreflightCase = {
  id: string;
  file: string;
  expect: "pass" | "block";
  auto_packages?: string[];
  auto_packages_includes?: string[];
  auto_packages_excludes?: string[];
  micropip_packages?: string[];
  must_warn?: string[];
  must_not_warn?: string[];
  block_match?: string[];
};

function warnText(warnings: string[]): string {
  return warnings.join("\n");
}

function assertWarnPatterns(warnings: string[], patterns: string[], label: string) {
  const text = warnText(warnings);
  for (const pattern of patterns) {
    assert.match(text, new RegExp(pattern, "i"), `${label}: expected warning matching /${pattern}/`);
  }
}

function assertNoWarnPatterns(warnings: string[], patterns: string[], label: string) {
  const text = warnText(warnings);
  for (const pattern of patterns) {
    assert.doesNotMatch(
      text,
      new RegExp(pattern, "i"),
      `${label}: should not warn matching /${pattern}/`
    );
  }
}

test("pyodide preflight fixture corpus", async (t) => {
  const raw = await fs.readFile(nodePath.join(FIXTURE_DIR, "manifest.json"), "utf8");
  const cases = JSON.parse(raw) as PreflightCase[];
  assert.ok(cases.length >= 30, "corpus should cover common agent Python patterns");

  for (const entry of cases) {
    await t.test(entry.id, async () => {
      const source = await fs.readFile(nodePath.join(FIXTURE_DIR, entry.file), "utf8");
      const pre = preflightPython(source);

      if (entry.expect === "block") {
        assert.ok(pre.block, `${entry.id} should be blocked`);
        for (const fragment of entry.block_match || []) {
          assert.match(pre.block!, new RegExp(fragment, "i"), `${entry.id} block message`);
        }
        return;
      }

      assert.equal(pre.block, undefined, `${entry.id} should pass preflight: ${pre.block}`);

      if (entry.auto_packages) {
        assert.deepEqual(
          [...pre.autoPackages].sort(),
          [...entry.auto_packages].sort(),
          `${entry.id} auto_packages`
        );
      }
      if (entry.auto_packages_includes) {
        for (const pkg of entry.auto_packages_includes) {
          assert.ok(
            pre.autoPackages.some((p) => p.toLowerCase() === pkg.toLowerCase()),
            `${entry.id} should auto-load ${pkg}`
          );
        }
      }
      if (entry.auto_packages_excludes) {
        for (const pkg of entry.auto_packages_excludes) {
          assert.ok(
            !pre.autoPackages.some((p) => p.toLowerCase() === pkg.toLowerCase()),
            `${entry.id} should not auto-load ${pkg}`
          );
        }
      }
      if (entry.micropip_packages) {
        assert.deepEqual(
          [...pre.micropipPackages].sort(),
          [...entry.micropip_packages].sort(),
          `${entry.id} micropip_packages`
        );
      }
      if (entry.must_warn?.length) {
        assertWarnPatterns(pre.warnings, entry.must_warn, entry.id);
      }
      if (entry.must_not_warn?.length) {
        assertNoWarnPatterns(pre.warnings, entry.must_not_warn, entry.id);
      }
    });
  }
});
