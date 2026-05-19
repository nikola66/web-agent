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

## Open-web research (Hermes-style)

- Bundled skill: `open-web-research` — fan-out `web_search`, verify with `web_fetch`, minimum effort before answering.
- Parallel safe tools (`web_search`, `web_fetch`, `grep`, `read_file`, …) run concurrently (cap 6) when emitted in one assistant turn.
- Research turns use a higher continuation nudge cap via `WEBAGENT_RESEARCH_MAX_AUTO_CONTINUE_NUDGES` (default 30 when unset).
- Turn judge: bundled ONNX in `models/turn-judge/`; sidecar on port 8787; browser uses `/api/turn-judge`. Set `WEBAGENT_TURN_JUDGE=0` to disable. Started with `npm run dev` and `scripts/start-with-proxy.sh`. After model or sidecar changes, restart dev and relaunch the agent profile. Verify: `curl http://127.0.0.1:8787/health` — see [turn-judge.md](turn-judge.md).
- Optional: `WEBAGENT_MAX_AGENT_ROUNDS=90` for long discovery tasks; configure a browser-agent search API key (Settings) — DuckDuckGo fallback is weaker for niche queries.
- Telegram sends `Still researching…` every 90s during an active channel turn.

## Profiles

- Stored as JSON in idb-keyval under `profiles:v1`.
- Adapter passes `WEBAGENT_PROFILE_NAME`, `WEBAGENT_PERSONALITY`, `WEBAGENT_PROVIDER`, optional `WEBAGENT_MODEL`, plus normal API key env vars.

## ANSI in UI strings

When embedding escape sequences in TypeScript template literals for the terminal, keep them valid JS strings (no broken `\x1b` sequences across line wraps).
