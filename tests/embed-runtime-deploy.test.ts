import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "..");
const distRuntime = path.join(root, "dist/agent-runtime");
const adapterPath = path.join(root, "src/agent/adapter.ts");

function listDistJsFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listDistJsFiles(full, base));
    else if (ent.name.endsWith(".js")) out.push(path.relative(base, full).replace(/\\/g, "/"));
  }
  return out.sort();
}

function adapterDeployPaths(adapterSource: string): Set<string> {
  const paths = new Set<string>();
  const writeRe = /writeFile\(\s*`\$\{webagentDir\}\/([^`]+)`/g;
  let m;
  while ((m = writeRe.exec(adapterSource))) {
    paths.add(m[1]);
  }
  if (adapterSource.includes("dist/agent-runtime/**/*.js")) {
    for (const rel of listDistJsFiles(distRuntime)) {
      paths.add(rel);
    }
    return paths;
  }
  if (adapterSource.includes('dist/agent-runtime/tools/**/*.js')) {
    for (const rel of listDistJsFiles(path.join(distRuntime, "tools"))) {
      paths.add(`tools/${rel}`);
    }
  }
  if (adapterSource.includes("dist/agent-runtime/llm/**/*.js")) {
    for (const rel of listDistJsFiles(path.join(distRuntime, "llm"))) {
      paths.add(`llm/${rel}`);
    }
  }
  if (adapterSource.includes('dist/agent-runtime/*.js')) {
    for (const rel of listDistJsFiles(distRuntime)) {
      if (!rel.includes("/")) paths.add(rel);
    }
  }
  return paths;
}

test("adapter deploys cron-scheduling.js for Nodebox cron_list", () => {
  assert.ok(fs.existsSync(distRuntime), "run npm run build:embed-runtime first");
  const adapterSource = fs.readFileSync(adapterPath, "utf8");
  const deployed = adapterDeployPaths(adapterSource);
  assert.ok(
    deployed.has("cron-scheduling.js"),
    `cron-scheduling.js must be written to .webagent; deployed sample: ${[...deployed].slice(0, 8).join(", ")}`
  );
  assert.ok(fs.existsSync(path.join(distRuntime, "cron-scheduling.js")));
});

test("adapter deploy covers all dist/agent-runtime/tools modules", () => {
  const adapterSource = fs.readFileSync(adapterPath, "utf8");
  const deployed = adapterDeployPaths(adapterSource);
  const toolFiles = listDistJsFiles(path.join(distRuntime, "tools"));
  const missing = toolFiles.filter((rel) => !deployed.has(`tools/${rel}`));
  assert.deepEqual(
    missing,
    [],
    `tools not deployed via adapter glob: ${missing.slice(0, 12).join(", ")}`
  );
});

test("adapter deploys tool-schema-sanitizer.js for registry Nodebox imports", () => {
  assert.ok(fs.existsSync(distRuntime), "run npm run build:embed-runtime first");
  const adapterSource = fs.readFileSync(adapterPath, "utf8");
  const deployed = adapterDeployPaths(adapterSource);
  const sanitizerRel = "llm/tool-schema-sanitizer.js";
  assert.ok(
    deployed.has(sanitizerRel),
    `adapter must deploy ${sanitizerRel} (registry imports ../llm/tool-schema-sanitizer.js)`
  );
  assert.ok(fs.existsSync(path.join(distRuntime, sanitizerRel)));
  const loaderSource = fs.readFileSync(path.join(distRuntime, "tools/tool-loader.js"), "utf8");
  assert.match(loaderSource, /tool-schema-sanitizer\.js/);
});

test("production Caddyfile routes subscription OAuth and LLM through sidecar", () => {
  const caddy = fs.readFileSync(path.join(root, "Caddyfile"), "utf8");
  assert.match(caddy, /\/api\/providers\/oauth/);
  assert.match(caddy, /\/api\/llm\/nous/);
  assert.match(caddy, /\/api\/llm\/openai-codex/);
});

test("cors-proxy-server handles subscription routes", () => {
  const source = fs.readFileSync(path.join(root, "scripts/cors-proxy-server.mjs"), "utf8");
  assert.match(source, /subscription\/router\.mjs/);
  assert.match(source, /handleSubscriptionHttp/);
});

test("adapter deploy covers all dist/agent-runtime/llm modules", () => {
  const adapterSource = fs.readFileSync(adapterPath, "utf8");
  const deployed = adapterDeployPaths(adapterSource);
  const llmFiles = listDistJsFiles(path.join(distRuntime, "llm"));
  const missing = llmFiles.filter((rel) => !deployed.has(`llm/${rel}`));
  assert.deepEqual(
    missing,
    [],
    `llm modules not deployed via adapter glob: ${missing.join(", ")}`
  );
});
