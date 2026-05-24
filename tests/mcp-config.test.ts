import { test } from "node:test";
import assert from "node:assert/strict";
import {
  interpolateEnvString,
  isServerEnabled,
  listEnabledServers,
  parseMcpServersConfig,
  shouldIncludeTool,
} from "../src/core/mcp/config.js";

test("parseMcpServersConfig ignores invalid entries", () => {
  const cfg = parseMcpServersConfig({
    ok: { command: "npx", args: ["-y", "pkg"] },
    bad: null,
    "": { url: "https://x.test/mcp" },
  });
  assert.equal(Object.keys(cfg).length, 1);
  assert.ok(cfg.ok);
});

test("interpolateEnvString replaces ${VAR}", () => {
  const out = interpolateEnvString("Bearer ${MCP_GITHUB_API_KEY}", {
    MCP_GITHUB_API_KEY: "secret",
  });
  assert.equal(out, "Bearer secret");
});

test("listEnabledServers skips disabled servers", () => {
  const rows = listEnabledServers(
    {
      a: { command: "npx", enabled: true },
      b: { url: "https://x.test", enabled: false },
    },
    {}
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0][0], "a");
});

test("shouldIncludeTool honors include and exclude", () => {
  assert.equal(shouldIncludeTool("read_file", { include: ["read_file"] }), true);
  assert.equal(shouldIncludeTool("write_file", { include: ["read_file"] }), false);
  assert.equal(shouldIncludeTool("write_file", { exclude: ["write_file"] }), false);
  assert.equal(isServerEnabled({ enabled: "false" }), false);
});
