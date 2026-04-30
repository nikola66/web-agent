import { DEFAULT_MASCOT, MASCOTS } from "@/core/mascots";

const COLOR_TO_MASCOT: Record<string, string> = Object.fromEntries(
  MASCOTS.map((mascot) => [mascot.accentColor.toLowerCase(), mascot.iconPath])
);

const RGB_PATTERN =
  /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i;

function toHexByte(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function normalizeColor(color: string | null | undefined): string | null {
  if (!color) return null;
  const raw = color.trim().toLowerCase();
  if (raw in COLOR_TO_MASCOT) return raw;

  const rgbMatch = raw.match(RGB_PATTERN);
  if (!rgbMatch) return null;
  const r = Number.parseInt(rgbMatch[1]!, 10);
  const g = Number.parseInt(rgbMatch[2]!, 10);
  const b = Number.parseInt(rgbMatch[3]!, 10);
  if ([r, g, b].some((v) => Number.isNaN(v) || v < 0 || v > 255)) return null;
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

export function mascotForAccentColor(accentColor: string | null | undefined): string {
  const normalized = normalizeColor(accentColor);
  const fallback = DEFAULT_MASCOT?.iconPath || "/mascot/Webby-pink.svg";
  return (normalized && COLOR_TO_MASCOT[normalized]) || fallback;
}
