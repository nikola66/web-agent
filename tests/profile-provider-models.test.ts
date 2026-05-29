import test from "node:test";
import assert from "node:assert/strict";
import {
  activeProfileModel,
  buildProviderModelsFromProfile,
  resolveProviderModelOverride,
  storeProviderModelOverride,
} from "../src/core/profile-provider-models.ts";

test("storeProviderModelOverride keeps per-provider overrides", () => {
  let models = storeProviderModelOverride({}, "openrouter", "custom/model-a", "google/gemma-4-31b-it");
  models = storeProviderModelOverride(models, "ollama", "llama-custom", "gemma4:31b-cloud");
  assert.deepEqual(models, {
    openrouter: "custom/model-a",
    ollama: "llama-custom",
  });
});

test("switching providers restores saved override from providerModels", () => {
  const models = storeProviderModelOverride({}, "openrouter", "custom/model-a", "google/gemma-4-31b-it");
  assert.equal(resolveProviderModelOverride("ollama", models, "gemma4:31b-cloud"), "");
  assert.equal(
    resolveProviderModelOverride("openrouter", models, "google/gemma-4-31b-it"),
    "custom/model-a"
  );
});

test("activeProfileModel uses providerModels for active provider", () => {
  const model = activeProfileModel(
    {
      provider: "openrouter",
      model: "",
      providerModels: { openrouter: "custom/model-a", ollama: "llama-custom" },
    },
    "google/gemma-4-31b-it"
  );
  assert.equal(model, "custom/model-a");
});

test("resolveProviderModelOverride ignores bitnet overrides", () => {
  const models = storeProviderModelOverride({}, "bitnet", "custom-model", "bitnet-b1.58-2b-4t");
  assert.deepEqual(models, {});
  assert.equal(resolveProviderModelOverride("bitnet", models, "bitnet-b1.58-2b-4t"), "");
});

test("buildProviderModelsFromProfile migrates legacy model field", () => {
  const models = buildProviderModelsFromProfile(
    {
      provider: "openrouter",
      model: "legacy/model",
      providerModels: { ollama: "llama-custom" },
    },
    "google/gemma-4-31b-it"
  );
  assert.deepEqual(models, {
    openrouter: "legacy/model",
    ollama: "llama-custom",
  });
});
