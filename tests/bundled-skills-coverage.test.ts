import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nodePath from "node:path";

import {
  listSkills,
  viewSkill,
  buildSkillsContextBlock,
  invalidateSkillsContextCache,
} from "../dist/agent-runtime/memory/index.js";

const BUNDLED_SKILL_DIR = nodePath.join(process.cwd(), "src/capabilities/skills");

function parseTriggersFromRaw(raw) {
  const inline = raw.match(/^triggers:\s*\[([^\]]+)\]/m);
  if (inline) {
    return inline[1]
      .split(",")
      .map((t) => t.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  const blockStart = raw.match(/^triggers:\s*$/m);
  if (!blockStart) return [];
  const lines = raw.split("\n");
  const idx = lines.findIndex((line) => /^triggers:\s*$/.test(line));
  const out = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s*-\s+(.+)$/);
    if (!m) break;
    out.push(m[1].trim());
  }
  return out;
}

async function readBundledSkillSlugs() {
  const entries = await fs.readdir(BUNDLED_SKILL_DIR, { withFileTypes: true });
  const slugs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = nodePath.join(BUNDLED_SKILL_DIR, entry.name, "SKILL.md");
    const raw = await fs.readFile(skillPath, "utf8");
    const nameMatch = raw.match(/^name:\s*(.+)$/m);
    assert.ok(nameMatch, `${entry.name}/SKILL.md should declare name in frontmatter`);
    const name = nameMatch[1].trim();
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    slugs.push(slug);
  }
  return slugs.sort();
}

test("every bundled capability skill is indexed and viewable on demand", async (t) => {
  invalidateSkillsContextCache();
  const expectedSlugs = await readBundledSkillSlugs();
  assert.ok(expectedSlugs.length > 0, "expected bundled skills under src/capabilities/skills");

  for (const slug of expectedSlugs) {
    await t.test(slug, async () => {
      const skillPath = nodePath.join(BUNDLED_SKILL_DIR, slug, "SKILL.md");
      const raw = await fs.readFile(skillPath, "utf8");
      const descMatch = raw.match(/^description:\s*(.+)$/m);
      assert.ok(descMatch, `${slug} should declare description`);
      assert.match(
        descMatch[1],
        /use when/i,
        `${slug} description should lead with discovery phrasing (Use when…)`,
      );
      const triggers = parseTriggersFromRaw(raw);
      assert.ok(
        triggers.length >= 4,
        `${slug} should declare at least 4 triggers in frontmatter`,
      );

      const listed = await listSkills({ query: slug });
      const skill = listed.find((item) => item.slug === slug);
      assert.ok(skill, `${slug} should appear in skill_list`);
      assert.equal(skill.source, "bundled");
      assert.equal(skill.category, "bundled");
      assert.match(skill.path, /src\/capabilities\/skills\//);
      assert.equal(skill.content, undefined);
      assert.ok(Array.isArray(skill.triggers) && skill.triggers.length >= 4);

      const viewed = await viewSkill({ name: slug });
      assert.equal(viewed.slug, slug);
      assert.match(viewed.content, /## /);

      if (slug === "web-agent-skill") {
        assert.match(viewed.content, /## Self-Evolution Loop/);
        assert.match(viewed.content, /skill_manage/);
        assert.match(viewed.content, /memory_save/);
        assert.match(viewed.content, /session_memory_append/);
        assert.match(viewed.content, /cron_register/);
        const context = await buildSkillsContextBlock();
        assert.match(context, /Web Agent Skill/);
        assert.match(context, /web-agent-skill/);
        assert.match(context, /\| triggers:/);
        assert.doesNotMatch(context, /## Self-Evolution Loop/);
      }
    });
  }
});

test("skills context index matches user message to triggers", async () => {
  invalidateSkillsContextCache();
  const context = await buildSkillsContextBlock();
  assert.match(context, /Match the user's latest message/);
  assert.match(context, /skill_view/);
  assert.match(context, /systematic-debugging/);
  assert.match(context, /\| triggers:.*\bbug\b/);
});
