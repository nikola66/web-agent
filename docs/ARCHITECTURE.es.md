# Arquitectura

**Idiomas:** [English](ARCHITECTURE.md) · [Español](ARCHITECTURE.es.md) · [简体中文](ARCHITECTURE.zh-CN.md) · [Deutsch](ARCHITECTURE.de.md)

Mapa de alto nivel de `web-agent`. Actualizado 2026-05-19.

## Contenido

- [Capas](#capas)
- [Límite del runtime](#límite-del-runtime)
- [Capas de almacenamiento](#capas-de-almacenamiento)
- [Bucle del agente](#bucle-del-agente)
- [Registro de tools](#registro-de-tools)
- [Pipeline de build](#pipeline-de-build)
- [Por dónde empezar](#por-dónde-empezar)

## Capas

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

## Límite del runtime

El "agente" corre *dentro* de la pestaña del navegador en un sandbox Nodebox/WebContainer — no en un servidor. `src/agent/adapter.ts` lo arranca como proceso tipo Node y se comunica por stdout/stdin.

### Protocolo de marcadores IPC

El runtime embebido no puede llamar `fetch` directamente (CORS / sin origin). Para HTTP escribe marcadores enmarcados en stdout:

```
<<<WEBAGENT_PROXY_REQ:<id>>>{"method":"POST","url":"…","headers":{…},"body":"…"}<<<END_WEBAGENT_PROXY_REQ>>>
```

`adapter.ts` parsea estos marcadores (aprox. líneas ~834–900), enruta por `/api/proxy` (proxy CORS; dev: `vite.config.ts`; prod: `scripts/cors-proxy-server.mjs` o Caddy) y escribe la respuesta en stdin:

```
<<<WEBAGENT_PROXY_RESP:<id>>>{"status":200,"body":"…"}<<<END_WEBAGENT_PROXY_RESP>>>
```

El mismo enmarcado se usa para streaming LLM (`ipcProxyStreamRequest` en `src/agent/runtime/llm/streaming.ts`).

## Capas de almacenamiento

| Capa           | Backend        | Versionado            | Propósito                              |
|----------------|----------------|-----------------------|----------------------------------------|
| Profiles       | idb-keyval     | envelope `{version,…}`| CRUD de perfiles (`src/core/profiles.ts`) |
| Credentials    | idb-keyval     | key-based             | API keys con PBKDF2 + AES-GCM          |
| Settings (UI)  | idb-keyval     | none                  | ancho sidebar, tema, etc.              |
| Workspace files| OPFS           | none                  | FS de WebContainer                     |
| Agent memory   | sql.js (WASM)  | column-add migrations | facts, learnings, jobs, snapshots      |
| Debug log      | OPFS JSONL     | none                  | tool calls, errores                    |

## Bucle del agente

1. `src/core/orchestrator.ts` arranca un perfil → `adapter.ts` lanza el runtime.
2. Entrada del usuario → `src/agent/runtime/turn.ts:agentTurn()`.
3. `streamOpenAI()` emite la petición (HTTP directo o enmarcado IPC).
4. Chunks del stream → extracción de tool calls.
5. `runTools()` (`registry.ts`) ejecuta built-ins o capability tools.
6. Resultado > 10 KB → archivo en workspace (límite inline `MAX_TOOL_RESULT_INLINE_CHARS`).
7. **Turn judge** sidecar ([`server/turn-judge`](../server/turn-judge)) carga ONNX de [`models/turn-judge/`](../models/turn-judge/) y clasifica `continue` / `stop` / `ask_user`. El navegador llama `POST /api/turn-judge` (Vite o Caddy → `127.0.0.1:8787/judge`). Desactivar con `WEBAGENT_TURN_JUDGE=0`. Si el judge no responde o hay baja confianza, `turn.ts` falla cerrado a `stop` con fallbacks conservadores. Despliegue: [turn-judge.md](turn-judge.md).
8. Máx. 64 rondas por turno (`WEBAGENT_MAX_AGENT_ROUNDS`).

`AbortController` por turno; `/stop` llama `abortCurrentTurn()`.

## Registro de tools

- Built-ins: `src/agent/runtime/tools/builtins/` — registro al cargar el módulo.
- Capability tools: `src/capabilities/tools/<id>/{manifest.json, handler.js}` — carga lazy; **omitidas si el nombre colisiona con un built-in** (aviso en consola + log JSONL).
- Catálogo reexportado al navegador vía `src/agent/tool-catalog.ts` para emoji/iconos en la UI.

## Pipeline de build

```
scripts/build-embed-runtime.mjs   → dist/agent-runtime/*.js
vite build                        → dist/assets/*
```

Estrategia de chunks (`vite.config.ts`):

| Chunk          | Contenido                      |
|----------------|--------------------------------|
| `sqljs`        | sql.js + WASM                  |
| `xterm`        | @xterm/* terminal              |
| `nodebox`      | @codesandbox/nodebox (si aplica)|
| `markdown`     | markdown-it                    |
| `icons`        | lucide-react                   |
| `react-vendor` | react, react-dom, scheduler    |
| `zustand`      | biblioteca de estado           |

Paneles pesados (`FilesPopup`, `MemoryTab`, `ProfileEditor`) usan `React.lazy` para no bloquear el primer paint.

## Por dónde empezar

| Tarea                         | Empezar aquí                                     |
|-------------------------------|--------------------------------------------------|
| Añadir tool                   | `src/agent/runtime/tools/builtins/`            |
| Añadir skill de capability    | `src/capabilities/skills/<id>/SKILL.md`          |
| Modificar bucle del agente    | `src/agent/runtime/turn.ts`                      |
| Turn judge / continue-stop    | `server/turn-judge/`, `models/turn-judge/`       |
| Añadir canal (Telegram, …)    | `src/capabilities/channels/<id>/`                |
| Nuevo proveedor LLM           | `src/core/providers/<id>.json` + manifest        |
| Panel UI                      | `src/ui/components/`                             |
| Cambio de persistencia        | `src/core/profiles.ts` + subir `STORAGE_SCHEMA_VERSION` |
