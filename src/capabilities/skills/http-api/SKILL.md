---
name: HTTP API
description: Use when calling REST or GraphQL APIs with web_fetch/web_post — auth headers, query params, GraphQL shape, discovery order, and reading error bodies.
version: 1.0.0
category: bundled
primary-tools: [web_fetch, web_post, web_upload]
tags: [rest, graphql, api, web_fetch, web_post, web_upload, bearer, cms, headers, discovery, multipart, file upload]
triggers: [graphql, REST API, bearer token, web_post, authenticated fetch, api call, authorization header, CMS, list collections, resource count, metadata endpoint]
---

## When web_post vs web_upload (read first)

**Invariant:** bytes move runtime → proxy → upstream. You see metadata (`bytes`, `path`, `file_id`) — never base64 blobs in tool arguments or chat.

| Situation | Tool |
|-----------|------|
| JSON/GraphQL REST write | `web_post` (`body`/`json`/`form`) |
| CMS `/files` or single file upload | `web_upload` (`source_url` **or** `file_path`) |
| Mixed form fields + file(s) | `web_post` with `multipart` array |
| Download binary to workspace | `web_fetch` with `save_to` |
| Python script file upload | `webagent.http.upload_file` inside `run_python` |

**Anti-pattern (causes 240s timeouts):** `web_fetch` binary → base64 in `web_post` body → `read_file` snapshot loop. Stop and use `web_upload.file_path` or `source_url` instead.

### Directus-style publish (3 steps)

1. **Upload file** — `web_upload` to `/files` with `source_url` or `file_path` (Telegram inbox paths work as `file_path`).
2. **Link record** — `web_post` PATCH the item with returned file id (`data.id`).
3. **Publish** (if needed) — `web_post` PATCH status field per imported skill.

## Tool contract

Canonical procedure for **REST GET** (`web_fetch`) and **HTTP writes** (`web_post`: POST/PATCH/PUT/DELETE). Do not use `run_shell` + axios for one-off API calls.

| Need | Tool | Required args |
|------|------|----------------|
| Public or authenticated **GET** | `web_fetch` | `url`; optional `headers`, `params` |
| **POST** JSON / GraphQL | `web_post` | `url`, `body` or `json`; optional `headers`, `params`, `timeout_ms` |
| **PATCH/PUT** REST update | `web_post` | `url`, `body`/`json`, `method` (`"PATCH"` or `"PUT"`); optional `headers`, `params` |
| **DELETE** REST resource | `web_post` | `url`, `method`: `"DELETE"`; optional `headers`, `params` (body optional) |
| **Form POST** (OAuth, urlencoded) | `web_post` | `url`, `form` object; optional `headers` |
| **CMS / file upload** (multipart) | `web_upload` | `upload_url`, `source_url` **or** `file_path`; optional `headers`, `field_name`, `filename` |
| **Mixed multipart** (fields + file) | `web_post` | `url`, `multipart` array with `text` / `file_path` / `source_url` per field |
| **Binary download to workspace** | `web_fetch` | `url`, `save_to` workspace path (metadata-only result) |
| Batch public GET (≤5 URLs) | `web_fetch` | `urls` array; shared `headers`, `params` |
| Secrets | `headers.Authorization` (or API-key header docs specify) | Never in URL query; prefer Settings/vault over `memory_save` |

**Non-negotiable:** Read the API's real schema before inventing field names. On `ok: false` or GraphQL `errors`, fix the query — do not retry the same malformed call in a loop.

## HTTP decision tree

| Context | Use |
|---------|-----|
| Agent one-off REST/GraphQL call | `web_fetch` (GET) or `web_post` (writes/GraphQL) |
| CMS / featured image / file to `/files` | `web_upload` with `source_url` or `file_path` — **never base64 in tool args** |
| Reusable Python skill script | `import webagent.http as http` inside `run_python`; files → `http.upload_file` |
| Legacy `urllib.request` in imported `.py` | Works (proxy-patched); prefer `webagent.http` for new code |
| OAuth SaaS with Composio connector | `skill_view` **`composio-oauth`**, then `composio_status` — use `composio_action` when connected; not raw `web_post` |
| `requests` / `httpx` in Pyodide | Avoid — may JsProxy-fail; use agent tools or `webagent.http` |

## When to Use

