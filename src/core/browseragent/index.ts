export interface BrowserAgentProvider {
  id: string;
  name: string;
  isDefault?: boolean;
  order?: number;
  docsUrl?: string;
  search?: {
    endpoint: string;
  };
  fetch?: {
    endpoint: string;
    timeoutMs?: number;
  };
  auth?: {
    settingKey: string;
    envVar: string;
    headerName?: string;
    placeholder?: string;
  };
}

const browserAgentModules = import.meta.glob("./*.json", { eager: true }) as Record<
  string,
  { default: BrowserAgentProvider }
>;

export const BROWSER_AGENT_PROVIDERS: readonly BrowserAgentProvider[] = Object.values(
  browserAgentModules
)
  .map((module) => module.default)
  .filter(
    (provider) =>
      provider &&
      typeof provider.id === "string" &&
      typeof provider.name === "string"
  )
  .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));

export const DEFAULT_BROWSER_AGENT_PROVIDER_ID =
  BROWSER_AGENT_PROVIDERS.find((provider) => provider.isDefault)?.id ??
  BROWSER_AGENT_PROVIDERS[0]?.id ??
  "tinyfish";

export const BROWSER_AGENT_PROVIDERS_JSON = JSON.stringify(
  BROWSER_AGENT_PROVIDERS,
  null,
  2
);

