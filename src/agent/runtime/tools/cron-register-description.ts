/**
 * Tool catalog copy for `cron_register` (Node registry + browser metadata).
 * Keep dependency-free so browser stubs can import it safely.
 */
export const CRON_REGISTER_TOOL_DESCRIPTION = `Save a recurring heartbeat job to \`.webagent/cronjobs.json\`, or remove one. The job runs only while the app tab is open; the runtime checks due jobs on heartbeat ticks (see HEARTBEAT.md — \`everyMinutes\` is minimum spacing between runs, not wall-clock cron like systemd).

**Remove a job:** \`{"action":"remove","id":"<job_id>"}\`. Requires an existing id; unknown ids error (use \`cron_list\` first).

**Register / update (default):** Always include \`id\` (string) and \`everyMinutes\` (number, ≥1). Set \`delivery\` to \`silent\`, \`terminal\`, or \`email\`. For \`email\`, also set \`deliveryEmailTo\` (and optional \`deliveryEmailSubject\`). Optional: \`notifyChannel\` as \`telegram:<chatId>\` when Telegram is configured.

**What runs:** Either (1) one tool at the job root, or (2) an ordered \`steps\` array. Each step must be a **built-in tool name** plus that tool’s arguments.

**Canonical step shape:** \`{"tool":"<builtin_name>","arguments":{...}}\` — use this in \`steps\`. Legacy \`action\` is accepted as an alias for \`tool\`.

**Do not confuse:** \`silent\` / \`terminal\` / \`email\` are **only** for the job’s \`delivery\` field. Never use them as a step’s \`tool\`.

**Nodebox:** Prefer \`web_search\`, \`write_file\`, memory tools, etc. over \`run_shell\` in steps when the runtime has no shell.

**Exact JSON examples (copy/paste patterns):**

Single tool (simplest):
\`\`\`json
{"id":"hourly_ping","everyMinutes":60,"delivery":"terminal","tool":"system_info","arguments":{}}
\`\`\`

Daily web search:
\`\`\`json
{"id":"daily_ai_news","everyMinutes":1440,"delivery":"terminal","tool":"web_search","arguments":{"query":"latest AI headlines","page":0}}
\`\`\`

Multi-step (each step is \`tool\` + \`arguments\`):
\`\`\`json
{"id":"search_then_save","everyMinutes":180,"delivery":"silent","steps":[{"tool":"web_search","arguments":{"query":"rust release notes","page":0}},{"tool":"write_file","arguments":{"path":"work/notes/rust.md","content":"paste summary here"}}]}
\`\`\`

Email digest when done:
\`\`\`json
{"id":"weekly_email","everyMinutes":10080,"delivery":"email","deliveryEmailTo":"you@example.com","deliveryEmailSubject":"Weekly digest","tool":"web_search","arguments":{"query":"industry news","page":0}}
\`\`\`

Remove (strict — id must exist):
\`\`\`json
{"action":"remove","id":"hourly_ping"}
\`\`\``;
