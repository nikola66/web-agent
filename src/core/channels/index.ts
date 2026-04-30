export interface ChannelCatalogEntry {
  id: string;
  name: string;
  isDefault?: boolean;
  order?: number;
  docsUrl?: string;
  auth?: {
    settingKey: string;
    envVar: string;
    placeholder?: string;
  };
  defaultPollTimeoutS?: number;
}

import { CAPABILITY_CHANNELS } from "@/capabilities";

export const CHANNELS: readonly ChannelCatalogEntry[] = (CAPABILITY_CHANNELS as ChannelCatalogEntry[])
  .filter(
    (entry) =>
      entry && typeof entry.id === "string" && typeof entry.name === "string"
  )
  .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));

export const DEFAULT_CHANNEL_ID =
  CHANNELS.find((entry) => entry.isDefault)?.id ??
  CHANNELS[0]?.id ??
  "telegram";

export const CHANNEL_CATALOG_JSON = JSON.stringify(CHANNELS, null, 2);
