type JsonModule<T> = { default: T };

export interface RuntimeCapabilityFile {
  path: string;
  content: string;
}

type ToolManifest = {
  id: string;
  emoji?: string;
  description?: string;
  inputSchema?: unknown;
  requiresConfirmation?: boolean;
  order?: number;
};

type ProviderManifest = {
  id: string;
  name: string;
  order?: number;
};

type ChannelManifest = {
  id: string;
  name: string;
  order?: number;
};

const toolManifestModules = import.meta.glob("./tools/*/manifest.json", {
  eager: true,
}) as Record<string, JsonModule<ToolManifest>>;

const toolHandlerModules = import.meta.glob("../../dist/capabilities-embed/tools/*/handler.js", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const providerManifestModules = import.meta.glob("./providers/*/manifest.json", {
  eager: true,
}) as Record<string, JsonModule<ProviderManifest>>;

const channelManifestModules = import.meta.glob("./channels/*/manifest.json", {
  eager: true,
}) as Record<string, JsonModule<ChannelManifest>>;

const channelRuntimeModules = import.meta.glob("../../dist/capabilities-embed/channels/*/runtime.js", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const skillTextModules = import.meta.glob("./skills/**/*.{md,json,txt,js,sh}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

function capabilityPath(sourcePath: string): string {
  const normalized = sourcePath.replace(/\\/g, "/");
  const embedMarker = "dist/capabilities-embed/";
  const embedIdx = normalized.indexOf(embedMarker);
  if (embedIdx !== -1) return normalized.slice(embedIdx + embedMarker.length);
  return sourcePath.replace(/^\.\//, "");
}

function folderId(sourcePath: string): string {
  const parts = capabilityPath(sourcePath).split("/");
  return parts[1] || "";
}

function sortedValues<T extends { id: string; order?: number }>(values: T[]): T[] {
  return values
    .filter((entry) => entry && typeof entry.id === "string" && entry.id.trim())
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
}

export const CAPABILITY_TOOLS: readonly ToolManifest[] = sortedValues(
  Object.values(toolManifestModules).map((module) => module.default)
);

export const CAPABILITY_TOOL_CATALOG: Record<string, ToolManifest> = Object.fromEntries(
  CAPABILITY_TOOLS.map((tool) => [tool.id, tool])
);

export const CAPABILITY_PROVIDERS: readonly ProviderManifest[] = sortedValues(
  Object.values(providerManifestModules).map((module) => module.default)
);

export const CAPABILITY_CHANNELS: readonly ChannelManifest[] = sortedValues(
  Object.values(channelManifestModules).map((module) => module.default)
);

export const CAPABILITY_RUNTIME_FILES: readonly RuntimeCapabilityFile[] = [
  ...Object.entries(toolManifestModules).map(([path, module]) => ({
    path: capabilityPath(path),
    content: JSON.stringify(module.default, null, 2),
  })),
  ...Object.entries(toolHandlerModules).map(([path, content]) => ({
    path: capabilityPath(path),
    content,
  })),
  ...Object.entries(providerManifestModules).map(([path, module]) => ({
    path: capabilityPath(path),
    content: JSON.stringify(module.default, null, 2),
  })),
  ...Object.entries(channelManifestModules).map(([path, module]) => ({
    path: capabilityPath(path),
    content: JSON.stringify(module.default, null, 2),
  })),
  ...Object.entries(channelRuntimeModules).map(([path, content]) => ({
    path: capabilityPath(path),
    content,
  })),
  ...Object.entries(skillTextModules).map(([path, content]) => ({
    path: capabilityPath(path),
    content,
  })),
].sort((a, b) => a.path.localeCompare(b.path));

export const CAPABILITY_SUMMARY_JSON = JSON.stringify(
  {
    tools: CAPABILITY_TOOLS.map((tool) => tool.id),
    providers: CAPABILITY_PROVIDERS.map((provider) => provider.id),
    channels: CAPABILITY_CHANNELS.map((channel) => channel.id),
    skills: Array.from(
      new Set(Object.keys(skillTextModules).map((path) => folderId(path)).filter(Boolean))
    ).sort(),
  },
  null,
  2
);
