/**
 * Classify tool/runtime errors for model-facing recovery hints.
 */

export type FailoverReason =
  | "rate_limit"
  | "auth"
  | "timeout"
  | "context_overflow"
  | "format_error"
  | "network"
  | "user_denied"
  | "unknown";

export type ClassifiedToolError = {
  reason: FailoverReason;
  retryable: boolean;
  shouldCompress: boolean;
  shouldFallback: boolean;
  /** Short stable code for tool result JSON */
  error_code: string;
  /** One line for the model */
  recovery_hint: string;
};

const RATE_LIMIT_RE = /\b(429|rate\s*limit|too\s+many\s+requests|throttl)/i;
const AUTH_RE = /\b(401|403|unauthorized|forbidden|invalid\s*api\s*key|auth)/i;
const TIMEOUT_RE = /\btimeout|timed\s+out|deadline|ETIMEDOUT\b/i;
const CONTEXT_RE = /\b(context|token)\s*(length|limit|overflow|exceeded)|maximum\s+context|too\s+long/i;
const FORMAT_RE = /\b(invalid|malformed|parse|json|syntax|unexpected\s+token|schema)/i;

function classifyFromMessage(message: string, statusHint: number | null): Omit<ClassifiedToolError, "recovery_hint"> & { hintBase: string } {
  const m = message.toLowerCase();
  let reason: FailoverReason = "unknown";
  let retryable = false;
  let shouldCompress = false;
  let shouldFallback = false;
  let error_code = "unknown_error";

  if (/^\s*aborted\s*$/i.test(message.trim()) || message.includes("turn aborted")) {
    reason = "unknown";
    retryable = false;
    error_code = "aborted";
    return { reason, retryable, shouldCompress, shouldFallback, error_code, hintBase: "Execution was aborted." };
  }

  if (/user_denied|(^|\b)denied(\b|$)|cancel/i.test(message)) {
    reason = "user_denied";
    retryable = false;
    error_code = "user_denied";
    return { reason, retryable, shouldCompress, shouldFallback, error_code, hintBase: "User declined this tool execution." };
  }

  if (/run_shell \(nodebox\):\s*HTTP calls belong in/i.test(message)) {
    reason = "format_error";
    retryable = false;
    shouldFallback = true;
    error_code = "shell_http_misroute";
    return {
      reason,
      retryable,
      shouldCompress,
      shouldFallback,
      error_code,
      hintBase: "Use web_fetch (GET + headers) or web_post (POST/GraphQL) instead of run_shell for HTTP.",
    };
  }

  if (/cannot find module ['"]axios['"]|require is not defined/i.test(message)) {
    reason = "format_error";
    retryable = false;
    shouldFallback = true;
    error_code = "shell_no_axios";
    return {
      reason,
      retryable,
      shouldCompress,
      shouldFallback,
      error_code,
      hintBase: "axios/require is unavailable in Nodebox shell — use web_fetch or web_post for HTTP.",
    };
  }

  if (/run_shell \(nodebox\):\s*no os shell/i.test(message)) {
    reason = "unknown";
    retryable = false;
    shouldFallback = true;
    error_code = "nodebox_shell_unsupported";
    return {
      reason,
      retryable,
      shouldCompress,
      shouldFallback,
      error_code,
      hintBase:
        "Nodebox has no POSIX shell — use web_fetch, web_post, grep, read_file, run_python, or local node scripts; do not retry shell pipelines or external binaries.",
    };
  }

  if (/run_shell \(nodebox\):\s*background mode is not supported/i.test(message)) {
    reason = "unknown";
    retryable = false;
    shouldFallback = true;
    error_code = "nodebox_shell_unsupported";
    return {
      reason,
      retryable,
      shouldCompress,
      shouldFallback,
      error_code,
      hintBase:
        "Nodebox run_shell cannot use background mode. Omit `background` or use a full host runtime.",
    };
  }

  if (/run_shell aborted/i.test(message)) {
    reason = "unknown";
    retryable = false;
    error_code = "aborted";
    return {
      reason,
      retryable,
      shouldCompress,
      shouldFallback,
      error_code,
      hintBase: "Shell run was aborted — do not retry unless the user asks.",
    };
  }

  // Python imports a package that isn't stdlib and isn't bundled in Pyodide.
  const webagentModuleMatch = message.match(/ModuleNotFoundError:\s*No module named ['"]webagent(?:\.http)?['"]/i);
  if (webagentModuleMatch) {
    reason = "format_error";
    retryable = false;
    shouldFallback = true;
    error_code = "pyodide_webagent_http";
    return {
      reason,
      retryable,
      shouldCompress,
      shouldFallback,
      error_code,
      hintBase:
        "webagent.http is injected at Pyodide init — use `import webagent.http as http` inside run_python (not pip). For one-off CMS uploads use agent web_upload instead.",
    };
  }

  // Common when a skill or the model invents an SDK (e.g. `from directus import DirectusClient`).
  const noModuleMatch = message.match(/ModuleNotFoundError:\s*No module named ['"]([\w.]+)['"]/i);
  if (noModuleMatch) {
    reason = "format_error";
    retryable = false;
    shouldFallback = true;
    error_code = "pyodide_missing_module";
    const mod = noModuleMatch[1];
    return {
      reason,
      retryable,
      shouldCompress,
      shouldFallback,
      error_code,
      hintBase: `Pyodide has no module '${mod}'. Pyodide ships stdlib + a fixed package list — no pip and no arbitrary PyPI SDKs. For HTTP/REST/GraphQL targets, use web_fetch/web_post directly with the service's documented endpoints instead of importing a client library. For Pyodide-bundled packages, pass them via the run_python \`packages\` arg.`,
    };
  }

  if (/Resource busy: ['"][^'"]*\/workspace\//i.test(message) || /pyodide[\s\S]*Resource busy/i.test(message)) {
    reason = "unknown";
    retryable = true;
    shouldFallback = true;
    error_code = "pyodide_workspace_busy";
    return {
      reason,
      retryable,
      shouldCompress,
      shouldFallback,
      error_code,
      hintBase:
        "Pyodide workspace cleanup failed. Retry once; for simple REST/GraphQL publishing, switch to web_fetch/web_post instead of Python.",
    };
  }

  if (
    /JsProxy.*not iterable|pyodide\.ffi\.JsProxy|urllib\.request\.urlopen/i.test(message)
  ) {
    reason = "format_error";
    retryable = false;
    shouldFallback = true;
    error_code = "pyodide_http_jsproxy";
    return {
      reason,
      retryable,
      shouldCompress,
      shouldFallback,
      error_code,
      hintBase:
        "Pyodide HTTP failed with a JsProxy/urllib error. Decision tree: agent one-off REST → web_fetch/web_post; reusable Python script → `import webagent.http as http` inside run_python; avoid requests/httpx in Pyodide.",
    };
  }

  if (
    /web_upload never accepts raw bytes|never pass base64|multipart\/form-data.*base64/i.test(message) ||
    (/IPC proxy stream timed out/i.test(message) && /upload|multipart|image|base64|snapshot/i.test(message)) ||
    (/read_file|snapshot/i.test(message) && /base64|upload|multipart|image/i.test(message) && TIMEOUT_RE.test(message))
  ) {
    reason = "format_error";
    retryable = false;
    shouldFallback = true;
    error_code = "upload_misroute";
    return {
      reason,
      retryable,
      shouldCompress,
      shouldFallback,
      error_code,
      hintBase:
        "Upload misroute — never pass binary/base64 in tool args or chat. Decision: CMS /files → web_upload (source_url or file_path); mixed form+file → web_post.multipart; JSON/GraphQL → web_post; download first → web_fetch save_to then web_upload.file_path; Python script → webagent.http.upload_file.",
    };
  }

  if (/LLM request body too large for IPC/i.test(message)) {
    reason = "context_overflow";
    retryable = false;
    shouldCompress = true;
    error_code = "ipc_body_too_large";
    return {
      reason,
      retryable,
      shouldCompress,
      shouldFallback,
      error_code,
      hintBase:
        "Conversation context is too large to send through the browser IPC bridge. Use compact tool summaries (list_digest, result_ref), run /compact or /clear, and avoid refetching full API payloads in one turn.",
    };
  }

  if (
    TIMEOUT_RE.test(message) ||
    statusHint === 408
  ) {
    reason = "timeout";
    retryable = true;
    error_code = "timeout";
    return { reason, retryable, shouldCompress, shouldFallback, error_code, hintBase: "Request timed out." };
  }

  if (
    CONTEXT_RE.test(message) ||
    statusHint === 413 ||
    (statusHint === 400 && m.includes("token"))
  ) {
    reason = "context_overflow";
    retryable = false;
    shouldCompress = true;
    error_code = "context_overflow";
    return {
      reason,
      retryable,
      shouldCompress,
      shouldFallback,
      error_code,
      hintBase: "Context/token limit exceeded; shorten inputs or omit large payloads.",
    };
  }

  if (RATE_LIMIT_RE.test(message) || statusHint === 429) {
    reason = "rate_limit";
    retryable = true;
    error_code = "rate_limit";
    return { reason, retryable, shouldCompress, shouldFallback, error_code, hintBase: "Rate limited — wait briefly and retry with smaller batch." };
  }

  if (AUTH_RE.test(message) || statusHint === 401 || statusHint === 403) {
    reason = "auth";
    retryable = false;
    error_code = "auth_error";
    const httpToolHint = /web_fetch|HTTP request failed/i.test(message)
      ? " Add Authorization in web_fetch/web_post headers — do not move auth to run_shell."
      : " Check credentials or permissions.";
    return {
      reason,
      retryable,
      shouldCompress,
      shouldFallback,
      error_code,
      hintBase: `Authentication/authorization failed —${httpToolHint}`,
    };
  }

  if (
    /\b(fetch failed|failed to fetch|network|econnreset|enotfound|socket|ECONNREFUSED)/i.test(message) ||
    statusHint === 502 ||
    statusHint === 503 ||
    statusHint === 504
  ) {
    reason = "network";
    retryable = true;
    error_code = "network_error";
    return { reason, retryable, shouldCompress, shouldFallback, error_code, hintBase: "Transient network/backend issue — retry once or alternate tool." };
  }

  if (/Refusing to write at workspace root/i.test(message)) {
    reason = "format_error";
    retryable = false;
    shouldFallback = true;
    error_code = "workspace_root_write_guard";
    return {
      reason,
      retryable,
      shouldCompress,
      shouldFallback,
      error_code,
      hintBase:
        "Root-level writes are blocked. Call make_dir, then write under work/<slug>/ or projects/<slug>/ — not the workspace root.",
    };
  }

  if (/missing required field\(s\) \[url\].*web_post/i.test(message)) {
    reason = "format_error";
    retryable = false;
    shouldFallback = true;
    error_code = "invalid_arguments";
    return {
      reason,
      retryable,
      shouldCompress,
      shouldFallback,
      error_code,
      hintBase:
        'web_post requires `url`. POST/PATCH/PUT need `body`, `json`, or `form`. DELETE/HEAD/OPTIONS omit body. Example: {"url":"https://api.example.com/items/posts","headers":{"Authorization":"Bearer <token>"},"json":{"title":"Hello"}}',
    };
  }

  if (/missing required field\(s\) \[command\].*run_shell/i.test(message)) {
    reason = "format_error";
    retryable = false;
    shouldFallback = true;
    error_code = "invalid_arguments";
    return {
      reason,
      retryable,
      shouldCompress,
      shouldFallback,
      error_code,
      hintBase: 'run_shell requires command. Example: {"command":"node --version"}',
    };
  }

  if (/run_shell exited with code 1/i.test(message)) {
    reason = "format_error";
    retryable = false;
    shouldFallback = true;
    error_code = "run_shell_silent_failure";
    return {
      reason,
      retryable,
      shouldCompress,
      shouldFallback,
      error_code,
      hintBase:
        "run_shell failed with exit code 1. For Python publishers use run_python with env; for REST/CMS workflows use web_fetch/web_post instead of node/python shell scripts.",
    };
  }

  if (FORMAT_RE.test(message) || statusHint === 422) {
    reason = "format_error";
    retryable = false;
    error_code = "format_error";
    return {
      reason,
      retryable,
      shouldCompress,
      shouldFallback: true,
      hintBase: "Invalid arguments or response format — fix parameters to match schema.",
    };
  }

  if (/invalid arguments|missing required|unknown tool/i.test(message)) {
    reason = "format_error";
    retryable = false;
    error_code = message.includes("unknown tool") ? "unknown_tool" : "invalid_arguments";
    shouldFallback = true;
    const hintBase =
      /create_archive/i.test(message)
        ? "There is no create_archive tool. Use run_python with stdlib zipfile to write work/<slug>/bundle.zip, then archive_list and artifact_present."
        : "Fix tool name and arguments per schema.";
    return { reason, retryable, shouldCompress, shouldFallback, error_code, hintBase };
  }

  return { reason, retryable: false, shouldCompress, shouldFallback, error_code, hintBase: "Tool failed." };
}

/**
 * Optionally pass HTTP status when the error came from fetch/web (e.g. web_fetch tool).
 */
export function classifyToolError(err: unknown, statusHint: number | null = null): ClassifiedToolError {
  const message = typeof err === "string" ? err : String((err as Error)?.message || err || "");
  const parsed = classifyFromMessage(message, statusHint);
  let recovery_hint = parsed.hintBase;
  const tail = message.replace(/\s+/g, " ").trim().slice(0, 180);
  if (tail && tail.length > 20 && !tail.startsWith(parsed.hintBase.slice(0, 12))) {
    recovery_hint = `${parsed.hintBase} Detail: ${tail}`;
  }
  const { hintBase: _h, ...rest } = parsed;
  return {
    ...rest,
    recovery_hint: recovery_hint.slice(0, 400),
  };
}
