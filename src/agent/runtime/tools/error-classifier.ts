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
const TIMEOUT_RE = /\btimeout|timed\s+out|deadline|ETIMEDOUT|abort/i;
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

  if (
    TIMEOUT_RE.test(message) ||
    statusHint === 408 ||
    m.includes("abort")
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
    return { reason, retryable, shouldCompress, shouldFallback, error_code, hintBase: "Authentication/authorization failed — check credentials or permissions." };
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
    return { reason, retryable, shouldCompress, shouldFallback, error_code, hintBase: "Fix tool name and arguments per schema." };
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
