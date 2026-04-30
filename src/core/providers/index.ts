export interface ProviderDefinition {
  id: string;
  name: string;
  label?: string;
  kind: "openai";
  requiresUserApiKey: boolean;
  isDefault?: boolean;
  model?: string;
  order?: number;
  apiKey?: {
    settingKey: string;
    envVar: string;
    placeholder?: string;
    getKeyUrl?: string;
  };
  runtime?: {
    basePath?: string;
    fallbackBaseUrl?: string;
    customBaseUrlEnvVar?: string;
    ensureV1Suffix?: boolean;
    extraHeaders?: Record<string, string>;
  };
}

import { CAPABILITY_PROVIDERS } from "@/capabilities";

export const PROVIDERS: readonly ProviderDefinition[] = (CAPABILITY_PROVIDERS as ProviderDefinition[])
  .filter(
    (provider) =>
      provider &&
      typeof provider.id === "string" &&
      typeof provider.name === "string" &&
      typeof provider.kind === "string"
  )
  .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));

export const PROVIDERS_BY_ID = Object.fromEntries(
  PROVIDERS.map((provider) => [provider.id, provider])
) as Record<string, ProviderDefinition>;

export const PROVIDER_IDS = PROVIDERS.map((provider) => provider.id);

export const DEFAULT_PROVIDER_ID =
  PROVIDERS.find((provider) => provider.isDefault)?.id ?? PROVIDERS[0]?.id ?? "openrouter";

export const PROVIDER_CATALOG_JSON = JSON.stringify(PROVIDERS, null, 2);
