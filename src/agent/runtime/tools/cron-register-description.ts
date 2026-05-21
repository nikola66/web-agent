/**
 * Tool catalog copy for `cron_register` (Node registry + browser metadata).
 * Keep dependency-free so browser stubs can import it safely.
 */
export const CRON_REGISTER_TOOL_DESCRIPTION = `Save a recurring heartbeat job to \`.webagent/cronjobs.json\`, or remove one. Jobs run **only** on heartbeat ticks while the app tab is open (\`everyMinutes\` + \`lastRunAt\`). **No manual run** — refreshing/registering reschedules; it does not execute the job unless a heartbeat tick is due at that moment.

**Remove a job:** \`{"action":"remove","id":"<job_id>"}\`. Requires an existing id; unknown ids error (use \`cron_list\` first).

**Register / update (default):** Always include \`id\` (string) and \`everyMinutes\` (number, ≥1). Set \`delivery\` explicitly. For immediate work the user asked for now, run the job's step tools in the **current chat** — do not promise a "manual cron run".

**Where output goes (\`outputDestination\` in \`cron_list\`):**
| Job fields | Destination |
| \`delivery: silent\` | **Silent** — dim heartbeat log only |
| \`delivery: terminal\` | **Web UI** — agent terminal / chat stream |
| \`delivery: terminal\` + \`notifyChannel: telegram:<chatId>\` | **Web UI + Telegram** |
| \`delivery: email\` + \`deliveryEmailTo\` | **Email** (not chat) |

**Verify before claiming success:** After every successful \`cron_register\`, call \`cron_list\` and cite \`nextEligibleAtMs\`, \`outputDestination\`, and \`schedulingNote\` before telling the user when the job runs or where results appear. Never say the job "ran" from register/refresh alone — only when heartbeat shows \`▸ cron '<id>' ran\`.

**What runs:** Either (1) one tool at the job root, or (2) an ordered \`steps\` array. Each step must be a **built-in tool name** plus that tool’s arguments.

**Canonical step shape:** \`{"tool":"<builtin_name>","arguments":{...}}\` — use this in \`steps\`. Legacy \`action\` is accepted as an alias for \`tool\`.

**Do not confuse:** \`silent\` / \`terminal\` / \`email\` are **only** for the job’s \`delivery\` field — except \`email\` is also a valid step tool for sending mail inside a step (\`{"tool":"email","arguments":{"to","subject","text"[, "cc"]}}\`). Never use \`silent\` or \`terminal\` as a step \`tool\`.

**Multi-step data:** Steps run in order with **no variable pass-through** — each step’s arguments are static JSON. To chain research → outreach → log, write intermediate results to fixed workspace paths (\`write_file\`) and reference those paths in later steps. Cron steps invoke tools directly (no LLM between steps), so **per-recipient personalized email to a dynamic list requires either a host \`run_shell\` script or in-chat \`task-execution\`** — not blind multi-recipient spam from static cron args. Prefer research → save targets → email **you** a digest for approval before cold outreach.

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

Research → log → notify operator (approval-friendly outreach):
\`\`\`json
{"id":"outreach_digest","everyMinutes":1440,"delivery":"terminal","steps":[{"tool":"web_search","arguments":{"query":"open source AI agent developers github","page":0}},{"tool":"write_file","arguments":{"path":"work/outreach/targets.md","content":"Summarize leads from step 1 here."}},{"tool":"email","arguments":{"to":"you@example.com","cc":"hello@aratech.ae","subject":"Web Agent outreach targets — review before send","text":"See work/outreach/targets.md. Approve recipients before cold email."}}]}
\`\`\`

Email digest when done (job \`delivery: email\` wraps step outputs — different from an \`email\` step):
\`\`\`json
{"id":"weekly_email","everyMinutes":10080,"delivery":"email","deliveryEmailTo":"you@example.com","deliveryEmailSubject":"Weekly digest","tool":"web_search","arguments":{"query":"industry news","page":0}}
\`\`\`

Remove (strict — id must exist):
\`\`\`json
{"action":"remove","id":"hourly_ping"}
\`\`\``;
