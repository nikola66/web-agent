/**
 * Per-turn deterministic tool-call loop guardrails (ported from Hermes Agent).
 */

import { createHash } from "node:crypto";
import { stableStringify } from "../stream-output.js";

export const IDEMPOTENT_TOOL_NAMES = new Set([
  "read_file",
  "grep",
  "list_dir",
  "find_files",
  "tree",
  "file_stat",
  "file_diff",
  "web_search",
  "web_fetch",
  "youtube_transcribe",
  "session_search",
  "memory_search",
  "memory_recall",
  "session_memory_list",
  "skill_view",
  "skill_list",
  "skill_recall",
  "wiki_search",
  "system_info",
]);

export const MUTATING_TOOL_NAMES = new Set([
  "run_shell",
  "write_file",
  "edit_file",
  "apply_patch",
  "multi_edit",
  "move_file",
  "delete_file",
  "make_dir",
  "todo_write",
  "memory_save",
  "session_memory_append",
  "skill_save",
  "skill_manage",
  "skill_bulk_save",
  "skill_delete",
  "cron_register",
  "wiki_setup",
  "wiki_sync",
  "artifact_present",
  "email",
]);

export type ToolLoopGuardrailConfig = {
  warningsEnabled: boolean;
  hardStopEnabled: boolean;
  exactFailureWarnAfter: number;
  exactFailureBlockAfter: number;
  sameToolFailureWarnAfter: number;
  sameToolFailureHaltAfter: number;
  noProgressWarnAfter: number;
  noProgressBlockAfter: number;
  idempotentTools: Set<string>;
  mutatingTools: Set<string>;
};

export const TOOL_LOOP_GUARDRAIL_DEFAULTS: ToolLoopGuardrailConfig = {
  warningsEnabled: true,
  hardStopEnabled: false,
  exactFailureWarnAfter: 2,
  exactFailureBlockAfter: 5,
  sameToolFailureWarnAfter: 3,
  sameToolFailureHaltAfter: 8,
  noProgressWarnAfter: 2,
  noProgressBlockAfter: 5,
  idempotentTools: IDEMPOTENT_TOOL_NAMES,
  mutatingTools: MUTATING_TOOL_NAMES,
};

export type ToolCallSignature = {
  toolName: string;
  argsHash: string;
};

export type ToolGuardrailAction = "allow" | "warn" | "block" | "halt";

export type ToolGuardrailDecision = {
  action: ToolGuardrailAction;
  code: string;
  message: string;
  toolName: string;
  count: number;
  signature?: ToolCallSignature;
};

function asBool(value: unknown, fallback: boolean): boolean {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Boolean(value);
  const lowered = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(lowered)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(lowered)) return false;
  return fallback;
}

function positiveInt(value: unknown, fallback: number): number {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const n = Math.trunc(parsed);
  return n >= 1 ? n : fallback;
}

export function readToolLoopGuardrailConfig(
  env: Record<string, string | undefined> = typeof process !== "undefined"
    ? (process.env as Record<string, string | undefined>)
    : {}
): ToolLoopGuardrailConfig {
  const d = TOOL_LOOP_GUARDRAIL_DEFAULTS;
  return {
    warningsEnabled: asBool(env.WEBAGENT_TOOL_LOOP_GUARDRAILS_WARNINGS ?? "1", d.warningsEnabled),
    hardStopEnabled: asBool(env.WEBAGENT_TOOL_LOOP_GUARDRAILS_HARD_STOP ?? "0", d.hardStopEnabled),
    exactFailureWarnAfter: positiveInt(
      env.WEBAGENT_TOOL_LOOP_EXACT_FAILURE_WARN_AFTER,
      d.exactFailureWarnAfter
    ),
    exactFailureBlockAfter: positiveInt(
      env.WEBAGENT_TOOL_LOOP_EXACT_FAILURE_BLOCK_AFTER,
      d.exactFailureBlockAfter
    ),
    sameToolFailureWarnAfter: positiveInt(
      env.WEBAGENT_TOOL_LOOP_SAME_TOOL_FAILURE_WARN_AFTER,
      d.sameToolFailureWarnAfter
    ),
    sameToolFailureHaltAfter: positiveInt(
      env.WEBAGENT_TOOL_LOOP_SAME_TOOL_FAILURE_HALT_AFTER,
      d.sameToolFailureHaltAfter
    ),
    noProgressWarnAfter: positiveInt(
      env.WEBAGENT_TOOL_LOOP_NO_PROGRESS_WARN_AFTER,
      d.noProgressWarnAfter
    ),
    noProgressBlockAfter: positiveInt(
      env.WEBAGENT_TOOL_LOOP_NO_PROGRESS_BLOCK_AFTER,
      d.noProgressBlockAfter
    ),
    idempotentTools: d.idempotentTools,
    mutatingTools: d.mutatingTools,
  };
}

