<!-- i18n-sync: en@8293e87 2026-05-20 -->

**Idiomas:** [English](../CAPABILITIES.md) · [简体中文](../zh-CN/CAPABILITIES.md) · [Español](CAPABILITIES.md) · [العربية](../ar/CAPABILITIES.md)

# Capacidades modulares

Web Agent supports trusted, repo-level capability folders. Add a folder, rebuild, and the host copies it into `.webagent/capabilities/` for the runtime to scan.

## Built-In Tools

For native runtime tools, create `src/agent/runtime/tools/builtins/<tool_name>.ts` and export a `defineTool(...)` default definition. `npm run build:embed-runtime` regenerates the built-in index and browser-safe catalog from these files.

## Capability Tools

Create `src/capabilities/tools/<tool_id>/`:

- `manifest.json`
- `handler.ts` (repo source; `npm run build:embed-runtime` emits `handler.js` into `dist/capabilities-embed/` for bundling)

At runtime, copied files use the **`handler.js`** basename under `.webagent/capabilities/`.

`manifest.json`:

```json
{
  "id": "example_tool",
  "emoji": "🧩",
  "description": "Explain exactly what this tool does.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "value": { "type": "string" }
    },
    "required": ["value"],
    "additionalProperties": false
  },
  "requiresConfirmation": false
}
```

`handler.ts` (emit → `handler.js`):

```js
export async function run(args, ctx) {
  return { ok: true, value: args.value };
}
```

Tool ids must match `/^[a-z][a-z0-9_]*$/`. A capability tool cannot override a built-in tool id.

## Providers

Create `src/capabilities/providers/<provider_id>/manifest.json`.

Provider manifests use the existing OpenAI-compatible provider shape: `id`, `name`, `kind: "openai"`, `requiresUserApiKey`, optional `model`, `apiKey`, and `runtime` fields. Providers with `runtime.fallbackBaseUrl` are automatically allowed by the Vite LLM proxy.

## Channels

Create `src/capabilities/channels/<channel_id>/`:

- `manifest.json`
- `runtime.ts` (repo source; emit → `runtime.js` in `dist/capabilities-embed/`)

`runtime.js` exports `start(deps)` and returns `{ stop() {} }`. V1 supports polling-style adapters. Telegram is implemented as a capability folder and remains available through the legacy fallback if an old workspace snapshot does not have copied capability files yet.

## Skills

Create `src/capabilities/skills/<skill_id>/SKILL.md`.

Bundled skills use the same `SKILL.md` validation as user-created skills. User-created skills in `.webagent/skills/` take precedence over bundled skills with the same slug.

## Verification

Run:

```bash
npm run build:embed-runtime
tsx --test tests/capability-loader.test.ts tests/tool-registry-catalog.test.ts
npm run build
```

At runtime, call `capability_list` to inspect copied capability folders.
