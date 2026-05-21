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
  if (adapterSource.includes('dist/agent-runtime/tools/**/*.js')) {
    for (const rel of listDistJsFiles(path.join(distRuntime, "tools"))) {
      paths.add(`tools/${rel}`);
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
