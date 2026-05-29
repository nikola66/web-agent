---
name: MCP Setup
description: Use when the user asks to connect, add, or configure an MCP server (Directus, a Hub URL, a streamable-HTTP/SSE endpoint, or a stdio command). Covers the exact .webagent/mcp-servers.json + mcp-secrets.json schema and how tools reload.
version: 1.0.0
category: bundled
primary-tools: [write_file, read_file]
tags: [mcp, directus, hub, streamable-http, sse, integration]
triggers: [connect mcp, add mcp, configure mcp, mcp server, directus mcp, hub.aratech, /mcp endpoint, streamable-http, mcp token]
---

## What this is

There is **no** `mcp_add` tool and **no** `/mcp` slash command. You configure MCP
servers by writing two JSON files. Writing either file **auto-triggers a reload** —
the `write_file` result returns an `mcp_reload` banner telling you how many tools
loaded and, on failure, *why*. Read that banner; do not re-fetch the endpoint.

| File | Purpose |
|------|---------|
| `.webagent/mcp-servers.json` | Server definitions (URL/command, transport, headers). Safe to commit. |
| `.webagent/mcp-secrets.json` | The raw token. Secret — never echo its value back. |

## Do NOT

- ❌ `web_fetch`/`web_post` the MCP endpoint to "test" it. A GET on an MCP URL
  returns a JSON-RPC/Zod error (`invalid_union … jsonrpc 2.0`). That is **normal** —
  it means the server is reachable and speaks MCP. Stop fetching; just write the config.
- ❌ Read runtime source to learn the schema. It is right here.
- ❌ Put the raw token in `mcp-servers.json`. Reference it as `${DIRECTUS_TOKEN}` and
  put the value in `mcp-secrets.json`.

## Schema — HTTP/SSE server (e.g. a Hub URL)

`.webagent/mcp-servers.json`:

```json
{
  "directus": {
    "url": "https://hub.aratech.ae/mcp",
    "headers": { "Authorization": "Bearer ${DIRECTUS_TOKEN}" }
  }
}
```

`.webagent/mcp-secrets.json`:

```json
{ "directus_token": "<the token>" }
```

- **Transport is auto-detected.** Omit `transport`: the client tries
  `streamable-http` first, then falls back to `sse`. Only set
  `"transport": "sse"` if you know the server is SSE-only.
- `directus_token` is exported to the env as `DIRECTUS_TOKEN`,
  `DIRECTUS_API_TOKEN`, `DIRECTUS_ACCESS_TOKEN`, and `MCP_BEARER_TOKEN`, so
  `${DIRECTUS_TOKEN}` in any header resolves automatically. For a non-Directus
  bearer, use the `bearer_token` key instead (same env exports).

## Schema — stdio server (local command)

```json
{
  "myserver": {
    "command": "node",
    "args": ["server.js"],
    "env": { "API_KEY": "${MY_KEY}" }
  }
}
```

## Optional per-server fields

| Field | Meaning |
|-------|---------|
| `enabled` | `false` disables without deleting. |
| `timeout` | Per-tool-call timeout, seconds (default 120). |
| `connect_timeout` | Connect timeout, seconds (default 60). |
| `tools.include` / `tools.exclude` | Allow/deny list of tool names. |

## Procedure

1. `write_file` `.webagent/mcp-secrets.json` with `{ "directus_token": "…" }` (or `bearer_token`).
2. `write_file` `.webagent/mcp-servers.json` with the server block above.
3. Read the `mcp_reload` banner in the write result:
   - `MCP: N tool(s) from 1 server(s)` → connected. The tools appear as `mcp_<server>_<tool>` in the Tool capability index next turn.
   - `… (1 failed) — directus: <reason>` → fix per the reason below.

## Failure reasons

| Banner reason | Fix |
|---------------|-----|
| empty `Authorization` / auth hint | Token missing or `${VAR}` name mismatched — verify `mcp-secrets.json` has `directus_token`. |
| `failed to fetch` / `CORS` / `network` | Cross-origin MCP routes through the browser page adapter — **keep the Web Agent browser tab open**; reconnecting channels alone won't connect MCP. |
| `… timed out` | Endpoint slow/unreachable; raise `connect_timeout` or confirm the URL. |
| `404` / `invalid_union jsonrpc` on connect | Wrong path — confirm the URL ends at the MCP route (e.g. `/mcp`), not the web UI. |

Once connected, call the `mcp_*` tools directly. Configuring an MCP for a CMS like
Directus does **not** replace the **`directus`** skill — use whichever the task needs.
