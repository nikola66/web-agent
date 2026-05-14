import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const modUrl = pathToFileURL(
  path.join(process.cwd(), "dist/agent-runtime/channel-outbound.js")
).href;

test("formatHelpForSurface telegram avoids ANSI and pipe tables", async () => {
  const { formatHelpForSurface } = await import(`${modUrl}?t=${Date.now()}-help-tg`);
  const out = formatHelpForSurface(
    "telegram",
    [{ name: "/help", description: "Show commands." }],
    [{ emoji: "🔍", name: "web_search", description: "Search the web." }]
  );
  assert.match(out, /Slash commands/);
  assert.doesNotMatch(out, /\x1b\[/);
  assert.doesNotMatch(out, /\| `\/help`/);
  assert.ok(out.length < 3500);
  assert.match(out, /`\/help`/);
});

test("formatHelpForSurface terminal preserves ANSI tables", async () => {
  const { formatHelpForSurface } = await import(`${modUrl}?t=${Date.now()}-help-term`);
  const out = formatHelpForSurface(
    "terminal",
    [{ name: "/help", description: "Show commands." }],
    [{ emoji: "🔍", name: "web_search", description: "Search the web." }]
  );
  assert.match(out, /\x1b\[/);
});

test("formatSkillsForSurface telegram empty state", async () => {
  const { formatSkillsForSurface } = await import(`${modUrl}?t=${Date.now()}-sk-tg`);
  const out = formatSkillsForSurface("telegram", [], {});
  assert.doesNotMatch(out, /\x1b\[/);
  assert.match(out, /No skills installed/);
});

test("formatSkillsForSurface telegram lists skills without pipes", async () => {
  const { formatSkillsForSurface } = await import(`${modUrl}?t=${Date.now()}-sk-tg2`);
  const out = formatSkillsForSurface(
    "telegram",
    [
      {
        slug: "demo",
        name: "Demo Skill",
        description: "Does a thing",
        tags: ["t1"],
        category: "local",
      },
    ],
    {}
  );
  assert.match(out, /`\/demo`/);
  assert.match(out, /\*\*Demo Skill\*\*/);
  assert.doesNotMatch(out, /\| Skill \|/);
});
