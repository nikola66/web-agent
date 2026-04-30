import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import {
  CONTEXT_COMPACTION_PREFIX,
  compactHistory,
  extractNonStreamAssistantText,
  maybeCompactHistory,
} from "../dist/agent-runtime/context-compression.js";
import {
  SLASH_COMMANDS,
  buildTelegramBotCommands,
} from "../dist/agent-runtime/commands.js";

const cfg = {
  provider: "test",
  model: "test-model",
  baseUrl: "https://example.test/v1",
  contextWindowTokens: 1000,
};

function summary() {
  return `${CONTEXT_COMPACTION_PREFIX}
Goal: Keep working.
Constraints & Preferences: Preserve important facts.
Progress: Middle history summarized.
Key Decisions: None.
Relevant Files: None.
Next Steps: Continue.
Critical Context: Test summary.`;
}

function makeHistory(count, { largeToolResultAt = -1, previousSummaryAt = -1 } = {}) {
  const messages = [
    { role: "system", content: "system prompt" },
    { role: "user", content: "initial goal" },
    { role: "assistant", content: "initial response" },
  ];
  for (let i = 0; i < count; i++) {
    if (i === previousSummaryAt) {
      messages.push({
        role: "assistant",
        content: `${CONTEXT_COMPACTION_PREFIX}\nGoal: old summary\nNext Steps: old next step`,
      });
      continue;
    }
    if (i === largeToolResultAt) {
      messages.push({
        role: "user",
        content: "Tool results (compact JSON):\n" + "x".repeat(4000),
      });
      continue;
    }
    messages.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i} ${"detail ".repeat(18)}`,
    });
  }
  return messages;
}

test("does not compact below threshold unless forced", async () => {
  const messages = makeHistory(25);
  const highWindowCfg = { ...cfg, contextWindowTokens: 100000 };
  const result = await maybeCompactHistory(messages, highWindowCfg, {
    summarize: async () => {
      throw new Error("should not summarize");
    },
  });

  assert.equal(result.changed, false);
  assert.equal(result.reason, "below_threshold");
  assert.equal(result.messages, messages);

  const forced = await compactHistory(messages, highWindowCfg, {
    summarize: async () => summary(),
  });
  assert.equal(forced.changed, true);
  assert.equal(forced.reason, "forced");
});

test("preserves system, first exchange, and recent tail", async () => {
  const messages = makeHistory(38);
  const result = await maybeCompactHistory(messages, cfg, {
    summarize: async () => summary(),
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.messages[0], messages[0]);
  assert.deepEqual(result.messages[1], messages[1]);
  assert.deepEqual(result.messages[2], messages[2]);
  assert.equal(
    result.messages.filter((message) => String(message.content || "").startsWith(CONTEXT_COMPACTION_PREFIX)).length,
    1
  );
  assert.deepEqual(result.messages.slice(-20), messages.slice(-20));
});

test("inserts exactly one compaction summary when recompressing previous summaries", async () => {
  const messages = makeHistory(42, { previousSummaryAt: 5 });
  let previousSummaries = [];
  const result = await compactHistory(messages, cfg, {
    summarize: async ({ previousSummaries: seen }) => {
      previousSummaries = seen;
      return summary();
    },
  });

  assert.equal(result.changed, true);
  assert.equal(previousSummaries.length, 1);
  assert.equal(
    result.messages.filter((message) => String(message.content || "").startsWith(CONTEXT_COMPACTION_PREFIX)).length,
    1
  );
});

test("extractNonStreamAssistantText reads string content, part arrays, and reasoning_content", () => {
  assert.equal(
    extractNonStreamAssistantText({
      choices: [{ message: { content: "hello" } }],
    }),
    "hello"
  );
  assert.equal(
    extractNonStreamAssistantText({
      choices: [{ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }],
    }),
    "ab"
  );
  assert.equal(
    extractNonStreamAssistantText({
      choices: [{ message: { content: null, reasoning_content: "  think  " } }],
    }),
    "think"
  );
  assert.throws(
    () =>
      extractNonStreamAssistantText({
        choices: [{ message: { refusal: "nope", content: "" } }],
      }),
    /model refused/
  );
});

test("leaves history unchanged if summary generation fails", async () => {
  const messages = makeHistory(40);
  const result = await compactHistory(messages, cfg, {
    summarize: async () => {
      throw new Error("summary down");
    },
  });

  assert.equal(result.changed, false);
  assert.equal(result.reason, "summary_failed");
  assert.equal(result.messages, messages);
});

test("prunes large old tool-result content before summarization", async () => {
  /** Past default compaction head (~4 user/assistant exchanges) but before the tail slice. */
  const messages = makeHistory(40, { largeToolResultAt: 10 });
  let summaryMessages = [];
  const result = await compactHistory(messages, cfg, {
    summarize: async ({ messages: seen }) => {
      summaryMessages = seen;
      return summary();
    },
  });

  assert.equal(result.changed, true);
  const pruned = summaryMessages.find((message) =>
    String(message.content || "").startsWith("Tool results (compact JSON):")
  );
  assert.ok(pruned);
  assert.match(pruned.content, /\[pruned: large historical tool-result JSON omitted/);
  assert.ok(!pruned.content.includes("x".repeat(2000)));
});

test("compact command appears in runtime, Telegram, and ChatInput command registries", async () => {
  assert.ok(SLASH_COMMANDS.some((command) => command.name === "/compact"));
  assert.ok(buildTelegramBotCommands().some((command) => command.command === "compact"));

  const chatInputSource = await fs.readFile(
    path.join(process.cwd(), "src/ui/components/ChatInput.tsx"),
    "utf8"
  );
  const chatInputUsesSharedSlashRegistry =
    /@\/agent\/embed-commands/.test(chatInputSource) && /\bSLASH_COMMANDS\b/.test(chatInputSource);
  assert.ok(
    chatInputUsesSharedSlashRegistry || /name:\s*"\/compact"/.test(chatInputSource),
    "ChatInput should list /compact or import SLASH_COMMANDS from embed-commands"
  );
});

test("adapter injects every bootstrap static ./ import (runtime entry pulls the graph)", async () => {
  const [bootstrapSource, adapterSource] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "src/agent/runtime/bootstrap.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/agent/adapter.ts"), "utf8"),
  ]);

  const runtimeImports = [
    ...bootstrapSource.matchAll(/from\s+["']\.\/([^"']+\.js)["']/g),
  ].map((match) => match[1]);

  assert.ok(runtimeImports.includes("context-compression.js"));
  for (const runtimeImport of runtimeImports) {
    if (runtimeImport.startsWith("tools/")) {
      assert.ok(
        adapterSource.includes("../../dist/agent-runtime/tools/**/*.js"),
        `adapter must glob-copy ${runtimeImport} into .webagent`
      );
      continue;
    }
    assert.ok(
      adapterSource.includes(`\${webagentDir}/${runtimeImport}`),
      `adapter must write ${runtimeImport} into .webagent`
    );
  }
});

test("adapter mirrors every tools/*.js relative dependency into .webagent", async () => {
  const adapterSource = await fs.readFile(path.join(process.cwd(), "src/agent/adapter.ts"), "utf8");
  assert.ok(adapterSource.includes("../../dist/agent-runtime/tools/**/*.js"));
  assert.ok(adapterSource.includes('replace(/^.*dist\\/agent-runtime\\/tools\\//, "tools/")'));
  assert.ok(adapterSource.includes("runtimeToolSources"));
});
