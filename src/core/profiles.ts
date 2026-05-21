import { get, set } from "idb-keyval";
import { getDefaultPersonalityPrompt } from "@/core/personalities";
import { DEFAULT_PROVIDER_ID, PROVIDERS } from "@/core/providers";
import { DEFAULT_ACCENT_COLOR } from "@/core/mascots";
import { DEFAULT_EDGE_TTS_VOICE } from "@/core/voice/edge-tts-client";

const STORAGE_KEY = "profiles:v1";
const STORAGE_SCHEMA_VERSION = 2;

interface StorageEnvelope {
  version: number;
  profiles: Profile[];
}

function isEnvelope(value: unknown): value is StorageEnvelope {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as StorageEnvelope).profiles) &&
    typeof (value as StorageEnvelope).version === "number"
  );
}

export const AGENT_NAMES = [
  "Velora",
  "Neonix",
  "Vespera",
  "Novara",
  "Chromis",
  "Lunara",
  "Sablis",
  "Eledyn",
  "Opaline",
  "Noctra",
  "Violex",
  "Solaris",
  "Orchidra",
  "Prismel",
  "Astryn",
  "Rubrix",
  "Saffrix",
  "Indara",
  "Pearlux",
  "Mirakai",
] as const;

export type ProfileProvider = string;

export interface LLMProvider {
  id: ProfileProvider;
  name: string;
  label?: string;
  model?: string;
  requiresUserApiKey: boolean;
  isDefault?: boolean;
  placeholder?: string;
  getKeyUrl?: string;
}

export const LLM_PROVIDER_CONFIG: readonly LLMProvider[] = PROVIDERS.map((provider) => ({
  id: provider.id,
  name: provider.name,
  label: provider.label,
  model: provider.model,
  requiresUserApiKey: provider.requiresUserApiKey,
  isDefault: provider.isDefault,
  placeholder: provider.apiKey?.placeholder,
  getKeyUrl: provider.apiKey?.getKeyUrl,
}));

export interface Profile {
  id: string;
  name: string;
  userName: string;
  personality: string;
  provider: ProfileProvider;
  /** Optional model id override for the chosen provider */
  model?: string;
  accentColor: string;
  /** Edge TTS voice id (en-US only), e.g. en-US-AvaNeural */
  ttsVoice?: string;
  createdAt: number;
  updatedAt: number;
}

function now(): number {
  return Date.now();
}

function normalizeProfiles(input: unknown): Profile[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((entry): entry is Profile => !!entry && typeof entry === "object")
    .map((entry) => ({
      ...entry,
      userName: String(entry.userName || "User"),
      ttsVoice: resolveProfileTtsVoiceStored(entry.ttsVoice),
      provider:
        entry.provider === "auto" ? DEFAULT_PROVIDER_ID : entry.provider,
    }));
}

function resolveProfileTtsVoiceStored(value: unknown): string {
  const v = String(value ?? "").trim();
  if (/^en-US-[A-Za-z0-9-]+$/.test(v)) return v;
  return DEFAULT_EDGE_TTS_VOICE;
}

async function readAll(): Promise<Profile[]> {
  const raw = await get<string>(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isEnvelope(parsed)) return normalizeProfiles(parsed.profiles);
    if (Array.isArray(parsed)) return normalizeProfiles(parsed);
    return [];
  } catch {
    return [];
  }
}

async function writeAll(profiles: Profile[]): Promise<void> {
  const envelope: StorageEnvelope = { version: STORAGE_SCHEMA_VERSION, profiles };
  await set(STORAGE_KEY, JSON.stringify(envelope));
}

export function createAgentName(existingNames: string[] = []): string {
  const used = new Set(existingNames.map((name) => name.toLowerCase()));
  const available = AGENT_NAMES.filter((name) => !used.has(name.toLowerCase()));
  const pool = available.length > 0 ? available : AGENT_NAMES;
  const index = crypto.getRandomValues(new Uint32Array(1))[0] % pool.length;
  return pool[index]!;
}

export async function listProfiles(): Promise<Profile[]> {
  return readAll();
}

export async function getProfileById(id: string): Promise<Profile | null> {
  const profiles = await readAll();
  return profiles.find((p) => p.id === id) ?? null;
}

export async function saveProfile(profile: Profile): Promise<void> {
  const profiles = await readAll();
  const idx = profiles.findIndex((p) => p.id === profile.id);
  const timestamp = now();
  const next = { ...profile, updatedAt: timestamp };
  if (idx >= 0) {
    profiles[idx] = next;
  } else {
    profiles.push({ ...next, createdAt: timestamp });
  }
  await writeAll(profiles);
}

export async function deleteProfileById(id: string): Promise<void> {
  const profiles = (await readAll()).filter((p) => p.id !== id);
  await writeAll(profiles);
}

export async function deleteAllProfiles(): Promise<void> {
  await writeAll([]);
}

const DEFAULT_PERSONALITY = getDefaultPersonalityPrompt();

export function createDefaultProfile(): Profile {
  const id = crypto.randomUUID();
  const defaultProvider = LLM_PROVIDER_CONFIG.find((provider) => provider.id === DEFAULT_PROVIDER_ID);
  return {
    id,
    name: createAgentName(),
    userName: "User",
    personality: DEFAULT_PERSONALITY,
    provider: DEFAULT_PROVIDER_ID,
    model: defaultProvider?.model || "",
    accentColor: DEFAULT_ACCENT_COLOR,
    ttsVoice: DEFAULT_EDGE_TTS_VOICE,
    createdAt: now(),
    updatedAt: now(),
  };
}

export async function seedDefaultProfileIfEmpty(): Promise<Profile> {
  const profiles = await readAll();
  if (profiles.length > 0) {
    const namesInUse = new Set(
      profiles
        .filter((profile) => profile.name.trim().toLowerCase() !== "default")
        .map((profile) => profile.name.toLowerCase())
    );
    const renamed = profiles.map((profile) => {
      if (profile.name.trim().toLowerCase() !== "default") return profile;
      const nextName = createAgentName(Array.from(namesInUse));
      namesInUse.add(nextName.toLowerCase());
      return {
        ...profile,
        name: nextName,
        updatedAt: now(),
      };
    });
    if (renamed.some((profile, index) => profile.name !== profiles[index]!.name)) {
      await writeAll(renamed);
    }
    return renamed[0]!;
  }
  const p = createDefaultProfile();
  await writeAll([p]);
  return p;
}
