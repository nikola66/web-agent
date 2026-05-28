import test from "node:test";
import assert from "node:assert/strict";

import {
  WEB_AGENT_USER_AGENT,
  withWebAgentUserAgent,
} from "../dist/agent-runtime/http-upstream.js";

test("WEB_AGENT_USER_AGENT contains web-agent substring", () => {
  assert.match(WEB_AGENT_USER_AGENT, /^web-agent\//);
});

test("withWebAgentUserAgent sets default when missing", () => {
  assert.deepEqual(withWebAgentUserAgent({}), { "User-Agent": WEB_AGENT_USER_AGENT });
});

test("withWebAgentUserAgent leaves existing web-agent UA unchanged", () => {
  assert.deepEqual(withWebAgentUserAgent({ "User-Agent": "web-agent-skills" }), {
    "User-Agent": "web-agent-skills",
  });
});

test("withWebAgentUserAgent appends web-agent to foreign UA", () => {
  const out = withWebAgentUserAgent({ "User-Agent": "curl/8.0" });
  assert.match(out["User-Agent"], /curl\/8\.0/);
  assert.match(out["User-Agent"], /web-agent\//);
});
