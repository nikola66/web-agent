import { defineTool } from "../definition.js";
import { runShellTool } from "../filesystem-tools.js";

export default defineTool({
  name: "run_shell",
  run: runShellTool,
  emoji: "🖥️",
  description: "Run a shell command in the workspace. On Nodebox (browser runtime, WEBAGENT_RUNTIME=nodebox) there is no OS `sh` process: only direct `node …` invocations are supported (spawned without a shell). For pipes, `grep`/`sed`, or other binaries, use read_file/grep tools, web_fetch, or a local terminal—not run_shell. Do not rely on run_shell inside heartbeat cron steps in Nodebox.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
