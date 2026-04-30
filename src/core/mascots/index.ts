export interface MascotDefinition {
  id: string;
  name: string;
  accentColor: string;
  iconPath: string;
  isDefault?: boolean;
  order?: number;
}

const mascotModules = import.meta.glob("./*.json", { eager: true }) as Record<
  string,
  { default: MascotDefinition }
>;

export const MASCOTS: readonly MascotDefinition[] = Object.values(mascotModules)
  .map((module) => module.default)
  .filter(
    (mascot) =>
      mascot &&
      typeof mascot.id === "string" &&
      typeof mascot.accentColor === "string" &&
      typeof mascot.iconPath === "string"
  )
  .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));

export const DEFAULT_MASCOT =
  MASCOTS.find((mascot) => mascot.isDefault) ?? MASCOTS[0] ?? null;

export const DEFAULT_ACCENT_COLOR = DEFAULT_MASCOT?.accentColor ?? "#fb75fc";

export const PRESET_ACCENT_COLORS = MASCOTS.map((mascot) => mascot.accentColor);

export function randomAccentColor(): string {
  if (PRESET_ACCENT_COLORS.length === 0) return DEFAULT_ACCENT_COLOR;
  const index = crypto.getRandomValues(new Uint32Array(1))[0] % PRESET_ACCENT_COLORS.length;
  return PRESET_ACCENT_COLORS[index] ?? DEFAULT_ACCENT_COLOR;
}

