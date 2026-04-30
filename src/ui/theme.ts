/** aratech design system tokens */

export const colors = {
  bg: {
    primary: "#000000",
    surface: "#0a0a0a",
    elevated: "#111111",
  },
  text: {
    primary: "#ffffff",
    secondary: "#bcbcbc",
    muted: "#666666",
  },
  brand: {
    violet: "#4b1cdd",
    purple: "#6823e5",
    magentaDark: "#8a38f5",
    magenta: "#c633f7",
    magentaLight: "#fb75fc",
  },
  cta: "#be32d6",
  glow: "rgba(251, 117, 252, 0.5)",
  glowSubtle: "rgba(251, 117, 252, 0.14)",
  border: {
    default: "rgba(255, 255, 255, 0.12)",
    subtle: "rgba(255, 255, 255, 0.08)",
    strong: "rgba(255, 255, 255, 0.18)",
  },
  status: {
    success: "#34d399",
    warning: "#fbbf24",
    error: "#f87171",
  },
} as const;

export const radius = {
  sm: 8,
  button: 13,
  card: 34,
  panel: 54,
  plate: 64,
  pill: 124,
} as const;

export const motion = {
  ease: "cubic-bezier(0.16, 1, 0.3, 1)",
  fast: "150ms",
  normal: "200ms",
  slow: "250ms",
} as const;

/** xterm.js theme matching aratech */
export const terminalTheme = {
  background: colors.bg.primary,
  foreground: colors.text.primary,
  cursor: colors.brand.magentaLight,
  cursorAccent: colors.bg.primary,
  selectionBackground: "rgba(251, 117, 252, 0.25)",
  selectionForeground: colors.text.primary,
  black: "#000000",
  red: "#f87171",
  green: "#34d399",
  yellow: "#fbbf24",
  blue: "#60a5fa",
  magenta: colors.brand.magentaLight,
  cyan: "#22d3ee",
  white: "#ffffff",
  brightBlack: "#666666",
  brightRed: "#fca5a5",
  brightGreen: "#6ee7b7",
  brightYellow: "#fde68a",
  brightBlue: "#93c5fd",
  brightMagenta: colors.brand.magenta,
  brightCyan: "#67e8f9",
  brightWhite: "#ffffff",
} as const;
