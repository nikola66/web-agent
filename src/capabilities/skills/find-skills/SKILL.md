---
name: Find Skills
description: Use when the user wants to discover, search, or install agent skills from online registries—top results by installs, stars, or votes. Or user sends /find-skills.
version: 1.0.0
category: bundled
tags: [skills, discovery, registry, marketplace, install, search, skills.sh, skillsmp, cursor]
triggers: [find skill, find skills, search skills, skill marketplace, skill registry, install skill, discover skill, skills.sh, skillsmp, cursor marketplace, /find-skills, skill library, agent skill pack]
---

## Tool contract (read first)

| Step | Tool |
|------|------|
| Ambiguous query | Follow **`clarify`** — one `<<<CLARIFY>>>` block (no search yet) |
| Registry discovery | `web_search` — ≥4 queries across the registries below |
| Verify rankings | `web_fetch` — ≥3 registry result/detail pages before answering |
| Install chosen skill | `skill_manage` / `/skills install` — defer to **`web-agent-skill`** |
| Present ranked table | plain assistant markdown (pipe table) |

**Non-negotiable:** Search **multiple** registries, rank by **install count, stars, or votes** (whichever each registry exposes), return **exactly 5** deduped skills. Never answer from memory alone — fetch live registry pages first.

## When to Use

- User asks to **find**, **search**, **discover**, or **recommend** agent skills for a topic.
- User sends **`/find-skills [query]`** or names a registry (`skills.sh`, SkillsMP, Cursor Marketplace).
- User wants the **most popular** skill for PDF, React, debugging, etc. — not installed workspace skills (use `/skills` for those).

**Not for:** listing skills already in the workspace (`/skills`), editing bundled skills (**`web-agent-skill`**), or general open-web people/product discovery (**`open-web-research`**).

## Registries (search all that respond)

| Registry | Search pattern | Popularity metric | Notes |
|----------|----------------|-------------------|-------|
| [skills.sh](https://skills.sh/) | `site:skills.sh {query}` or `skills.sh {query}` | **Installs** | Open agent-skills directory; install via `npx skillsadd <owner/repo>` |
| [SkillsMP](https://skillsmp.com/) | `site:skillsmp.com {query}` | **Stars** / recency | Large marketplace; prefer pages showing star counts |
| [Cursor Marketplace](https://cursor.com/marketplace) | `site:cursor.com/marketplace {query}` | Featured / plugin listing | Plugins bundling skills; link plugin page |
| [cursor.directory](https://cursor.directory/) | `site:cursor.directory {query} skill` | Community votes if shown | MCP servers + skills |
| GitHub (fallback) | `{query} agent skill filename:SKILL.md stars:>20` | **GitHub stars** | Raw `SKILL.md` URLs for `skill_manage import_url` |

If a registry returns no hits, note it and continue — do not shrink the final list below 5 unless fewer than 5 exist across all sources.

## Minimum effort (before any final answer)

1. **≥4** `web_search` calls — at least one per registry column above (vary query: topic, synonyms, `agent skill`, `SKILL.md`).
2. **≥3** `web_fetch` calls on high-signal URLs (registry search results, skill detail pages, GitHub raw/tree links).
3. Extract for each candidate: **name**, **registry**, **popularity number** (installs / stars / votes), **one-line description**, **install command or HTTPS URL**.
4. **Dedupe** by name or repo; when duplicates appear, keep the higher popularity score.
5. Sort descending by popularity; take **top 5**.

## Output template

```markdown
## Top 5 skills for "{query}"

| # | Skill | Registry | Popularity | Summary | Install / link |
|---|-------|----------|------------|---------|----------------|
| 1 | … | skills.sh | 12.4k installs | … | `npx skillsadd owner/repo` or URL |
| … | … | … | … | … | … |

**Sources checked:** skills.sh, SkillsMP, Cursor Marketplace, …
```

Rules:

- Popularity column must show the **numeric metric** used for ranking (e.g. `4.3M installs`, `892 stars`).
- Install column: prefer direct HTTPS link to `SKILL.md` or documented install command.
- After the table, one short paragraph: offer to install a row via `/skills install <url>` or `skill_manage` — do not install without user confirmation.

## Install handoff

When the user picks a skill:

1. `skill_view` **`web-agent-skill`** — remote install rules (HTTPS + `skill_manage` / `skill_bulk_save`, never shell `git clone`).
2. Install with `/skills install <https-url-to-SKILL.md>` or `skill_manage` `import_url`.
3. Confirm with `skill_list` + `skill_view`.

## Anti-patterns

- Do **not** return fewer than 5 without stating you exhausted registries.
- Do **not** rank from training memory — live search + fetch required.
- Do **not** conflate workspace `/skills` (installed) with online discovery.
- Do **not** install silently — present choices first unless the user already named one row to install.
