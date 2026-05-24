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
    "Last-resort shell — prefer built-ins and the Capability router first. **HTTP/file ops blocked** — use `web_fetch`/`web_post`, `read_file`, `grep`, etc.; see `recovery_hint` on failure. `python3`/`python` routes to Pyodide (`routed_via: run_python`) — prefer `run_python` directly. **Host:** POSIX `sh -c`; **Nodebox:** `node …`, Pyodide python alias, simple probes only — no pipes, curl, git, npx. Required: `command`. Examples: " +
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
