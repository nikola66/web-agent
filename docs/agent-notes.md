# Agent notes (Web Agent single-runtime)

This document is for contributors working on `src/agent/`, `src/runtimes/webcontainer/`, and profile/workspace persistence.

## WebContainer filesystem

WebContainer uses a layered virtual filesystem. Mounts from the host page (`wc.mount`) land in the mount layer; spawned processes can create files in a process layer that may shadow mounts under the same path.

**Pattern used here**

- Agent runtime is imported as raw strings from **`dist/agent-runtime/*.js`** (`?raw`) and written to `/workspace/.webagent/*.js` on launch (after `npm run build:embed-runtime`).
- Markdown next to runtime (`HEARTBEAT.md`, etc.) still imports from `./runtime/*.md?raw` via a small Vite plugin.
- First-run setup writes `/workspace/AGENT.md` and `/workspace/USER.md`; the generated Unicode emoji library is mounted as `/workspace/EMOJIS.md`.
- `HOME=/tmp` so Node can write temp files without fighting read-only mount roots.

## OPFS snapshots

Workspace persistence lives under:

`profiles/{profileId}/snapshot/workspace/...`

`restoreFilesystem(profileId)` walks that prefix in OPFS and writes files into the WebContainer FS.

`saveWorkspaceSnapshot(profileId)` runs a tiny `node -e` inside WC to list all files under `/workspace`, then reads each file back into OPFS at the same prefix.

Legacy `snapshots/openclaw` and `snapshots/hermes` trees are removed once by `runLegacySnapshotMigration()` (`src/core/migrate.ts`).

## Agent runtime (`src/agent/runtime/` → `dist/agent-runtime/`)

- **Sources:** TypeScript under `src/agent/runtime/**/*.ts` (import specifiers use `.js` for Node ESM).
- **Emit:** `npm run build:embed-runtime` (see `scripts/build-embed-runtime.mjs`) writes plain ES modules to `dist/agent-runtime/`.
- **Browser bundle:** `src/agent/adapter.ts` imports emitted files as `?raw` strings and writes them to `/workspace/<profile>/.webagent/*.js` on launch.
- **Target:** Node inside the embedded runtime (Nodebox); keep APIs compatible with that environment.
- **LLM:** Native `fetch` streaming — OpenAI-compatible SSE (`/chat/completions`) and Anthropic SSE (`/v1/messages`).
- **Tools:** Model emits lines `<<<TOOL>>>{"name":"...","arguments":{...}}<<<END>>>`. The agent strips these for chat history and executes tools in-process.

## Loop Guard

Local **continue / stop / ask_user** decisions are the sole runtime loop mechanism (the old regex auto-continue stack is removed). After each assistant step, the Nodebox runtime asks the browser adapter to score the last few messages with a vendored MobileBERT MNLI classifier (Transformers.js ONNX, sourced from `Xenova/mobilebert-uncased-mnli`). ORT WASM is served from `/transformers-ort/`; model weights are static files at `/models/loop-guard/` (`public/models/loop-guard/`, refresh with `npm run download:loop-guard-model`).

Use [`.env.local`](../.env.local) for machine-specific local dev (gitignored; Vite loads it automatically). [`.env.example`](../.env.example) documents production-style defaults. All Loop Guard knobs use the `VITE_WEBAGENT_*` prefix so Vite exposes them to the adapter; `buildEnv()` mirrors them into `WEBAGENT_*` for the embedded runtime.

| Variable | Default | Role |
|----------|---------|------|
| `VITE_WEBAGENT_LOOP_GUARD` | `1` | `0` / `false` disables Loop Guard (runtime stops without nudges). |
| `VITE_WEBAGENT_MAX_AUTO_CONTINUE_NUDGES` | `20` | Cap on continue nudges per user turn. |
| `VITE_WEBAGENT_RESEARCH_MAX_AUTO_CONTINUE_NUDGES` | `30` | Higher cap when the user prompt matches open-web research intent. |
| `VITE_WEBAGENT_LOOP_GUARD_MAX_MESSAGES` | `6` | Messages included in the NLI premise. |
| `VITE_WEBAGENT_LOOP_GUARD_STOP_THRESHOLD` | `0.62` | Score for “task appears complete”. |
| `VITE_WEBAGENT_LOOP_GUARD_ASK_USER_THRESHOLD` | `0.60` | Score for “should ask for clarification”. |
| `VITE_WEBAGENT_LOOP_GUARD_CONTINUE_THRESHOLD` | `0.58` | Score for “should keep working”. |

Threshold order: stop → ask_user → continue; if none clear the bar, decision is **stop** (safe default).

Debug: set `VITE_WEBAGENT_DEBUG_LOG=1` and look for `turn_loop_guard` / `turn_loop_guard_nudge` in the session JSONL, or dim `▸ loop guard · …` lines in the terminal.

**Separate from Loop Guard:** `tool-failure-streak.ts` halts repeated identical tool failures inside one turn (deterministic streak counter).

## Open-web research (Hermes-style)

- Bundled skill: `open-web-research` — fan-out `web_search`, verify with `web_fetch`, minimum effort before answering.
- Parallel safe tools (`web_search`, `web_fetch`, `grep`, `read_file`, …) run concurrently (cap 6) when emitted in one assistant turn.
- Research turns use the higher Loop Guard nudge cap (`VITE_WEBAGENT_RESEARCH_MAX_AUTO_CONTINUE_NUDGES`, default 30).
- Optional: `WEBAGENT_MAX_AGENT_ROUNDS=90` for long discovery tasks; configure a browser-agent search API key (Settings) — DuckDuckGo fallback is weaker for niche queries.
- Telegram sends `Still researching…` every 90s during an active channel turn.

## Profiles

- Stored as JSON in idb-keyval under `profiles:v1`.
- Adapter passes `WEBAGENT_PROFILE_NAME`, `WEBAGENT_PERSONALITY`, `WEBAGENT_PROVIDER`, optional `WEBAGENT_MODEL`, plus normal API key env vars.

## ANSI in UI strings

When embedding escape sequences in TypeScript template literals for the terminal, keep them valid JS strings (no broken `\x1b` sequences across line wraps).
