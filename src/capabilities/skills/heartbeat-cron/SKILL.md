---
name: Heartbeat Cron
description: Author recurring jobs in .cronjobs.json via cron_register/cron_list—heartbeat-gated timing, tab must stay open, Nodebox-safe steps.
version: 1.0.0
category: bundled
tags: [cron, schedule, heartbeat, automation, telegram, email]
---

## When to Use

- User wants digest, reminders, periodic search, or multi-step automation inside Web Agent.
- Explaining why a job did not run at an exact wall-clock time.
- Choosing `delivery` and avoiding invalid step shapes.

## Facts (non-negotiable)

- Jobs run **only while the app tab/session is open**. Closing the browser stops the heartbeat until you return.
- Scheduling is **heartbeat-gated**, not systemd-style cron: `everyMinutes` is **minimum** spacing between runs; ticks use `HEARTBEAT_INTERVAL_MS` (typically 30 minutes). Short `everyMinutes` still waits for the next tick after becoming due.
- State files: `.heartbeat-state.json`, cron definition **`.cronjobs.json`** in the workspace.
- `tool` at job root or each `steps[]` entry must be a **built-in** name with that tool's `arguments`.
- **`delivery`** is only on the job: `silent` (minimal logs), `terminal` (agent terminal; optional `notifyChannel` for Telegram), or `email` (needs `deliveryEmailTo`, optional subject). Never put `silent`/`terminal`/`email` as a step `tool`.

## Authoring

1. Use **`cron_register`** (or edit `.cronjobs.json` carefully) with `id`, `everyMinutes` (≥1), and `delivery` (confirm email vs terminal with the user).
2. Prefer **`web_search`**, **`write_file`**, memory tools — **not** `run_shell` in steps on Nodebox (no real POSIX shell). The **canonical** tool decision table is **`browser-runtime-map`**; this skill only adds cron/heartbeat/delivery rules.
3. For Telegram side-channel: `delivery: terminal` plus `notifyChannel: telegram:<chatId>` when Telegram is configured; `silent`/`email` do not use `notifyChannel`.
4. Multi-step: ordered `steps` with shape `{"tool":"…","arguments":{…}}` (legacy `action` aliases to `tool`).

## Pitfalls

- Expecting overnight jobs without the tab open — they will not fire.
- Using host `crontab` / `at` via shell — blocked; use `cron_register`.
- Packing shell pipelines into cron steps in browser-backed runtimes — will fail; use dedicated tools.

## Anti-patterns

- `run_shell` steps on Nodebox for install or `curl` when `web_fetch` / `web_search` fits.
- Omitting `delivery` on new jobs — always set explicitly for clarity.
