---
name: Directus MCP
description: Use when connecting to Directus via Streamable HTTP MCP — configure .webagent/mcp-servers.json, store tokens in mcp-secrets.json, and call mcp_* tools for CMS CRUD.
version: 1.0.0
category: bundled
primary-tools: [write_file, skill_manage]
tags: [directus, mcp, cms, bearer, hub, collections, items, schema]
triggers: [directus mcp, connect directus, hub.aratech.ae, mcp-servers.json, directus token, mcp_directus, configure directus, directus cms mcp]
---

## Tool contract (read first)

| Need | Tool / file |
|------|-------------|
| Save MCP server URL + headers template | `write_file` → `.webagent/mcp-servers.json` |
| Save Bearer token (never in chat after setup) | `write_file` → `.webagent/mcp-secrets.json` |
| Reload MCP tools after config write | Automatic — `write_file` returns `mcp_reload` banner |
| CMS CRUD once registered | Call exact `mcp_<server>_<tool>` names from ## MCP in the Tool capability index |
| REST fallback (no MCP) | `skill_view` **`http-api`** — `/items/…`, `/collections/…` + Bearer headers |
| Create a reusable Directus procedure skill | `skill_manage` `action: "create"` with frontmatter + `## Procedure` section |

**Non-negotiable:** Do not probe the MCP JSON-RPC endpoint with `web_post`/`web_fetch` to discover tools — use registered `mcp_*` tools or `mcp_reload` output. Do not grep or list `memory/snapshots/` to recover MCP `tools/list` payloads.

## When to Use

- User asks to connect Directus MCP (Streamable HTTP URL + static token).
- Task needs Directus collections/items/schema and MCP is configured or being configured.
- After writing MCP config — verify ## MCP section lists `mcp_*` tools before calling them.
- User wants a saved skill documenting their Directus instance workflow.

**Not for:** generic REST without MCP (**`http-api`**), or Playwright/admin UI automation.

## Procedure

### 1. Configure MCP (two files under profile workspace)

**Secrets** (`.webagent/mcp-secrets.json`):

```json
{
  "directus_token": "<static-directus-token>"
}
```

**Server** (`.webagent/mcp-servers.json` — adjust URL and server key):

```json
{
  "directus": {
    "url": "https://your-directus.example.com/mcp",
    "transport": "streamable-http",
    "headers": {
      "Authorization": "Bearer ${DIRECTUS_TOKEN}"
    },
    "enabled": true
  }
}
```

Write both with `write_file`. Check the tool result for `mcp_reload` (e.g. `MCP: N tool(s) from 1 server(s)`). If `N` is 0, read startup warnings — empty `Authorization` means the token file is missing or mis-keyed.

### 2. Use registered MCP tools (not raw HTTP to `/mcp`)

1. Open the **Tool capability index** → ## MCP (`directus` or your server key).
2. Call tools by exact registry name: `mcp_<server>_<mcp_tool>` (underscores, lowercase).
3. Official Directus MCP (`directus/mcp`) commonly exposes kebab-case tools such as:

| MCP tool (on server) | Typical use |
|----------------------|-------------|
| `read-collections` | List collections + compact schema (start here) |
| `read-fields` | Full field definitions when `read-collections` is not enough |
| `read-items` | Query items (`collection`, `query` with filter/sort/fields/limit) |
| `create-item` | Insert row |
| `update-item` | Patch by id |
| `delete-item` | Remove by id |

Registry names example: server `directus` + tool `read-items` → **`mcp_directus_read_items`**.

Tool names vary by MCP package version — always use names from ## MCP after reload, not guesses.

### 3. Discovery order for new instances

1. `read-collections` (or REST `GET /collections` via **`http-api`**).
2. Pick collection slug from step 1 — never guess `posts`, `articles`, etc.
3. `read-items` with minimal `fields` + small `limit`.
4. Mutations only after confirming field names from schema.

### 4. Create a user skill (when asked)

Use `skill_manage` — not bare `write_file` unless you know the full SKILL.md shape:

```json
{
  "action": "create",
  "name": "directus-hub-publish",
  "description": "Publish content to our Directus hub instance",
  "content": "---\nname: directus-hub-publish\ndescription: Publish content to our Directus hub\ncategory: local\n---\n\n## Procedure\n\n1. Call mcp_directus_read_collections.\n2. …\n"
}
```

Required: YAML frontmatter with `name` + `description`, and at least one `##` section in the body.

## Relation to other skills

- REST/Bearer without MCP: **`http-api`**
- Imported skills mentioning MCP: **`imported-skill-compat`**
- File uploads to `/files`: **`http-api`** (`web_upload`) even when MCP is configured

## Pitfalls

- **403 on `tools/list`:** Bearer missing — token must be in `mcp-secrets.json`; `${DIRECTUS_TOKEN}` is resolved from that file at MCP connect time.
- **Manual JSON-RPC via `web_post`:** Wrong tool for discovery; causes snapshot spills and loops. Use `mcp_*` after reload.
- **grep / list_dir on `memory/snapshots/`:** Blocked by design — rerun the originating tool or use `list_digest` from compact output.
- **Profile restart:** Not required if `write_file` returned `mcp_reload` with tools > 0; restart only when the browser adapter was unavailable during reload.

## Anti-patterns

- Writing only `mcp-servers.json` without `mcp-secrets.json` when headers use `${DIRECTUS_TOKEN}`.
- Parsing MCP handshake responses with Python/`run_python` instead of reading ## MCP tool names.
- Chaining multiple `read_file` calls on the same snapshot path.
- Creating `.webagent/skills/.../SKILL.md` via `write_file` without frontmatter validation — use `skill_manage` create.
