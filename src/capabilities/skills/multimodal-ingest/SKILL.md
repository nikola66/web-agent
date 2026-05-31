---
name: Multimodal Ingest
description: Use when the input is an image, screenshot, diagram, PDF/DOCX, audio file, or YouTube link—extract metadata/text before reasoning.
version: 1.1.0
category: bundled
primary-tools: [vision_analyze, image_info, audio_analyze, youtube_transcribe, pdf_extract, docx_extract]
tags: [vision, multimodal, ocr, youtube, transcript, image, pdf, docx]
triggers: [screenshot, image, diagram, ocr, what is in this image, youtube link, transcribe, video summary, pdf text, docx text, vision_analyze, youtube_transcribe, audio_analyze]
---

## Tool contract (read first)

| Input | Tool |
|-------|------|
| Image metadata / dimensions | `image_info` |
| Image / screenshot / diagram | `vision_analyze` with a focused question |
| YouTube / Shorts URL | `youtube_transcribe` |
| Workspace audio file | `audio_analyze` |
| Workspace PDF | `pdf_extract` |
| Workspace DOCX | `docx_extract` |
| Cross-check claims | `web_search`, `web_fetch` — **`open-web-research`** |
| Persist transcript / extract | `write_file` under `work/<slug>/` |
| Show visual to user | `artifact_present` — **`artifact-delivery`** |
| Durable facts | `memory_save` — **`memory-layers`** |

**Non-negotiable:** Focused vision questions, not "describe everything". Long transcripts → file + present, not chat paste.

## When to Use

- User attaches or references an image / screenshot / diagram / PDF / DOCX path.
- User pastes a YouTube or Shorts URL and asks about content.
- OCR or chart-read needed before any text reasoning can proceed.
- Visual evidence requested (UI bug screenshot, design mock comparison).

## Relation to other skills

- Verify claims: **`open-web-research`**. Present files: **`artifact-delivery`**. Facts: **`memory-layers`**.

## Procedure

1. **Images** → `vision_analyze` with a **focused question**, not "describe everything". Examples: "What error code is shown?", "List visible CLI flags", "Read the chart x-axis values".
2. **Video** → `youtube_transcribe` → grep / scan segments for the relevant span → summarize with **timestamp citations** (`[mm:ss]`). For long videos, transcribe once, then operate on the cached transcript text.
3. **Documents** → `pdf_extract` / `docx_extract` before `run_python`; persist long extracted text under `work/<slug>/`.
4. **Cross-check** factual claims pulled from visuals or documents using **`open-web-research`** (verify a name, date, or product before asserting).
5. **Persist** non-trivial extracted facts via `memory_save`; long transcripts belong in `work/<slug>/` then **`artifact-delivery`** — not inline.

## Pitfalls

- Re-running `vision_analyze` on the same image for variant questions — combine questions or cache the prior answer in session memory.
- Transcribing a 90-minute video when a single segment is needed — narrow first by searching the title/description.
- Treating OCR output as ground truth — confirm key strings (URLs, codes, prices) before acting.

## Anti-patterns

- Pasting base64 image data or raw transcript bodies into chat.
- Asking the user to retype text already visible in their screenshot.
- Skipping vision entirely and guessing image content from filename.
