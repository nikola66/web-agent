import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nodePath from "node:path";

import { BUILTIN_TOOLS } from "../dist/agent-runtime/tools/registry-browser.js";

const PLAYBOOK_PATH = nodePath.join(process.cwd(), "docs/use-cases-playbook.md");
const SKILLS_DIR = nodePath.join(process.cwd(), "src/capabilities/skills");
const BUILTIN_TOOL_NAMES = new Set(Object.keys(BUILTIN_TOOLS));
const SLASH_COMMAND_EXCEPTIONS = new Set(["plan"]);
const NON_TOOL_TOKENS = new Set(["none", "CLARIFY"]);

function extractSkillSlugs(raw: string): string[] {
  return [...raw.matchAll(/`\/([a-z0-9-]+)`/g)].map((m) => m[1]);
}

function extractDeclaredTools(raw: string): string[] {
  const tools: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.includes("| `") && !line.startsWith("**Tools that fire:**")) continue;
    if (line.includes("*(none") || line.includes("*(redaction")) continue;
    const segment = line.startsWith("**Tools that fire:**")
      ? line.slice("**Tools that fire:**".length)
      : line.split("|").pop() ?? "";
    for (const match of segment.matchAll(/`([a-z_]+)`/g)) {
      const name = match[1];
      if (!NON_TOOL_TOKENS.has(name)) tools.push(name);
    }
  }
  return tools;
}

test("use-cases playbook has enough detail cards and valid skill/tool references", async () => {
  const raw = await fs.readFile(PLAYBOOK_PATH, "utf8");
  const detailsCount = (raw.match(/<details>/g) ?? []).length;
  assert.ok(detailsCount >= 20, `expected at least 20 <details> cards, got ${detailsCount}`);

  const skillDirs = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
  const bundledSlugs = new Set(
    skillDirs.filter((e) => e.isDirectory()).map((e) => e.name),
  );

  for (const slug of extractSkillSlugs(raw)) {
    assert.ok(
      bundledSlugs.has(slug) || SLASH_COMMAND_EXCEPTIONS.has(slug),
      `playbook references unknown skill or command /${slug}`,
    );
  }

  for (const tool of extractDeclaredTools(raw)) {
    assert.ok(BUILTIN_TOOL_NAMES.has(tool), `playbook references unknown tool \`${tool}\``);
  }
});
