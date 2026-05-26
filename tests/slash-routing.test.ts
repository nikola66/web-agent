import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTelegramBotCommands,
} from "../dist/agent-runtime/commands.js";
import { deleteSkill, saveSkill } from "../dist/agent-runtime/memory/index.js";
import {
  findSkillBySlashToken,
  normalizeSlashCommandInput,
  parseLocalSlashCommand,
  resolveSlashUserMessage,
  skillSlashCommandForSurface,
  skillSlugToTelegramCommand,
  slashTokenToSkillSlug,
} from "../dist/agent-runtime/slash-routing.js";

test("skillSlugToTelegramCommand uses underscores and skips built-in collisions", () => {
  assert.equal(skillSlugToTelegramCommand("memory-layers"), "memory_layers");
  assert.equal(skillSlugToTelegramCommand("find-skills"), null);
  assert.equal(skillSlugToTelegramCommand("clarify"), null);
});

test("slashTokenToSkillSlug maps underscore tokens to hyphen slugs", () => {
  assert.equal(slashTokenToSkillSlug("memory_layers"), "memory-layers");
  assert.equal(slashTokenToSkillSlug("task-execution"), "task-execution");
});

test("findSkillBySlashToken matches hyphen and underscore forms", () => {
  const skills = [{ slug: "memory-layers", name: "Memory Layers", description: "", category: "bundled" }];
  assert.ok(findSkillBySlashToken("memory-layers", skills));
  assert.ok(findSkillBySlashToken("memory_layers", skills));
  assert.equal(findSkillBySlashToken("find_skills", skills), null);
});

test("normalizeSlashCommandInput strips Telegram bot suffix", () => {
  assert.equal(
    normalizeSlashCommandInput("/mcp@webagent_bot use https://x/mcp"),
    "/mcp use https://x/mcp"
  );
  assert.equal(normalizeSlashCommandInput("/reload_mcp@my_bot"), "/reload_mcp");
});

test("parseLocalSlashCommand recognizes /mcp@bot as mcp", () => {
  assert.deepEqual(parseLocalSlashCommand("/mcp@my_bot use https://hub.example/mcp"), {
    kind: "mcp",
    input: "/mcp use https://hub.example/mcp",
  });
  assert.deepEqual(parseLocalSlashCommand("/reload_mcp@bot"), { kind: "reload_mcp" });
});

test("parseLocalSlashCommand recognizes shared local commands", () => {
  assert.deepEqual(parseLocalSlashCommand("/clear"), { kind: "clear" });
  assert.deepEqual(parseLocalSlashCommand("/checkpoint pre-delete"), {
    kind: "checkpoint",
    name: "pre-delete",
  });
  assert.deepEqual(parseLocalSlashCommand("/rollback"), { kind: "rollback", name: "" });
});

test("buildTelegramBotCommands registers bundled skills with underscore tokens", () => {
  const commands = buildTelegramBotCommands([
    { slug: "memory-layers", name: "Memory Layers", description: "Pick memory layer" },
    { slug: "find-skills", name: "Find Skills", description: "Should not duplicate built-in" },
    { slug: "clarify", name: "Clarify", description: "Should not duplicate built-in" },
  ]);
  assert.ok(commands.some((c) => c.command === "find_skills"));
  assert.ok(commands.some((c) => c.command === "clarify"));
  assert.ok(commands.some((c) => c.command === "memory_layers"));
  assert.equal(
    commands.filter((c) => c.command === "find_skills").length,
    1
  );
  assert.ok(commands.every((c) => /^[a-z0-9_]{1,32}$/.test(c.command)));
});

test("skillSlashCommandForSurface uses underscores on telegram", () => {
  assert.equal(skillSlashCommandForSurface("task-execution", "telegram"), "/task_execution");
  assert.equal(skillSlashCommandForSurface("task-execution", "terminal"), "/task-execution");
});

test("resolveSlashUserMessage rewrites underscore skill slash to skill_view prompt", async () => {
  const name = `Sync Test ${Date.now()}`;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const underscore = slug.replace(/-/g, "_");

  await saveSkill({
    name,
    description: "Sync test skill",
    category: "local",
    content: ["## Procedure", "", "Run sync test."].join("\n"),
  });

  try {
    const msg = await resolveSlashUserMessage(`/${underscore} do the thing`);
    assert.ok(msg);
    assert.match(msg, new RegExp(slug));
    assert.match(msg, /skill_view/);
    assert.match(msg, /do the thing/);
  } finally {
    await deleteSkill(slug).catch(() => {});
  }
});