- Any task hitting a REST or GraphQL HTTP API (CMS, CRM, webhooks, custom backends).
- After `web_post` / `web_fetch` returns validation, 401, or 403.
- Imported skills that mention `requests`, curl, axios, or `python -m …` for HTTP.
- Before guessing collection names, endpoints, or GraphQL root fields.

## Relation to other skills

- Tool picker (shell vs HTTP): **`browser-runtime-map`**. MCP integrations: configure via `/mcp`; names appear in the system **Tool capability index** — activate with `tool_search` / `tool_activate` before use.
- Python scripts: **`run_python`** when Pyodide-compatible. Secrets: **`memory-layers`**.
- **Imported skills own endpoints** — call `skill_view` on the imported skill first; use this skill for generic REST/GraphQL mechanics.

## Procedure

1. **Imported skill** — `skill_view` on the skill that documents this API (discovery order, auth, paths).
2. **Pick verb** — GET → `web_fetch`; POST/GraphQL → `web_post`; PATCH/PUT/DELETE/HEAD/OPTIONS → `web_post` with `method`.
3. **Auth** — pass `headers: { "Authorization": "Bearer <token>" }` (or header name from docs). Same token can go on every call; do not embed in URL.
4. **Discovery** — follow the skill's order: health/ping → list metadata/schema → data queries. Do not guess resource slugs or GraphQL root fields.
5. **REST read** — start minimal: list/count before heavy payloads. Use `params` on the tool or query string on `url`.
6. **GraphQL** — POST JSON body `{"query":"…","variables":{…}}` with `Content-Type: application/json` (default for JSON bodies).
7. **Errors** — if result has `ok: false` or `data.errors`, read `error` / `recovery_hint` / `errors[0].message` and adjust; one fix per failure class.
8. **Unknown resource id** — run discovery or ask the user; do not brute-force generic names endlessly.

## REST patterns (`web_fetch`)

```json
{
  "url": "https://api.example.com/v1/resources/posts",
  "params": { "limit": 10, "fields": "id,title" },
  "headers": { "Authorization": "Bearer <token>" }
}
```

| Pattern | Example |
|---------|---------|
| Row count (when docs specify) | `GET …/resources/{slug}?limit=0&meta=total_count` (shape varies by API) |
| Single filter | `…/resources/{slug}?filter[status]=published&fields=id` |
| List metadata | Skill-documented list/schema endpoint (may 403 without admin scope) |
| Pagination | `limit` + `offset` or `page` per API docs |

JSON responses return `data` + `status`. HTML returns readable `text`.

### TinyFish markdown vs API (Directus and other SPAs)

When `web_fetch` uses TinyFish (default when no `headers`) and markdown returns a **"JavaScript required"** page (Directus admin often shows: *"Directus doesn't work without JavaScript enabled"*):

- **HTTP 200 means the host responded** — not outage, not "unreachable", and not proof the REST API is broken.
- That body is the **non-API UI shell** (no JS in TinyFish). Do **not** loop on the same admin/root URL or declare the site down.
- **Do instead:** call documented REST paths (`/items/…`, `/collections/…`, `/server/info`, …) with `headers.Authorization: Bearer <token>`, `web_post` for writes, or `/mcp use <url>/mcp` for Directus MCP.

Authenticated GET always passes `headers` → routes via `/api/proxy` (JSON), not TinyFish markdown.

### Directus / CMS via MCP (optional)

