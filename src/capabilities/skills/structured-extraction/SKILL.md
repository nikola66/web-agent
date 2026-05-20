---
name: Structured Extraction
description: Use when the user wants tables, lists, or JSON pulled from fetched pages, feeds, or APIs—web_fetch then parse cleanly.
version: 1.0.0
category: bundled
tags: [extraction, scraping, parsing, etl, web_fetch, data]
triggers: [scrape, extract table, parse html, structured data, csv from page, json from feed, normalize results, dedupe rows, list from page]
---

## When to Use

- Converting `web_fetch` or `web_search` output into typed rows (creators, products, papers, prices, listings).
- Deduping or normalizing entity lists produced by **`open-web-research`** or **`research-pack`**.
- User asks for CSV, JSON, or table from a URL — not freeform summary.

## Relation to other skills

- **`open-web-research`** finds the URLs and confirms regional/topic fit; this skill shapes the rows.
- **`research-pack`** owns arXiv / Semantic Scholar API parsing — defer there for scholarly fields.
- Tool-choice constraints live in **`browser-runtime-map`** (no `npx`/`curl` on Nodebox).

## Procedure

1. **Inspect raw** `web_fetch.text` first — note whether HTML, RSS/Atom, or JSON. Do not parse blind.
2. **Prefer feeds/APIs** over HTML: RSS/Atom, sitemap.xml, JSON endpoints, oEmbed. Cheaper, stabler, less noise.
3. **Parse narrowly.** On Nodebox use small `run_shell` `node -e` snippets — `DOMParser` is unavailable; use `parse5` if present, otherwise targeted regex on canonical tags (`<a href>`, `<title>`, JSON-LD `<script type="application/ld+json">`).
4. **Normalize** before emitting: lowercase hostnames, strip tracking params, ISO-8601 dates, trimmed text, stable key order.
5. **Dedupe** by canonical URL or id, not display title.
6. **Emit JSON array** plus a short pipe-table summary for the user.

## Output template

```json
[
  { "id": "...", "title": "...", "url": "https://...", "published_at": "2026-01-12", "source": "..." }
]
```

Followed by:

```markdown
| Title | Source | Date |
|-------|--------|------|
```

## Pitfalls

- Regex against minified JS bundles — brittle. Prefer JSON-LD or feed.
- Trusting the first search hit without `web_fetch` confirm (same verify rule as **`open-web-research`**).
- Silent row drops on parse error — log skipped count instead.
- Mixing units / timezones — normalize at parse time, not in the table.

## Anti-patterns

- Copying raw HTML into chat for the user to clean.
- Chaining multiple shell pipes when one `node -e` does the parse.
- Storing extracted rows in `memory_save` — write to a file under `work/` and use **`artifact-delivery`**.
