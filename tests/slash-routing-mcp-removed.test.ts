import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLocalSlashCommand,
  RESERVED_SLASH_TOKENS,
} from "../src/agent/runtime/slash-routing.js";

test("MCP slash commands are not reserved or routed", () => {
  assert.ok(!RESERVED_SLASH_TOKENS.has("mcp"));
  assert.ok(!RESERVED_SLASH_TOKENS.has("reload_mcp"));
  assert.deepEqual(parseLocalSlashCommand("/mcp list"), { kind: "none" });
  assert.deepEqual(parseLocalSlashCommand("/reload-mcp"), { kind: "none" });
  assert.deepEqual(parseLocalSlashCommand("/mcp use https://example.com/mcp"), { kind: "none" });
});
