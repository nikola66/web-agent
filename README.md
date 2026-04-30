![Web Agent](public/images/preview.webp)

<div align="center">

# Web Agent

**Browser-native AI agent — no servers, no installs, no VMs.**

Run a single **Web Agent** (Node.js 22 in [WebContainers](https://webcontainers.io/)) with **profiles**: separate personalities, workspaces, and memory per profile. Everything executes on your machine.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)
[![WebContainers](https://img.shields.io/badge/WebContainers-API-1e1e1e?style=flat-square&logo=stackblitz&logoColor=white)](https://webcontainers.io/)

</div>

---

## Overview

Web Agent boots one interactive agent runtime in the browser tab. The agent is a **zero-dependency Node 22 script** mounted into WebContainer (no `npm install` on launch — cold start is typically **~2 seconds**).

The project is intentionally built as a **data-driven system**: most user-facing behavior (providers, personalities, mascots, tool metadata, browser search/fetch backends) is defined in small structured files, then loaded by shared registries. This keeps extensions low-risk and makes open-source contributions easier to review.

| Concept | Description |
|--------|-------------|
| **Web Agent** | Single-file agent loop with 19 built-in tools (filesystem, shell, search, fetch, memory, todos) |
| **Profiles** | Named identities with their own system prompt, workspace snapshot, and optional provider/model overrides |
| **Terminal** | Full xterm.js PTY wired to the agent process |

---

## Features

- **Fast launch** — agent script mounted via `WebContainer.mount()`, no package install step
- **Profiles** — switch personality and isolated workspace; one profile active at a time
- **Tooling** — read/write/edit files, grep, tree, shell, web search, HTTP fetch, append-only memory, todo list
- **Provider agnostic** — OpenRouter or any OpenAI-compatible base URL via the Custom provider
- **Credential vault** — API keys stored encrypted in IndexedDB, never sent to any server
- **Workspace persistence** — per-profile snapshots in OPFS (restored on next launch)
- **Offline-capable** — service worker caches assets after first load

---

## Getting Started

### Prerequisites

- Node.js 18+
- An API key from [OpenRouter](https://openrouter.ai), or a custom OpenAI-compatible endpoint

### Installation

```bash
git clone https://github.com/aratech/web-agent
cd web-agent
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### Usage

1. **Profiles** — select or create a profile (name, personality, provider, accent color)
2. **Settings** — add your LLM API key(s)
3. **Launch Web Agent** — wait for the terminal prompt, then chat

First page load still downloads the WebContainer runtime (~ as before). There is no separate Python/Pyodide download.

---

## Architecture

```
src/
├── agent/
│   ├── adapter.ts          # Spawn agent PTY in embedded Node (Nodebox); writes `.webagent/*.js`
│   ├── tool-catalog.ts      # UI-facing TOOL_CATALOG JSON (from registry-browser)
│   ├── embed-commands.ts    # Re-exports SLASH_COMMANDS from compiled runtime
│   └── runtime/            # Node runtime sources (.ts → emit `dist/agent-runtime/*.js`)
├── capabilities/           # Drop-in tools, channels, providers, bundled skills
├── core/
│   ├── orchestrator.ts     # Terminal I/O, start/stop, storage hints
│   ├── profiles.ts       # Profile CRUD (idb-keyval)
│   ├── personalities/     # One file per personality preset
│   ├── providers/         # One file per LLM provider
│   ├── mascots/           # One file per mascot/accent/icon
│   ├── browseragent/      # One file per search/fetch backend
│   ├── migrate.ts        # One-time cleanup of legacy OPFS layout
│   ├── credential-vault.ts
│   ├── persistence.ts    # OPFS
│   └── workspace.ts      # Export/import/destroy per profile
├── runtimes/webcontainer/ # Boot, spawn, filesystem sync
└── ui/
    ├── components/       # Sidebar, ProfileSelector, ProfileEditor, Terminal, …
    └── stores/           # profile-store, runtime-store, settings-store
```

### How the agent runs

1. TypeScript boots WebContainer and restores `profiles/{id}/snapshot` from OPFS into `/workspace`.
2. The compiled `dist/agent-runtime/agent.js` string is injected into `/workspace/.webagent/agent.js` on launch (`npm run dev` / `build` run `build:embed-runtime` first).
3. `node .webagent/agent.js` runs with `cwd=/workspace`, API keys in `process.env`, and profile metadata in `WEBAGENT_*` variables.
4. On exit (or Stop), the workspace tree is re-exported to OPFS under the same profile prefix.

### Design principles for maintainability

- **File-based extension points**: add/remove capabilities by adding/removing a file in a catalog folder.
- **Thin registries, no hardcoded branches**: loaders compose data into runtime/UI config; avoid large switch statements.
- **Single source of truth**: metadata lives in one place and is shared across UI + runtime wiring.
- **Backward-compatible defaults**: each catalog defines a default entry to keep startup reliable.
- **Contributor-safe changes**: most feature work becomes JSON + small wiring updates, reducing regression surface.

### Catalog-driven modules

| Area | Folder | Typical file | What it controls |
|------|--------|--------------|------------------|
| Personalities | `src/core/personalities/` | `friend.json` | System prompt presets in Profile Editor |
| Built-in tools | `src/agent/runtime/tools/builtins/` | One `<tool_name>.ts` definition file | Native runtime tool registration, metadata, and OpenAI tool schema |
| Capability tools | `src/capabilities/tools/<id>/` | `manifest.json` + `handler.ts` (emitted as `handler.js` into `dist/capabilities-embed/`) | Drop-in extension tool registration and OpenAI tool schema |
| Gateway channels | `src/capabilities/channels/<id>/` | `manifest.json` + `runtime.ts` (emitted as `runtime.js`) | Polling channel sidecars such as Telegram |
| LLM providers | `src/capabilities/providers/<id>/` | `manifest.json` | Provider list, env mapping, runtime defaults, proxy allowlist |
| Bundled skills | `src/capabilities/skills/<id>/` | `SKILL.md` | Built-in procedural skills available to the agent |
| Mascots | `src/core/mascots/` | `pink.json` | Accent colors and crab icon mapping |
| Browser search/fetch providers | `src/core/browseragent/` | `tinyfish.json` | `web_search` / `web_fetch` backend config |
| Tool metadata | `src/agent/tool-catalog.ts` + generated `dist/agent-runtime/tools/registry-browser.js` | TypeScript/Generated JS | Tool emoji/description rendering and specs (browser-safe stub) |

### Extension workflow (recommended)

1. Add a built-in tool file in `src/agent/runtime/tools/builtins/<tool_name>.ts`, or add a capability folder in `src/capabilities/<type>/<id>/`.
2. Export a `defineTool(...)` default for built-ins; include the required manifest and runtime file for capabilities.
3. Verify the corresponding registry picks it up automatically.
4. Run `npm run build:embed-runtime` (or `npm run build`), then `tsx --test tests/capability-loader.test.ts tests/tool-registry-catalog.test.ts` (or `npm run test`).
5. Document any new required secrets in README.

See `CAPABILITIES.md` for the exact folder contracts.

### Removal workflow

This architecture supports safe removal by deleting a single file (for example, `src/core/providers/openrouter.json`), as long as:

- at least one valid catalog entry remains, and
- a default entry still exists (or the first entry is acceptable as fallback).

---

## Configuration

API keys live in **Settings** and are persisted encrypted. Optional **Custom** provider: base URL + key for any OpenAI-compatible API. Custom providers are called directly from the WebContainer, so the endpoint must allow browser/WebContainer CORS in local development.
Built-in LLM proxy routes are allowlisted by provider at `/api/llm/:provider/*` and currently support only: `openrouter`.

### Privacy contract

- Profiles and profile metadata live in IndexedDB.
- Credentials live encrypted in IndexedDB.
- Workspaces, memory, history, todos, cron jobs, bundled skills, and browser-local debug logs live in browser storage (OPFS-backed runtime files).
- Hosted deployments may still transit some requests through same-origin proxy routes such as `/api/proxy` and `/api/llm/:provider/*` because some upstreams are not reliably browser-CORS accessible.
- Those proxy routes are forwarding-only. They must not persist request bodies, response bodies, prompts, fetched page content, workspace files, or headers carrying credentials on the server.

### Transit-only hosted mode

- Set `VITE_WEBAGENT_LAUNCH_MODE=transit_only_proxy` for production or any hosted launch.
- This is the required production posture when you need same-origin proxy transit without server-side persistence of user data.
- Proxy debug logging is opt-in only via `WEBAGENT_DEBUG_PROXY=1` or the legacy `WEBAGENT_DEBUG_LLM_PROXY=1`, and should stay off in production.
- When proxy debug logging is enabled, logs are metadata-only: generated request id, route id, status code, and timing. Bodies, prompts, fetched content, auth headers, cookies, API keys, and full sensitive URLs are redacted.

### WebContainer runtime sourcing

- The `@webcontainer/api` package is pinned to an exact version for reproducible installs.
- The browser still downloads core WebContainer runtime assets from StackBlitz-managed infrastructure during boot.
- Service worker caching reduces repeat-load latency for app-owned assets and app shell files.
- If you require strict no-external-runtime networking, evaluate StackBlitz enterprise/self-host deployment options for WebContainers.

`web_search` / `web_fetch` providers are catalog-driven via `src/core/browseragent/`.
- TinyFish is currently the default provider.
- Add `tinyfish_api_key` in Settings (get one at [agent.tinyfish.ai/sign-up](https://agent.tinyfish.ai/sign-up)).
- New backends (for example Firecrawl) should be added as new files in that folder.
- Missing or invalid keys fail fast with actionable runtime errors.

### Reliability debug logs

- Set `VITE_WEBAGENT_DEBUG_LOG=1` to emit session JSONL traces while testing.
- Logs are written inside the runtime workspace at `debug-logs/<session-id>.jsonl`.
- Override location with `VITE_WEBAGENT_DEBUG_LOG_DIR` (default `debug-logs`).
- These logs stay browser-local and are never uploaded automatically by the app.
- Sensitive fields are redacted before write, including auth headers, cookies, prompt text, email bodies, fetched content, and full sensitive URLs.
- Do not enable runtime debug logs in production unless you explicitly want browser-local diagnostics for a test session.

### Production hosting requirements

- Disable request/response body capture in your host, reverse proxy, CDN/WAF, APM, tracing, and error replay products.
- If access logs are required, retain only route, timestamp, status, latency, and request id, with short retention.
- Disable vendor features that snapshot prompts, payload bodies, or response bodies by default.
- Ensure no proxy tier writes temp request artifacts to disk or object storage.
- Treat any new same-origin route that can transit user content as blocked until it is documented as non-persistent and covered by redaction tests.

Default models when no per-profile override is set (provider auto-detect follows key presence: OpenRouter → custom):

| Provider | Default model |
|----------|----------------|
| OpenRouter | `stepfun/step-3.5-flash` |
| Custom | `gpt-4o-mini` |

---

## Development

```bash
npm run dev      # watch transpile embed TS → dist/agent-runtime + dist/capabilities-embed, then Vite + HMR
npm run build    # embed transpile, then `tsc -b`, then Vite production build
npm run test     # embed transpile + Node unit tests (`tests/*.test.ts` via tsx)
npm run preview  # preview last production build (run `npm run build` first)
```

### Notes for contributors

See [`docs/agent-notes.md`](docs/agent-notes.md) for WebContainer filesystem layers, OPFS snapshot paths, and the `?raw` agent bundle pattern.

---

## Tech stack

| Layer | Technology |
|-------|------------|
| UI | React 19 + TypeScript 5.8 |
| Build | Vite 6 |
| Styling | Tailwind CSS 4 |
| Terminal | xterm.js 5 |
| State | Zustand 5 |
| Runtime | WebContainers API (Node 22) |
| Profile store | idb-keyval |
| Workspace | OPFS via `navigator.storage` |

---

## Known limitations

- **Browser-only** — no Telegram/Discord daemons, no host Playwright, no background cron when the tab is closed
- **One process** — one agent PTY at a time; profile switch requires stop then launch
- **Tool protocol** — chat requests use OpenAI-style native `tools` + `tool_choice: "auto"` (see runtime [`streaming.ts`](src/agent/runtime/llm/streaming.ts)); text fallbacks include `<<<TOOL>>>…<<<END>>>`, JSON shapes, and line-oriented aliases in [`agent.ts`](src/agent/runtime/agent.ts). If the provider rejects the `tools` parameter, the stream fails with an explicit error (no silent fallback).

---

## License

MIT