Configure a Directus Streamable HTTP MCP endpoint (**the Web Agent page must be running** (Telegram messages already prove this — MCP failures are usually auth, remote server reachability, or an IPC bridge bug, not a closed tab):

1. Bearer token in `.webagent/mcp-secrets.json` (`directus_token`) — saves bearer token in workspace (`.webagent/mcp-secrets.json`); works from Telegram without pasting the token into `/mcp use`.
2. Server entry in `.webagent/mcp-servers.json` — Telegram: `/mcp@YourBot use …` (normalized automatically).
3. Relaunch profile to discover tools if tools do not appear after save.
4. Agent workflow: call `mcp_*` tools directly with exact tool name → call `mcp_<server>_<tool>`. MCP tools are **not** in the default LLM tool list.

If probe times out: open Web Agent in the browser, start the profile, then `/reload_mcp`. Config may already be saved as enabled.

Prefer MCP for CMS mutations when REST from the sandbox is blocked; prefer REST (`/items/…` + Bearer) when `headers` work.

## REST updates (`web_post` + method)

To update an existing resource (CMS item, record by id):

```json
{
  "url": "https://api.example.com/v1/resources/posts/42",
  "method": "PATCH",
  "headers": { "Authorization": "Bearer <token>" },
  "body": "{\"status\":\"published\"}"
}
```

| Pattern | Example |
|---------|---------|
| Partial update | `method`: `"PATCH"`, body with changed fields only |
| Full replace | `method`: `"PUT"` when API docs require it |
| Delete | `method`: `"DELETE"` — body optional |
| Form / OAuth token | `form`: `{ "grant_type": "...", ... }` — auto urlencoded |
| Large CMS payload | `timeout_ms`: 180000 (up to 600000) |
| Binary upload (avoid) | Do **not** pass base64 in `body` — use `web_upload` or `web_post.multipart` with `file_path`/`source_url` |

Do not POST to `/resources/{slug}/{id}` to update — use PATCH/PUT on that path.

## File uploads (`web_upload`)

**Never put image/binary bytes or base64 in tool arguments** — runtime fetches or reads files server-side.

Directus / generic CMS `/files`:

```json
{
  "upload_url": "https://cms.example.com/files",
  "headers": { "Authorization": "Bearer <token>" },
  "field_name": "file",
  "filename": "hero.jpg",
  "content_type": "image/jpeg",
  "source_url": "https://images.example.com/hero.jpg"
}
```

From workspace (after `web_fetch` with `save_to`, or a generated asset):

```json
{
  "upload_url": "https://cms.example.com/files",
  "headers": { "Authorization": "Bearer <token>" },
  "file_path": "projects/images/hero.jpg",
  "filename": "hero.jpg"
}
```

Then PATCH the record with the returned file id (`data.id` on Directus).

Mixed multipart (custom API) via `web_post`:

```json
{
  "url": "https://api.example.com/upload",
  "multipart": [
    { "name": "title", "text": "Hero" },
    { "name": "file", "file_path": "projects/images/hero.jpg", "filename": "hero.jpg", "content_type": "image/jpeg" }
  ],
  "headers": { "Authorization": "Bearer <token>" }
}
```

## GraphQL patterns (`web_post`)

```json
{
  "url": "https://api.example.com/graphql",
  "json": { "query": "query { __typename }" },
  "headers": { "Authorization": "Bearer <token>" }
}
```

With variables:

```json
{
  "json": { "query": "query ($id: ID!) { item(id: $id) { id title } }", "variables": { "id": "42" } }
}
```

| Rule | Detail |
|------|--------|
| Root fields | Must exist on **that** API's `Query` type — never assume generic names |
| Imported CMS/API skills | Root fields often match **resource slugs** from the skill's list step — read the skill |
| Introspection | `{ __schema { queryType { name } } }` only if docs allow |
| Errors | 400 with `errors[]` → fix query shape; read `recovery_hint` when present |

## Connect / discover an API

Generic order (exact URLs come from the **imported skill**, not from memory):

| Step | Call | Purpose |
|------|------|---------|
| 1 | Skill's health/ping GET (often unauthenticated) | Reachability |
| 2 | Skill's list/metadata GET + auth | **Known resource slugs or schema** |
| 3 | Pick slug/id from step 2 | Never guess `posts`, `articles`, etc. before step 2 |

If step 2 returns **403**, the token may lack metadata scope — ask the user for the resource name; still do **not** brute-force guessed paths.

**403 on a specific resource path** means wrong slug/id or missing read permission — return to discovery or ask the user; it does not mean the host is unreachable.

## Pitfalls

- Inventing GraphQL fields not in the schema.
- `web_fetch` for POST/GraphQL (use `web_post`).
- Putting Bearer tokens in the URL or repeating failed shell `node -e` axios attempts.
- Treating 403 as "wrong URL" when it may mean **wrong permission** or wrong resource slug.
- Ignoring structured error payloads — they tell you exactly which field failed validation.
- Skipping `skill_view` on the imported skill and guessing endpoints from product folklore.

## Anti-patterns

- Retry loop: same bad GraphQL query 3+ times.
- `run_shell` with `require('axios')`, `fetch(`, curl, or python `requests` when `web_fetch`/`web_post` suffice.
- Storing API tokens in `memory_save` — use Settings/vault and pass via `headers` each call.
