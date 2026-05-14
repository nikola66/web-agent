import { defineTool } from "../definition.js";
import { runShellTool } from "../filesystem-tools.js";

const RUN_SHELL_EXAMPLES = [
  { command: "node --version" },
  { command: "printf '%s\\n' ok", cwd: ".", timeout_ms: 5000 },
];

export default defineTool({
  name: "run_shell",
  run: runShellTool,
  emoji: "🖥️",
  description:
    "Run a shell command in the workspace. On Nodebox (browser runtime, WEBAGENT_RUNTIME=nodebox) there is no OS `sh` process: only direct `node …` invocations are supported (spawned without a shell). For pipes, `grep`/`sed`, or other binaries, use read_file/grep tools, web_fetch, or a local terminal—not run_shell. Do not rely on run_shell inside heartbeat cron steps in Nodebox. Required: `command` (string). Examples (arguments JSON only): " +
    JSON.stringify(RUN_SHELL_EXAMPLES[0]) +
    " | " +
    JSON.stringify(RUN_SHELL_EXAMPLES[1]),
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Shell command (host) or `node …` only in Nodebox.",
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
