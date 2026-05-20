---
name: Research Pack
description: Use when the user wants papers, arXiv, citations, literature review, or Semantic Scholar—not general creator or product discovery.
version: 1.0.0
category: bundled
tags: [research, papers, citations, academic, arxiv, semantic-scholar, literature]
triggers: [arxiv, paper, citation, semantic scholar, literature review, academic, research paper, who cited, references]
---

## When to Use

- **Scholarly** workflows: papers, arXiv, Semantic Scholar, citations, literature review.
- User shares arXiv links, DOIs, or asks for related work / reference lists.
- Not for general open-web discovery (people, products, creators)—use **`open-web-research`**.

## Preconditions

Use `web_fetch` for HTTP GET. Respect rate limits (cache results; batch sparingly).

## arXiv (API docs: https://arxiv.org/help/api/)

**Search (Atom feed):**

`GET https://export.arxiv.org/api/query?search_query=all:KEYWORD&start=0&max_results=5`

Replace `KEYWORD` — spaces → `+` or `%20`. Parse XML in the fetched `text`; entries contain `<title>`, `<summary>`, `<id>` (abs URL).

**By id:**

From an `arxiv:YYMM.NNNNN` or `/abs/` URL derive id `YYMM.NNNNN` (or `arch-ive/YYMM.NNNNNvN`).

`GET https://export.arxiv.org/api/query?id_list=YYMM.NNNNN`

## Semantic Scholar (Graph API)

Base: `https://api.semanticscholar.org/graph/v1`

**Paper search:**

`GET https://api.semanticscholar.org/graph/v1/paper/search?query=QUERY&limit=5&fields=title,authors,year,url,abstract`

**Citations for a paper id** (S2 id or DOI hash — use `paperId` from search results):

`GET https://api.semanticscholar.org/graph/v1/paper/{paperId}/citations?limit=10&fields=title,year`

**References:**

`GET https://api.semanticscholar.org/graph/v1/paper/{paperId}/references?limit=10&fields=title,year`

If `429` appears, back off and retry once with a longer delay; avoid fan-out.

## Response Discipline

- Summarize papers in your own words; quote short phrases only with attribution.
- Prefer primary links (arXiv abs, publisher DOI) from API fields when present.
