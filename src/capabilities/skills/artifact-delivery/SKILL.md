---
name: Artifact Delivery
description: Use when finished work must be shown to the user—or when they ask to see/display a visual (image, thumbnail, screenshot)—artifact_present for files, inline markdown with remote image URLs, terminal preview, email or Telegram delivery.
version: 1.0.0
category: bundled
tags: [artifact, delivery, presentation, email, telegram, output, image, thumbnail]
triggers: [show me, show it, preview, display, thumbnail, image url, deliver, send via telegram, send email, attach, artifact_present, share result, package output, final output, write_file]
---

## Tool contract (read first)

Ad-hoc delivery in a single turn — not scheduled jobs (see **`heartbeat-cron`**).

| Need | Tool |
|------|------|
| Persist deliverable file | `write_file` under `projects/` or `work/` — see **`project-scaffold`** |
| Show file / open View popup | `artifact_present` with `title` + `path` |
| Inline markdown or remote image | `artifact_present` with `markdown` (e.g. `![alt](https://…)`) |
| Email a result | `email` with `subject` + body — redact via **`credential-hygiene`** |
| Mermaid SVG in View popup | ` ```mermaid ` fence + `artifact_present` — see **`chart`** |
| Telegram (ad-hoc) | Configured channel side-effect; cron jobs use `notifyChannel` in **`heartbeat-cron`** |

**Non-negotiable:** User asked to show/see/display → call `artifact_present` **same turn** once ready. Never paste the full artifact body in chat after present. Binary/large output: `path`, not inline.

## Canonical scope

Owns choice between inline reply, **`artifact_present`**, **`email`**, and cron `delivery` mode. Scheduled-job delivery semantics (`silent` / `terminal` / `email`, `notifyChannel`) stay in **`heartbeat-cron`**; this skill covers ad-hoc delivery in a single turn.

## When to Use

- Work produced a file, code block, table, or report the user should keep or open.
- User asks to **show**, **see**, or **display** something — especially images, thumbnails, or screenshots.
- You have a concrete **remote image URL** (YouTube thumbnail, og:image, CDN link) the user should view.
- External recipient: user asks to email or Telegram a result.
- Output exceeds ~200 lines or is binary — never paste inline.

## Decision table

| Result shape | Use |
|--------------|-----|
| Short text answer, ≤30 lines | Inline reply |
| Workspace file (image, audio, video, PDF, DOCX, PPTX, markdown, mermaid) | `artifact_present` with `title` + workspace-relative `path` |
| Remote image URL (thumbnail, screenshot, hero, og:image) user should see | `artifact_present` with inline `markdown`: `![alt](https://…)` — **same turn** you obtain the URL |
| Markdown report / plan with Mermaid fences | `artifact_present` — fence + render rules in **`chart`** |
| Send to mailbox | `email` (subject + body), redact via **`credential-hygiene`** |
| Side-channel chat | Telegram via configured channel |
| Recurring job output | see **`heartbeat-cron`** (`delivery` + `notifyChannel`) |
| Multi-step run report | `work/task-execution/<slug>/report.md` via **`task-execution`** |
| Standalone Mermaid diagram | `.mmd` / `.mermaid` path — see **`chart`** |

Supported in-browser preview: markdown, mermaid (SVG via **`chart`** rules), images, audio, video, PDF, DOCX, PPTX. Legacy `.doc` / `.ppt` are download-only (convert to `.docx` / `.pptx` for preview).

## Procedure

1. **`write_file`** under `projects/<slug>/` (durable) or `work/<slug>/` (scratch) — see **`project-scaffold`**.
2. **`artifact_present`** with `title` and either:
   - **`path`** — preferred for binary or large files (PNG, MP3, MP4, PDF, DOCX, PPTX, `.md`, `.mmd`), or
   - **`markdown`** — inline body for plans/specs, or a single `![alt](https://…)` line for remote images.
3. **Show visuals immediately** — when the user asked to show/see/display, call `artifact_present` in that same turn once the URL or file is ready. Do not stop with a bare URL or wait for another nudge.
4. **Do not duplicate** the artifact body in chat. A short summary is the deliverable.
5. **Email**: always set `subject`; body is plain text or markdown; never include secrets (run mentally through **`credential-hygiene`**).
6. **Confirm receipt** when the channel supports it (delivery id, message id, file path echoed back).

## Pitfalls

- Pasting the artifact body inline *and* presenting it — picks one.
- Sending email with empty / generic subject ("Update").
- Echoing API keys, bearer tokens, or `.env` content into delivery surfaces.
- Sending the user their own pasted content back unchanged.

## Anti-patterns

- `read_file` followed by inline paste when `artifact_present` is available.
- Ending the turn with an image URL in chat when the user wanted to see it — call `artifact_present` first.
- Waiting for "show it to me" after you already have the image URL.
- Writing the file at workspace root (rejected by `assertAllowedWorkspaceWritePath`) — use `projects/` or `work/`.
- Binary blobs (images, PDFs) inlined as base64.
