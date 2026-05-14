import { defineTool } from "../definition.js";
import { runShellTool } from "../filesystem-tools.js";

const RUN_SHELL_EXAMPLES = [
  { command: "node --version" },
  { command: "node -e \"console.log('ok')\"", cwd: ".", timeout_ms: 5000 },
];

export default defineTool({
  name: "run_shell",
  run: runShellTool,
  emoji: "🖥️",
  description:
    "Not a general-purpose tool—prefer built-ins first (`grep`, `read_file`, `web_fetch`, `list_dir`, `system_info`, etc.). Last resort for workspace commands with no dedicated tool. **Host:** runs via POSIX `sh -c` (optional `cwd`, `timeout_ms`, `background`); `crontab`/`at` are blocked—use `cron_register`. **Nodebox** (`WEBAGENT_RUNTIME=nodebox`): not a real shell—only `node …` (spawned without `sh -c`); no pipes, `npx`, `curl`, `git`, or other binaries; no `background`; avoid in heartbeat cron. Required: `command` (string). Examples (arguments JSON only): " +
    JSON.stringify(RUN_SHELL_EXAMPLES[0]) +
    " | " +
    JSON.stringify(RUN_SHELL_EXAMPLES[1]),
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "POSIX shell string on host; in Nodebox must start with `node ` (no shell wrapper).",
      },
      cwd: { type: "string", description: "Optional working directory (host)." },
      timeout_ms: { type: "number", description: "Optional timeout cap in milliseconds." },
      background: { type: "boolean", description: "Run in background (host only)." },
      watch_patterns: {
        type: "array",
        items: { type: "string" },
        description: "Optional glob patterns for background completion.",
      },
      notify_on_complete: { type: "boolean", description: "Notify when background job completes." },
    },
    required: ["command"],
    additionalProperties: true,
    examples: RUN_SHELL_EXAMPLES,
  },
});
