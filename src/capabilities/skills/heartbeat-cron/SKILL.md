---
name: Heartbeat Cron
description: Use when the user wants scheduled jobs, daily digests, recurring reminders, or cron_register—not host crontab or shell pipelines.
version: 1.0.0
category: bundled
primary-tools: [cron_register, cron_list]
tags: [cron, schedule, heartbeat, automation, telegram, email, recurring, digest]
triggers: [schedule, cron, daily digest, recurring, every day, reminder job, cron_register, cron_list, periodic, automate daily]
---

## Tool contract (read first)

| Need | Tool |
|------|------|
| Create or update a scheduled job | `cron_register` |
| List existing jobs | `cron_list` |
| Inspect job definitions on disk | `read_file` on `.webagent/cronjobs.json` |
| Step tools inside a job | Built-in names only — e.g. `web_search`, `web_fetch`, `write_file`, `email`, `memory_save` |
| Output destination | Job fields (`cron_list` → `outputDestination`) |
| **Silent** | `delivery: silent` |
| **Web UI** (agent terminal / chat) | `delivery: terminal` |
| **Web UI + Telegram** | `delivery: terminal` + `notifyChannel: telegram:<chatId>` |
| **Email** | `delivery: email` + `deliveryEmailTo` (wraps all step outputs into one digest email) |
| **Send mail inside a step** | Step tool `email` with `{to, subject, text[, cc]}` — distinct from job `delivery` |

**Non-negotiable:** No manual cron run — `cron_list` reports `manualRunSupported: false`. Register/refresh does **not** execute the job. Never use host `crontab`/`at` via `run_shell`. Job `delivery` routes **where results go**; step `email` **sends** during the run. Tab must stay open for jobs to run. **Steps do not pass variables** — use fixed `write_file` paths between steps. Cron runs tools only (no LLM between steps), so dynamic per-recipient cold outreach belongs in **`task-execution`** or an approval-first digest cron, not static spam templates.

Tool choice for step bodies: **`browser-runtime-map`**. Ad-hoc present/email: **`artifact-delivery`**.

## When to Use

- User wants digest, reminders, periodic search, or multi-step automation inside Web Agent.
- "Run this every morning", recurring checks, or Telegram/email delivery for jobs.
- Explaining why a job did not run at an exact wall-clock time (tab must stay open).
- Choosing `delivery` and avoiding invalid step shapes on Nodebox.

## Relation to other skills

- Step tools: **`browser-runtime-map`**. Ad-hoc delivery: **`artifact-delivery`**.

## Facts (non-negotiable)

- Jobs run **only while the app tab/session is open**. Closing the browser stops the heartbeat until you return.
- Scheduling is **heartbeat-gated**, not systemd-style cron: `everyMinutes` is **minimum** spacing between runs; ticks use `HEARTBEAT_INTERVAL_MS` (typically 30 minutes). Short `everyMinutes` still waits for the next tick after becoming due.
- State files: `.webagent/heartbeat-state.json`, cron definition **`.webagent/cronjobs.json`** in the workspace.
- `tool` at job root or each `steps[]` entry must be a **built-in** name with that tool's `arguments`.
- **`delivery`** is only on the job (see table above). `notifyChannel` applies only when `delivery` is `terminal`. Never put `silent`/`terminal` as a step `tool`. **`email` is both** job delivery and a valid step tool when arguments include `to`+`subject` (+ `text` for send).
- After register/refresh, call **`cron_list`** and tell the user **`nextEligibleAtMs`** and **`outputDestination`** — do not claim the job already ran unless heartbeat logged `▸ cron '<id>' ran`.
- **Multi-step chaining:** write intermediate results to known paths (`work/...`); later steps cannot read prior tool JSON automatically. For outreach: research → `write_file` targets → `email` operator for approval — not unsupervised bulk cold email.

## Authoring

1. Use **`cron_register`** (or edit `.webagent/cronjobs.json` carefully) with `id`, `everyMinutes` (≥1), and `delivery` (confirm email vs terminal with the user).
2. Prefer **`web_search`**, **`write_file`**, memory tools — **not** `run_shell` in steps on Nodebox (no real POSIX shell). The **canonical** tool decision table is **`browser-runtime-map`**; this skill only adds cron/heartbeat/delivery rules.
3. For Telegram side-channel: `delivery: terminal` plus `notifyChannel: telegram:<chatId>` when Telegram is configured; `silent`/`email` do not use `notifyChannel`. Ad-hoc (non-cron) delivery formatting lives in **`artifact-delivery`**.
4. Multi-step: ordered `steps` with shape `{"tool":"…","arguments":{…}}` (legacy `action` aliases to `tool`).

## Pitfalls

- Expecting overnight jobs without the tab open — they will not fire.
- Using host `crontab` / `at` via shell — blocked; use `cron_register`.
- Packing shell pipelines into cron steps in browser-backed runtimes — will fail; use dedicated tools.

## Anti-patterns

- Promising a **manual cron run**, "kick off the cron now", or conflating in-chat skill work with cron execution.
- Saying a job "ran" or "is hunting" right after `cron_register` refresh without a heartbeat `▸ cron` line.
- `run_shell` steps on Nodebox for install or `curl` when `web_fetch` / `web_search` fits.
- Omitting `delivery` on new jobs — always set explicitly for clarity.
