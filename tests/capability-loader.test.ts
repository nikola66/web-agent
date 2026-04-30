import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nodePath from "node:path";

test("runtime discovers and executes drop-in tool capability folders", async (t) => {
  const id = `dynamic_fixture_${Date.now()}`;
  const root = nodePath.join(process.cwd(), ".webagent", "capabilities", "tools", id);
  await fs.mkdir(root, { recursive: true });
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.writeFile(
    nodePath.join(root, "manifest.json"),
    JSON.stringify(
      {
        id,
        emoji: "T",
        description: "Dynamic fixture tool",
        inputSchema: {
          type: "object",
          properties: {
            value: { type: "string" },
          },
          required: ["value"],
          additionalProperties: false,
        },
      },
      null,
      2
    ),
    "utf8"
  );
  await fs.writeFile(
    nodePath.join(root, "handler.js"),
    "export async function run(args) { return { ok: true, echoed: args.value }; }\n",
    "utf8"
  );

  const registry = await import("../dist/agent-runtime/tools/registry.js");
  registry.reloadToolCapabilitiesForTest();
  const catalog = await registry.loadToolCatalog();
  const names = await registry.getToolNamesAsync();
  assert.ok(names.includes(id));
  assert.equal(catalog[id].description, "Dynamic fixture tool");

  const tools = await registry.loadTools();
  const result = await tools[id]({ value: "loaded" }, {});
  assert.equal(result.echoed, "loaded");
});
