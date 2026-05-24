import { defineTool } from "../definition.js";
import { runPythonTool } from "../python-tools.js";

const RUN_PYTHON_EXAMPLES = [
  { code: "print('ok')" },
  { path: "scripts/publish-5lang.py", env: { DIRECTUS_API_TOKEN: "<from Settings/vault>" }, timeout_ms: 300000 },
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
    "Run Python in browser-only Nodebox via lazy Pyodide. Use for stdlib/Pyodide-compatible Python skills. Supports `code` or workspace `path`, optional `args`, `cwd`, `env`, `packages`, and `timeout_ms`. **Create ZIP archives:** there is no `create_archive` tool — use inline `code` or a script with stdlib `zipfile`, write under `work/` or `projects/`, then `archive_list` + `artifact_present`. Auto-loads Pyodide wheels for common imports (Pillow, numpy, pandas, python-docx, python-pptx, openpyxl, pypdf, reportlab, pdfplumber, defusedxml, lxml, beautifulsoup4, pyyaml, requests, matplotlib) — you don't need to list them in `packages`. Hard-blocked at preflight: scripts that spawn host binaries (`soffice`/`libreoffice`/`pdftoppm`/`pdftotext`/`qpdf`/`pdftk`/`pandoc`/`tesseract`/`ffmpeg`/`gcc`/`curl`/`wget`/`git`) or import packages that need them at runtime (`pdf2image`, `pytesseract`) or need raw sockets (`psycopg2`, `pymongo`, `paramiko`, …). For those, fall back to `web_fetch`/`web_post` or pure-Python equivalents (`pypdf` instead of poppler, `python-docx` instead of LibreOffice). No subprocess, system pip, Playwright/Selenium, or arbitrary compiled wheels. Examples: " +
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
