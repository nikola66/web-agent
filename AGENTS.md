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

For architecture context (runtime layout, IPC protocol, storage layers), read `docs/ARCHITECTURE.md`.

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
