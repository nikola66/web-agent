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

## Tool loop guardrails

Per-turn **deterministic tool loop guardrails** (ported from Hermes Agent) detect repeated tool failures and idempotent no-progress reads inside a single user turn. Warnings append guidance to tool results; hard stops are opt-in.

Configure via `.env` / `.env.local` (`VITE_WEBAGENT_TOOL_LOOP_*` → mirrored to `WEBAGENT_TOOL_LOOP_*` in Nodebox):

| Variable | Default | Role |
|----------|---------|------|
| `VITE_WEBAGENT_TOOL_LOOP_GUARDRAILS_WARNINGS` | `1` | Append warning guidance to tool results. |
| `VITE_WEBAGENT_TOOL_LOOP_GUARDRAILS_HARD_STOP` | `0` | Enable block/halt circuit breaker behavior. |
| `VITE_WEBAGENT_TOOL_LOOP_EXACT_FAILURE_WARN_AFTER` | `2` | Identical failing call signature → warn. |
| `VITE_WEBAGENT_TOOL_LOOP_EXACT_FAILURE_BLOCK_AFTER` | `5` | Identical failing call signature → block (hard stop only). |
| `VITE_WEBAGENT_TOOL_LOOP_SAME_TOOL_FAILURE_WARN_AFTER` | `3` | Same tool, varying args → warn. |
| `VITE_WEBAGENT_TOOL_LOOP_SAME_TOOL_FAILURE_HALT_AFTER` | `8` | Same tool failure streak → halt turn (hard stop only). |
| `VITE_WEBAGENT_TOOL_LOOP_NO_PROGRESS_WARN_AFTER` | `2` | Idempotent tool same result → warn. |
| `VITE_WEBAGENT_TOOL_LOOP_NO_PROGRESS_BLOCK_AFTER` | `5` | Idempotent tool same result → block (hard stop only). |

Implementation: `src/agent/runtime/tools/tool-loop-guardrails.ts`, integrated in `turn.ts` before/after tool execution.

Multi-step turns end when the model produces a final answer without tool calls. `/plan` is one turn only; explicit follow-up executes the plan in a new turn.

## Voice (STT / playback)

- **Browser mic:** `src/core/voice/stt-worker.ts` + `stt-client.ts` run vendored whisper-tiny.en (WASM). Mic input in `ChatInput` submits transcribed text directly — no LLM provider required for STT.
- **Browser playback:** `src/core/voice-playback.ts` — Edge TTS (free cloud, `en-US-AvaNeural`, +25% rate) via same-origin `/api/edge-tts`. Toggle with `/voice on|off` or the speaker control. Dev: Vite middleware; prod: `scripts/cors-proxy-server.mjs` + Caddy.
- **Telegram / workspace audio:** `audio_analyze` sends bytes to the STT worker over IPC (`WEBAGENT_STT_REQ` in `adapter.ts`). Telegram voice notes are transcribed and answered in **text** only.
- **Refresh script:** `npm run download:whisper`; `npm run check:models` runs before production builds.

See [`src/agent/runtime/voice/README.md`](../src/agent/runtime/voice/README.md).

## Bundled skills (discovery)

The runtime injects a **compact index** each turn (`description` + optional `triggers` + `tags`) — not full `SKILL.md` bodies. Contributors adding or editing skills under `src/capabilities/skills/` should:

- Start `description` with **Use when the user …** and real phrases users type.
- Add `triggers: […]` with 6–12 short match phrases (see `CAPABILITIES.md`).
- Keep `## When to Use` bullets aligned with triggers; procedures stay in the body for `skill_view`.

## Open-web research (Hermes-style)

- Bundled skill: `open-web-research` — fan-out `web_search`, verify with `web_fetch`, minimum effort before answering.
- Parallel safe tools (`web_search`, `web_fetch`, `grep`, `read_file`, …) run concurrently (cap 6) when emitted in one assistant turn.
- Optional: `WEBAGENT_MAX_AGENT_ROUNDS=90` for long discovery tasks; configure a browser-agent search API key (Settings) — DuckDuckGo fallback is weaker for niche queries.
- Telegram sends `Still working…` every 90s during an active channel turn.

## Profiles

- Stored as JSON in idb-keyval under `profiles:v1`.
- Adapter passes `WEBAGENT_PROFILE_NAME`, `WEBAGENT_PERSONALITY`, `WEBAGENT_PROVIDER`, optional `WEBAGENT_MODEL`, plus normal API key env vars.

## ANSI in UI strings

When embedding escape sequences in TypeScript template literals for the terminal, keep them valid JS strings (no broken `\x1b` sequences across line wraps).
