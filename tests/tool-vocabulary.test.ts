import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nodePath from "node:path";

const ROOT = process.cwd();
const BUNDLED_SKILLS = nodePath.join(ROOT, "src/capabilities/skills");

const LEGACY_SKILL_TOOL = /\b(?:skill_view|skill_list|skill_manage|skill_bulk_save|skill_save|skill_create)\b/;
const LEGACY_BROWSE_AS_STANDALONE = /`(?:list_dir|find_files|tree)`/;
const LEGACY_BROWSE_BARE = /\b(?:list_dir|find_files)\b/;

const DOC_FILES = [
  "README.md",
  "README.es.md",
  "README.zh-CN.md",
  "README.ar.md",
  "docs/testing-checklist.md",
  "docs/test-prompts.md",
  "docs/es/testing-checklist.md",
  "docs/es/test-prompts.md",
  "docs/zh-CN/testing-checklist.md",
  "docs/zh-CN/test-prompts.md",
  "docs/ar/testing-checklist.md",
  "docs/ar/test-prompts.md",
  "docs/use-cases-playbook.md",
  "docs/es/use-cases-playbook.md",
  "docs/zh-CN/use-cases-playbook.md",
  "docs/ar/use-cases-playbook.md",
];

function stripWireAliasDisclaimer(body: string) {
  return body.replace(/^.*Hidden aliases[^\n]*\n/gm, "");
}

const EXCLUDED_SCAN_FILES = new Set([
  "skill-tool-normalize.ts",
  "streaming.ts",
  "find_files.ts",
  "list_dir.ts",
  "tree.ts",
  "tool-search-tools.ts",
  "argument-normalization.ts",
  "skill-bulk-args.ts",
  "remote-tools.ts",
  "tool-runner.ts",
  "tool-prep.ts",
  "snapshots.ts",
  "tool-result-preview.ts",
  "python-preflight.ts",
]);

const PROMPT_FILES = [
  "src/agent/runtime/memory-guidance.ts",
  "src/agent/runtime/background-review.ts",
  "src/agent/runtime/find-skills-slash.ts",
  "src/agent/runtime/turn-continuation.ts",
  "src/agent/runtime/execution-guidance.ts",
  "src/agent/runtime/planning-slash.ts",
  "src/agent/runtime/turn.ts",
  "src/agent/runtime/tool-capability-index.ts",
  "src/agent/runtime/workspace-map.ts",
  "src/agent/runtime/tools/builtins/web_fetch.ts",
  "src/agent/runtime/tools/builtins/web_post.ts",
  "src/agent/runtime/tools/builtins/web_upload.ts",
  "src/agent/runtime/tools/builtins/run_python.ts",
  "src/agent/runtime/tools/builtins/composio_action.ts",
  "src/agent/runtime/tools/builtins/read_file.ts",
  "src/agent/runtime/tools/builtins/grep.ts",
  "src/agent/runtime/tools/builtins/extract_archive.ts",
  "src/agent/runtime/tools/filesystem/read.ts",
  "src/agent/runtime/memory/skill-compat.ts",
  "src/agent/runtime/memory/skills.ts",
];

function stripImportMappingLeftColumn(body: string): string {
  return body.replace(/\| External[^\n]*\n\|[-| ]+\n([\s\S]*?)(\n\n|\n## )/m, (_m, table, tail) => {
    const rows = String(table)
      .split("\n")
      .filter((line) => line.startsWith("|"))
      .map((line) => {
        const parts = line.split("|");
        if (parts.length >= 4) return `| … |${parts.slice(2).join("|")}`;
        return line;
      })
      .join("\n");
    return `\n${rows}${tail}`;
  });
}

async function readBundledSkillBodies() {
  const entries = await fs.readdir(BUNDLED_SKILLS, { withFileTypes: true });
  const out: Array<{ slug: string; raw: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = nodePath.join(BUNDLED_SKILLS, entry.name, "SKILL.md");
    const raw = await fs.readFile(skillPath, "utf8");
    out.push({ slug: entry.name, raw });
  }
  return out;
}

test("bundled SKILL.md files use canonical skill and browse vocabulary", async () => {
  for (const { slug, raw } of await readBundledSkillBodies()) {
    const body = slug === "imported-skill-compat" ? stripImportMappingLeftColumn(raw) : raw;
    assert.doesNotMatch(body, LEGACY_SKILL_TOOL, `${slug}/SKILL.md still uses legacy skill tool names`);
    assert.doesNotMatch(
      body,
      LEGACY_BROWSE_AS_STANDALONE,
      `${slug}/SKILL.md teaches standalone list_dir/find_files/tree`
    );
  }
});

test("injected runtime prompts avoid legacy skill and browse tool names", async () => {
  for (const rel of PROMPT_FILES) {
    const raw = await fs.readFile(nodePath.join(ROOT, rel), "utf8");
    const body = rel.endsWith("skill-compat.ts") ? stripImportMappingLeftColumn(raw) : raw;
    assert.doesNotMatch(body, LEGACY_SKILL_TOOL, `${rel} still mentions legacy skill tool names`);
    if (!rel.includes("tool_search") && !rel.includes("tool_activate")) {
      assert.doesNotMatch(body, LEGACY_BROWSE_AS_STANDALONE, `${rel} teaches standalone browse aliases`);
    }
  }
});

test("contributor docs describe consolidated tool surface", async () => {
  const agentNotes = await fs.readFile(nodePath.join(ROOT, "docs/agent-notes.md"), "utf8");
  assert.match(agentNotes, /Skill tool \(model-facing\)[\s\S]*`skill`/);
  assert.doesNotMatch(agentNotes, LEGACY_SKILL_TOOL);

  const caps = await fs.readFile(nodePath.join(ROOT, "CAPABILITIES.md"), "utf8");
  assert.match(caps, /50 built-in tools/);
  assert.match(caps, /skill` \(action=view\)/);
});

test("README, playbooks, and manual test docs use canonical browse and skill vocabulary", async () => {
  for (const rel of DOC_FILES) {
    const raw = await fs.readFile(nodePath.join(ROOT, rel), "utf8");
    const body = stripWireAliasDisclaimer(raw);
    assert.doesNotMatch(body, LEGACY_SKILL_TOOL, `${rel} still mentions legacy skill tool names`);
    assert.doesNotMatch(body, LEGACY_BROWSE_AS_STANDALONE, `${rel} teaches standalone browse aliases in backticks`);
    assert.doesNotMatch(body, LEGACY_BROWSE_BARE, `${rel} still mentions list_dir or find_files`);
  }
});
