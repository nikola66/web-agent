---
name: Artifact Delivery
description: Use when finished work must be shown to the user—or when they ask to see/display a visual—artifact_present for files, inline markdown with remote image URLs, terminal preview, email or Telegram delivery.
version: 1.1.0
category: bundled
primary-tools: [artifact_present, email]
tags: [artifact, delivery, presentation, email, telegram, output, image, thumbnail, secrets, redact]
triggers: [show me, show it, preview, display, thumbnail, image url, deliver, send via telegram, send email, attach, share result, package output, final output, redact, api key in report]
---

## Tool contract (read first)

Ad-hoc delivery in a single turn — not scheduled jobs (see **`heartbeat-cron`**).

| Need | Tool |
|------|------|
| Persist deliverable file | `write_file` under `projects/` or `work/` — see **`project-scaffold`** |
| Show file / open View popup | `artifact_present` with `title` + `path` |
| **ZIP bundle deliverable** | `run_python` + `zipfile` → `.zip` under `work/` or `projects/`, then `artifact_present` — see **`browser-runtime-map`** (no `create_archive` tool) |
| Inline markdown or remote image | `artifact_present` with `markdown` (e.g. `![alt](https://…)`) |
| Email a result | `email` with `subject` + body — redact secrets first |
| Mermaid SVG in View popup | ` ```mermaid ` fence + `artifact_present` — see **`chart`** |
| Telegram (ad-hoc) | Configured channel side-effect; cron jobs use `notifyChannel` in **`heartbeat-cron`** |

**Non-negotiable:** User asked to show/see/display → call `artifact_present` **same turn** once ready. Never paste the full artifact body in chat after present. Never echo `sk-…`, bearer tokens, or `.env` contents in delivery surfaces.

## Canonical scope

Owns choice between inline reply, **`artifact_present`**, **`email`**, and cron `delivery` mode. Scheduled-job delivery semantics stay in **`heartbeat-cron`**.

## When to Use

- Work produced a file, code block, table, or report the user should keep or open.
- User asks to **show**, **see**, or **display** something — especially images, thumbnails, or screenshots.
- External recipient: user asks to email or Telegram a result.
- Output exceeds ~200 lines or is binary — never paste inline.

## Relation to other skills

- Multi-step run reports: **`task-execution`** writes `work/task-execution/<slug>/report.md`.
- Mermaid authoring: **`chart`**. Durable facts (including credentials the user asked to store): **`memory-layers`**.

## Procedure

1. **`write_file`** under `projects/<slug>/` (durable) or `work/<slug>/` (scratch).
2. **`artifact_present`** with `title` and `path` or `markdown`.
3. **Show visuals immediately** — same turn once URL or file is ready.
4. **Do not duplicate** the artifact body in chat.
5. **Email**: always set `subject`; redact secrets before send.
6. **Confirm receipt** when the channel supports it.
7. **ZIP bundles:** there is no `create_archive` tool. Stage files, zip with `run_python` + stdlib `zipfile`, write to `work/<slug>/name.zip`, verify with `archive_list`, present with `artifact_present`.

## Secrets before delivery

- Strip API keys, bearer tokens, and `.env` contents from `artifact_present` bodies and email text.
- If the user pasted a secret, redact in the delivered artifact — do not send it back unchanged.
## Pitfalls

- Pasting the artifact body inline *and* presenting it.
- Sending email with empty / generic subject.
- Echoing secrets into delivery surfaces.
- Ending with a bare URL when the user wanted to see the image — call `artifact_present`.

## Anti-patterns

- `read_file` followed by inline paste when `artifact_present` is available.
- Binary blobs inlined as base64.
- Writing deliverables at workspace root — use `projects/` or `work/`.
- Bundling multiple files as a plain `.txt` when the user asked for a zip — use `run_python` + `zipfile` instead.