export function canonicalToolArgs(args: Record<string, unknown>): string {
  return stableStringify(args ?? {});
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function toolCallSignatureFromCall(
  toolName: string,
  args: Record<string, unknown> | null | undefined
): ToolCallSignature {
  const canonical = canonicalToolArgs(args ?? {});
  return { toolName, argsHash: sha256(canonical) };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function fileMutationResultLanded(toolName: string, result: string): boolean {
  const parsed = safeJsonParse(result);
  if (!parsed || typeof parsed !== "object") return false;
  const row = parsed as Record<string, unknown>;
  if (toolName === "write_file" || toolName === "edit_file" || toolName === "multi_edit") {
    if (typeof row.bytes_written === "number" && row.bytes_written > 0) return true;
    if (row.success === true) return true;
  }
  if (toolName === "apply_patch") {
    if (row.success === true) return true;
    if (typeof row.diff === "string" && row.diff.length > 0) return true;
  }
  return false;
}

export function classifyToolFailure(toolName: string, result: string | null | undefined): boolean {
  if (result == null) return false;
  if (fileMutationResultLanded(toolName, result)) return false;

  if (toolName === "run_shell") {
    const data = safeJsonParse(result);
    if (data && typeof data === "object") {
      const exitCode = (data as Record<string, unknown>).exit_code;
      if (exitCode != null && exitCode !== 0) return true;
    }
    return false;
  }

  const lower = result.slice(0, 500).toLowerCase();
  if (lower.includes('"error"') || lower.includes('"failed"') || result.startsWith("Error")) {
    return true;
  }
  return false;
}

function resultHash(result: string | null | undefined): string {
  const parsed = safeJsonParse(result ?? "");
  if (parsed != null) {
    try {
      return sha256(stableStringify(parsed as Record<string, unknown>));
    } catch {
      return sha256(String(parsed));
    }
  }
  return sha256(result ?? "");
}

function toolFailureRecoveryHint(toolName: string, count: number): string {
  const common =
    `${toolName} has failed ${count} times this turn. This looks like a loop. ` +
    "Do not switch to text-only replies; keep using tools, but diagnose before retrying. " +
    "First inspect the latest error/output and verify your assumptions. ";
  if (toolName === "run_shell") {
    return (
      common +
      "For terminal failures, run a small diagnostic such as `pwd && ls -la` in the same tool, " +
      "then try an absolute path, a simpler command, a different working directory, or a different " +
      "tool such as read_file/write_file/apply_patch."
    );
  }
  return (
    common +
    "Try different arguments, a narrower query/path, an absolute path when relevant, or a different " +
    "tool that can make progress. If the blocker is external, report the blocker after one " +
    "diagnostic attempt instead of repeating the same failing path."
  );
}

function decision(
  partial: Partial<ToolGuardrailDecision> & Pick<ToolGuardrailDecision, "toolName">
): ToolGuardrailDecision {
  return {
    action: partial.action ?? "allow",
    code: partial.code ?? "allow",
    message: partial.message ?? "",
    toolName: partial.toolName,
    count: partial.count ?? 0,
    signature: partial.signature,
  };
}

export class ToolCallGuardrailController {
  private readonly config: ToolLoopGuardrailConfig;
  private exactFailureCounts = new Map<string, number>();
  private sameToolFailureCounts = new Map<string, number>();
  private noProgress = new Map<string, [string, number]>();
  private _haltDecision: ToolGuardrailDecision | null = null;

  constructor(config: ToolLoopGuardrailConfig = TOOL_LOOP_GUARDRAIL_DEFAULTS) {
    this.config = config;
    this.resetForTurn();
  }

  resetForTurn(): void {
    this.exactFailureCounts.clear();
    this.sameToolFailureCounts.clear();
    this.noProgress.clear();
    this._haltDecision = null;
  }

  get haltDecision(): ToolGuardrailDecision | null {
    return this._haltDecision;
  }

  private signatureKey(signature: ToolCallSignature): string {
    return `${signature.toolName}:${signature.argsHash}`;
  }

  private isIdempotent(toolName: string): boolean {
    if (this.config.mutatingTools.has(toolName)) return false;
    return this.config.idempotentTools.has(toolName);
  }

  beforeCall(
    toolName: string,
    args: Record<string, unknown> | null | undefined
  ): ToolGuardrailDecision {
    const signature = toolCallSignatureFromCall(toolName, args);
    if (!this.config.hardStopEnabled) {
      return decision({ toolName, signature });
    }

    const exactCount = this.exactFailureCounts.get(this.signatureKey(signature)) ?? 0;
    if (exactCount >= this.config.exactFailureBlockAfter) {
      const blocked = decision({
        action: "block",
        code: "repeated_exact_failure_block",
        message:
          `Blocked ${toolName}: the same tool call failed ${exactCount} times with identical arguments. ` +
          "Stop retrying it unchanged; change strategy or explain the blocker.",
        toolName,
        count: exactCount,
        signature,
      });
      this._haltDecision = blocked;
      return blocked;
    }

    if (this.isIdempotent(toolName)) {
      const record = this.noProgress.get(this.signatureKey(signature));
      if (record) {
        const [, repeatCount] = record;
        if (repeatCount >= this.config.noProgressBlockAfter) {
          const blocked = decision({
            action: "block",
            code: "idempotent_no_progress_block",
            message:
              `Blocked ${toolName}: this read-only call returned the same result ${repeatCount} times. ` +
              "Stop repeating it unchanged; use the result already provided or try a different query.",
            toolName,
            count: repeatCount,
            signature,
          });
          this._haltDecision = blocked;
          return blocked;
        }
      }
    }

    return decision({ toolName, signature });
  }

  afterCall(
    toolName: string,
    args: Record<string, unknown> | null | undefined,
    result: string | null | undefined,
    failed?: boolean
  ): ToolGuardrailDecision {
    const signature = toolCallSignatureFromCall(toolName, args);
    const isFailed = failed ?? classifyToolFailure(toolName, result ?? null);

    if (isFailed) {
      const key = this.signatureKey(signature);
      const exactCount = (this.exactFailureCounts.get(key) ?? 0) + 1;
      this.exactFailureCounts.set(key, exactCount);
      this.noProgress.delete(key);

      const sameCount = (this.sameToolFailureCounts.get(toolName) ?? 0) + 1;
      this.sameToolFailureCounts.set(toolName, sameCount);

      if (this.config.hardStopEnabled && sameCount >= this.config.sameToolFailureHaltAfter) {
        const halt = decision({
          action: "halt",
          code: "same_tool_failure_halt",
          message:
            `Stopped ${toolName}: it failed ${sameCount} times this turn. ` +
            "Stop retrying the same failing tool path and choose a different approach.",
          toolName,
          count: sameCount,
          signature,
        });
        this._haltDecision = halt;
        return halt;
      }

      if (this.config.warningsEnabled && exactCount >= this.config.exactFailureWarnAfter) {
        return decision({
          action: "warn",
          code: "repeated_exact_failure_warning",
          message:
            `${toolName} has failed ${exactCount} times with identical arguments. ` +
            "This looks like a loop; inspect the error and change strategy instead of retrying it unchanged.",
          toolName,
          count: exactCount,
          signature,
        });
      }

      if (this.config.warningsEnabled && sameCount >= this.config.sameToolFailureWarnAfter) {
        return decision({
          action: "warn",
          code: "same_tool_failure_warning",
          message: toolFailureRecoveryHint(toolName, sameCount),
          toolName,
          count: sameCount,
          signature,
        });
      }

      return decision({ toolName, count: exactCount, signature });
    }

    this.exactFailureCounts.delete(this.signatureKey(signature));
    this.sameToolFailureCounts.delete(toolName);

    if (!this.isIdempotent(toolName)) {
      this.noProgress.delete(this.signatureKey(signature));
      return decision({ toolName, signature });
    }

    const hash = resultHash(result);
    const previous = this.noProgress.get(this.signatureKey(signature));
    let repeatCount = 1;
    if (previous && previous[0] === hash) {
      repeatCount = previous[1] + 1;
    }
    this.noProgress.set(this.signatureKey(signature), [hash, repeatCount]);

    if (this.config.warningsEnabled && repeatCount >= this.config.noProgressWarnAfter) {
      return decision({
        action: "warn",
        code: "idempotent_no_progress_warning",
        message:
          `${toolName} returned the same result ${repeatCount} times. ` +
          "Use the result already provided or change the query instead of repeating it unchanged.",
        toolName,
        count: repeatCount,
        signature,
      });
    }

    return decision({ toolName, count: repeatCount, signature });
  }
}

export function toolGuardrailSyntheticResult(dec: ToolGuardrailDecision): string {
  return JSON.stringify({
    error: dec.message,
    guardrail: {
      action: dec.action,
      code: dec.code,
      message: dec.message,
      tool_name: dec.toolName,
      count: dec.count,
      signature: dec.signature
        ? { tool_name: dec.signature.toolName, args_hash: dec.signature.argsHash }
        : undefined,
    },
  });
}

export function appendToolGuardrailGuidance(
  result: string | null | undefined,
  dec: ToolGuardrailDecision
): string {
  if ((dec.action !== "warn" && dec.action !== "halt") || !dec.message) return result ?? "";
  const label = dec.action === "halt" ? "Tool loop hard stop" : "Tool loop warning";
  return `${result ?? ""}\n\n[${label}: ${dec.code}; count=${dec.count}; ${dec.message}]`;
}

export function executionResultText(item: Record<string, unknown> | null | undefined): string {
  if (!item) return "";
  if (item.error != null) return String(item.error);
  const result = item.result;
  if (typeof result === "string") return result;
  if (result != null) return stableStringify(result);
  return "";
}
