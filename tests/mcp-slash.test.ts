import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLocalSlashCommand } from "../src/agent/runtime/slash-routing.js";
import { RESERVED_SLASH_TOKENS } from "../src/agent/runtime/slash-routing.js";
import { parseMcpAuthInput, parseMcpUseInput } from "../src/agent/runtime/mcp-slash.js";
import { maskMcpToken, mcpSecretsToEnv, resolveMcpBearerToken } from "../src/agent/runtime/mcp-secrets.js";

test("parseLocalSlashCommand recognizes reload-mcp and mcp", () => {
  assert.deepEqual(parseLocalSlashCommand("/reload-mcp"), { kind: "reload_mcp" });
  assert.deepEqual(parseLocalSlashCommand("/reload_mcp"), { kind: "reload_mcp" });
  assert.deepEqual(parseLocalSlashCommand("/mcp list"), { kind: "mcp", input: "/mcp list" });
});

test("reserved tokens include mcp commands", () => {
  assert.ok(RESERVED_SLASH_TOKENS.has("reload_mcp"));
  assert.ok(RESERVED_SLASH_TOKENS.has("mcp"));
});

test("parseMcpUseInput extracts URL from natural language", () => {
  const parsed = parseMcpUseInput(
    "/mcp use your MCP tool for this https://hub.aratech.ae/mcp"
  );
  assert.ok(parsed);
  assert.equal(parsed.url, "https://hub.aratech.ae/mcp");
  assert.equal(parsed.name, "hub-aratech-ae-mcp");
});

test("parseMcpUseInput honors --name and --header", () => {
  const parsed = parseMcpUseInput(
    "/mcp use https://example.com/mcp --name directus --header Authorization=Bearer tok"
  );
  assert.ok(parsed);
  assert.equal(parsed.name, "directus");
  assert.equal(parsed.headers.Authorization, "Bearer tok");
});

test("parseMcpAuthInput extracts token or clear", () => {
  assert.deepEqual(parseMcpAuthInput("/mcp auth my-secret-token"), { token: "my-secret-token" });
  assert.deepEqual(parseMcpAuthInput("/mcp auth clear"), { clear: true });
  assert.equal(parseMcpAuthInput("/mcp auth"), null);
});

test("mcpSecretsToEnv maps bearer for header interpolation", () => {
  const env = mcpSecretsToEnv({ directus_token: "abc123" });
  assert.equal(env.DIRECTUS_TOKEN, "abc123");
  assert.equal(resolveMcpBearerToken({ bearer_token: "x" }), "x");
  assert.match(maskMcpToken("abcdefghijklmnop"), /abcd…mnop/);
});
