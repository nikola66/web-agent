import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

test("reasoningDisableExtras uses OpenRouter reasoning object only", async () => {
  const { reasoningDisableExtras, reasoningPreviewEnabled } = await import(
    "../dist/agent-runtime/llm/provider-config.js"
  );
  const prev = process.env.WEBAGENT_REASONING_PREVIEW;
  process.env.WEBAGENT_REASONING_PREVIEW = "0";
  try {
    assert.equal(reasoningPreviewEnabled(), false);
    assert.deepEqual(reasoningDisableExtras("openrouter"), { reasoning: { enabled: false } });
    assert.deepEqual(reasoningDisableExtras("opencode"), { reasoning: { enabled: false } });
    assert.deepEqual(reasoningDisableExtras("ollama"), {});
  } finally {
    if (prev === undefined) delete process.env.WEBAGENT_REASONING_PREVIEW;
    else process.env.WEBAGENT_REASONING_PREVIEW = prev;
  }
  assert.equal(reasoningPreviewEnabled(), true);
  assert.deepEqual(reasoningDisableExtras("openrouter"), {});
  assert.deepEqual(reasoningDisableExtras("openrouter", "org/big-pickle"), {
    reasoning: { enabled: false },
  });
  assert.deepEqual(reasoningDisableExtras("opencode", "big-pickle"), {
    reasoning: { enabled: false },
  });
  assert.deepEqual(reasoningDisableExtras("nous"), {});
  assert.deepEqual(reasoningDisableExtras("custom"), {});
});

test("resolveLlm routes built-in providers through the app LLM proxy in nodebox", async () => {
  const providers = await Promise.all(
    (await fs.readdir(path.join(process.cwd(), "src/capabilities/providers"))).map(
      async (dir) =>
        JSON.parse(
          await fs.readFile(
            path.join(process.cwd(), "src/capabilities/providers", dir, "manifest.json"),
            "utf8"
          )
        )
    )
  );

  await fs.mkdir(".webagent", { recursive: true });
  await fs.writeFile(".webagent/providers.json", JSON.stringify(providers, null, 2));

  const previous = {
    provider: process.env.WEBAGENT_PROVIDER,
    runtime: process.env.WEBAGENT_RUNTIME,
    origin: process.env.WEBAGENT_APP_ORIGIN,
    ollamaKey: process.env.OLLAMA_API_KEY,
  };

  process.env.WEBAGENT_PROVIDER = "ollama";
  process.env.WEBAGENT_RUNTIME = "nodebox";
  process.env.WEBAGENT_APP_ORIGIN = "http://localhost:5173";
  process.env.OLLAMA_API_KEY = "test-key";

  try {
    const { resolveLlm } = await import("../dist/agent-runtime/llm/provider-config.js");
    const cfg = await resolveLlm();
    assert.ok(cfg);
    assert.equal(cfg.provider, "ollama");
    assert.equal(cfg.baseUrl, "http://localhost:5173/api/llm/ollama");
    assert.equal(cfg.model, "gemma4:31b-cloud");
  } finally {
    process.env.WEBAGENT_PROVIDER = previous.provider;
    process.env.WEBAGENT_RUNTIME = previous.runtime;
    process.env.WEBAGENT_APP_ORIGIN = previous.origin;
    process.env.OLLAMA_API_KEY = previous.ollamaKey;
  }
});

test("resolveLlm routes OpenRouter directly in nodebox when useLocalProxy is false", async () => {
  const providers = await Promise.all(
    (await fs.readdir(path.join(process.cwd(), "src/capabilities/providers"))).map(
      async (dir) =>
        JSON.parse(
          await fs.readFile(
            path.join(process.cwd(), "src/capabilities/providers", dir, "manifest.json"),
            "utf8"
          )
        )
    )
  );

  await fs.mkdir(".webagent", { recursive: true });
  await fs.writeFile(".webagent/providers.json", JSON.stringify(providers, null, 2));

  const previous = {
    provider: process.env.WEBAGENT_PROVIDER,
    runtime: process.env.WEBAGENT_RUNTIME,
    origin: process.env.WEBAGENT_APP_ORIGIN,
    openrouterKey: process.env.OPENROUTER_API_KEY,
  };

  process.env.WEBAGENT_PROVIDER = "openrouter";
  process.env.WEBAGENT_RUNTIME = "nodebox";
  process.env.WEBAGENT_APP_ORIGIN = "http://localhost:5173";
  process.env.OPENROUTER_API_KEY = "test-key";

  try {
    const { resolveLlm } = await import("../dist/agent-runtime/llm/provider-config.js");
    const cfg = await resolveLlm();
    assert.ok(cfg);
    assert.equal(cfg.provider, "openrouter");
    assert.equal(cfg.baseUrl, "https://openrouter.ai/api/v1");
  } finally {
    process.env.WEBAGENT_PROVIDER = previous.provider;
    process.env.WEBAGENT_RUNTIME = previous.runtime;
    process.env.WEBAGENT_APP_ORIGIN = previous.origin;
    process.env.OPENROUTER_API_KEY = previous.openrouterKey;
  }
});

