<!-- i18n-sync: en@8293e87 2026-05-20 -->

**اللغات:** [English](../DESIGN.md) · [简体中文](../zh-CN/DESIGN.md) · [Español](../es/DESIGN.md) · [العربية](DESIGN.md)

# Sistema de diseño Web Agent

Web Agent is a browser-native AI workspace with a retro-futurist terminal core. The visual language should feel closer to a serious coding agent than a generic SaaS dashboard: direct, dense, luminous, and operational.

## Principios de diseño

- Output-first, not chrome-first. The terminal and agent transcript are the center of the experience.
- Retro terminal energy, modern execution. Use old-school command-line cues with a clean, high-contrast finish.
- Dense but readable. Information should feel compact without becoming cramped.
- Luminous accents, dark foundations. Light is used sparingly to signal focus, state, and affordance.
- Browser-native and local-first. The UI should feel like a tool running on the user’s machine, not a remote web app pretending to be a desktop app.

## Visual Identity

The design language is inspired by coding agents such as Claude Code, Codex, and OpenCode, and by the terminal UX patterns from OpenClaw and Hermes Agent. The result should feel:

- engineered
- immediate
- slightly theatrical
- technically credible

The terminal area should evoke a modern TUI: monospaced output, sharp contrast, minimal decoration, and clear command feedback. Other surfaces should stay quieter so the terminal remains the visual anchor.

## Color System

The palette is intentionally black-forward with magenta-violet energy.

### Core Surfaces

- `#000000` - primary background
- `#0a0a0a` - surface background
- `#111111` - elevated surface

### Text

- `#ffffff` - primary text
- `#bcbcbc` - secondary text
- `#666666` - muted text

### Brand Accent

- `#4b1cdd` - violet
- `#6823e5` - purple
- `#8a38f5` - magenta dark
- `#c633f7` - magenta
- `#fb75fc` - magenta light
- `#be32d6` - CTA accent

### Glow And Borders

- Glow should be soft, not neon-heavy.
- Use `rgba(251, 117, 252, 0.5)` for strong emphasis and `rgba(251, 117, 252, 0.14)` for subtle ambient glow.
- Borders stay thin and understated: white at 8 to 18 percent opacity.

### Semantic Colors

- Success: `#34d399`
- Warning: `#fbbf24`
- Error: `#f87171`

## Typography

Primary font: `Poppins`

The product uses a two-font logic:

- UI chrome, labels, and navigation use `Poppins`
- Terminal output, code, command text, and technical surfaces should feel monospaced and tool-like

Typography should follow these rules:

- Use strong contrast in size and weight rather than many competing styles.
- Keep labels small and purposeful.
- Avoid soft, friendly SaaS copy styling in the terminal area.
- Prefer tight tracking for badges and section headers when a machine-like tone is needed.

## Geometry

The shape language is soft but deliberate. Radii are large enough to feel polished, not playful.

- `8px` - small controls
- `13px` - buttons
- `34px` - cards
- `54px` - panels
- `64px` - plates
- `124px` - pills

Use rounded geometry for containers, but keep the terminal itself visually disciplined. The goal is to make the shell feel integrated, not cutesy.

## Motion

Motion should feel like equipment, not decoration.

- Fast interactions: `150ms`
- Standard transitions: `200ms`
- Slower emphasis: `250ms`
- Easing: `cubic-bezier(0.16, 1, 0.3, 1)`

Use motion for:

- launch states
- hover affordances
- loading and thinking indicators
- profile and workspace transitions

Avoid continuous motion unless it has a job. When animation is present, it should communicate state or guide attention.

## Terminal Language

The terminal is the product’s signature surface.

### Tone

- Output should read like a capable agent console.
- Error and status lines should be clear, direct, and compact.
- Keep logs functional rather than chatty.

### Behavior

- Prefer output-first presentation.
- Hide unnecessary cursor chrome when the interface is in agent-output mode.
- Preserve clickable links, but do not let them dominate the terminal visually.
- Keep scrollbars and selection styling aligned with the accent palette.

### Terminal Theme

The xterm theme should remain close to the core palette:

- background: black
- foreground: white
- cursor: magenta light
- selection: translucent magenta

ANSI colors should be readable, not saturated for their own sake. Bright variants should remain within the same family so logs stay coherent.

## Component Language

The interface should feel like a layered agent workspace.

### Panels

- Surfaces are dark, bordered, and slightly elevated.
- Use translucent or lightly differentiated containers for auxiliary areas.
- Primary focus should remain on the terminal and live workspace.

### Controls

- Buttons should be compact and precise.
- Use accent color sparingly for primary action and active state.
- Secondary controls should recede until hovered or focused.

### Inputs

- Inputs should feel like operator tools, not consumer forms.
- Treat command entry as a first-class interaction.
- Keep focus states visible and crisp.

### Status And Feedback

- Use color to signal state, not to decorate everything.
- Success, warning, and error should be unmistakable.
- Thinking, streaming, and waiting states should have a subtle living quality, but never become noisy.

## Layout

Web Agent should read as a workspace with a terminal core and supporting side surfaces.

- Terminal and agent transcript are the primary vertical anchor.
- Workspace panels should support the terminal rather than compete with it.
- Sidebars and drawers should be dense, useful, and easy to scan.
- Mobile and narrow layouts should preserve the same hierarchy, even if the arrangement changes.

## Brand Voice In UI

The interface copy should sound:

- direct
- technical
- calm under load
- confident without hype

Avoid filler language. Prefer short, actionable phrasing that helps the user operate the system.

## What Not To Do

- Do not use generic pastel SaaS styling.
- Do not flatten the terminal into a chat bubble UI.
- Do not overuse gradients or glow effects.
- Do not mix too many visual systems in one screen.
- Do not let auxiliary panels overpower the agent runtime.

## Implementation Notes

The current codebase already encodes the system in `src/styles.css` and `src/ui/theme.ts`. Any future UI work should treat those files as the source of truth for color, radius, motion, and terminal theme values.

If the design system changes, update the tokens first, then align the components to those tokens.
