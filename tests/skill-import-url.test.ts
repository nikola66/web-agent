import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeSkillImportUrl,
  resolveSkillImportUrlFromPage,
  looksLikeSkillMarkdown,
  fetchSkillImportText,
} from "../dist/agent-runtime/memory/skill-import-url.js";

test("normalizeSkillImportUrl converts github blob to raw", () => {
  assert.equal(
    normalizeSkillImportUrl(
      "https://github.com/o/r/blob/main/skills/foo/SKILL.md"
    ),
    "https://raw.githubusercontent.com/o/r/main/skills/foo/SKILL.md"
  );
});

test("normalizeSkillImportUrl converts github tree dir to raw SKILL.md", () => {
  assert.equal(
    normalizeSkillImportUrl(
      "https://github.com/LaWebcapsule/d9-skills/tree/main/skills/d9-fork-setup"
    ),
    "https://raw.githubusercontent.com/LaWebcapsule/d9-skills/main/skills/d9-fork-setup/SKILL.md"
  );
});

test("resolveSkillImportUrlFromPage extracts github tree from skillsmp HTML", () => {
  const html = `
    <a href="https://github.com/LaWebcapsule/d9-skills/tree/main/skills/d9-fork-setup">repo</a>
  `;
  assert.equal(
    resolveSkillImportUrlFromPage(
      "https://skillsmp.com/fr/skills/lawebcapsule-d9-skills-skills-d9-fork-setup-skill-md",
      html
    ),
    "https://raw.githubusercontent.com/LaWebcapsule/d9-skills/main/skills/d9-fork-setup/SKILL.md"
  );
});

test("looksLikeSkillMarkdown detects valid frontmatter body", () => {
  const md = ["---", "name: x", "description: y", "---", "", "## Procedure", "", "1. Step."].join(
    "\n"
  );
  assert.equal(looksLikeSkillMarkdown(md), true);
  assert.equal(looksLikeSkillMarkdown("<html><body>nope</body></html>"), false);
});

test("fetchSkillImportText returns markdown from direct fetch", async () => {
  const skillMd = ["---", "name: direct", "description: ok", "---", "", "## Procedure", "step"].join(
    "\n"
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    ({
      ok: true,
      status: 200,
      headers: { get: () => "text/plain" },
      text: async () => skillMd,
    }) as Response;
  try {
    const text = await fetchSkillImportText("https://example.com/SKILL.md");
    assert.match(text, /name: direct/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
