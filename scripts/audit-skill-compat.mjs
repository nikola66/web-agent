#!/usr/bin/env node
/**
 * Batch-audit skill directories against analyzeSkillCompat + Python preflight.
 * Usage: node scripts/audit-skill-compat.mjs [skills-root]
 */
import fs from "node:fs/promises";
import nodePath from "node:path";
import { pathToFileURL } from "node:url";

const root = nodePath.resolve(process.argv[2] || "tmp/repos/sample-skills/skills");
const outPath = nodePath.join(nodePath.dirname(root), "audit-compat.json");

const distBase = nodePath.join(process.cwd(), "dist/agent-runtime");
const { analyzeSkillCompat } = await import(
  pathToFileURL(nodePath.join(distBase, "memory/skill-compat.js")).href
);
const { preflightPythonForSkillFile } = await import(
  pathToFileURL(nodePath.join(distBase, "tools/python-preflight.js")).href
);

const SKILL_MD = "SKILL.md";
const PY_DIRS = new Set(["scripts", "lib", "src"]);

function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) return { meta: {} };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { meta: {} };
  const block = raw.slice(3, end).trim();
  const meta = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (!m) continue;
    const [, key, val] = m;
    if (val.startsWith("[") && val.endsWith("]")) {
      meta[key] = val
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    } else {
      meta[key] = val.replace(/^['"]|['"]$/g, "");
    }
  }
  return { meta };
}

async function listPyFiles(skillDir) {
  const out = [];
  const walk = async (abs, rel) => {
    const entries = await fs.readdir(abs, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const nextAbs = nodePath.join(abs, e.name);
      const nextRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (["tests", "examples", "node_modules", ".git", "test"].includes(e.name)) continue;
        await walk(nextAbs, nextRel);
        continue;
      }
      if (e.isFile() && e.name.endsWith(".py")) out.push({ path: nextRel, abs: nextAbs });
    }
  };
  await walk(skillDir, "");
  return out.slice(0, 32);
}

async function auditSkill(skillDir, id) {
  const skillMd = nodePath.join(skillDir, SKILL_MD);
  let raw = "";
  let hasSkillMd = false;
  try {
    raw = await fs.readFile(skillMd, "utf8");
    hasSkillMd = true;
  } catch {
    return { skill: id, has_skill_md: false, tier: "unknown", scripts: [] };
  }
  const { meta } = parseFrontmatter(raw);
  const analysis = analyzeSkillCompat(raw, meta);
  const scripts = [];
  for (const file of await listPyFiles(skillDir)) {
    const content = await fs.readFile(file.abs, "utf8");
    const pre = preflightPythonForSkillFile(file.path, content);
    scripts.push({
      path: file.path,
      blocked: Boolean(pre.block),
      block: pre.block || undefined,
      auto_packages: pre.autoPackages,
      micropip_packages: pre.micropipPackages,
      warnings: pre.warnings.slice(0, 4),
    });
  }
  return {
    skill: id,
    has_skill_md: hasSkillMd,
    tier: analysis.tier,
    flags: analysis.flags,
    python_libraries: analysis.python_libraries,
    runnable_scripts: scripts.filter((s) => !s.blocked).length,
    blocked_scripts: scripts.filter((s) => s.blocked).length,
    scripts,
  };
}

const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
const rows = [];
for (const author of entries) {
  if (!author.isDirectory()) continue;
  const authorDir = nodePath.join(root, author.name);
  const skills = await fs.readdir(authorDir, { withFileTypes: true }).catch(() => []);
  for (const skill of skills) {
    if (!skill.isDirectory()) continue;
    const skillDir = nodePath.join(authorDir, skill.name);
    rows.push(await auditSkill(skillDir, `${author.name}/${skill.name}`));
  }
}

const summary = {
  audited_at: new Date().toISOString(),
  root,
  skills: rows.length,
  tier_counts: rows.reduce((acc, r) => {
    acc[r.tier] = (acc[r.tier] || 0) + 1;
    return acc;
  }, {}),
  runnable_script_skills: rows.filter((r) => r.runnable_scripts > 0).length,
  blocked_script_skills: rows.filter((r) => r.blocked_scripts > 0).length,
};

const report = { summary, rows };
await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
console.log(`Wrote ${outPath}`);
