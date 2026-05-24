import test from "node:test";
import assert from "node:assert/strict";

const OPENROUTER_CFG = {
  provider: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "test-key",
  model: "openrouter/owl-alpha",
  extraHeaders: {},
};

const OPENROUTER_LIST = {
  data: [
    {
      id: "openrouter/owl-alpha",
      canonical_slug: "openrouter/owl-alpha",
      context_length: 1048756,
    },
    {
      id: "alias/model",
      canonical_slug: "vendor/canonical-model",
      context_length: 128000,
    },
  ],
};

function mockFetch(payloadByUrl, { calls = { count: 0 } } = {}) {
  return async (url, options = {}) => {
    calls.count += 1;
    const key = String(url);
    const entry = payloadByUrl[key];
    if (entry instanceof Error) throw entry;
    if (entry === undefined) {
      return { ok: false, json: async () => ({}) };
    }
    return {
      ok: true,
      json: async () => (typeof entry === "function" ? entry(options) : entry),
    };
  };
}

test("fetchContextWindow resolves openrouter/owl-alpha from models catalog", async () => {
  const { fetchContextWindow, resetModelMetadataCacheForTests } = await import(
    "../dist/agent-runtime/llm/model-metadata.js"
  );
  resetModelMetadataCacheForTests();

  const calls = { count: 0 };
  const fetchWithTimeout = mockFetch(
    { "https://openrouter.ai/api/v1/models": OPENROUTER_LIST },
    { calls }
  );

  const value = await fetchContextWindow(OPENROUTER_CFG, fetchWithTimeout);
  assert.equal(value, 1048756);
  assert.equal(calls.count, 1);
});

test("fetchContextWindow caches models catalog per provider session", async () => {
  const { fetchContextWindow, resetModelMetadataCacheForTests } = await import(
    "../dist/agent-runtime/llm/model-metadata.js"
  );
  resetModelMetadataCacheForTests();

  const calls = { count: 0 };
  const fetchWithTimeout = mockFetch(
    { "https://openrouter.ai/api/v1/models": OPENROUTER_LIST },
    { calls }
  );

  await fetchContextWindow(OPENROUTER_CFG, fetchWithTimeout);
  await fetchContextWindow(
    { ...OPENROUTER_CFG, model: "alias/model" },
    fetchWithTimeout
  );
  assert.equal(calls.count, 1);
});

test("fetchContextWindow returns default for openrouter/free without catalog fetch", async () => {
  const { fetchContextWindow, resetModelMetadataCacheForTests } = await import(
    "../dist/agent-runtime/llm/model-metadata.js"
  );
  resetModelMetadataCacheForTests();

  const calls = { count: 0 };
  const fetchWithTimeout = mockFetch({}, { calls });

  const value = await fetchContextWindow(
    { ...OPENROUTER_CFG, model: "openrouter/free" },
    fetchWithTimeout
  );
  assert.equal(value, 64000);
  assert.equal(calls.count, 0);
});

test("fetchContextWindow returns default for big-pickle without catalog fetch", async () => {
  const { fetchContextWindow, resetModelMetadataCacheForTests } = await import(
    "../dist/agent-runtime/llm/model-metadata.js"
  );
  resetModelMetadataCacheForTests();

  const calls = { count: 0 };
  const fetchWithTimeout = mockFetch({}, { calls });

  const value = await fetchContextWindow(
    {
      provider: "opencode",
      baseUrl: "https://opencode.ai/zen/v1",
      apiKey: "public",
      model: "big-pickle",
      extraHeaders: {},
    },
    fetchWithTimeout
  );
  assert.equal(value, 200_000);
  assert.equal(calls.count, 0);
});

test("fetchContextWindow returns null for unknown model", async () => {
  const { fetchContextWindow, resetModelMetadataCacheForTests } = await import(
    "../dist/agent-runtime/llm/model-metadata.js"
  );
  resetModelMetadataCacheForTests();

  const fetchWithTimeout = mockFetch({
    "https://openrouter.ai/api/v1/models": { data: [] },
  });

  const value = await fetchContextWindow(
    { ...OPENROUTER_CFG, model: "missing/model" },
    fetchWithTimeout
  );
  assert.equal(value, null);
});

test("parseModelsCatalog indexes canonical_slug alias", async () => {
  const { parseModelsCatalog } = await import("../dist/agent-runtime/llm/model-metadata.js");
  const map = parseModelsCatalog(OPENROUTER_LIST);
  assert.equal(map.get("vendor/canonical-model"), 128000);
});

