# Architecture

High-level map of `web-agent`. Updated 2026-05-18.

## Layers

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (React 19 + Vite + Tailwind)                        │
│  ─────────────────────────────────────────────────────────── │
│  src/App.tsx ─ src/ui/components/{Terminal, ChatInput,       │
│                Sidebar, FilesPopup, MemoryTab, ProfileEditor}│
│  src/ui/stores/{runtime, profile, settings}-store  (Zustand) │
│                              │                                │
│                              ▼                                │
│  src/core/orchestrator.ts   ─ lifecycle, terminal, storage   │
│  src/core/workspace.ts      ─ WebContainer FS / shell        │
│  src/core/persistence.ts    ─ idb-keyval + OPFS              │
│  src/core/credential-vault  ─ AES-GCM encrypted API keys     │
│                              │                                │
│                              ▼                                │
│  src/agent/adapter.ts       ─ spawns embedded agent runtime  │
│                                in Nodebox / WebContainer     │
│                              │   stdout/stdin IPC markers    │
│                              ▼                                │
│  src/agent/runtime/         ─ Node-style agent (excluded     │
│    ├─ turn.ts                 from tsc; built via            │
│    ├─ tools/registry.ts       scripts/build-embed-runtime)   │
│    ├─ llm/streaming.ts                                       │
│    ├─ memory/* (sql.js)                                      │
│    └─ logging, channels, ...                                 │
│                              │                                │
│                              ▼                                │
│  HTTPS to LLM provider (OpenRouter / Ollama / custom)        │
│  via /api/llm/<provider> reverse proxy (vite.config.ts)      │
└──────────────────────────────────────────────────────────────┘
```

## Runtime boundary

The "agent" runs *inside* the browser tab in a Nodebox/WebContainer sandbox — not on a server. `src/agent/adapter.ts` spawns it as a Node-like process, then communicates through stdout/stdin.

### IPC marker protocol

The embedded runtime cannot directly call `fetch` (CORS / no origin). To make HTTP requests it writes framed markers to stdout:

```
<<<WEBAGENT_PROXY_REQ:<id>>>{"method":"POST","url":"…","headers":{…},"body":"…"}<<<END_WEBAGENT_PROXY_REQ>>>
```

`adapter.ts` parses these markers (currently lines ~834–900), routes through `/api/proxy` (CORS proxy, dev: `vite.config.ts`; prod: `scripts/cors-proxy-server.mjs` or Caddy), then writes the response back to stdin:

```
<<<WEBAGENT_PROXY_RESP:<id>>>{"status":200,"body":"…"}<<<END_WEBAGENT_PROXY_RESP>>>
```

The same framing is used for streaming LLM responses (`ipcProxyStreamRequest` in `src/agent/runtime/llm/streaming.ts`).

## Storage layers

| Layer          | Backed by      | Versioning            | Purpose                                |
|----------------|----------------|-----------------------|----------------------------------------|
| Profiles       | idb-keyval     | envelope `{version,…}`| Profile CRUD (`src/core/profiles.ts`)  |
| Credentials    | idb-keyval     | key-based             | PBKDF2 + AES-GCM API keys              |
| Settings (UI)  | idb-keyval     | none                  | sidebar width, theme, etc.             |
| Workspace files| OPFS           | none                  | WebContainer FS                        |
| Agent memory   | sql.js (WASM)  | column-add migrations | facts, learnings, jobs, snapshots      |
| Debug log      | OPFS JSONL     | none                  | tool calls, errors                     |

## Agent loop

1. `src/core/orchestrator.ts` boots a profile → `adapter.ts` spawns runtime.
2. User input → `src/agent/runtime/turn.ts:agentTurn()`.
3. `streamOpenAI()` issues a request (HTTP direct or IPC-framed).
4. Streamed chunks parsed → tool calls extracted.
5. `runTools()` (registry.ts) executes built-ins or capability tools.
6. Result spillover > 10 KB → written to workspace file (inline cap `MAX_TOOL_RESULT_INLINE_CHARS`).
7. **Turn judge** sidecar ([`server/turn-judge`](../server/turn-judge)) loads bundled ONNX from [`models/turn-judge/`](../models/turn-judge/) and classifies `continue` / `stop` / `ask_user`. The browser calls same-origin `POST /api/turn-judge` (Vite or Caddy → `127.0.0.1:8787/judge`). Disable with `WEBAGENT_TURN_JUDGE=0`. On unreachable judge or low model confidence, `turn.ts` fails closed to `stop` and applies conservative fallbacks (empty-after-tools, mid-task narration). Deploy and verify: [turn-judge.md](turn-judge.md).
8. Max 64 rounds per turn (`WEBAGENT_MAX_AGENT_ROUNDS`).

`AbortController` per turn; `/stop` triggers `abortCurrentTurn()`.

## Tool registry

- Built-in tools: `src/agent/runtime/tools/builtins/` — registered at module load.
- Capability tools: `src/capabilities/tools/<id>/{manifest.json, handler.js}` — loaded lazily; **skipped if name collides with a built-in** (warns to console + JSONL debug log).
- Tool catalog re-exported to browser via `src/agent/tool-catalog.ts` for emoji/icon hints in the UI.

## Build pipeline

```
scripts/build-embed-runtime.mjs   → dist/agent-runtime/*.js   (compiled agent code,
                                                                imported as ?raw strings)
vite build                        → dist/assets/*             (browser bundle)
```

Chunk strategy (`vite.config.ts`):

| Chunk          | Contents                       |
|----------------|--------------------------------|
| `sqljs`        | sql.js + WASM                  |
| `xterm`        | @xterm/* terminal              |
| `nodebox`      | @codesandbox/nodebox (if used) |
| `markdown`     | markdown-it                    |
| `icons`        | lucide-react                   |
| `react-vendor` | react, react-dom, scheduler    |
| `zustand`      | state library                  |

Heavy panels (`FilesPopup`, `MemoryTab`, `ProfileEditor`) are loaded via `React.lazy` so they don't block first paint.

## Where to look first

| Task                          | Start here                                       |
|-------------------------------|--------------------------------------------------|
| Add a tool                    | `src/agent/runtime/tools/builtins/`              |
| Add a capability skill        | `src/capabilities/skills/<id>/SKILL.md`          |
| Modify the agent loop         | `src/agent/runtime/turn.ts`                      |
| Turn judge / continue-stop    | `server/turn-judge/`, `models/turn-judge/`       |
| Add a channel (Telegram, …)   | `src/capabilities/channels/<id>/`                |
| New LLM provider              | `src/core/providers/<id>.json` + manifest        |
| UI panel                      | `src/ui/components/`                             |
| Persistence change            | `src/core/profiles.ts` + bump `STORAGE_SCHEMA_VERSION` |
