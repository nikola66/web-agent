# HEARTBEAT

Periodic tasks are evaluated on a heartbeat while **this browser tab/session is open**. Closing the tab stops cron jobs until you return.

## How it works

- **Tick cadence:** the runtime wakes the evaluator on a timer. The interval is **`HEARTBEAT_INTERVAL_MS`** in [`constants.js`](./constants.js) (currently **30 minutes** — not once per minute). Jobs with `everyMinutes` smaller than the tick spacing may still wait until the next tick after they become due.
- **State file:** `.heartbeat-state.json`.
- **Cron tracker file:** `.cronjobs.json`.
- On each heartbeat, the runtime loads `.cronjobs.json`, finds jobs that are due (by `everyMinutes` and `lastRunAt`), and runs them.

**Scheduling expectations:** Cron is **heartbeat-gated**. “Every 60 minutes” means “at least 60 minutes after `lastRunAt`, when a heartbeat sees it”—not precise wall-clock cron like systemd. Overnight or “end of day” jobs only fire if the app stays open across that window.

## Cron tracker format

When calling the **`cron_register`** tool from the model, use the same shapes as below; copy-ready fenced JSON examples live in [`cron-register-description.ts`](./tools/cron-register-description.ts) (tool catalog text).

Use this JSON shape in `.cronjobs.json`. Prefer **`web_search` / `write_file` / memory tools** in steps—not `run_shell`—because the hosted **Nodebox** runtime has **no POSIX shell wrapper** (`sh -c`). For shell pipelines you need a **local/full** runtime, not this browser-backed one.

```json
{
  "jobs": [
    {
      "id": "daily-web-search-sample",
      "delivery": "terminal",
      "enabled": true,
      "everyMinutes": 1440,
      "tool": "web_search",
      "arguments": {
        "query": "example topic"
      },
      "notifyChannel": "telegram:123456789",
      "lastRunAt": 0
    },
    {
      "id": "drink-water-reminder",
      "delivery": "silent",
      "enabled": true,
      "everyMinutes": 60,
      "tool": "email",
      "arguments": {
        "to": "you@example.com",
        "subject": "Hydration reminder",
        "text": "Time for water."
      },
      "lastRunAt": 0
    },
    {
      "id": "weekly-digest",
      "delivery": "email",
      "deliveryEmailTo": "you@example.com",
      "deliveryEmailSubject": "Weekly cron digest",
      "enabled": true,
      "everyMinutes": 10080,
      "tool": "web_search",
      "arguments": { "query": "weekly summary topic" },
      "lastRunAt": 0
    }
  ]
}
```

- **`delivery`**: `silent` — minimal dim logs only; `terminal` — success/failure lines in the agent terminal (and optional `notifyChannel` Telegram copy); `email` — send a Resend digest (`deliveryEmailTo` required). Omit only on legacy jobs; new registrations should always set it (assistant should confirm with the user).
- The `email` **tool** inside a job accepts shorthand: when `to`, `subject`, and `text` are present, `action` defaults to `send`.

## Notes

- `tool` must be one of the built-in tool names.
- `arguments` are passed directly to that tool.
- Telegram notifications run only when `delivery` is `terminal` and `notifyChannel` is set (`telegram:<chatId>`); `silent` and `email` deliveries do not use `notifyChannel`.
- `lastRunAt` is updated automatically after each attempt (success or failure) to avoid tight retry loops.
- In WebContainer environments, prefer `cron_register` / `cron_list` over host `crontab` / `at` commands (those are blocked in the agent sandbox).
- **Nodebox / browser:** Avoid `run_shell` in cron `steps`; it cannot run arbitrary shell scripts. Prefer tools that map to real APIs (search, fetch, files, email, etc.).
- Plain one-line `tool path` hints in streamed text only cover simple tools; `cron_register` needs full JSON arguments via native tool_calls or fallbacks like `<<<TOOL>>>` / embedded JSON.

## Startup tick

A **deferred** startup evaluation runs shortly after the agent process boots (see `agent.js`) so the first heartbeat does not race with first-turn UI (for example, guarded tool approval). Periodic ticks still follow `HEARTBEAT_INTERVAL_MS`.
