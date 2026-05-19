import { isDebugLogEnabled } from "./logging/debug-log.js";
import { dim } from "./terminal-format.js";
import { RESEARCH_INTENT_RE } from "./turn-sequencing.js";

export function isResearchIntent(input: string): boolean {
  return RESEARCH_INTENT_RE.test(String(input || ""));
}

export function resolveMaxAutoContinueNudges(originalUserInput: string) {
  const base = (() => {
    const raw = String(typeof process !== "undefined" ? process.env?.WEBAGENT_MAX_AUTO_CONTINUE_NUDGES ?? "" : "").trim();
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return Math.max(0, parsed);
    }
    return 20;
  })();
  if (!isResearchIntent(originalUserInput)) return base;
  const researchRaw = String(
    typeof process !== "undefined" ? process.env?.WEBAGENT_RESEARCH_MAX_AUTO_CONTINUE_NUDGES ?? "" : ""
  ).trim();
  if (researchRaw) {
    const parsed = Number(researchRaw);
    if (Number.isFinite(parsed)) return Math.max(base, parsed);
  }
  return Math.max(base, 30);
}

export function shouldSuppressPostToolNudgeFromExecutions(executions: unknown[]) {
  if (!Array.isArray(executions) || executions.length === 0) return false;
  return executions.some(
    (item) =>
      item &&
      typeof item === "object" &&
      (item as { error?: unknown; retryable?: boolean; error_code?: string }).error &&
      (item as { retryable?: boolean }).retryable === false &&
      (item as { error_code?: string }).error_code === "nodebox_shell_unsupported"
  );
}

export function emitLoopStopLine(message: string) {
  if (!isDebugLogEnabled()) return;
  process.stdout.write(dim(`▸ stopped: ${message}`));
}
