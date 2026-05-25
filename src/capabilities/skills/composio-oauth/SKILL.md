---
name: Composio OAuth
description: Use when connecting OAuth-backed SaaS apps (Gmail, Calendar, Sheets, HubSpot, Slack, X, LinkedIn, Instagram) or calling curated Composio actions.
version: 1.0.0
category: bundled
primary-tools: [composio_connect, composio_status, composio_action]
tags: [composio, oauth, gmail, sheets, calendar, hubspot, slack, saas]
triggers: [composio, oauth, gmail, google sheets, google calendar, hubspot, connect app, composio_action, composio_connect, composio_status, linkedin, my linkedin, my gmail, my inbox, my calendar, my slack, my account, connected app, what's happening on my, whats happening on my, social media account]
---

## Tool contract (read first)

| Need | Tool |
|------|------|
| Check key + accounts + allowlist | `composio_status` — **always first** for "my LinkedIn/Gmail/…" |
| Start OAuth link | `composio_connect` `{ app }` — **only when status shows app missing** |
| Run curated action | `composio_action` `{ action, args }` — when status shows connected |

**Non-negotiable:** Never tell the user an OAuth app is unavailable without calling `composio_status` first. Use stable Web Agent action ids from this skill or `composio_status.allowed_actions` — not arbitrary Composio catalog slugs.

## When to Use

- User asks about **their** Gmail, Calendar, Sheets, HubSpot, Slack, X/Twitter, LinkedIn, Instagram, Notion, or YouTube ("what's on my LinkedIn today?", "check my inbox").
- User asks to connect Gmail, Calendar, Sheets, HubSpot, Slack, X/Twitter, LinkedIn, Instagram, Notion, or YouTube.
- Task needs OAuth-connected SaaS rather than raw `web_post`.

## Setup (local only)

Composio setup lives in **Settings → Composio → API key** (`composio_api_key`). There is no external SETUP.md or repo doc to fetch — when `composio_status` returns `configured: false`, tell the user to add their key in Settings (from [Composio dashboard](https://dashboard.composio.dev)), then run `composio_connect` for the app.

**Do not** `web_search` or `web_fetch` GitHub/raw URLs for Web Agent setup instructions.

## Flow

1. `composio_status` — confirm API key, list connected accounts, read `allowed_actions`.
2. If app not connected: `composio_connect` → share `redirect_url` with the user.
3. `composio_action` with action id + args. Send/post/delete/publish may require approval.

## Curated action ids

**Google Calendar:** `google_calendar_list_events`, `google_calendar_get_event`, `google_calendar_create_event`, `google_calendar_patch_event`, `google_calendar_delete_event`, `google_calendar_find_free_slots`

**Gmail:** `gmail_fetch_emails`, `gmail_list_drafts`, `gmail_create_draft`, `gmail_send_draft`, `gmail_send_email`, `gmail_add_label_to_email`

**Google Sheets:** `googlesheets_batch_get`, `googlesheets_values_get`, `googlesheets_spreadsheets_values_append`, `googlesheets_values_update`, `googlesheets_create_spreadsheet_row`, `googlesheets_upsert_rows`

**X/Twitter:** `x_search_recent`, `x_create_post`, `x_list_post_likers`

**LinkedIn:** `linkedin_create_post`, `linkedin_create_article_or_url_share`, `linkedin_get_my_info`

LinkedIn publish args use Web Agent-friendly fields (Composio schemas are normalized automatically):

- `linkedin_create_post` — `{ text, url?, draft?, images? }`
- `linkedin_create_article_or_url_share` — `{ text, url, draft? }`
- `author` is auto-filled from `linkedin_get_my_info` when omitted
- Before publishing, optionally run `composio_status` with `{ app: "linkedin", catalog_check: true }` to detect stale action ids

**Instagram:** `instagram_get_user_info`, `instagram_get_user_media`, `instagram_post_media`, `instagram_publish_media`, `instagram_send_text_message`, `instagram_send_image`

**HubSpot:** `hubspot_search_contacts`, `hubspot_create_contact`, `hubspot_update_contact`

**Notion:** `notion_search`, `notion_create_page`

**Slack:** `slack_send_message`

**YouTube:** `youtube_search`

**Also supported:** see `composio_status.allowed_actions` for the full allowlist.

## Relation to other skills

- **`http-api`** — public REST/GraphQL without OAuth; use `web_fetch`/`web_post`.
- **`browser-runtime-map`** — never use shell curl for Composio.

## Pitfalls

- Missing `WEBAGENT_COMPOSIO_API_KEY` → `composio_status` returns setup guidance; do not loop failed actions.
- Wrong action slug → 404 with hints; read `allowed_actions` instead of guessing.
- LinkedIn toolkit versioning — Composio defaults to a base catalog without `version`; Web Agent sends `latest` automatically. Override with `WEBAGENT_COMPOSIO_TOOLKIT_VERSION` or per-app env vars if needed.

## Anti-patterns

- Telling the user you have "no LinkedIn/Gmail access" without calling `composio_status` first.
- Offering `composio_connect` when `composio_status.connected_accounts` already includes the app.
- Raw `web_post` to Google/Slack/LinkedIn APIs without OAuth setup.
- Inventing Composio catalog slugs not in the allowlist.
