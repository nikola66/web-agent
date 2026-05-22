import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeSkillImportUrl,
  resolveSkillImportUrlFromPage,
  resolveAllSkillImportUrlsFromPage,
  candidateRawSkillUrls,
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

test("resolveSkillImportUrlFromPage extracts github tree from officialskills.sh HTML", () => {
  const html = `
    <a href="https://github.com/anthropics/skills/tree/main/skills/frontend-design">Source</a>
    <a href="https://github.com/other/repo/tree/main/skills/other">Other</a>
  `;
  assert.equal(
    resolveSkillImportUrlFromPage(
      "https://officialskills.sh/anthropics/skills/frontend-design",
      html
    ),
    "https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md"
  );
});

test("resolveAllSkillImportUrlsFromPage returns all github links", () => {
  const html = `
    <a href="https://github.com/anthropics/skills/tree/main/skills/frontend-design">A</a>
    <a href="https://github.com/google-labs-code/skills/tree/main/design-md">B</a>
  `;
  const urls = resolveAllSkillImportUrlsFromPage("https://skills.sh/foo", html);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /anthropics\/skills/);
  assert.match(urls[1], /google-labs-code/);
});

test("candidateRawSkillUrls tries skills and dot-prefix paths", () => {
  const base =
    "https://raw.githubusercontent.com/o/r/main/google-labs-code/design-md/SKILL.md";
  const candidates = candidateRawSkillUrls(base);
  assert.deepEqual(candidates, [
    base,
    "https://raw.githubusercontent.com/o/r/main/skills/google-labs-code/design-md/SKILL.md",
    "https://raw.githubusercontent.com/o/r/main/.agents/skills/google-labs-code/design-md/SKILL.md",
    "https://raw.githubusercontent.com/o/r/main/.claude/skills/google-labs-code/design-md/SKILL.md",
  ]);
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

test("fetchSkillImportText retries candidate paths on 404", async () => {
  const skillMd = ["---", "name: alt", "description: ok", "---", "", "## Procedure", "step"].join(
    "\n"
  );
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/skills/google-labs-code/design-md/SKILL.md")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => "text/plain" },
        text: async () => skillMd,
      } as Response;
    }
    return {
      ok: false,
      status: 404,
      headers: { get: () => "text/plain" },
      text: async () => "not found",
    } as Response;
  };
  try {
    const text = await fetchSkillImportText(
      "https://raw.githubusercontent.com/o/r/main/google-labs-code/design-md/SKILL.md"
    );
    assert.match(text, /name: alt/);
    assert.ok(calls.length >= 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