test("parseModelsCatalog coerces string context_length", async () => {
  const { parseModelsCatalog } = await import("../dist/agent-runtime/llm/model-metadata.js");
  const map = parseModelsCatalog({ data: [{ id: "stringy/model", context_length: "32000" }] });
  assert.equal(map.get("stringy/model"), 32000);
});

test("fetchContextWindow omits Authorization when apiKey is empty", async () => {
  const { fetchContextWindow, resetModelMetadataCacheForTests } = await import(
    "../dist/agent-runtime/llm/model-metadata.js"
  );
  resetModelMetadataCacheForTests();

  let seenHeaders = {};
  const fetchWithTimeout = async (_url, options = {}) => {
    seenHeaders = options.headers || {};
    return { ok: true, json: async () => OPENROUTER_LIST };
  };

  await fetchContextWindow({ ...OPENROUTER_CFG, apiKey: "" }, fetchWithTimeout);
  assert.equal(seenHeaders.Authorization, undefined);
});

test("fetchContextWindow retries catalog fetch after transient failure", async () => {
  const { fetchContextWindow, resetModelMetadataCacheForTests } = await import(
    "../dist/agent-runtime/llm/model-metadata.js"
  );
  resetModelMetadataCacheForTests();

  let attempts = 0;
  const fetchWithTimeout = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("network");
    return { ok: true, json: async () => OPENROUTER_LIST };
  };

  const first = await fetchContextWindow(OPENROUTER_CFG, fetchWithTimeout);
  assert.equal(first, null);
  const second = await fetchContextWindow(OPENROUTER_CFG, fetchWithTimeout);
  assert.equal(second, 1048756);
  assert.equal(attempts, 2);
});

test("fetchContextWindow does not cache non-ok catalog responses", async () => {
  const { fetchContextWindow, resetModelMetadataCacheForTests } = await import(
    "../dist/agent-runtime/llm/model-metadata.js"
  );
  resetModelMetadataCacheForTests();

  let attempts = 0;
  const fetchWithTimeout = async () => {
    attempts += 1;
    if (attempts === 1) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => OPENROUTER_LIST };
  };

  const first = await fetchContextWindow(OPENROUTER_CFG, fetchWithTimeout);
  assert.equal(first, null);
  const second = await fetchContextWindow(OPENROUTER_CFG, fetchWithTimeout);
  assert.equal(second, 1048756);
  assert.equal(attempts, 2);
});

test("shouldUseNodeboxLlmProxy matches app-origin llm proxy URLs only in nodebox", async () => {
  const { shouldUseNodeboxLlmProxy } = await import("../dist/agent-runtime/llm/http-utils.js");
  const prevRuntime = process.env.WEBAGENT_RUNTIME;
  const prevOrigin = process.env.WEBAGENT_APP_ORIGIN;
  try {
    process.env.WEBAGENT_RUNTIME = "nodebox";
    process.env.WEBAGENT_APP_ORIGIN = "http://localhost:5173";
    assert.equal(
      shouldUseNodeboxLlmProxy("http://localhost:5173/api/llm/openai-codex/models"),
      true
    );
    assert.equal(shouldUseNodeboxLlmProxy("https://openrouter.ai/api/v1/models"), false);
  } finally {
    if (prevRuntime === undefined) delete process.env.WEBAGENT_RUNTIME;
    else process.env.WEBAGENT_RUNTIME = prevRuntime;
    if (prevOrigin === undefined) delete process.env.WEBAGENT_APP_ORIGIN;
    else process.env.WEBAGENT_APP_ORIGIN = prevOrigin;
  }
});

test("fetchContextWindow uses Ollama show fallback when catalog lacks context", async () => {
  const { fetchContextWindow, resetModelMetadataCacheForTests } = await import(
    "../dist/agent-runtime/llm/model-metadata.js"
  );
  resetModelMetadataCacheForTests();

  const fetchWithTimeout = mockFetch({
    "https://ollama.com/v1/models": { data: [{ id: "gemma4:31b-cloud" }] },
    "https://ollama.com/api/show": {
      model_info: { "gemma3.context_length": 131072 },
    },
  });

  const value = await fetchContextWindow(
    {
      provider: "ollama",
      baseUrl: "https://ollama.com/v1",
      apiKey: "test-key",
      model: "gemma4:31b-cloud",
      extraHeaders: {},
    },
    fetchWithTimeout
  );
  assert.equal(value, 131072);
});

test("provider-config re-exports fetchContextWindow", async () => {
  const providerConfig = await import("../dist/agent-runtime/llm/provider-config.js");
  const modelMetadata = await import("../dist/agent-runtime/llm/model-metadata.js");
  assert.equal(providerConfig.fetchContextWindow, modelMetadata.fetchContextWindow);
});
