import { test } from "node:test";
import assert from "node:assert/strict";
import { SLASH_COMMANDS } from "../src/agent/runtime/commands.js";
import {
  parseLocalSlashCommand,
  RESERVED_SLASH_TOKENS,
} from "../src/agent/runtime/slash-routing.js";

test("removed slash commands are not in help or routing", () => {
  const names = SLASH_COMMANDS.map((c) => c.name.split(/\s/)[0]);
  for (const removed of ["/exit", "/clarify", "/voice", "/mcp", "/reload-mcp"]) {
    assert.ok(!names.includes(removed), `should not list ${removed}`);
  }
  assert.ok(!RESERVED_SLASH_TOKENS.has("exit"));
  assert.ok(!RESERVED_SLASH_TOKENS.has("voice"));
  assert.ok(!RESERVED_SLASH_TOKENS.has("clarify"));
  assert.ok(!RESERVED_SLASH_TOKENS.has("mcp"));
  assert.deepEqual(parseLocalSlashCommand("/exit"), { kind: "none" });
  assert.deepEqual(parseLocalSlashCommand("/clarify"), { kind: "none" });
  assert.deepEqual(parseLocalSlashCommand("/voice on"), { kind: "none" });
});
