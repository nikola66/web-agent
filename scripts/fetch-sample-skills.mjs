#!/usr/bin/env node
/**
 * Refresh sample-skills corpus from skills-manifest.json (clone/fetch entries).
 * Usage: node scripts/fetch-sample-skills.mjs [manifest-path]
 */
import fs from "node:fs/promises";
import nodePath from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const manifestPath = nodePath.resolve(
  process.argv[2] || "tmp/repos/sample-skills/skills-manifest.json"
);
const baseDir = nodePath.dirname(manifestPath);
const skillsRoot = nodePath.join(baseDir, "skills");

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function cloneRepo(url, target) {
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(nodePath.dirname(target), { recursive: true });
  await exec("git", ["clone", "--depth", "1", url, target], { timeout: 120_000 });
}

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const results = [];

for (const entry of manifest) {
  const author = entry.author || entry.owner;
  const slug = entry.slug || entry.name;
  const target = nodePath.join(skillsRoot, author, slug);
  const row = { author, slug, target, status: "skipped" };
  try {
    if (entry.repo) {
      await cloneRepo(entry.repo.replace(/\.git$/, "") + (entry.repo.endsWith(".git") ? "" : ".git"), target);
      row.status = "cloned_repo";
      row.source = entry.repo;
    } else if (entry.url) {
      await fs.mkdir(target, { recursive: true });
      const text = await fetchText(entry.url);
      await fs.writeFile(nodePath.join(target, "SKILL.md"), text, "utf8");
      row.status = "fetched_url";
      row.source = entry.url;
    } else {
      row.status = "no_source";
    }
    results.push(row);
  } catch (e) {
    row.status = "failed";
    row.error = String(e?.message || e);
    results.push(row);
  }
}

const report = {
  fetched_at: new Date().toISOString(),
  manifest: manifestPath,
  results,
};
const reportPath = nodePath.join(baseDir, "fetch-report.json");
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Fetched ${results.filter((r) => r.status !== "failed").length}/${results.length} skills`);
console.log(`Wrote ${reportPath}`);
