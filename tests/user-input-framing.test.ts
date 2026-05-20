import test from "node:test";
import assert from "node:assert/strict";

import {
  encodeUserInputLineForAgent,
  takeFramedUserInput,
  USER_INPUT_END,
  USER_INPUT_START,
} from "../dist/agent-runtime/user-input-framing.js";

test("single-line input stays a plain newline-terminated line", () => {
  assert.equal(encodeUserInputLineForAgent("hello"), "hello\n");
  assert.equal(takeFramedUserInput("hello\n"), null);
});

test("multiline input round-trips through framed stdin", () => {
  const multiline = "Directus URL:\nhttps://example.com\nToken: abc";
  const encoded = encodeUserInputLineForAgent(multiline);
  assert.ok(encoded.startsWith(USER_INPUT_START));
  assert.ok(encoded.includes(USER_INPUT_END));

  const take = takeFramedUserInput(encoded);
  assert.equal(take?.kind, "complete");
  if (take?.kind !== "complete") return;
  assert.equal(take.line, multiline);
  assert.equal(take.rest, "");
});

test("framed input waits until the closing marker arrives", () => {
  const partial = encodeUserInputLineForAgent("a\nb").slice(0, -2);
  assert.equal(takeFramedUserInput(partial)?.kind, "incomplete");
});
