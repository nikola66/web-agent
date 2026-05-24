import test from "node:test";
import assert from "node:assert/strict";
import {
  CodexResponsesStreamAdapter,
  codexChatToResponses,
} from "../scripts/subscription/llm-proxy.mjs";

test("codexChatToResponses keeps assistant history and tool results", () => {
  const converted = codexChatToResponses({
    model: "gpt-5.4-mini",
    messages: [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hey" },
      {
        role: "assistant",
        content: "Hi there.",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "read_file", arguments: "{\"path\":\"/workspace/a.txt\"}" },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "file contents" },
      { role: "user", content: "Thanks" },
    ],
    tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object" } } }],
  });

  assert.equal(converted.instructions, "You are helpful.");
  assert.equal(converted.input.length, 5);
  assert.deepEqual(converted.input[0], {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "Hey" }],
  });
  assert.deepEqual(converted.input[1], {
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: "Hi there." }],
  });
  assert.equal(converted.input[2].type, "function_call");
  assert.equal(converted.input[2].call_id, "call_1");
  assert.equal(converted.input[3].type, "function_call_output");
  assert.equal(converted.input[3].call_id, "call_1");
  assert.equal(converted.input[4].content[0].text, "Thanks");
});

test("CodexResponsesStreamAdapter maps function-call SSE to OpenAI tool_calls", () => {
  const chunks: string[] = [];
  const adapter = new CodexResponsesStreamAdapter("id", "gpt-5.4-mini", (payload) => chunks.push(payload));

  adapter.handleEvent({
    type: "response.output_item.added",
    output_index: 0,
    item: { type: "function_call", call_id: "call_abc", name: "read_file" },
  });
  adapter.handleEvent({
    type: "response.function_call_arguments.delta",
    output_index: 0,
    delta: "{\"path\":\"/workspace/a.txt\"}",
  });
  adapter.handleEvent({ type: "response.completed" });

  assert.equal(chunks.length, 3);
  const start = JSON.parse(chunks[0].slice(6));
  assert.equal(start.choices[0].delta.tool_calls[0].function.name, "read_file");
  const args = JSON.parse(chunks[1].slice(6));
  assert.equal(args.choices[0].delta.tool_calls[0].function.arguments, "{\"path\":\"/workspace/a.txt\"}");
  const done = JSON.parse(chunks[2].slice(6));
  assert.equal(done.choices[0].finish_reason, "tool_calls");
});

test("CodexResponsesStreamAdapter maps output_text deltas to content", () => {
  const chunks: string[] = [];
  const adapter = new CodexResponsesStreamAdapter("id", "gpt-5.4-mini", (payload) => chunks.push(payload));

  adapter.handleEvent({ type: "response.output_text.delta", delta: "Hello" });
  adapter.handleEvent({ type: "response.output_text.delta", delta: " there" });
  adapter.handleEvent({ type: "response.completed" });

  const first = JSON.parse(chunks[0].slice(6));
  assert.equal(first.choices[0].delta.content, "Hello");
  const last = JSON.parse(chunks[chunks.length - 1].slice(6));
  assert.equal(last.choices[0].finish_reason, "stop");
});

test("parseSubscriptionLlmTarget resolves codex models passthrough path", async () => {
  const { parseSubscriptionLlmTarget } = await import("../scripts/subscription/llm-handler.mjs");
  assert.deepEqual(parseSubscriptionLlmTarget("/api/llm/openai-codex/v1/models"), {
    provider: "openai-codex",
    targetPath: "/v1/models",
  });
  assert.deepEqual(parseSubscriptionLlmTarget("/api/llm/openai-codex/chat/completions"), {
    provider: "openai-codex",
    targetPath: "/chat/completions",
  });
  assert.equal(parseSubscriptionLlmTarget("/api/llm/openrouter/v1/models"), null);
});
