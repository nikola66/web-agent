---
name: Multimodal Ingest
description: Use when the input is an image, screenshot, diagram, or YouTube link—vision_analyze and youtube_transcribe before text reasoning.
version: 1.0.0
category: bundled
tags: [vision, multimodal, ocr, youtube, transcript, image]
triggers: [screenshot, image, diagram, ocr, what is in this image, youtube link, transcribe, video summary, vision_analyze, youtube_transcribe]
---

## When to Use

- User attaches or references an image / screenshot / diagram path.
- User pastes a YouTube or Shorts URL and asks about content.
- OCR or chart-read needed before any text reasoning can proceed.
- Visual evidence requested (UI bug screenshot, design mock comparison).

## Procedure

1. **Images** → `vision_analyze` with a **focused question**, not "describe everything". Examples: "What error code is shown?", "List visible CLI flags", "Read the chart x-axis values".
2. **Video** → `youtube_transcribe` → grep / scan segments for the relevant span → summarize with **timestamp citations** (`[mm:ss]`). For long videos, transcribe once, then operate on the cached transcript text.
3. **Cross-check** factual claims pulled from visuals using **`open-web-research`** (verify a name, date, or product before asserting).
4. **Persist** non-trivial extracted facts via `memory_save`; long transcripts belong in `work/<slug>/` then **`artifact-delivery`** — not inline.

## Pitfalls

- Re-running `vision_analyze` on the same image for variant questions — combine questions or cache the prior answer in session memory.
- Transcribing a 90-minute video when a single segment is needed — narrow first by searching the title/description.
- Treating OCR output as ground truth — confirm key strings (URLs, codes, prices) before acting.

## Anti-patterns

- Pasting base64 image data or raw transcript bodies into chat.
- Asking the user to retype text already visible in their screenshot.
- Skipping vision entirely and guessing image content from filename.
