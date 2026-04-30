import { create } from "zustand";
import {
  listProfiles,
  saveProfile,
  deleteProfileById,
  seedDefaultProfileIfEmpty,
  createAgentName,
  type Profile,
} from "@/core/profiles";

const ACTIVE_PROFILE_KEY = "web-agent:active-profile-id";

function readSavedActiveProfileId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROFILE_KEY);
  } catch {
    return null;
  }
}

function writeSavedActiveProfileId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_PROFILE_KEY, id);
    else localStorage.removeItem(ACTIVE_PROFILE_KEY);
  } catch {
    /* localStorage may be unavailable in restricted contexts */
  }
}

interface ProfileState {
  profiles: Profile[];
  activeProfileId: string | null;
  loaded: boolean;

  loadProfiles: () => Promise<void>;
  setActiveProfile: (id: string) => void;
  createProfile: (partial: {
    name: string;
    userName?: string;
    personality: string;
    provider: Profile["provider"];
    model?: string;
    accentColor: string;
  }, options?: { setActive?: boolean }) => Promise<Profile>;
  updateProfile: (id: string, patch: Partial<Profile>) => Promise<void>;
  removeProfile: (id: string) => Promise<void>;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profiles: [],
  activeProfileId: null,
  loaded: false,

  loadProfiles: async () => {
    await seedDefaultProfileIfEmpty();
    const profiles = await listProfiles();
    const { activeProfileId: currentInMemory } = get();
    const current = currentInMemory ?? readSavedActiveProfileId();
    const active =
      current && profiles.some((p) => p.id === current)
        ? current
        : profiles[0]?.id ?? null;
    writeSavedActiveProfileId(active);
    set({ profiles, activeProfileId: active, loaded: true });
  },

  setActiveProfile: (id) => {
    if (!get().profiles.some((p) => p.id === id)) return;
    writeSavedActiveProfileId(id);
    set({ activeProfileId: id });
  },

  createProfile: async (partial, options) => {
    const t = Date.now();
    const existingNames = get().profiles.map((p) => p.name);
    const p: Profile = {
      id: crypto.randomUUID(),
      name: partial.name.trim() || createAgentName(existingNames),
      userName: String(partial.userName || "User").trim() || "User",
      personality: partial.personality,
      provider: partial.provider,
      model: partial.model ?? "",
      accentColor: partial.accentColor,
      createdAt: t,
      updatedAt: t,
    };
    await saveProfile(p);
    const profiles = await listProfiles();
    const shouldSetActive = options?.setActive ?? true;
    if (shouldSetActive) {
      writeSavedActiveProfileId(p.id);
      set({ profiles, activeProfileId: p.id });
    } else {
      set({ profiles });
    }
    return p;
  },

  updateProfile: async (id, patch) => {
    const existing = get().profiles.find((p) => p.id === id);
    if (!existing) return;
    const next: Profile = { ...existing, ...patch, id, updatedAt: Date.now() };
    await saveProfile(next);
    set({ profiles: await listProfiles() });
  },

  removeProfile: async (id) => {
    const { profiles, activeProfileId } = get();
    if (profiles.length <= 1) return;
    await deleteProfileById(id);
    const nextList = await listProfiles();
    const nextActive =
      activeProfileId === id ? nextList[0]?.id ?? null : activeProfileId;
    writeSavedActiveProfileId(nextActive);
    set({ profiles: nextList, activeProfileId: nextActive });
  },
}));

export type { Profile };
