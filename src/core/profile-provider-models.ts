export type ProviderModelOverrides = Record<string, string>;

export type ProfileModelFields = {
  provider: string;
  model?: string;
  providerModels?: ProviderModelOverrides;
};

export function resolveProviderModelOverride(
  providerId: string,
  providerModels: ProviderModelOverrides | undefined,
  defaultModel = ""
): string {
  if (providerId === "opencode") return "";
  const stored = String(providerModels?.[providerId] || "").trim();
  const normalizedDefault = String(defaultModel || "").trim();
  if (!stored || (normalizedDefault && stored === normalizedDefault)) return "";
  return stored;
}

export function storeProviderModelOverride(
  providerModels: ProviderModelOverrides,
  providerId: string,
  draftModel: string,
  defaultModel = ""
): ProviderModelOverrides {
  const next = { ...providerModels };
  const trimmed = String(draftModel || "").trim();
  const normalizedDefault = String(defaultModel || "").trim();
  if (providerId === "opencode" || !trimmed || (normalizedDefault && trimmed === normalizedDefault)) {
    delete next[providerId];
  } else {
    next[providerId] = trimmed;
  }
  return next;
}

export function buildProviderModelsFromProfile(
  profile: ProfileModelFields,
  defaultModel = ""
): ProviderModelOverrides {
  const models = { ...(profile.providerModels || {}) };
  const legacy = String(profile.model || "").trim();
  const providerId = profile.provider;
  const normalizedDefault = String(defaultModel || "").trim();
  if (legacy && !models[providerId]) {
    if (providerId !== "opencode" && legacy !== normalizedDefault) {
      models[providerId] = legacy;
    }
  }
  return models;
}

export function activeProfileModel(
  profile: ProfileModelFields,
  defaultModel = ""
): string {
  const models = buildProviderModelsFromProfile(profile, defaultModel);
  return resolveProviderModelOverride(profile.provider, models, defaultModel);
}
