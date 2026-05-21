---
name: Open Web Research
description: Use when the user wants to find, list, or discover people, creators, companies, or content on the open web—search many queries, fetch URLs, then synthesize.
version: 1.1.0
category: bundled
tags: [research, web, search, discovery, creators, influencers, competitors, list]
triggers: [find youtubers, list creators, who posts about, discover, search for, competitors, influencers, channels about, posting about, web_search, web_fetch, artifact_present]
---

## Tool contract (read first)

| Step | Tool |
|------|------|
| Ambiguous intent | Follow **`clarify`** — emit one `<<<CLARIFY>>>` block (no search, no tools) |
| Discovery queries | `web_search` — ≥6 varied queries before any final answer |
| Verify hits | `web_fetch` — ≥2 URLs after each search batch |
| Persist research pack | `write_file` under `work/` or `projects/` |
| Show thumbnail/image | `artifact_present` with inline `markdown` `![alt](https://…)` — **`artifact-delivery`** |
| Shape rows / JSON | defer to **`structured-extraction`** |

**Non-negotiable:** After `web_search`, next tools must be `web_fetch`. Never claim "zero found" without ≥2 fetches. Sparse niche hits = inconclusive, not proof of absence.

## When to Use

- Open-web discovery: find people, channels, companies, communities, or content about a topic in a region or platform.
- "Who makes videos about…", list creators, competitors, or niche communities—not academic papers (use `research-pack`).
- User asks to search the web for entities, profiles, or regional lists before concluding.

## Intent vs evidence

If **what to research** is still ambiguous (topic, region, platform, or success criteria), follow **`clarify`** and emit one `<<<CLARIFY>>>` block first — no tools; wait for the user’s choice. Once intent is settled, meet the minimum-effort bar below—do not stall search/fetch behind extra open questions.

## Minimum Effort (before any final answer)

- **≥6** `web_search` calls with varied queries (topic × region × platform).
- **≥2** `web_fetch` calls on high-signal URLs (channel pages, profiles, top hits).
- Empty or noisy niche-keyword results are **inconclusive**, not proof that nothing exists.
- Do **not** ask "would you like me to…" or pivot to outreach until the minimum bar is met.

## Search Then Fetch (mandatory)

After any batch of `web_search`, the **next** tool calls must be `web_fetch` (or one batch `web_fetch` with `urls`) on at least two result URLs. Prefer YouTube channel (`youtube.com/@…`) or video pages.

Do not write a verdict, table, or "zero found" summary until those fetches complete.

## Query Fan-Out

Build a small matrix and run searches in parallel when the runtime allows multiple tool calls in one turn:

| Axis | Examples |
|------|----------|
| Topic | product name, alternate spellings, related terms |
| Region | country, city, `"UAE" OR "Dubai"`, `location: ae` (one code per call: `ae` or `sa`, not `ae, sa`) |
| Platform | `site:youtube.com`, `site:instagram.com`, `site:twitter.com` |
| Language | English + local (e.g. Arabic tutorial) |

**Operators** (in `query`): `site:`, quoted `"exact phrase"`, `-term`, `OR`.

Use `web_search` `location` (e.g. `ae`, `sa`) and `language` when the provider supports them.

## Verify Before Concluding

1. Search for metadata (titles, URLs, snippets).
2. `web_fetch` channel/about pages to confirm geography and topic fit.
3. Label each finding: **confirmed**, **likely**, or **not regional** (with reason).

**Golden check (UAE + agent tools):** Before claiming no UAE creators, search `Tech With Tim Dubai OpenClaw` and `web_fetch` `https://www.youtube.com/@TechWithTim` — he is UAE-based and covers Hermes Agent and OpenClaw.

## Output Template

```markdown
## Confirmed
- **Name** — platform, base (✅), links, what they cover

## Likely / Unverified
- ...

## Not regional (reference only)
- ...

## Summary table
| Creator | Platform | Base | Topic match |
|---------|----------|------|-------------|
```

Prefer pipe tables. Include direct links. State clearly when KSA/UAE YouTube coverage is thin but Instagram/social exists. For row-shaping, dedup, or JSON output, defer to **`structured-extraction`**.

## Presenting visuals

When the user asked to show/see/display an image or thumbnail, call `artifact_present` in the **same turn** you obtain a concrete image URL — inline `markdown` with `![alt](https://…)`. Do not stop with the URL alone; see **`artifact-delivery`**.

## Stop Rules

- Do not conclude "none exist" or "zero" after only exact-match niche queries or search-only rounds.
- Do not substitute generic "AI influencers" unless the user asked for a broad list.
- Continue searching with broader queries (`AI agent`, `LLM`, regional tech) before giving up.
