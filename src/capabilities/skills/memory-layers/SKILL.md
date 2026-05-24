---
name: Memory Layers
description: Use when the user says remember this, save a preference, paste API keys, or you must pick memory_save vs session notes vs skill_manage vs wiki_* tools.
version: 1.1.0
category: bundled
primary-tools: [memory_save, session_search, skill_view, wiki_search]
tags: [memory, session, skills, facts, context, remember, preference, security, credentials, secrets]
triggers: [remember this, save preference, session note, store fact, recall later, what do we remember, persistent note, knowledge vault, wiki sync, sync facts to wiki, wiki search, api key, secret, .env, paste key, sk-, bearer, rotate key, commit secrets, redact, password in chat]
---

## Tool contract (read first)

Canonical picker for **what to persist**, **which memory tool**, and **secret handling**. Maintainer evolution: **`web-agent-skill`**.

| Layer | Tools | Use for |
|-------|--------|---------|
| **Facts** | `memory_save`, `memory_forget`, `memory_recall`, `memory_search` | Stable preferences (timezone, stack, env constraints), plus exact-key cleanup. Never API keys or tokens. |
| **Session** | `session_memory_append`, `session_memory_list`, `session_search` | Rolling notes, temporary decisions, artifact pointers this session. |
| **Skills** | `skill_view`, `skill_list`, `skill_manage`, `skill_bulk_save` | Repeatable procedures with a clear trigger. |
| **Wiki vault** | `wiki_setup`, `wiki_sync`, `wiki_search` | PARA markdown mirror (default `.webagent/knowledge-vault/`). Also `/wiki_setup`, `/wiki_sync`, `/wiki_search`. |
| **OAuth SaaS** | `composio_connect`, `composio_status`, `composio_action` | Connected apps (Gmail, Sheets, HubSpot, …) — not raw `web_post` without OAuth setup. |
| **MCP extensions** | Dynamic MCP tools (after `/mcp add`) | User-configured servers — see **`imported-skill-compat`**. |

**Non-negotiable:** One-off facts → `memory_save`. Debugging trail → `session_memory_append`. Repeatable recipe → `skill_manage` create after `skill_view`. Secrets belong in **Settings / vault** — never in memory, session, skills, or workspace prose.

## Canonical scope

Single guide for choosing among durable facts, rolling session notes, procedural skills, and wiki projections. Maintainer-only Web Agent evolution: **`web-agent-skill`**.

## When to Use

- User asks "remember this" vs "save a reusable workflow" or "for next session".
- User pastes keys, asks to commit `.env`, or where to store credentials.
- Deciding between `memory_save`, `session_memory_append`, and `skill_manage`.
- Reducing duplicate or contradictory stored context; wiki_sync vs facts.

## Relation to other skills

- Delivery redaction before `artifact_present` / `email`: **`artifact-delivery`** Secrets subsection.
- Maintainer evolution: **`web-agent-skill`**.

## Procedure

### Layer choice

1. **One-off fact** ("I use pnpm") → `memory_save` (or update existing key; add `scope` when obvious).
2. **Debugging trail** ("tried X, failed Y") → session memory until resolved.
3. **Wrong/stale durable fact** → `memory_forget` by exact key; use `memory_search` first if unsure.
4. **Repeatable recipe** ("how we deploy previews") → `skill_manage` create when the user wants it reusable; call `skill_view` first.

### Wiki vault

1. **Scaffold once** — `wiki_setup` or `/wiki_setup`.
2. **Project runtime** — `wiki_sync` or `/wiki_sync [facts|session|all]`.
3. **Browse/search** — `wiki_search` or `/wiki_search <query>`.

### Secrets (never in memory layers)

1. **Settings / vault** — provider keys per profile (encrypted local vault), not workspace files the model edits casually.
2. **Never echo secrets** in chat, `artifact_present`, email, or logs — redact (`sk-…`, bearer tokens, long hex).
3. **`read_file` on secrets** — only when the user explicitly asked to inspect their own config path.
4. Direct users to Settings when they ask where to put keys — not `memory_save`.

## Pitfalls

- Storing secrets in memory, session, or skills.
- Duplicating the same content in facts and a skill — pick one layer.
- Mirroring long content in both `memory_save` and synced wiki pages — prefer facts/skills as source of truth.
- Huge dumps into `memory_save` — summarize; long prose belongs in skills or session.

## Anti-patterns

- "Paste your API key here so I can test" — direct to Settings.
- Duplicating the same secret in skills, memory, and files — one vault source of truth.
- Maintainer-only workflows here — use **`web-agent-skill`** for self-evolution of Web Agent itself.
