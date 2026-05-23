import { Readable } from "node:stream";

function extractMessageText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        if (part.type === "text") return String(part.text || "");
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function openAiToolsToResponses(tools) {
  if (!Array.isArray(tools)) return [];
  return tools
    .map((tool) => {
      const fn = tool?.function;
      if (!fn || typeof fn.name !== "string") return null;
      return {
        type: "function",
        name: fn.name,
        description: typeof fn.description === "string" ? fn.description : "",
        parameters: fn.parameters || {},
      };
    })
    .filter(Boolean);
}

export function codexChatToResponses(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const tools = openAiToolsToResponses(body.tools);
  const systemParts = [];
  const input = [];

  for (const msg of messages) {
    const role = String(msg.role || "");
    if (role === "system") {
      const text = extractMessageText(msg.content);
      if (text) systemParts.push(text);
      continue;
    }
    if (role === "user") {
      const text = extractMessageText(msg.content);
      if (text) input.push({ type: "message", role: "user", content: [{ type: "input_text", text }] });
      continue;
    }
    if (role === "assistant") {
      const text = extractMessageText(msg.content);
      if (text) input.push({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });
      for (const call of Array.isArray(msg.tool_calls) ? msg.tool_calls : []) {
        const fn = call?.function;
        if (!fn || typeof fn.name !== "string") continue;
        input.push({
          type: "function_call",
          call_id: String(call.id || fn.name),
          name: fn.name,
          arguments: String(fn.arguments || "{}"),
          status: "completed",
        });
      }
      continue;
    }
    if (role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: String(msg.tool_call_id || msg.name || "tool"),
        output: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? ""),
        status: "completed",
      });
    }
  }

  return {
    model: String(body.model || "gpt-5.4-mini"),
    store: false,
    stream: true,
    instructions: systemParts.length ? systemParts.join("\n") : "You are a helpful assistant.",
    input,
    ...(tools.length ? { tools, tool_choice: "auto", parallel_tool_calls: true } : {}),
  };
}

function chatChunk(id, model, delta, finishReason) {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function createCodexEventReducer() {
  let content = "";
  let reasoning = "";
  const toolCalls = [];
  const toolByOutput = new Map();
  let nextToolIndex = 0;

  function applyEvent(event) {
    const type = String(event.type || "");
    if (type === "response.output_text.delta") content += String(event.delta || "");
    if (type === "response.reasoning_text.delta") reasoning += String(event.delta || "");
    if (type === "response.text.done" && !content) content = String(event.text || "");
    if (type === "response.output_item.added") {
      const item = event.item;
      if (item?.type === "function_call") {
        const outputIndex = Number(event.output_index ?? nextToolIndex);
        const call = {
          id: String(item.call_id || item.id || `call_${nextToolIndex}`),
          name: String(item.name || ""),
          arguments: "",
          index: nextToolIndex,
        };
        toolByOutput.set(outputIndex, call);
        toolCalls.push(call);
        nextToolIndex++;
      }
    }
    if (type === "response.function_call_arguments.delta" || type === "response.function_call.arguments.delta") {
      const outputIndex = Number(event.output_index ?? 0);
      const call = toolByOutput.get(outputIndex);
      if (call) call.arguments += String(event.delta || "");
    }
  }

  return {
    applyEvent,
    snapshot: () => ({ content, reasoning, toolCalls }),
  };
}

export class CodexResponsesStreamAdapter {
  constructor(chunkId, model, write) {
    this.chunkId = chunkId;
    this.model = model;
    this.write = write;
    this.toolCalls = new Map();
    this.outputIndexToToolIndex = new Map();
    this.nextToolIndex = 0;
    this.hasToolCalls = false;
    this.hasText = false;
    this.finished = false;
  }

  handleEvent(event) {
    if (this.finished) return;
    const type = String(event.type || "");

    if (type === "response.output_text.delta" && event.delta) {
      this.hasText = true;
      this.emitDelta({ content: String(event.delta) });
      return;
    }
    if (type === "response.reasoning_text.delta" && event.delta) {
      this.emitDelta({ reasoning_content: String(event.delta) });
      return;
    }
    if (type === "response.text.done" && event.text && !this.hasText) {
      this.hasText = true;
      this.emitDelta({ content: String(event.text) });
      return;
    }
    if (type === "response.output_item.added") {
      const item = event.item;
      if (item?.type === "function_call") {
        const outputIndex = Number(event.output_index ?? 0);
        const index = this.nextToolIndex++;
        this.outputIndexToToolIndex.set(outputIndex, index);
        const id = String(item.call_id || item.id || `call_${index}`);
        const name = String(item.name || "");
        this.toolCalls.set(index, { id, name, arguments: "", index });
        this.hasToolCalls = true;
        this.emitDelta({ tool_calls: [{ index, id, type: "function", function: { name, arguments: "" } }] });
      }
      return;
    }
    if (type === "response.function_call_arguments.delta" || type === "response.function_call.arguments.delta") {
      const outputIndex = Number(event.output_index ?? 0);
      const index = this.outputIndexToToolIndex.get(outputIndex);
      if (index == null) return;
      const delta = String(event.delta || "");
      if (!delta) return;
      const call = this.toolCalls.get(index);
      if (!call) return;
      call.arguments += delta;
      this.emitDelta({ tool_calls: [{ index, function: { arguments: delta } }] });
      return;
    }
    if (type === "response.completed") {
      this.finished = true;
      this.emitDelta({}, this.hasToolCalls ? "tool_calls" : "stop");
    }
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.emitDelta({}, this.hasToolCalls ? "tool_calls" : "stop");
  }

  emitDelta(delta, finishReason = null) {
    this.write(`data: ${JSON.stringify(chatChunk(this.chunkId, this.model, delta, finishReason))}\n\n`);
  }
}

function copyHeaders(headers, res) {
  headers.forEach((value, key) => {
    if (key.toLowerCase() === "content-length") return;
    res.setHeader(key, value);
  });
}

function parseSseEvents(buffer) {
  const events = [];
  let rest = buffer;
  while (true) {
    const boundary = rest.indexOf("\n\n");
    if (boundary < 0) break;
    const block = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      try {
        events.push(JSON.parse(raw));
      } catch {
        /* ignore partial JSON */
      }
    }
  }
  return { events, rest };
}

