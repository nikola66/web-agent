---
name: Artifact Delivery
description: Use when finished work must be shown to the user—artifact_present for files, terminal preview, email or Telegram delivery formatting.
version: 1.0.0
category: bundled
tags: [artifact, delivery, presentation, email, telegram, output]
triggers: [show me the file, preview, deliver, send via telegram, send email, attach, artifact_present, share result, package output, final output]
---

## Canonical scope

Owns choice between inline reply, **`artifact_present`**, **`email`**, and cron `delivery` mode. Scheduled-job delivery semantics (`silent` / `terminal` / `email`, `notifyChannel`) stay in **`heartbeat-cron`**; this skill covers ad-hoc delivery in a single turn.

## When to Use

- Work produced a file, code block, table, or report the user should keep or open.
- External recipient: user asks to email or Telegram a result.
- Output exceeds ~200 lines or is binary — never paste inline.

## Decision table

| Result shape | Use |
|--------------|-----|
| Short text answer, ≤30 lines | Inline reply |
| File / code / markdown / image deliverable | `artifact_present` with path + caption |
| Send to mailbox | `email` (subject + body), redact via **`credential-hygiene`** |
| Side-channel chat | Telegram via configured channel |
| Recurring job output | see **`heartbeat-cron`** (`delivery` + `notifyChannel`) |

## Procedure

1. **Write the file** under `projects/<slug>/` (durable) or `work/<slug>/` (scratch) — see **`project-scaffold`**.
2. **`artifact_present`** with the path and a one-line caption naming what it is and why.
3. **Do not duplicate** the artifact body in chat. A short summary + link is the deliverable.
4. **Email**: always set `subject`; body is plain text or markdown; never include secrets (run mentally through **`credential-hygiene`**).
5. **Confirm receipt** when the channel supports it (delivery id, message id, file path echoed back).

## Pitfalls

- Pasting the artifact body inline *and* presenting it — picks one.
- Sending email with empty / generic subject ("Update").
- Echoing API keys, bearer tokens, or `.env` content into delivery surfaces.
- Sending the user their own pasted content back unchanged.

## Anti-patterns

- `read_file` followed by inline paste when `artifact_present` is available.
- Writing the file at workspace root (rejected by `assertAllowedWorkspaceWritePath`) — use `projects/` or `work/`.
- Binary blobs (images, PDFs) inlined as base64.
