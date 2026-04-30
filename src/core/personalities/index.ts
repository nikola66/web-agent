export interface PersonalityPreset {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  order?: number;
}

const personalityModules = import.meta.glob<{ default: PersonalityPreset }>(
  "./*.json",
  { eager: true }
);

const PERSONALITY_PRESETS: readonly PersonalityPreset[] = Object.values(personalityModules)
  .map((m) => m.default)
  .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));

export const DEFAULT_PERSONALITY_PRESET_ID = "friend";

export function listPersonalityPresets(): readonly PersonalityPreset[] {
  return PERSONALITY_PRESETS;
}

export function getPersonalityPresetById(id: string): PersonalityPreset | undefined {
  return PERSONALITY_PRESETS.find((preset) => preset.id === id);
}

export function getDefaultPersonalityPrompt(): string {
  return (
    getPersonalityPresetById(DEFAULT_PERSONALITY_PRESET_ID)?.prompt ??
    PERSONALITY_PRESETS[0]?.prompt ??
    ""
  );
}

/** Preset display name (e.g. "Life Coach") when `prompt` matches a built-in preset exactly; otherwise null. */
export function getPersonalityDisplayLabelForPrompt(prompt: string): string | null {
  const trimmed = String(prompt ?? "").trim();
  if (!trimmed) return null;
  const preset = PERSONALITY_PRESETS.find((p) => p.prompt === trimmed);
  return preset?.name ?? null;
}

