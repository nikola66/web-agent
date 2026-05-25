import test from "node:test";
import assert from "node:assert/strict";

import {
  detectHttpIntentInShellCommand,
  formatShellHttpMisrouteError,
  shellCommandLooksLikeHttp,
} from "../dist/agent-runtime/tools/http-tool-routing.js";

test("detectHttpIntentInShellCommand flags axios require as web_fetch", () => {
  const d = detectHttpIntentInShellCommand(
    'node -e "const axios = require(\'axios\'); axios.get(\'https://api.example.com/items\')"'
  );
  assert.equal(d.detected, true);
  assert.equal(d.suggested_tool, "web_fetch");
});

test("detectHttpIntentInShellCommand flags axios patch as web_post", () => {
  const d = detectHttpIntentInShellCommand(
    'node -e "const axios = require(\'axios\'); axios.patch(\'https://api.example.com/items/42\', { status: \'published\' })"'
  );
  assert.equal(d.detected, true);
  assert.equal(d.suggested_tool, "web_post");
});

test("detectHttpIntentInShellCommand flags GraphQL as web_post", () => {
  const d = detectHttpIntentInShellCommand(
    'node -e "fetch(\'https://hub.example.com/graphql\', { method: \'POST\', body: JSON.stringify({ query: \'{ __typename }\' }) })"'
  );
  assert.equal(d.detected, true);
  assert.equal(d.suggested_tool, "web_post");
});

test("detectHttpIntentInShellCommand flags multipart upload as web_upload", () => {
  const d = detectHttpIntentInShellCommand(
    'curl -F "file=@hero.jpg" -H "Authorization: Bearer tok" https://cms.example.com/files'
  );
  assert.equal(d.detected, true);
  assert.equal(d.suggested_tool, "web_upload");
  assert.match(d.recovery_hint, /web_upload/);
});

test("formatShellHttpMisrouteError names suggested tool", () => {
  const d = detectHttpIntentInShellCommand("node -e \"require('axios')\"");
  const msg = formatShellHttpMisrouteError(d);
  assert.match(msg, /web_fetch/);
  assert.match(msg, /HTTP calls belong in/);
});

test("shellCommandLooksLikeHttp ignores plain node version", () => {
  assert.equal(shellCommandLooksLikeHttp("node --version"), false);
});
