import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("cors proxy gate always returns HTTP 200 JSON envelope (upstream 204 must not strip body)", async () => {
  const vite = await fs.readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
  const block = vite.slice(vite.indexOf("function corsProxyGate"), vite.indexOf("function rawRuntimeFilesPlugin"));
  assert.match(block, /res\.statusCode = 200;/);
  assert.doesNotMatch(block, /res\.statusCode = upstream\.status;/);

  const sidecar = await fs.readFile(new URL("../scripts/cors-proxy-server.mjs", import.meta.url), "utf8");
  assert.match(sidecar, /res\.statusCode = 200;/);
  assert.doesNotMatch(sidecar, /res\.statusCode = upstream\.status;/);
});
