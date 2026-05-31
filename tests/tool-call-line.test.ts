import test from "node:test";
import assert from "node:assert/strict";

import { parseToolStartTranscriptLine } from "../src/agent/tool-call-line.ts";

test("parseToolStartTranscriptLine extracts tool names from transcript lines", () => {
  assert.equal(parseToolStartTranscriptLine("▸ web_search {\"query\":\"x\"}"), "web_search");
  assert.equal(parseToolStartTranscriptLine("▸ 🌍 web_search {\"query\":\"x\"}"), "web_search");
  assert.equal(parseToolStartTranscriptLine("▸ 📄 read_file"), "read_file");
  assert.equal(parseToolStartTranscriptLine("▸ mcp_a_x {\"q\":1}"), "mcp_a_x");
});

test("parseToolStartTranscriptLine ignores non-tool status lines", () => {
  assert.equal(parseToolStartTranscriptLine("▸ heartbeat done, ran 0 job(s)"), null);
  assert.equal(parseToolStartTranscriptLine("▸ no cron jobs registered"), null);
  assert.equal(parseToolStartTranscriptLine("▸ skipped 1 invalid tool call(s): x"), null);
  assert.equal(parseToolStartTranscriptLine("▸ cron 'job' ran (ok)"), null);
  assert.equal(parseToolStartTranscriptLine("▸ deferred write_file: truncated"), null);
  assert.equal(parseToolStartTranscriptLine("Picklo · 🛠️"), null);
});
