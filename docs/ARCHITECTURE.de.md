# Architektur

**Sprachen:** [English](ARCHITECTURE.md) · [Español](ARCHITECTURE.es.md) · [简体中文](ARCHITECTURE.zh-CN.md) · [Deutsch](ARCHITECTURE.de.md)

Überblick über `web-agent`. Stand 2026-05-19.

## Inhalt

- [Schichten](#schichten)
- [Runtime-Grenze](#runtime-grenze)
- [Speicherschichten](#speicherschichten)
- [Agent-Schleife](#agent-schleife)
- [Tool-Registry](#tool-registry)
- [Build-Pipeline](#build-pipeline)
- [Einstiegspunkte](#einstiegspunkte)

## Schichten

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

## Runtime-Grenze

Der „Agent“ läuft *im* Browser-Tab in einer Nodebox/WebContainer-Sandbox — nicht auf einem Server. `src/agent/adapter.ts` startet ihn als Node-ähnlichen Prozess und kommuniziert über stdout/stdin.

### IPC-Marker-Protokoll

Die eingebettete Runtime kann nicht direkt `fetch` aufrufen (CORS / kein Origin). HTTP-Anfragen werden als gerahmte Marker nach stdout geschrieben:

```
<<<WEBAGENT_PROXY_REQ:<id>>>{"method":"POST","url":"…","headers":{…},"body":"…"}<<<END_WEBAGENT_PROXY_REQ>>>
```

`adapter.ts` parst die Marker (ca. Zeilen ~834–900), leitet über `/api/proxy` (CORS-Proxy; Dev: `vite.config.ts`; Prod: `scripts/cors-proxy-server.mjs` oder Caddy) und schreibt die Antwort auf stdin:

```
<<<WEBAGENT_PROXY_RESP:<id>>>{"status":200,"body":"…"}<<<END_WEBAGENT_PROXY_RESP>>>
```

Gleiche Rahmung für LLM-Streaming (`ipcProxyStreamRequest` in `src/agent/runtime/llm/streaming.ts`).

## Speicherschichten

| Schicht         | Backend        | Versionierung           | Zweck                                  |
|-----------------|----------------|-------------------------|----------------------------------------|
| Profiles        | idb-keyval     | envelope `{version,…}`  | Profile CRUD (`src/core/profiles.ts`)   |
| Credentials     | idb-keyval     | key-based               | PBKDF2 + AES-GCM API-Keys              |
| Settings (UI)   | idb-keyval     | none                    | Sidebar-Breite, Theme, …               |
| Workspace files | OPFS           | none                    | WebContainer-FS                        |
| Agent memory    | sql.js (WASM)  | column-add migrations   | facts, learnings, jobs, snapshots      |
| Debug log       | OPFS JSONL     | none                    | Tool-Aufrufe, Fehler                   |

## Agent-Schleife

1. `src/core/orchestrator.ts` startet ein Profil → `adapter.ts` startet die Runtime.
2. Nutzereingabe → `src/agent/runtime/turn.ts:agentTurn()`.
3. `streamOpenAI()` sendet die Anfrage (direktes HTTP oder IPC-Rahmen).
4. Stream-Chunks → Tool-Calls extrahieren.
5. `runTools()` (`registry.ts`) führt Built-ins oder Capability-Tools aus.
6. Ergebnis > 10 KB → Workspace-Datei (Inline-Limit `MAX_TOOL_RESULT_INLINE_CHARS`).
7. **Turn judge** Sidecar ([`server/turn-judge`](../server/turn-judge)) lädt ONNX aus [`models/turn-judge/`](../models/turn-judge/) und klassifiziert `continue` / `stop` / `ask_user`. Browser ruft `POST /api/turn-judge` (Vite oder Caddy → `127.0.0.1:8787/judge`). Deaktivieren: `WEBAGENT_TURN_JUDGE=0`. Bei Unreachability oder niedriger Konfidenz schließt `turn.ts` konservativ mit `stop`. Deploy: [turn-judge.md](turn-judge.md).
8. Max. 64 Runden pro Turn (`WEBAGENT_MAX_AGENT_ROUNDS`).

`AbortController` pro Turn; `/stop` ruft `abortCurrentTurn()` auf.

## Tool-Registry

- Built-ins: `src/agent/runtime/tools/builtins/` — beim Modul-Laden registriert.
- Capability-Tools: `src/capabilities/tools/<id>/{manifest.json, handler.js}` — lazy; **übersprungen bei Namenskollision mit Built-in** (Konsole + JSONL).
- Katalog via `src/agent/tool-catalog.ts` für Emoji/Icons in der UI.

## Build-Pipeline

```
scripts/build-embed-runtime.mjs   → dist/agent-runtime/*.js
vite build                        → dist/assets/*
```

Chunk-Strategie (`vite.config.ts`):

| Chunk          | Inhalt                         |
|----------------|--------------------------------|
| `sqljs`        | sql.js + WASM                  |
| `xterm`        | @xterm/* terminal              |
| `nodebox`      | @codesandbox/nodebox (falls genutzt) |
| `markdown`     | markdown-it                    |
| `icons`        | lucide-react                   |
| `react-vendor` | react, react-dom, scheduler    |
| `zustand`      | State-Bibliothek               |

Schwere Panels (`FilesPopup`, `MemoryTab`, `ProfileEditor`) per `React.lazy`, damit der First Paint nicht blockiert.

## Einstiegspunkte

| Aufgabe              | Start hier                                       |
|----------------------|--------------------------------------------------|
| Tool hinzufügen      | `src/agent/runtime/tools/builtins/`              |
| Capability-Skill     | `src/capabilities/skills/<id>/SKILL.md`          |
| Agent-Schleife       | `src/agent/runtime/turn.ts`                      |
| Turn judge           | `server/turn-judge/`, `models/turn-judge/`       |
| Kanal (Telegram, …)  | `src/capabilities/channels/<id>/`                |
| Neuer LLM-Provider   | `src/core/providers/<id>.json` + manifest        |
| UI-Panel             | `src/ui/components/`                             |
| Persistenz           | `src/core/profiles.ts` + `STORAGE_SCHEMA_VERSION` erhöhen |
