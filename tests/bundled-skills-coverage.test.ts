import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nodePath from "node:path";

import { listSkills, viewSkill, buildSkillsContextBlock } from "../dist/agent-runtime/memory/index.js";

const BUNDLED_SKILL_DIR = nodePath.join(process.cwd(), "src/capabilities/skills");

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
  const expectedSlugs = await readBundledSkillSlugs();
  assert.ok(expectedSlugs.length > 0, "expected bundled skills under src/capabilities/skills");

  for (const slug of expectedSlugs) {
    await t.test(slug, async () => {
      const listed = await listSkills({ query: slug });
      const skill = listed.find((item) => item.slug === slug);
      assert.ok(skill, `${slug} should appear in skill_list`);
      assert.equal(skill.source, "bundled");
      assert.equal(skill.category, "bundled");
      assert.match(skill.path, /src\/capabilities\/skills\//);
      assert.equal(skill.content, undefined);

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
        assert.doesNotMatch(context, /## Self-Evolution Loop/);
      }
    });
  }
});
