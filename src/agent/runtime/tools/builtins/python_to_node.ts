import { defineTool } from "../definition.js";
import { pythonToNodeTool } from "../script-porting.js";

export default defineTool({
  name: "python_to_node",
  run: pythonToNodeTool,
  emoji: "🐍",
  description:
    "Read-only Python→Node compatibility report for Nodebox — not an auto-transpiler. Returns checklist, " +
    "Python→JS mappings, detected libraries, compatibility tier, recipes, templates, heuristic hints, `env_vars`, `suggested_cwd`, cache metadata, and `run_shell_example`. " +
    "Use before writing scripts/*.js when a skill references python, pip, or .py files. Full procedure: skill_view **`script-porting`**. " +
    "Provide `path` (workspace .py file) or `python` (inline source); path wins if both set.",
  inputSchema: {
    type: "object",
    properties: {
      python: { type: "string", description: "Optional Python source snippet or full script." },
      path: { type: "string", description: "Optional workspace-relative path to a .py file to analyze." },
    },
    additionalProperties: false,
    examples: [
      { python: "import requests\nprint(requests.get('https://example.com').text)" },
      { path: "tools/example.py" },
    ],
  },
});
