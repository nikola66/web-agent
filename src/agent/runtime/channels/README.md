# Channels

Inbound/outbound plumbing for Telegram (and the in-browser terminal). The dispatcher normalizes both into agent turns.

## Telegram attachments

`mapInboundUpdate` (`telegram.ts`) extracts:

- `text` / `caption`
- `voice` → handed to `voice/telegram-voice.ts`
- `attachments[]` → handed to `telegram-files.ts`

Supported attachment kinds: `document`, `photo` (largest preview), `video`, `audio`. Anything else is silently ignored.

### Download flow

`telegram-files.ts:downloadTelegramAttachment`:

1. `resolveTelegramFileUrl` → Bot API `getFile` (HTTP proxied via adapter `/api/proxy` when Nodebox blocks direct sockets).
2. Fetch binary payload → `Buffer`.
3. Save to `.webagent/telegram-inbox/<ts>-<safeFileId>-<safeFileName>`.

Hard limit: **Telegram Bot API caps inbound files at 20MB.** `getFile` returns an error for larger files and we return `null` — the user gets an apology that mentions the limit.

### Dispatcher → prompt

`dispatcher.ts` downloads each attachment, then prepends a structured preamble to the user turn:

```
The user sent N Telegram attachment(s). Saved to workspace:

- .webagent/telegram-inbox/<file> — kind=<kind>, mime=<mime>, <size>KB

Failures: …                  (only if any)

Use `read_file` for text/markdown/JSON/CSV. Use `vision_analyze` for images.
Use `extract_archive` for .zip/.tar/.tar.gz. Use `pdf_extract` for PDFs.
Use `docx_extract` for .docx.

User's accompanying message:
<caption if any>
```

The LLM picks the right tool from the hints. No pre-processing happens in the dispatcher — same posture as hermes-agent.

### Required env

- `WEBAGENT_TELEGRAM_BOT_TOKEN` — Bot API token used by all download helpers.

If the token is missing, the dispatcher tells the user to retry once it's set rather than silently dropping the file.

## File map

- `telegram.ts` — Bot API polling, outbound formatting, `mapInboundUpdate`.
- `telegram-files.ts` — shared `externalFetch` + `resolveTelegramFileUrl` + `downloadTelegramAttachment`.
- `dispatcher.ts` — turns inbound messages into agent turns; handles voice + attachment preambles.
- `index.ts` — channel registry.
