import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nodePath from "node:path";
import os from "node:os";
import {
  mcpAuthEnvWarnings,
  mcpEnvForConfigResolved,
} from "../src/agent/runtime/mcp-config.js";

async function withTempWorkspace(run: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "mcp-secrets-"));
  const previous = process.env.WEBAGENT_WORKSPACE_ROOT;
  process.env.WEBAGENT_WORKSPACE_ROOT = root;
  try {
    await run(root);
  } finally {
    if (previous === undefined) delete process.env.WEBAGENT_WORKSPACE_ROOT;
    else process.env.WEBAGENT_WORKSPACE_ROOT = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("mcpEnvForConfigResolved loads directus_token from mcp-secrets.json", async () => {
  await withTempWorkspace(async (root) => {
    await fs.mkdir(nodePath.join(root, ".webagent"), { recursive: true });
    await fs.writeFile(
      nodePath.join(root, ".webagent/mcp-secrets.json"),
      JSON.stringify({ directus_token: "secret-token-123" }),
      "utf8"
    );
    const config = {
      directus: {
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer ${DIRECTUS_TOKEN}" },
      },
    };
    const env = await mcpEnvForConfigResolved(config);
    assert.equal(env.DIRECTUS_TOKEN, "secret-token-123");
  });
});

test("mcpAuthEnvWarnings flags empty Bearer after interpolation", () => {
  const config = {
    directus: {
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer ${DIRECTUS_TOKEN}" },
    },
  };
  const warnings = mcpAuthEnvWarnings(config, {});
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /empty Authorization/i);
  assert.match(warnings[0], /mcp-secrets/i);
});
