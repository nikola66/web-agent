/** Build OpenAI-compatible SSE bodies for Playwright route mocks. */

export function buildOpenAiSseBody(content: string, finishReason: string | null = "stop"): string {
  const chunks: string[] = [];
  if (content) {
    const delta = {
      id: "chatcmpl-turn-stall-mock",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "mock-turn-stall",
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
    };
    chunks.push(`data: ${JSON.stringify(delta)}`);
  }
  const finish = {
    id: "chatcmpl-turn-stall-mock",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "mock-turn-stall",
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
  };
  chunks.push(`data: ${JSON.stringify(finish)}`);
  chunks.push("data: [DONE]");
  return `${chunks.join("\n\n")}\n\n`;
}

export function createMockLlmResponseQueue(contents: string[]) {
  let index = 0;
  return () => {
    const content = contents[Math.min(index, contents.length - 1)] ?? "";
    index += 1;
    return buildOpenAiSseBody(content);
  };
}
