# Modular Capabilities

Web Agent ships **49 built-in tools** and **19 bundled skills** under `src/capabilities/`. Add a capability folder, rebuild, and the host copies it into `.webagent/capabilities/` for the runtime to scan.

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

Bundled skills use the same `SKILL.md` validation as user-created skills. In the **sandbox**, user skills live in `.webagent/skills/<category>/<slug>/` and take precedence over bundled copies under `.webagent/capabilities/skills/`. Install imports with `skill` action=manage `import_dir` — do not copy into `capabilities/skills/`. Host contributors edit `src/capabilities/skills/<skill_id>/SKILL.md`.

**Discovery surface:** Each turn injects a compact index built from frontmatter only (`name`, `description`, optional `triggers`, `tags`) — not the full `SKILL.md` body. Write `description` and `triggers` so they match how users phrase requests; load procedures with `skill_view`.

**Remote imports:** Skills installed via `skill_manage import_url` or `skill_bulk_save` auto-append a **Web Agent execution** section (see `src/agent/runtime/memory/skill-compat.ts`) mapping `WebFetch`, Bash, Python (`run_python`), Playwright, and MCP references to built-in tools. Bundled skills are not patched. After install, agents should `skill_view` **`imported-skill-compat`** then the installed slug.

Optional frontmatter:

```yaml
---
name: Example Skill
description: Use when the user asks to …
triggers: [phrase one, phrase two, error message users paste]
tags: [topic]
category: bundled
---
```

`triggers` accepts YAML lists or inline `[a, b]` arrays (same as `tags`). Use **6–12 user phrases** — not tool names. The index shows triggers after the description (truncated per skill if needed).

**Body sections (bundled skills):**

```markdown
## Tool contract (read first)
## When to Use
## Relation to other skills
## Procedure          # or Loop / Checklist / Output Contract
## Pitfalls
## Anti-patterns
```

## Verification

Run:

```bash
npm run build:embed-runtime
tsx --test tests/capability-loader.test.ts tests/tool-registry-catalog.test.ts
npm run build
```

At runtime, call `capability_list` to inspect copied capability folders.