test("resolveLlm routes OpenCode Big Pickle through the app LLM proxy in nodebox", async () => {
  const providers = await Promise.all(
    (await fs.readdir(path.join(process.cwd(), "src/capabilities/providers"))).map(
      async (dir) =>
        JSON.parse(
          await fs.readFile(
            path.join(process.cwd(), "src/capabilities/providers", dir, "manifest.json"),
            "utf8"
          )
        )
    )
  );

  await fs.mkdir(".webagent", { recursive: true });
  await fs.writeFile(".webagent/providers.json", JSON.stringify(providers, null, 2));

  const previous = {
    provider: process.env.WEBAGENT_PROVIDER,
    runtime: process.env.WEBAGENT_RUNTIME,
    origin: process.env.WEBAGENT_APP_ORIGIN,
  };

  process.env.WEBAGENT_PROVIDER = "opencode";
  process.env.WEBAGENT_RUNTIME = "nodebox";
  process.env.WEBAGENT_APP_ORIGIN = "http://localhost:5173";

  try {
    const { resolveLlm } = await import("../dist/agent-runtime/llm/provider-config.js");
    const cfg = await resolveLlm();
    assert.ok(cfg);
    assert.equal(cfg.provider, "opencode");
    assert.equal(cfg.apiKey, "public");
    assert.equal(cfg.baseUrl, "http://localhost:5173/api/llm/opencode");
    assert.equal(cfg.model, "big-pickle");
  } finally {
    process.env.WEBAGENT_PROVIDER = previous.provider;
    process.env.WEBAGENT_RUNTIME = previous.runtime;
    process.env.WEBAGENT_APP_ORIGIN = previous.origin;
  }
});

test("resolveLlm ignores model override for OpenCode Big Pickle", async () => {
  const providers = await Promise.all(
    (await fs.readdir(path.join(process.cwd(), "src/capabilities/providers"))).map(
      async (dir) =>
        JSON.parse(
          await fs.readFile(
            path.join(process.cwd(), "src/capabilities/providers", dir, "manifest.json"),
            "utf8"
          )
        )
    )
  );

  await fs.mkdir(".webagent", { recursive: true });
  await fs.writeFile(".webagent/providers.json", JSON.stringify(providers, null, 2));

  const previous = {
    provider: process.env.WEBAGENT_PROVIDER,
    model: process.env.WEBAGENT_MODEL,
    runtime: process.env.WEBAGENT_RUNTIME,
    origin: process.env.WEBAGENT_APP_ORIGIN,
  };

  process.env.WEBAGENT_PROVIDER = "opencode";
  process.env.WEBAGENT_MODEL = "other-model";
  process.env.WEBAGENT_RUNTIME = "nodebox";
  process.env.WEBAGENT_APP_ORIGIN = "http://localhost:5173";

  try {
    const { resolveLlm } = await import("../dist/agent-runtime/llm/provider-config.js");
    const cfg = await resolveLlm();
    assert.ok(cfg);
    assert.equal(cfg.model, "big-pickle");
  } finally {
    process.env.WEBAGENT_PROVIDER = previous.provider;
    process.env.WEBAGENT_MODEL = previous.model;
    process.env.WEBAGENT_RUNTIME = previous.runtime;
    process.env.WEBAGENT_APP_ORIGIN = previous.origin;
  }
});

test("llmChatCompletionExtras adds stream_options except for subscription providers", async () => {
  const { llmChatCompletionExtras } = await import("../dist/agent-runtime/llm/provider-config.js");
  assert.deepEqual(llmChatCompletionExtras("openrouter", { stream: true }), {
    stream_options: { include_usage: true },
  });
  assert.deepEqual(llmChatCompletionExtras("nous", { stream: true }), {});
  assert.deepEqual(llmChatCompletionExtras("openai-codex", { stream: true }), {});
  assert.deepEqual(llmChatCompletionExtras("opencode", { stream: true }), {
    stream_options: { include_usage: true },
  });

  const prev = process.env.WEBAGENT_REASONING_PREVIEW;
  process.env.WEBAGENT_REASONING_PREVIEW = "0";
  try {
    assert.deepEqual(llmChatCompletionExtras("openrouter", { stream: true }), {
      reasoning: { enabled: false },
      stream_options: { include_usage: true },
    });
  } finally {
    if (prev === undefined) delete process.env.WEBAGENT_REASONING_PREVIEW;
    else process.env.WEBAGENT_REASONING_PREVIEW = prev;
  }
});

test("resolveLlm keeps direct upstream URLs outside nodebox", async () => {
  const providers = await Promise.all(
    (await fs.readdir(path.join(process.cwd(), "src/capabilities/providers"))).map(
      async (dir) =>
        JSON.parse(
          await fs.readFile(
            path.join(process.cwd(), "src/capabilities/providers", dir, "manifest.json"),
            "utf8"
          )
        )
    )
  );

  await fs.mkdir(".webagent", { recursive: true });
  await fs.writeFile(".webagent/providers.json", JSON.stringify(providers, null, 2));

  const previous = {
    provider: process.env.WEBAGENT_PROVIDER,
    runtime: process.env.WEBAGENT_RUNTIME,
    origin: process.env.WEBAGENT_APP_ORIGIN,
    ollamaKey: process.env.OLLAMA_API_KEY,
  };

  process.env.WEBAGENT_PROVIDER = "ollama";
  process.env.WEBAGENT_RUNTIME = "node";
  process.env.WEBAGENT_APP_ORIGIN = "http://localhost:5173";
  process.env.OLLAMA_API_KEY = "test-key";

  try {
    const { resolveLlm } = await import("../dist/agent-runtime/llm/provider-config.js");
    const cfg = await resolveLlm();
    assert.ok(cfg);
    assert.equal(cfg.baseUrl, "https://ollama.com/v1");
  } finally {
    process.env.WEBAGENT_PROVIDER = previous.provider;
    process.env.WEBAGENT_RUNTIME = previous.runtime;
    process.env.WEBAGENT_APP_ORIGIN = previous.origin;
    process.env.OLLAMA_API_KEY = previous.ollamaKey;
  }
});
