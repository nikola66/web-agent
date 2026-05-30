/**
 * Per-turn deterministic tool-call loop guardrails (ported from Hermes Agent).
 */

import { createHash } from "node:crypto";
import { stableStringify } from "../stream-output.js";
import {
  formatWriteFileMissingFieldsHint,
  normalizeWriteFileArgs,
  writeFileArgsMissing,
} from "./write-file-args.js";

export const IDEMPOTENT_TOOL_NAMES = new Set([
  "read_file",
  "grep",
  "browse_workspace",
  "list_dir",
  "find_files",
  "tree",
  "file_diff",
  "web_search",
  "web_fetch",
  "web_post",
  "web_upload",
  "youtube_transcribe",
  "session_search",
  "memory_search",
  "memory_recall",
  "session_memory_list",
  "skill",
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
    if (typeof row.bytes === "number" && row.bytes > 0) return true;
    if (row.ok === true) return true;
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

export const SNAPSHOT_READ_WARN_AFTER = 1;
export const SNAPSHOT_READ_BLOCK_AFTER = 2;
export const WEB_FETCH_REPEAT_BLOCK_AFTER = 3;
export const WRITE_FILE_OVERWRITE_BLOCK_AFTER = 1;

function normalizeWriteFilePath(args: Record<string, unknown> | null | undefined): string {
  const normalized = normalizeWriteFileArgs(args ?? {});
  const path =
    typeof normalized.path === "string"
      ? normalized.path.trim()
      : typeof normalized.file === "string"
        ? normalized.file.trim()
        : "";
  return path.replace(/\\/g, "/");
}

function isSnapshotSpillReadPath(args: Record<string, unknown> | null | undefined): boolean {
  const pathArg = String(args?.path ?? args?.filename ?? args?.file ?? "").trim().replace(/\\/g, "/");
  return /^memory\/snapshots\b/i.test(pathArg);
}

function snapshotReadChainMessage(count: number): string {
  return (
    `read_file on memory/snapshots/ (${count} this turn). Use the inlined \`result\` or \`list_digest\` ` +
    "from the latest \"Tool results (compact JSON)\" message — do not chain snapshot reads. " +
    "Rerun web_fetch/web_post if the payload is missing or stale."
  );
}

function toolFailureRecoveryHint(
  toolName: string,
  count: number,
  args: Record<string, unknown> | null | undefined = null
): string {
  const common =
    `${toolName} has failed ${count} times this turn. This looks like a loop. ` +
    "Do not switch to text-only replies; keep using tools, but diagnose before retrying. " +
    "First inspect the latest error/output and verify your assumptions. ";
  if (toolName === "run_shell") {
    return (
      common +
      "In Nodebox, run_shell is not a POSIX shell — prefer run_python (with env) for .py publishers, " +
      "web_fetch/web_post for HTTP/API workflows, and read_file/write_file for workspace files. " +
      "Do not retry export/&& chains or silent node script loops."
    );
  }
  if (toolName === "grep") {
    return (
      common +
      "grep root must exist under the workspace (directory `.` or a file path). Run browse_workspace (action=list/tree) on `.`` first, " +
      "or browse_workspace (action=find) to locate a filename before grepping again."
    );
  }
  if (toolName === "read_file" || toolName === "list_dir" || toolName === "find_files") {
    const pathArg = String(args?.path ?? args?.root ?? "").trim();
    if (/^memory\/(?:runs|snapshots)\b/i.test(pathArg.replace(/\\/g, "/"))) {
      return (
        common +
        "Do not scavenge `memory/runs/` or browse `memory/snapshots/` for API data. Rerun `web_fetch`/`web_post`, " +
        "or read_file the exact `result_ref` from the latest tool batch once."
      );
    }
    return (
      common +
      "Paths are workspace-relative — run list_dir({\"path\":\".\"}) or tree before retrying. " +
      "Do not assume src/ or .webagent/package.json; use browse_workspace (action=find) to locate by name."
    );
  }
  if (toolName === "web_fetch" || toolName === "web_search") {
    return (
      common +
      "Try a different URL/query, fetch a simpler page, or use web_search to find an alternate source " +
      "before repeating the same failing request."
    );
  }
  if (toolName === "edit_file" || toolName === "write_file" || toolName === "apply_patch") {
    const pathArg = String(args?.path ?? args?.file ?? "").trim();
    const hasContent =
      typeof args?.content === "string" ||
      typeof args?.contents === "string" ||
      typeof args?.new_content === "string";
    if (toolName === "write_file" && !pathArg && !hasContent) {
      return (
        common +
        'Emit one JSON object with "path" and "content" (flat or under "arguments") — not markdown-fenced. ' +
        "For long bodies, write section-by-section: first write_file without append, then write_file with append:true."
      );
    }
    return (
      common +
      "Re-read the target file, confirm old_string/context matches exactly, try a smaller patch, " +
      "or use write_file when the file is new or empty."
    );
  }
  if (toolName === "skill") {
    return (
      common +
      "Use action=manage with manage_action=create and full SKILL.md content, manage_action=patch with old_string+new_string, " +
      "manage_action=import_dir with path to an extracted skill folder, or manage_action=write_file with name+file_path+content for support files. If rewriting SKILL.md, " +
      "include valid frontmatter (`name` and `description`) and use file_path=\"SKILL.md\"."
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
  private snapshotReadCount = 0;
  private webFetchUrlCounts = new Map<string, number>();
  private writeFileOverwriteCounts = new Map<string, number>();
  private writeFilePathLastHash = new Map<string, string>();
  private _haltDecision: ToolGuardrailDecision | null = null;

  constructor(config: ToolLoopGuardrailConfig = TOOL_LOOP_GUARDRAIL_DEFAULTS) {
    this.config = config;
    this.resetForTurn();
  }

  resetForTurn(): void {
    this.exactFailureCounts.clear();
    this.sameToolFailureCounts.clear();
    this.noProgress.clear();
    this.snapshotReadCount = 0;
    this.webFetchUrlCounts.clear();
    this.writeFileOverwriteCounts.clear();
    this.writeFilePathLastHash.clear();
    this._haltDecision = null;
  }

  get haltDecision(): ToolGuardrailDecision | null {
    return this._haltDecision;
  }

  private signatureKey(signature: ToolCallSignature): string {
    return `${signature.toolName}:${signature.argsHash}`;
  }

  private isIdempotent(
    toolName: string,
    args: Record<string, unknown> | null | undefined = null
  ): boolean {
    if (toolName === "skill") {
      const action = String(args?.action ?? "").trim().toLowerCase();
      if (action === "manage" || action === "bulk") return false;
      return action === "list" || action === "view" || !action;
    }
    if (this.config.mutatingTools.has(toolName)) return false;
    return this.config.idempotentTools.has(toolName);
  }

  beforeCall(
    toolName: string,
    args: Record<string, unknown> | null | undefined
  ): ToolGuardrailDecision {
    const signature = toolCallSignatureFromCall(toolName, args);

    if (toolName === "write_file") {
      const missing = writeFileArgsMissing(normalizeWriteFileArgs(args ?? {}));
      if (missing.length) {
        const blocked = decision({
          action: "block",
          code: "write_file_missing_required",
          message: `write_file: invalid arguments: missing required field(s) [${missing.join(", ")}]. ${formatWriteFileMissingFieldsHint(missing)}`,
          toolName,
          count: 1,
          signature,
        });
        this._haltDecision = blocked;
        return blocked;
      }
      const path = normalizeWriteFilePath(args);
      const append = args?.append === true;
      if (path && !append) {
        const lastHash = this.writeFilePathLastHash.get(path);
        const contentChanged = !!lastHash && lastHash !== signature.argsHash;
        if (contentChanged) {
          const prior = this.writeFileOverwriteCounts.get(path) ?? 0;
          if (prior >= WRITE_FILE_OVERWRITE_BLOCK_AFTER) {
            const blocked = decision({
              action: "block",
              code: "write_file_overwrite_block",
              message:
                `write_file already overwrote ${path} ${prior} time(s) this turn with different content. ` +
                "Use append:true for additional sections or edit_file for targeted changes — do not rewrite the whole file again.",
              toolName,
              count: prior,
              signature,
            });
            this._haltDecision = blocked;
            return blocked;
          }
        }
      }
    }

    if (toolName === "web_fetch") {
      const url = String(args?.url ?? "").trim();
      if (url) {
        const priorSuccesses = this.webFetchUrlCounts.get(url) ?? 0;
        const noProgEntry = this.noProgress.get(this.signatureKey(signature));
        const identicalRepeats = noProgEntry?.[1] ?? 0;
        const deferForNoProgress =
          this.config.hardStopEnabled &&
          identicalRepeats >= this.config.noProgressBlockAfter;
        if (priorSuccesses >= WEB_FETCH_REPEAT_BLOCK_AFTER && !deferForNoProgress) {
          const blocked = decision({
            action: "block",
            code: "web_fetch_repeat_block",
            message:
              `web_fetch on the same URL (${priorSuccesses} successful fetch(es) already this turn). Use list_digest/result_ref ` +
              "from the latest tool batch or web_post with minimal fields — do not refetch the full collection.",
            toolName,
            count: priorSuccesses,
            signature,
          });
          this._haltDecision = blocked;
          return blocked;
        }
      }
    }

    if (toolName === "read_file" && isSnapshotSpillReadPath(args)) {
      this.snapshotReadCount += 1;
      if (this.snapshotReadCount >= SNAPSHOT_READ_BLOCK_AFTER) {
        const blocked = decision({
          action: "block",
          code: "snapshot_read_chain_block",
          message: snapshotReadChainMessage(this.snapshotReadCount),
          toolName,
          count: this.snapshotReadCount,
          signature,
        });
        this._haltDecision = blocked;
        return blocked;
      }
    }

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

    if (this.isIdempotent(toolName, args)) {
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

    if (
      toolName === "write_file" &&
      !isFailed &&
      fileMutationResultLanded(toolName, result ?? "")
    ) {
      const path = normalizeWriteFilePath(args);
      const append = args?.append === true;
      if (path && !append) {
        const lastHash = this.writeFilePathLastHash.get(path);
        const contentChanged = !!lastHash && lastHash !== signature.argsHash;
        if (contentChanged) {
          const count = (this.writeFileOverwriteCounts.get(path) ?? 0) + 1;
          this.writeFileOverwriteCounts.set(path, count);
          if (
            this.config.warningsEnabled &&
            count === WRITE_FILE_OVERWRITE_BLOCK_AFTER
          ) {
            return decision({
              action: "warn",
              code: "write_file_overwrite_warning",
              message:
                `write_file overwrote ${path} again with different content. For additional sections use append:true; ` +
                "for edits use edit_file — do not rewrite the entire file again unless the user asked for a full rewrite.",
              toolName,
              count,
              signature,
            });
          }
        }
        this.writeFilePathLastHash.set(path, signature.argsHash);
      }
    }

    if (
      toolName === "read_file" &&
      isSnapshotSpillReadPath(args) &&
      !isFailed &&
      this.config.warningsEnabled &&
      this.snapshotReadCount === SNAPSHOT_READ_WARN_AFTER
    ) {
      return decision({
        action: "warn",
        code: "snapshot_read_chain_warning",
        message: snapshotReadChainMessage(this.snapshotReadCount),
        toolName,
        count: this.snapshotReadCount,
        signature,
      });
    }

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
          message: toolFailureRecoveryHint(toolName, sameCount, args),
          toolName,
          count: sameCount,
          signature,
        });
      }

      return decision({ toolName, count: exactCount, signature });
    }

    this.exactFailureCounts.delete(this.signatureKey(signature));
    this.sameToolFailureCounts.delete(toolName);

    if (toolName === "web_fetch") {
      const url = String(args?.url ?? "").trim();
      if (url) {
        this.webFetchUrlCounts.set(url, (this.webFetchUrlCounts.get(url) ?? 0) + 1);
      }
    }

    if (!this.isIdempotent(toolName, args)) {
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
