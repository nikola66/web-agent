import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nodePath from "node:path";

import { PYODIDE_VERSION } from "../src/runtimes/webcontainer/pyodide-config.js";

const RUNTIME_DIR = nodePath.join(process.cwd(), "src/runtimes/webcontainer");

test("pyodide-capabilities.json matches pinned Pyodide version", async () => {
  const raw = await fs.readFile(nodePath.join(RUNTIME_DIR, "pyodide-capabilities.json"), "utf8");
  const manifest = JSON.parse(raw) as Record<string, unknown>;
  assert.equal(manifest.runtime, "pyodide");
  assert.equal(manifest.version, PYODIDE_VERSION);
  assert.equal(manifest.environment, "browser-wasm");
  assert.equal(manifest.supports_subprocess, false);
  assert.equal(manifest.supports_native_modules, false);
  assert.equal(manifest.supports_tcp, false);
  assert.equal(manifest.networking, "fetch-via-webagent-http-bridge");
  assert.equal(manifest.filesystem, "virtual-emscripten-fs");
  assert.equal(manifest.js_interop, true);
  assert.equal(manifest.preferred_http, "webagent.http");
});

test("pyodide-substitution-matrix.json has forbidden imports and patterns", async () => {
  const raw = await fs.readFile(nodePath.join(RUNTIME_DIR, "pyodide-substitution-matrix.json"), "utf8");
  const matrix = JSON.parse(raw) as {
    forbidden_imports: Record<string, { prefer: string[] }>;
    forbidden_binaries: Record<string, string>;
    patterns: Array<{ task: string; bad: string; good: string }>;
  };
  assert.ok(matrix.forbidden_imports.requests?.prefer.includes("webagent.http"));
  assert.ok(matrix.forbidden_binaries.soffice);
  assert.ok(matrix.patterns.some((p) => /ZIP/i.test(p.task)));
  assert.ok(matrix.patterns.length >= 6);
});

test("capabilities manifest references substitution matrix file", async () => {
  const raw = await fs.readFile(nodePath.join(RUNTIME_DIR, "pyodide-capabilities.json"), "utf8");
  const manifest = JSON.parse(raw) as { substitution_matrix: string };
  const matrixPath = nodePath.join(RUNTIME_DIR, manifest.substitution_matrix);
  await fs.access(matrixPath);
});
