import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

test("channel dispatcher rewrites /plan like CLI bootstrap synthetic prompt", async () => {
  const originalCwd = process.cwd();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "webagent-channel-"));
  const dispatcherUrl = pathToFileURL(
    path.join(originalCwd, "dist/agent-runtime/channels/dispatcher.js")
  ).href;

  process.chdir(tmp);
  process.env.WEBAGENT_MEMORY_ROOT = path.join(tmp, "memory");

  try {
    const { createChannelInboundHandler } = await import(`${dispatcherUrl}?t=${Date.now()}-plan`);

    let lastHistory = [];

    const inbound = createChannelInboundHandler({
      cfg: {},
      sendReply: async () => {},
      agentTurn: async (history, _cfg, _meta) => {
        lastHistory = history;
        return [];
      },
    });

    await inbound({
      channel: "telegram",
      chatId: "99",
      text: "/plan roll out SSO",
    });

    const tail = [...lastHistory].reverse().find((m) => m?.role === "user");
    const content = String(tail?.content || "");
    assert.match(content, /\*\*Goal:\*\*\s*roll out SSO/);
    assert.match(content, /invoked \*\*planning mode\*\* via `\/plan`/i);
  } finally {
    process.chdir(originalCwd);
    delete process.env.WEBAGENT_MEMORY_ROOT;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("channel dispatcher sends tool notices and then the final answer", async () => {
  const originalCwd = process.cwd();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "webagent-channel-"));
  const dispatcherUrl = pathToFileURL(
    path.join(originalCwd, "dist/agent-runtime/channels/dispatcher.js")
  ).href;

  process.chdir(tmp);
  process.env.WEBAGENT_MEMORY_ROOT = path.join(tmp, "memory");

  try {
    const { createChannelInboundHandler } = await import(`${dispatcherUrl}?t=${Date.now()}`);
    const replies = [];
    const inbound = createChannelInboundHandler({
      cfg: {},
      sendReply: async (_chatId, text) => {
        replies.push(text);
      },
      agentTurn: async (_history, _cfg, meta) => {
        assert.equal(meta.onToolCalls, undefined);
        assert.equal(meta.skipTerminalOutput, true);
        assert.equal(meta.skipBackgroundReview, true);
        await meta.onTranscript({
          type: "tool_start",
          name: "web_search",
          argsPreview: "{\"query\":\"UAE Iran\"}",
        });
        await meta.onTranscript({ type: "tool_result", name: "web_search", status: "ok" });
        await meta.onTranscript({
          type: "assistant",
          agentName: "Opaline",
          text: "There is no active UAE-Iran war in the checked reports.",
          branchBelowName: true,
        });
        return [
          {
            role: "assistant",
            content: "There is no active UAE-Iran war in the checked reports.",
          },
        ];
      },
    });

    await inbound({
      channel: "telegram",
      chatId: "123",
      text: "UAE Iran war latest?",
    });

    assert.equal(replies.length, 3);
    assert.match(replies[0], /^▸ .*web_search$/);
    assert.match(replies[0], /web_search/);
    assert.match(replies[1], /^✓ .*web_search$/);
    assert.equal(replies[2], "There is no active UAE-Iran war in the checked reports.");
  } finally {
    process.chdir(originalCwd);
    delete process.env.WEBAGENT_MEMORY_ROOT;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("channel dispatcher does not need onToolCalls for channel tool notices", async () => {
  const originalCwd = process.cwd();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "webagent-channel-"));
  const dispatcherUrl = pathToFileURL(
    path.join(originalCwd, "dist/agent-runtime/channels/dispatcher.js")
  ).href;

  process.chdir(tmp);
  process.env.WEBAGENT_MEMORY_ROOT = path.join(tmp, "memory");

  try {
    const { createChannelInboundHandler } = await import(`${dispatcherUrl}?t=${Date.now()}-no-hook`);
    const replies = [];
    const inbound = createChannelInboundHandler({
      cfg: {},
      sendReply: async (_chatId, text) => {
        replies.push(text);
      },
      agentTurn: async (_history, _cfg, meta) => {
        assert.equal(meta.onToolCalls, undefined);
        await meta.onTranscript({
          type: "tool_start",
          name: "read_file",
          argsPreview: "{\"path\":\"README.md\"}",
        });
        await meta.onTranscript({
          type: "assistant",
          agentName: "Opaline",
          text: "Done",
          branchBelowName: true,
        });
        return [{ role: "assistant", content: "Done" }];
      },
    });

    await inbound({
      channel: "telegram",
      chatId: "123",
      text: "read the file",
    });

    assert.deepEqual(replies, ["▸ 📄 read_file", "Done"]);
  } finally {
    process.chdir(originalCwd);
    delete process.env.WEBAGENT_MEMORY_ROOT;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("channel dispatcher surfaces final assistant delivery failures", async () => {
  const originalCwd = process.cwd();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "webagent-channel-"));
  const dispatcherUrl = pathToFileURL(
    path.join(originalCwd, "dist/agent-runtime/channels/dispatcher.js")
  ).href;

  process.chdir(tmp);
  process.env.WEBAGENT_MEMORY_ROOT = path.join(tmp, "memory");

  try {
    const { createChannelInboundHandler } = await import(`${dispatcherUrl}?t=${Date.now()}-fail`);
    const replies = [];
    const inbound = createChannelInboundHandler({
      cfg: {},
      sendReply: async (_chatId, text) => {
        if (String(text).includes("Final answer")) throw new Error("telegram unavailable");
        replies.push(text);
      },
      agentTurn: async (_history, _cfg, meta) => {
        await meta.onTranscript({ type: "tool_result", name: "web_search", status: "ok" });
        await meta.onTranscript({
          type: "assistant",
          agentName: "Opaline",
          text: "Final answer",
          branchBelowName: true,
        });
        return [{ role: "assistant", content: "Final answer" }];
      },
    });

    await inbound({
      channel: "telegram",
      chatId: "123",
      text: "question",
    });

    assert.deepEqual(replies, ["✓ 🌍 web_search", "Error: telegram unavailable"]);
  } finally {
    process.chdir(originalCwd);
    delete process.env.WEBAGENT_MEMORY_ROOT;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("channel dispatcher continues when non-critical transcript delivery fails", async () => {
  const originalCwd = process.cwd();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "webagent-channel-"));
  const dispatcherUrl = pathToFileURL(
    path.join(originalCwd, "dist/agent-runtime/channels/dispatcher.js")
  ).href;

  process.chdir(tmp);
  process.env.WEBAGENT_MEMORY_ROOT = path.join(tmp, "memory");

  try {
    const { createChannelInboundHandler } = await import(`${dispatcherUrl}?t=${Date.now()}-tool-fail`);
    const replies = [];
    const inbound = createChannelInboundHandler({
      cfg: {},
      sendReply: async (_chatId, text) => {
        if (/^✓ /.test(text)) throw new Error("tool notice failed");
        replies.push(text);
      },
      agentTurn: async (_history, _cfg, meta) => {
        await meta.onTranscript({ type: "tool_result", name: "web_search", status: "ok" });
        await meta.onTranscript({
          type: "assistant",
          critical: true,
          agentName: "Opaline",
          text: "Final answer",
          branchBelowName: true,
        });
        return [{ role: "assistant", content: "Final answer" }];
      },
    });

    await inbound({
      channel: "telegram",
      chatId: "123",
      text: "question",
    });

    assert.deepEqual(replies, ["Final answer"]);
  } finally {
    process.chdir(originalCwd);
    delete process.env.WEBAGENT_MEMORY_ROOT;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("telegram sends phase-aware status after configured silence", async () => {
  const originalCwd = process.cwd();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "webagent-channel-"));
  const dispatcherUrl = pathToFileURL(
    path.join(originalCwd, "dist/agent-runtime/channels/dispatcher.js")
  ).href;
  const prevFirst = process.env.WEBAGENT_CHANNEL_STATUS_FIRST_MS;
  const prevRepeat = process.env.WEBAGENT_CHANNEL_STATUS_REPEAT_MS;

  process.chdir(tmp);
  process.env.WEBAGENT_MEMORY_ROOT = path.join(tmp, "memory");
  process.env.WEBAGENT_CHANNEL_STATUS_FIRST_MS = "20";
  process.env.WEBAGENT_CHANNEL_STATUS_REPEAT_MS = "1000";

  try {
    const { createChannelInboundHandler } = await import(`${dispatcherUrl}?t=${Date.now()}-status`);
    const replies = [];
    const inbound = createChannelInboundHandler({
      cfg: {},
      sendReply: async (_chatId, text) => {
        replies.push(text);
      },
      agentTurn: async (_history, _cfg, meta) => {
        await new Promise((resolve) => setTimeout(resolve, 70));
        await meta.onTranscript({
          type: "assistant",
          agentName: "Opaline",
          text: "Done",
          branchBelowName: true,
        });
        return [{ role: "assistant", content: "Done" }];
      },
    });

    await inbound({ channel: "telegram", chatId: "123", text: "slow answer" });

    assert.ok(replies.includes("Working…"));
    assert.equal(replies.at(-1), "Done");
    assert.ok(!replies.some((text) => /Still working/i.test(text)));
  } finally {
    process.chdir(originalCwd);
    delete process.env.WEBAGENT_MEMORY_ROOT;
    if (prevFirst === undefined) delete process.env.WEBAGENT_CHANNEL_STATUS_FIRST_MS;
    else process.env.WEBAGENT_CHANNEL_STATUS_FIRST_MS = prevFirst;
    if (prevRepeat === undefined) delete process.env.WEBAGENT_CHANNEL_STATUS_REPEAT_MS;
    else process.env.WEBAGENT_CHANNEL_STATUS_REPEAT_MS = prevRepeat;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("telegram status timer is suppressed while transcript events flow", async () => {
  const originalCwd = process.cwd();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "webagent-channel-"));
  const dispatcherUrl = pathToFileURL(
    path.join(originalCwd, "dist/agent-runtime/channels/dispatcher.js")
  ).href;
  const prevFirst = process.env.WEBAGENT_CHANNEL_STATUS_FIRST_MS;
  const prevRepeat = process.env.WEBAGENT_CHANNEL_STATUS_REPEAT_MS;

  process.chdir(tmp);
  process.env.WEBAGENT_MEMORY_ROOT = path.join(tmp, "memory");
  process.env.WEBAGENT_CHANNEL_STATUS_FIRST_MS = "20";
  process.env.WEBAGENT_CHANNEL_STATUS_REPEAT_MS = "1000";

  try {
    const { createChannelInboundHandler } = await import(`${dispatcherUrl}?t=${Date.now()}-status-suppress`);
    const replies = [];
    const inbound = createChannelInboundHandler({
      cfg: {},
      sendReply: async (_chatId, text) => {
        replies.push(text);
      },
      agentTurn: async (_history, _cfg, meta) => {
        for (let i = 0; i < 4; i++) {
          await meta.onTranscript({ type: "tool_start", name: "web_fetch", argsPreview: "{}" });
          await new Promise((resolve) => setTimeout(resolve, 12));
        }
        await meta.onTranscript({ type: "tool_result", name: "web_fetch", status: "ok" });
        await meta.onTranscript({
          type: "assistant",
          agentName: "Opaline",
          text: "Done",
          branchBelowName: true,
        });
        return [{ role: "assistant", content: "Done" }];
      },
    });

    await inbound({ channel: "telegram", chatId: "123", text: "fetch this" });

    assert.ok(replies.some((text) => /^▸ .*web_fetch/.test(text)));
    assert.ok(replies.some((text) => /^✓ .*web_fetch/.test(text)));
    assert.equal(replies.at(-1), "Done");
    assert.ok(!replies.some((text) => /^(Working|Still running|Still working)/i.test(text)));
  } finally {
    process.chdir(originalCwd);
    delete process.env.WEBAGENT_MEMORY_ROOT;
    if (prevFirst === undefined) delete process.env.WEBAGENT_CHANNEL_STATUS_FIRST_MS;
    else process.env.WEBAGENT_CHANNEL_STATUS_FIRST_MS = prevFirst;
    if (prevRepeat === undefined) delete process.env.WEBAGENT_CHANNEL_STATUS_REPEAT_MS;
    else process.env.WEBAGENT_CHANNEL_STATUS_REPEAT_MS = prevRepeat;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("channel dispatcher handles /compact without starting an agent turn", async () => {
  const originalCwd = process.cwd();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "webagent-channel-"));
  const dispatcherUrl = pathToFileURL(
    path.join(originalCwd, "dist/agent-runtime/channels/dispatcher.js")
  ).href;

  process.chdir(tmp);
  process.env.WEBAGENT_MEMORY_ROOT = path.join(tmp, "memory");

  try {
    const { createChannelInboundHandler } = await import(`${dispatcherUrl}?t=${Date.now()}-compact`);
    const replies = [];
    let agentTurns = 0;
    const inbound = createChannelInboundHandler({
      cfg: {},
      sendReply: async (_chatId, text) => {
        replies.push(text);
      },
      agentTurn: async () => {
        agentTurns += 1;
        return [];
      },
    });

    await inbound({
      channel: "telegram",
      chatId: "123",
      text: "/compact",
    });

    assert.equal(agentTurns, 0);
    assert.deepEqual(replies, ["Not enough history to compact."]);
  } finally {
    process.chdir(originalCwd);
    delete process.env.WEBAGENT_MEMORY_ROOT;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("channel dispatcher handles /help without agent turn", async () => {
  const originalCwd = process.cwd();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "webagent-channel-"));
  const dispatcherUrl = pathToFileURL(
    path.join(originalCwd, "dist/agent-runtime/channels/dispatcher.js")
  ).href;

  process.chdir(tmp);
  process.env.WEBAGENT_MEMORY_ROOT = path.join(tmp, "memory");

  try {
    const { createChannelInboundHandler } = await import(`${dispatcherUrl}?t=${Date.now()}-help`);
    const replies = [];
    let agentTurns = 0;
    const inbound = createChannelInboundHandler({
      cfg: {},
      sendReply: async (_chatId, text) => {
        replies.push(text);
      },
      agentTurn: async () => {
        agentTurns += 1;
        return [];
      },
    });

    await inbound({
      channel: "telegram",
      chatId: "123",
      text: "/help",
    });

    assert.equal(agentTurns, 0);
    assert.equal(replies.length, 1);
    assert.match(replies[0], /Slash commands/);
    assert.doesNotMatch(replies[0], /\x1b\[/);
  } finally {
    process.chdir(originalCwd);
    delete process.env.WEBAGENT_MEMORY_ROOT;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("channel dispatcher handles /skills without agent turn", async () => {
  const originalCwd = process.cwd();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "webagent-channel-"));
  const dispatcherUrl = pathToFileURL(
    path.join(originalCwd, "dist/agent-runtime/channels/dispatcher.js")
  ).href;

  process.chdir(tmp);
  process.env.WEBAGENT_MEMORY_ROOT = path.join(tmp, "memory");

  try {
    const { createChannelInboundHandler } = await import(`${dispatcherUrl}?t=${Date.now()}-skills`);
    const replies = [];
    let agentTurns = 0;
    const inbound = createChannelInboundHandler({
      cfg: {},
      sendReply: async (_chatId, text) => {
        replies.push(text);
      },
      agentTurn: async () => {
        agentTurns += 1;
        return [];
      },
    });

    await inbound({
      channel: "telegram",
      chatId: "123",
      text: "/skills",
    });

    assert.equal(agentTurns, 0);
    assert.equal(replies.length, 1);
    assert.match(replies[0], /Installed skills|No skills installed/);
    assert.doesNotMatch(replies[0], /\x1b\[/);
  } finally {
    process.chdir(originalCwd);
    delete process.env.WEBAGENT_MEMORY_ROOT;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("channel dispatcher handles /clear without agent turn", async () => {
  const originalCwd = process.cwd();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "webagent-channel-"));
  const dispatcherUrl = pathToFileURL(
    path.join(originalCwd, "dist/agent-runtime/channels/dispatcher.js")
  ).href;

  process.chdir(tmp);
  process.env.WEBAGENT_MEMORY_ROOT = path.join(tmp, "memory");

  try {
    const { createChannelInboundHandler } = await import(`${dispatcherUrl}?t=${Date.now()}-clear`);
    const replies: string[] = [];
    let agentTurns = 0;
    const inbound = createChannelInboundHandler({
      cfg: {},
      sendReply: async (_chatId, text) => {
        replies.push(text);
      },
      agentTurn: async () => {
        agentTurns += 1;
        return [];
      },
    });

    await inbound({ channel: "telegram", chatId: "123", text: "/plan test" });
    await inbound({ channel: "telegram", chatId: "123", text: "/clear" });

    assert.equal(agentTurns, 1);
    assert.equal(replies.at(-1), "Conversation cleared (identity unchanged).");
  } finally {
    process.chdir(originalCwd);
    delete process.env.WEBAGENT_MEMORY_ROOT;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
