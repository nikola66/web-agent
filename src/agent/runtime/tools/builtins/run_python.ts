import { defineTool } from "../definition.js";
import { runPythonTool } from "../python-tools.js";

const RUN_PYTHON_EXAMPLES = [
  { code: "print('ok')" },
  { path: "scripts/publish-5lang.py", env: { DIRECTUS_API_TOKEN: "<from memory_recall or user>" }, timeout_ms: 300000 },
  {
    code:
      "import zipfile\nfrom pathlib import Path\nroot=Path('work/my-bundle'); out=root/'bundle.zip'\nwith zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED) as zf:\n  [zf.write(f,f.relative_to(root)) for f in root.rglob('*') if f.is_file() and f!=out]\nprint(out)",
  },
];

export default defineTool({
  name: "run_python",
  run: runPythonTool,
  emoji: "🐍",
  description:
    "Run Python in browser-only Nodebox via lazy Pyodide (v0.29.4). **Before codegen:** `skill` (action=view) **`pyodide-runtime`** (WASM contract). **Prefer over `run_shell python3`.** Agent one-off REST → `web_fetch`/`web_post`; file uploads → `web_upload`; HTTP inside scripts → `import webagent.http as http` (`upload_file` for files). Supports `code` or workspace `path`, optional `args`, `cwd`, `env`, `packages`, `timeout_ms`. **Create ZIP:** stdlib `zipfile` (no `create_archive` tool). Auto-loads common Pyodide wheels. Hard-blocked: host binaries/subprocess, Playwright, raw DB sockets. Examples: " +
    JSON.stringify(RUN_PYTHON_EXAMPLES[0]) +
    " | " +
    JSON.stringify(RUN_PYTHON_EXAMPLES[1]),
  inputSchema: {
    type: "object",
    properties: {
      code: { type: "string", description: "Inline Python source. Ignored when `path` is provided." },
      path: { type: "string", description: "Workspace-relative Python file to execute." },
      args: {
        type: "array",
        items: { type: "string" },
        description: "Optional sys.argv entries after the script name.",
      },
      cwd: { type: "string", description: "Optional working directory, relative to workspace root." },
      env: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Optional environment variables for this Python invocation.",
      },
      packages: {
        type: "array",
        items: { type: "string" },
        description: "Optional Pyodide package names to load before execution.",
      },
      timeout_ms: { type: "number", description: "Optional timeout cap in milliseconds." },
    },
    additionalProperties: false,
    examples: RUN_PYTHON_EXAMPLES,
  },
});
