---
name: HTTP API
description: Use when calling REST or GraphQL APIs with web_fetch/web_post — auth headers, query params, GraphQL shape, discovery order, and reading error bodies.
version: 1.0.0
category: bundled
tags: [rest, graphql, api, web_fetch, web_post, bearer, cms, headers, discovery]
triggers: [graphql, REST API, bearer token, web_post, authenticated fetch, api call, authorization header, CMS, list collections, resource count, metadata endpoint]
---

## Tool contract (read first)

Canonical procedure for **REST GET** (`web_fetch`) and **POST / GraphQL** (`web_post`). Do not use `run_shell` + axios for one-off API calls.

| Need | Tool | Required args |
|------|------|----------------|
| Public or authenticated **GET** | `web_fetch` | `url`; optional `headers` |
| **POST** JSON / GraphQL | `web_post` | `url`, `body`; optional `headers`, `content_type` |
| Batch public GET (≤5 URLs) | `web_fetch` | `urls` array; shared `headers` |
| Secrets | `headers.Authorization` (or API-key header docs specify) | Never in URL query; prefer Settings/vault over `memory_save` |

**Non-negotiable:** Read the API's real schema before inventing field names. On `ok: false` or GraphQL `errors`, fix the query — do not retry the same malformed call in a loop.

## When to Use

- Any task hitting a REST or GraphQL HTTP API (CMS, CRM, webhooks, custom backends).
- After `web_post` / `web_fetch` returns validation, 401, or 403.
- Imported skills that mention `requests`, curl, axios, or `python -m …` for HTTP.
- Before guessing collection names, endpoints, or GraphQL root fields.

## Relation to other skills

- Tool picker (shell vs HTTP): **`browser-runtime-map`**. Python skills: **`script-porting`**. Secrets: **`memory-layers`**.
- **Imported skills own endpoints** — call `skill_view` on the imported skill first; use this skill for generic REST/GraphQL mechanics.

## Procedure

1. **Imported skill** — `skill_view` on the skill that documents this API (discovery order, auth, paths).
2. **Pick verb** — GET → `web_fetch`; POST (including GraphQL) → `web_post`.
3. **Auth** — pass `headers: { "Authorization": "Bearer <token>" }` (or header name from docs). Same token can go on every call; do not embed in URL.
4. **Discovery** — follow the skill's order: health/ping → list metadata/schema → data queries. Do not guess resource slugs or GraphQL root fields.
5. **REST read** — start minimal: list/count before heavy payloads. Use query params on the URL (encoded).
6. **GraphQL** — POST JSON body `{"query":"…","variables":{…}}` with `Content-Type: application/json` (default for JSON bodies).
7. **Errors** — if result has `ok: false` or `data.errors`, read `error` / `recovery_hint` / `errors[0].message` and adjust; one fix per failure class.
8. **Unknown resource id** — run discovery or ask the user; do not brute-force generic names endlessly.

## REST patterns (`web_fetch`)

```json
{
  "url": "https://api.example.com/v1/resources/posts?limit=10&fields=id,title",
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

## GraphQL patterns (`web_post`)

Body is always a **string** (JSON.stringify if you build an object):

```json
{
  "url": "https://api.example.com/graphql",
  "headers": {
    "Authorization": "Bearer <token>",
    "Content-Type": "application/json"
  },
  "body": "{\"query\":\"query { __typename }\"}"
}
```

With variables:

```json
{
  "body": "{\"query\":\"query ($id: ID!) { item(id: $id) { id title } }\",\"variables\":{\"id\":\"42\"}}"
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
- `run_shell` with `require('axios')` or `fetch(` one-liners when `web_fetch`/`web_post` suffice.
- Storing API tokens in `memory_save` — use Settings/vault and pass via `headers` each call.
