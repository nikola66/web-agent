import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHelpMarkdown,
  buildSkillsMarkdown,
  buildToolRowsFromCatalog,
  renderHelpView,
  renderSkillsView,
} from "../dist/agent-runtime/slash-command-views.js";
import { SLASH_COMMANDS } from "../dist/agent-runtime/commands.js";
import { stripAnsi } from "../dist/agent-runtime/utils.js";

test("buildHelpMarkdown includes command and tool sections", () => {
  const markdown = buildHelpMarkdown(
    [{ name: "/help", description: "Show built-in commands and available tools." }],
    [{ emoji: "📄", name: "read_file", description: "Read a UTF-8 file from the workspace." }]
  );
  assert.match(markdown, /## ⌨️ Slash commands/);
  assert.match(markdown, /`\/help`/);
  assert.match(markdown, /## 🛠️ Tools/);
  assert.match(markdown, /📄/);
  assert.match(markdown, /`read_file`/);
});

test("buildSkillsMarkdown groups skills by category", () => {
  const markdown = buildSkillsMarkdown(
    [
      {
        slug: "alpha",
        name: "Alpha",
        description: "First skill",
        category: "bundled",
        tags: ["qa"],
      },
      {
        slug: "beta",
        name: "Beta",
        description: "Second skill",
        category: "local",
        tags: [],
      },
    ],
    { query: "skill" }
  );
  assert.match(markdown, /## 📚 Installed skills/);
  assert.match(markdown, /filtered: "skill"/);
  assert.match(markdown, /### bundled/);
  assert.match(markdown, /### local/);
  assert.match(markdown, /`\/alpha`/);
  assert.match(markdown, /`\/beta`/);
});

test("renderHelpView renders slash commands and tool ids without comma blob", () => {
  const catalog = {
    read_file: { emoji: "📄", description: "Read a UTF-8 file from the workspace." },
    grep: { emoji: "🔍", description: "Search file contents for text or regex." },
  };
  const plain = stripAnsi(renderHelpView(SLASH_COMMANDS, buildToolRowsFromCatalog(catalog)));
  assert.match(plain, /\/help/);
  assert.match(plain, /read_file/);
  assert.match(plain, /grep/);
  assert.doesNotMatch(plain, /read_file, grep/);
});

test("renderHelpView works when process is unavailable in the browser", () => {
  const processDescriptor = Object.getOwnPropertyDescriptor(globalThis, "process");
  try {
    Object.defineProperty(globalThis, "process", {
      configurable: true,
      value: undefined,
    });
    const plain = stripAnsi(
      renderHelpView(
        SLASH_COMMANDS,
        buildToolRowsFromCatalog({
          read_file: { emoji: "📄", description: "Read a UTF-8 file from the workspace." },
        })
      )
    );
    assert.match(plain, /\/help/);
    assert.match(plain, /read_file/);
  } finally {
    if (processDescriptor) {
      Object.defineProperty(globalThis, "process", processDescriptor);
    }
  }
});

test("renderHelpView wraps table rows within narrow terminal width", () => {
  const prev = process.stdout.columns;
  const prevEnv = process.env.COLUMNS;
  Object.defineProperty(process.stdout, "columns", { value: 56, configurable: true });
  process.env.COLUMNS = "56";
  try {
    const plain = stripAnsi(
      renderHelpView(
        [{ name: "/help", description: "Show built-in commands and available tools with long descriptions that should wrap instead of breaking borders." }],
        buildToolRowsFromCatalog({
          read_file: {
            emoji: "📄",
            description: "Read a UTF-8 file from the workspace with enough text to force wrapping in the terminal renderer.",
          },
        })
      )
    );
    assert.match(plain, /┌/);
    assert.ok(plain.split("\n").every((line) => line.length <= 56));
  } finally {
    Object.defineProperty(process.stdout, "columns", { value: prev, configurable: true });
    if (prevEnv !== undefined) process.env.COLUMNS = prevEnv;
    else delete process.env.COLUMNS;
  }
});

test("renderSkillsView wraps grouped skills within narrow terminal width", () => {
  const prev = process.stdout.columns;
  const prevEnv = process.env.COLUMNS;
  Object.defineProperty(process.stdout, "columns", { value: 60, configurable: true });
  process.env.COLUMNS = "60";
  try {
    const plain = stripAnsi(
      renderSkillsView([
        {
          slug: "very-long-skill-slug",
          name: "Very Long Skill Name",
          description: "Detailed description that previously pushed the right edge of the xterm table out of alignment.",
          category: "bundled",
          tags: ["debugging", "formatting", "terminal"],
        },
      ])
    );
    assert.match(plain, /bundled/);
    assert.match(plain, /┌/);
    assert.ok(plain.split("\n").every((line) => line.length <= 60));
  } finally {
    Object.defineProperty(process.stdout, "columns", { value: prev, configurable: true });
    if (prevEnv !== undefined) process.env.COLUMNS = prevEnv;
    else delete process.env.COLUMNS;
  }
});