function collectNonStreamOutput(text) {
  const reducer = createCodexEventReducer();
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === "[DONE]") continue;
    try {
      reducer.applyEvent(JSON.parse(raw));
    } catch {
      continue;
    }
  }
  return reducer.snapshot();
}

export async function proxyCodexChatCompletions(req, res, accessToken, baseUrl, bodyBuf) {
  let body;
  try {
    body = JSON.parse(bodyBuf.toString("utf8"));
  } catch {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "invalid_json_body" }));
    return;
  }

  const model = String(body.model || "gpt-5.4-mini");
  const codexBody = codexChatToResponses(body);
  const upstream = await fetch(`${baseUrl.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      Accept: "text/event-stream",
      originator: "pi",
    },
    body: JSON.stringify(codexBody),
  });

  if (!upstream.ok) {
    res.statusCode = upstream.status;
    res.setHeader("content-type", "application/json");
    res.end(await upstream.text());
    return;
  }

  if (!body.stream) {
    const text = await upstream.text();
    const collected = collectNonStreamOutput(text);
    const message = { role: "assistant", content: collected.content };
    if (collected.reasoning) message.reasoning_content = collected.reasoning;
    if (collected.toolCalls.length) {
      message.tool_calls = collected.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments || "{}" },
      }));
    }
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: `chatcmpl_${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message, finish_reason: collected.toolCalls.length ? "tool_calls" : "stop" }],
      })
    );
    return;
  }

  res.statusCode = 200;
  res.setHeader("content-type", "text/event-stream; charset=utf-8");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("connection", "keep-alive");

  const chunkId = `chatcmpl_${Date.now()}`;
  if (!upstream.body) {
    res.end();
    return;
  }

  const adapter = new CodexResponsesStreamAdapter(chunkId, model, (payload) => res.write(payload));
  let sseBuffer = "";
  Readable.fromWeb(upstream.body)
    .on("data", (chunk) => {
      sseBuffer += chunk.toString("utf8");
      const parsed = parseSseEvents(sseBuffer);
      sseBuffer = parsed.rest;
      for (const event of parsed.events) adapter.handleEvent(event);
    })
    .on("end", () => {
      if (sseBuffer.trim()) {
        const parsed = parseSseEvents(`${sseBuffer}\n\n`);
        for (const event of parsed.events) adapter.handleEvent(event);
      }
      adapter.finish();
      res.write("data: [DONE]\n\n");
      res.end();
    })
    .on("error", () => {
      adapter.finish();
      if (!res.writableEnded) {
        res.statusCode = 502;
        res.end();
      }
    });
}

export async function passthroughSubscriptionProxy(req, res, upstreamUrl, apiKey, body) {
  const upstreamHeaders = new Headers();
  for (const [key, rawValue] of Object.entries(req.headers)) {
    if (rawValue == null) continue;
    const lower = key.toLowerCase();
    if (lower === "host" || lower === "content-length") continue;
    if (Array.isArray(rawValue)) {
      for (const value of rawValue) upstreamHeaders.append(key, value);
    } else {
      upstreamHeaders.set(key, rawValue);
    }
  }
  upstreamHeaders.set("Authorization", `Bearer ${apiKey}`);
  const upstream = await fetch(upstreamUrl, {
    method: req.method || "GET",
    headers: upstreamHeaders,
    body,
  });
  res.statusCode = upstream.status;
  copyHeaders(upstream.headers, res);
  if (!upstream.body) {
    res.end();
    return;
  }
  Readable.fromWeb(upstream.body).pipe(res);
}
