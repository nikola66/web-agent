import test from "node:test";
import assert from "node:assert/strict";

import { expandSkillBulkSaveArgs } from "../dist/agent-runtime/tools/skill-bulk-args.js";

test("expandSkillBulkSaveArgs maps top-level url to single item", () => {
  const out = expandSkillBulkSaveArgs({
    url: " https://example.com/SKILL.md ",
    category: " imported ",
  });
  assert.deepEqual(out.items, [{ url: "https://example.com/SKILL.md", category: "imported" }]);
});

test("expandSkillBulkSaveArgs maps urls array to items", () => {
  const out = expandSkillBulkSaveArgs({
    urls: [" https://a/x.md ", "", "https://b/y.md"],
    category: "hub",
  });
  assert.deepEqual(out.items, [
    { url: "https://a/x.md", category: "hub" },
    { url: "https://b/y.md", category: "hub" },
  ]);
});

test("expandSkillBulkSaveArgs leaves non-empty items unchanged", () => {
  const items = [{ name: "n", content: "c" }];
  const out = expandSkillBulkSaveArgs({ items, url: "https://ignored/x.md" });
  assert.deepEqual(out.items, items);
});

test("expandSkillBulkSaveArgs empty items falls through to url", () => {
  const out = expandSkillBulkSaveArgs({ items: [], url: "https://z/s.md" });
  assert.deepEqual(out.items, [{ url: "https://z/s.md" }]);
});
