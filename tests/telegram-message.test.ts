import test from "node:test";
import assert from "node:assert/strict";

import { sendTelegramMessage, sendTelegramPreviewMessage, editTelegramMessage } from "../dist/agent-runtime/channels/telegram.js";

function okResponse(result = {}) {
  return {
    json: async () => ({ ok: true, result }),
  };
}

function failResponse(description = "Bad Request: can't parse entities") {
  return {
    json: async () => ({ ok: false, description }),
  };
}

test("sendTelegramMessage sends rendered HTML normally", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, opts) => {
    calls.push(JSON.parse(opts.body));
    return okResponse();
  };

  try {
    await sendTelegramMessage("token", "chat-1", "**Hello** `world`");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].chat_id, "chat-1");
  assert.equal(calls[0].parse_mode, "HTML");
  assert.match(calls[0].text, /<b>Hello<\/b>/);
  assert.match(calls[0].text, /<code>world<\/code>/);
});

test("sendTelegramMessage retries as plain text when HTML send fails", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    return calls.length === 1 ? failResponse() : okResponse();
  };

  try {
    await sendTelegramMessage("token", "chat-2", "**Final** answer");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 2);
  assert.equal(calls[0].parse_mode, "HTML");
  assert.equal(calls[1].parse_mode, undefined);
  assert.equal(calls[1].text, "**Final** answer");
  const { text: _htmlText, parse_mode: _htmlParseMode, ...htmlCommon } = calls[0];
  const { text: _plainText, parse_mode: _plainParseMode, ...plainCommon } = calls[1];
  assert.deepEqual(plainCommon, htmlCommon);
});

test("sendTelegramMessage preserves underscores inside exact tokens", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, opts) => {
    calls.push(JSON.parse(opts.body));
    return okResponse();
  };

  try {
    await sendTelegramMessage("token", "chat-2", "Final token: LIVE_DIRECT_OK_TOKEN");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, "Final token: LIVE_DIRECT_OK_TOKEN");
});

test("sendTelegramMessage omits markdown horizontal rules in HTML", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, opts) => {
    calls.push(JSON.parse(opts.body));
    return okResponse();
  };

  try {
    await sendTelegramMessage("token", "chat-hr", "Section A\n---\nSection B");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].text, /────────/);
  assert.match(calls[0].text, /Section A/);
  assert.match(calls[0].text, /Section B/);
});

test("sendTelegramMessage linkifies bare https URLs", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, opts) => {
    calls.push(JSON.parse(opts.body));
    return okResponse();
  };
  const url = "https://connect.composio.dev/link/lk_5oiVSeNBNB6P";

  try {
    await sendTelegramMessage("token", "chat-link", `Authorize Gmail: ${url}`);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.match(
    calls[0].text,
    new RegExp(`<a href="${url.replace(/\//g, "\\/")}"><u>${url.replace(/\//g, "\\/")}<\\/u><\\/a>`)
  );
});

test("sendTelegramMessage keeps markdown link syntax visible", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, opts) => {
    calls.push(JSON.parse(opts.body));
    return okResponse();
  };
  const raw = "[Authorize Gmail](https://connect.composio.dev/link/lk_test)";

  try {
    await sendTelegramMessage("token", "chat-md-link", raw);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /\[Authorize Gmail\]\(/);
  assert.doesNotMatch(calls[0].text, /<a href="https:\/\/connect\.composio\.dev\/link\/lk_test">Authorize Gmail<\/a>/);
});

test("sendTelegramMessage ignores empty messages", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return okResponse();
  };

  try {
    await sendTelegramMessage("token", "chat-3", "  \n ");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls, 0);
});

test("sendTelegramPreviewMessage returns message_id from Telegram API", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body) });
    return okResponse({ message_id: 42 });
  };

  try {
    const messageId = await sendTelegramPreviewMessage("token", "chat-prev", "_💭 thinking_");
    assert.equal(messageId, 42);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.match(String(calls[0].url), /sendMessage$/);
  assert.equal(calls[0].body.chat_id, "chat-prev");
});

test("editTelegramMessage uses editMessageText API", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body) });
    return okResponse({ message_id: 42 });
  };

  try {
    await editTelegramMessage("token", "chat-prev", 42, "_💭 updated thought_");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.match(String(calls[0].url), /editMessageText$/);
  assert.equal(calls[0].body.message_id, 42);
  assert.equal(calls[0].body.chat_id, "chat-prev");
});
