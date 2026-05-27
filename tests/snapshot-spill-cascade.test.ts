import test from "node:test";
import assert from "node:assert/strict";

import {
  decideToolResultCompression,
  getMaxTurnInlineChars,
} from "../dist/agent-runtime/memory/index.js";
import { extractHttpListDigest } from "../dist/agent-runtime/tool-result-preview.js";
import { summarizeToolExecutions } from "../dist/agent-runtime/stream-output.js";

test("decideToolResultCompression spills large unwrapped snapshot read", () => {
  const content = "x".repeat(80_000);
  const item = {
    tool: "read_file",
    result: {
      ok: true,
      path: "memory/snapshots/run_x_r1_0.json",
      from_snapshot: true,
      content,
    },
  };
  const decision = decideToolResultCompression(item, 48_000, 256_000);
  assert.equal(decision.inline, false);
});

test("decideToolResultCompression spills first-hop web_fetch when turn budget exhausted", () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({ collection: `collection_${i}` }));
  const item = {
    tool: "web_fetch",
    result: {
      ok: true,
      url: "https://api.example.com/collections",
      data: rows,
    },
  };
  const decision = decideToolResultCompression(item, 48_000, 500);
  assert.equal(decision.inline, false);
  assert.equal(decision.spilledForTurnBudget, true);
});

test("getMaxTurnInlineChars default is 256k", () => {
  const prev = process.env.WEBAGENT_MAX_TURN_INLINE_CHARS;
  delete process.env.WEBAGENT_MAX_TURN_INLINE_CHARS;
  try {
    assert.equal(getMaxTurnInlineChars(), 256_000);
  } finally {
    if (prev === undefined) delete process.env.WEBAGENT_MAX_TURN_INLINE_CHARS;
    else process.env.WEBAGENT_MAX_TURN_INLINE_CHARS = prev;
  }
});

test("extractHttpListDigest extracts collection slugs from web_fetch data", () => {
  const digest = extractHttpListDigest({
    ok: true,
    url: "https://hub.example.com/collections",
    data: [{ collection: "job_postings" }, { collection: "Leads" }],
  });
  assert.deepEqual(digest?.slugs, ["job_postings", "Leads"]);
  assert.equal(digest?.total, 2);
});

test("summarizeToolExecutions adds list_digest when metadata payload spills", () => {
  const exec = [
    {
      tool: "web_fetch",
      result: {
        ok: true,
        url: "https://hub.example.com/collections",
        data: [{ collection: "job_postings" }, { collection: "Leads" }],
      },
    },
  ];
  const rows = summarizeToolExecutions(exec, ["memory/snapshots/run_x_r0_0.json"]);
  assert.match(rows[0].summary, /List digest \(2\)/);
  assert.match(rows[0].summary, /job_postings/);
  assert.match(rows[0].summary, /list_digest below/i);
  assert.match(rows[0].summary, /do not read_file/i);
  assert.deepEqual(rows[0].list_digest?.slugs, ["job_postings", "Leads"]);
});
