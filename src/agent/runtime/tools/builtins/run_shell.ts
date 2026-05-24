import { defineTool } from "../definition.js";
import { runShellTool } from "../filesystem-tools.js";

const RUN_SHELL_EXAMPLES = [
  { command: "node --version" },
  { command: "node -e \"console.log('ok')\"", cwd: ".", timeout_ms: 5000 },
  {
    command: "python3 scripts/publish-5lang.py article.md",
    cwd: ".webagent/skills/imported/example",
    env: { API_TOKEN: "<from Settings/vault>" },
    timeout_ms: 300000,
  },
];

export default defineTool({
  name: "run_shell",
  run: runShellTool,
  emoji: "🖥️",
  description:
    "Not a general-purpose tool—prefer built-ins first (`web_fetch`, `web_post`, `grep`, `read_file`, `list_dir`, `system_info`, etc.). **HTTP:** GET → `web_fetch` (+ `headers`); POST/GraphQL → `web_post` — not run_shell axios/fetch one-liners. Last resort for local scripts with no dedicated tool. **Host:** runs via POSIX `sh -c` (optional `cwd`, `env`, `timeout_ms`, `background`); `crontab`/`at` are blocked—use `cron_register`. **Nodebox** (`WEBAGENT_RUNTIME=nodebox`): not a real shell—supports `node …`, `python`/`python3` via Pyodide, and simple read-only probes; no pipes, `npx`, `curl`, `git`, package managers, or `background`; prefer run_python for Python scripts and avoid run_shell in heartbeat cron. Required: `command` (string). Examples (arguments JSON only): " +
    JSON.stringify(RUN_SHELL_EXAMPLES[0]) +
    " | " +
    JSON.stringify(RUN_SHELL_EXAMPLES[1]),
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "POSIX shell string on host; in Nodebox use `node ...`, `python3 ...`, or a simple read-only probe.",
      },
      cwd: { type: "string", description: "Optional working directory (relative to workspace root)." },
      env: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Optional env vars for this invocation (Nodebox: passed to shell.runCommand; host: merged over process.env).",
      },
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
