# Agent guidance for this repo

Rules for any AI coding agent (Claude Code, Codex, etc.) working in `web-agent`.

## Engineering style

- Make surgical fixes. Do not add new lines of code unless necessary.
- When changing or removing a feature, remove all related stale code in the same pass.
- Strive to write less code, not more.
- Ask clarifying questions if intent is unclear.
- Default to editing existing files; do not create new files when extending an existing module works.
- Never add comments that describe *what* code does — only *why*, and only when non-obvious.

## Project shape

For architecture context (runtime layout, IPC protocol, storage layers), read `docs/ARCHITECTURE.md`. Use English canonical docs unless the user requests a locale (`docs/zh-CN/`, `docs/es/`, `docs/ar/`).

Key entry points:
- `src/main.tsx` — React root.
- `src/core/orchestrator.ts` — central agent lifecycle.
- `src/agent/adapter.ts` — bridges browser UI to the embedded Node-in-browser agent runtime.
- `src/agent/runtime/turn.ts` — main LLM loop.
- `src/agent/runtime/tools/registry.ts` — built-in + capability tool loading.

The `src/agent/runtime` tree is **excluded from `tsc`** (see `tsconfig.json`). Edits there are not type-checked at build time; rely on tests and runtime checks.

## Before submitting

- `npx tsc -b --noEmit` clean.
- `npm test` passes.
- `npm run build` succeeds; no new oversized chunks.
- For UI changes, smoke the affected panel in `npm run dev` once.

## Cursor Cloud specific instructions

Single-service SPA — only one process needed: `npm run dev` (Vite + embed-runtime watcher via concurrently). No Docker, databases, or external services required for development.

- **Type checking requires a pre-built embed runtime.** Run `npm run build:embed-runtime` before `npx tsc -b --noEmit` if you haven't started the dev server yet. The dev server builds it automatically on start.
- **Unit tests** (`npm test`) also build the embed runtime first; no extra steps needed.
- **No linter configured** — there is no ESLint/Prettier/Biome. Type checking (`tsc`) is the primary static analysis tool.
- **Playwright E2E** (`npm run test:browser`) requires `TESTING_OPENROUTER_API_KEY` in `.env.local` and installed browsers (`npx playwright install chromium`). Skip unless you have an API key.
- **Directus skill E2E** (`tests/skill-directus-crud.spec.ts`) also needs `TESTING_DIRECTUS_TOKEN` (and optionally `TESTING_DIRECTUS_URL`). Skips when Directus is unreachable via `/api/proxy`.
- Dev server serves at `http://localhost:5173`. LLM interactions require an API key configured per-profile in the UI (OpenRouter, Ollama, or custom provider).
- Standard commands are documented in `package.json` scripts and README "Development" section.
