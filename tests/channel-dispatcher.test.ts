import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
    assert.match(replies[0], /^▸ web_search/);
    assert.match(replies[0], /web_search/);
    assert.equal(replies[1], "✓ web_search");
    assert.equal(
      replies[2],
      "Opaline\n ⎿ There is no active UAE-Iran war in the checked reports."
    );
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

    assert.deepEqual(replies, [
      "▸ read_file {\"path\":\"README.md\"}",
      "Opaline\n ⎿ Done",
    ]);
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
        if (String(text).startsWith("Opaline\n")) throw new Error("telegram unavailable");
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

    assert.deepEqual(replies, ["✓ web_search", "Error: telegram unavailable"]);
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
        if (text === "✓ web_search") throw new Error("tool notice failed");
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

    assert.deepEqual(replies, ["Opaline\n ⎿ Final answer"]);
  } finally {
    process.chdir(originalCwd);
    delete process.env.WEBAGENT_MEMORY_ROOT;
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
