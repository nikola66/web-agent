import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nodePath from "node:path";

import { multiEditTool } from "../dist/agent-runtime/tools/filesystem-tools.js";

function fixturePath(name) {
  return nodePath.join(process.cwd(), "tmp", name);
}

async function writeFixture(name, content) {
  const abs = fixturePath(name);
  await fs.mkdir(nodePath.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  return { abs, rel: nodePath.relative(process.cwd(), abs) };
}

test("multiEditTool applies array edits", async (t) => {
  const { abs, rel } = await writeFixture(
    "multi-edit-array.txt",
    "Hello world\ntest value\n"
  );
  t.after(async () => {
    await fs.rm(abs, { force: true });
  });

  const result = await multiEditTool(
    {
      path: rel,
      edits: [
        { find: "Hello", replace: "Hi" },
        { find: "test", replace: "sample" },
      ],
    },
    {}
  );

  const updated = await fs.readFile(abs, "utf8");
  assert.equal(result.ok, true);
  assert.equal(result.replacements, 2);
  assert.equal(updated, "Hi world\nsample value\n");
});

test("multiEditTool applies JSON-string edits", async (t) => {
  const { abs, rel } = await writeFixture(
    "multi-edit-string.txt",
    "Hello world\ntest value\n"
  );
  t.after(async () => {
    await fs.rm(abs, { force: true });
  });

  const result = await multiEditTool(
    {
      path: rel,
      edits: JSON.stringify([
        { find: "Hello", replace: "Hi" },
        { find: "test", replace: "sample" },
      ]),
    },
    {}
  );

  const updated = await fs.readFile(abs, "utf8");
  assert.equal(result.ok, true);
  assert.equal(result.replacements, 2);
  assert.equal(updated, "Hi world\nsample value\n");
});

test("multiEditTool errors clearly for invalid JSON edits string", async (t) => {
  const { abs, rel } = await writeFixture("multi-edit-invalid.txt", "Hello\n");
  t.after(async () => {
    await fs.rm(abs, { force: true });
  });

  await assert.rejects(
    async () => {
      await multiEditTool({ path: rel, edits: "[not-json]" }, {});
    },
    /valid JSON array string/
  );
});
