/**
 * Provider HTTP error taxonomy for LLM streaming/completion retry routing.
 */

export type LlmFailoverReason =
  | "rate_limit"
  | "auth"
  | "timeout"
  | "context_overflow"
  | "payload_too_large"
  | "model_not_found"
  | "format_error"
  | "server_error"
  | "network"
  | "unknown";

export type ClassifiedLlmError = {
  reason: LlmFailoverReason;
  statusCode: number | null;
  retryable: boolean;
  shouldCompress: boolean;
  recoveryHint: string;
  message: string;
};

const CONTEXT_OVERFLOW_RE =
  /\b(context|token|prompt)\s*(length|limit|window|size|overflow|exceeded)|maximum\s+context|too\s+many\s+tokens|max_model_len|prompt\s+is\s+too\s+long|input\s+is\s+too\s+long|reduce\s+the\s+length/i;
const RATE_LIMIT_RE = /\b(429|rate\s*limit|too\s+many\s+requests|throttl|resource_exhausted)\b/i;
const AUTH_RE = /\b(401|403|invalid\s+api\s+key|unauthorized|forbidden|authentication)\b/i;
const TIMEOUT_RE = /\b(timeout|timed\s+out|deadline\s+exceeded)\b/i;
const MODEL_NOT_FOUND_RE =
  /\b(model\s+not\s+found|invalid\s+model|unknown\s+model|no\s+such\s+model|does\s+not\s+exist)\b/i;
const PAYLOAD_TOO_LARGE_RE = /\b(413|payload\s+too\s+large|request\s+entity\s+too\s+large)\b/i;

function parseProviderMessage(bodyText: string): string {
  try {
    const parsed = JSON.parse(String(bodyText || ""));
    if (typeof parsed?.error === "string") return parsed.error.trim();
    if (parsed?.error && typeof parsed.error === "object") {
      const msg = parsed.error.message || parsed.error.code;
      if (typeof msg === "string") return msg.trim();
    }
  } catch {
    /* ignore */
  }
  return String(bodyText || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function classifyLlmProviderError(
  status: number,
  bodyText = "",
  provider = "LLM"
): ClassifiedLlmError {
  const details = parseProviderMessage(bodyText);
  const haystack = `${status} ${details}`.toLowerCase();
  const statusCode = Number.isFinite(status) && status > 0 ? status : null;

  if (CONTEXT_OVERFLOW_RE.test(haystack) || (statusCode === 400 && /token/i.test(details))) {
    return {
      reason: "context_overflow",
      statusCode,
      retryable: false,
      shouldCompress: true,
      recoveryHint: "Context exceeded provider limit — compact history or shorten the prompt before retrying.",
      message: `${provider} context overflow: ${details || "prompt too large"}`,
    };
  }

  if (PAYLOAD_TOO_LARGE_RE.test(haystack) || statusCode === 413) {
    return {
      reason: "payload_too_large",
      statusCode,
      retryable: false,
      shouldCompress: true,
      recoveryHint: "Request payload too large — compact history or remove large tool outputs.",
      message: `${provider} payload too large: ${details || "request entity too large"}`,
    };
  }

  if (RATE_LIMIT_RE.test(haystack) || statusCode === 429) {
    return {
      reason: "rate_limit",
      statusCode,
      retryable: true,
      shouldCompress: false,
      recoveryHint: "Rate limited — wait briefly, then retry with a smaller batch.",
      message: `${provider} rate limited: ${details || "too many requests"}`,
    };
  }

  if (AUTH_RE.test(haystack) || statusCode === 401 || statusCode === 403) {
    return {
      reason: "auth",
      statusCode,
      retryable: false,
      shouldCompress: false,
      recoveryHint: "Authentication failed — verify API key and provider permissions.",
      message: `${provider} auth error: ${details || "unauthorized"}`,
    };
  }

  if (TIMEOUT_RE.test(haystack) || statusCode === 408) {
    return {
      reason: "timeout",
      statusCode,
      retryable: true,
      shouldCompress: false,
      recoveryHint: "Request timed out — retry once; if it persists, shorten the prompt.",
      message: `${provider} timeout: ${details || "timed out"}`,
    };
  }

  if (MODEL_NOT_FOUND_RE.test(haystack) || statusCode === 404) {
    return {
      reason: "model_not_found",
      statusCode,
      retryable: false,
      shouldCompress: false,
      recoveryHint: "Model or endpoint not found — switch provider/model configuration.",
      message: `${provider} model not found: ${details || "not found"}`,
    };
  }

  if (statusCode != null && statusCode >= 500 && statusCode < 600) {
    return {
      reason: "server_error",
      statusCode,
      retryable: true,
      shouldCompress: false,
      recoveryHint: "Upstream server error — retry with backoff.",
      message: `${provider} server error ${statusCode}: ${details || "internal error"}`,
    };
  }

  if (statusCode === 400 || statusCode === 422) {
    return {
      reason: "format_error",
      statusCode,
      retryable: false,
      shouldCompress: false,
      recoveryHint: "Request rejected by provider — fix message/tool schema or switch model.",
      message: `${provider} format error: ${details || "bad request"}`,
    };
  }

  if (statusCode === 502 || statusCode === 503 || statusCode === 504) {
    return {
      reason: "network",
      statusCode,
      retryable: true,
      shouldCompress: false,
      recoveryHint: "Transient gateway/network issue — retry with backoff.",
      message: `${provider} gateway error ${statusCode}: ${details || "unavailable"}`,
    };
  }

  return {
    reason: "unknown",
    statusCode,
    retryable: statusCode == null || statusCode >= 500,
    shouldCompress: false,
    recoveryHint: "LLM request failed — inspect provider response and retry if transient.",
    message: `${provider} API ${statusCode ?? "?"}: ${details || "empty error response"}`,
  };
}

export function formatClassifiedLlmError(
  classified: ClassifiedLlmError,
  extraHint = ""
): string {
  const parts = [classified.message];
  if (classified.shouldCompress) parts.push(classified.recoveryHint);
  else if (classified.recoveryHint) parts.push(classified.recoveryHint);
  if (extraHint) parts.push(extraHint);
  return parts.filter(Boolean).join(" ");
}
