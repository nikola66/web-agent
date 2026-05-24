import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLocalSlashCommand } from "../src/agent/runtime/slash-routing.js";
import { RESERVED_SLASH_TOKENS } from "../src/agent/runtime/slash-routing.js";

test("parseLocalSlashCommand recognizes reload-mcp and mcp", () => {
  assert.deepEqual(parseLocalSlashCommand("/reload-mcp"), { kind: "reload_mcp" });
  assert.deepEqual(parseLocalSlashCommand("/reload_mcp"), { kind: "reload_mcp" });
  assert.deepEqual(parseLocalSlashCommand("/mcp list"), { kind: "mcp", input: "/mcp list" });
});

test("reserved tokens include mcp commands", () => {
  assert.ok(RESERVED_SLASH_TOKENS.has("reload_mcp"));
  assert.ok(RESERVED_SLASH_TOKENS.has("mcp"));
});
